import json
from pathlib import Path
import tempfile
import unittest
from pilot import Pilot, day

CHANNEL = 'UC' + 'a' * 22

class PilotTests(unittest.TestCase):
    def make(self, transport):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        p = Pilot(temp.name, transport)
        self.addCleanup(p.db.close)
        p.seed({'exported_at': '2026-10-29T00:00:00Z', 'channels': [{'id': CHANNEL, 'name': 'Test', 'uploads': 'UUtest', 'discovery_scope': 'eligible'}], 'catalog': [{'id': 'excluded123', 'decision': 'EXCLUDED'}]})
        return p

    def test_checkpoint_reconciliation_and_exhaustion(self):
        calls = []
        def api(endpoint, params):
            calls.append((endpoint, params))
            if endpoint == 'playlistItems':
                if params.get('pageToken'):
                    return {'items': []}
                return {'nextPageToken': 'page2', 'items': [{'contentDetails': {'videoId': v}} for v in ['excluded123', 'candidate12', 'unknown1234']]}
            return {'items': [{'id': v, 'snippet': {'title': 'Missioned Souls reaction' if v != 'unknown1234' else 'Other title', 'publishedAt': '2020-01-01T00:00:00Z'}} for v in params['id'].split(',')]}
        p = self.make(api)
        self.assertTrue(p.step())
        self.assertEqual(p.db.execute('SELECT token FROM channels').fetchone()[0], 'page2')
        classes = dict(p.db.execute('SELECT id,classification FROM videos'))
        self.assertEqual(classes['excluded123'], 'existing:EXCLUDED')
        self.assertEqual(classes['candidate12'], 'review')
        self.assertEqual(classes['unknown1234'], 'unmatched')
        self.assertTrue(p.step())
        self.assertFalse(p.step())
        self.assertEqual(p.report()['channels'][0]['state'], 'exhausted')
        self.assertEqual(p.report()['today']['requests'], 3)

    def test_budget_counts_failed_attempt_and_preserves_cursor(self):
        def failure(*_):
            raise ValueError('Network error')
        p = self.make(failure)
        p.limit = 1
        with self.assertRaisesRegex(RuntimeError, 'Daily request cap'):
            p.step()
        self.assertEqual(p.report()['today']['requests'], 1)
        self.assertIsNone(p.report()['channels'][0]['token'])
        self.assertEqual(p.report()['channels'][0]['state'], 'queued')

    def test_resume_after_metadata_budget_exhaustion(self):
        def api(endpoint, params):
            if endpoint == 'playlistItems':
                return {'items': [{'contentDetails': {'videoId': 'candidate12'}}]}
            return {'items': [{'id': 'candidate12', 'snippet': {'title': 'Missioned Souls reaction'}}]}
        p = self.make(api)
        p.limit = 1
        with self.assertRaisesRegex(RuntimeError, 'Daily request cap'):
            p.step()
        self.assertEqual(p.report()['today']['pages'], 0)
        self.assertEqual(p.db.execute('SELECT COUNT(*) FROM videos').fetchone()[0], 0)
        p.limit = 3
        p.step()
        self.assertFalse(p.step())
        self.assertEqual(p.report()['today']['pages'], 1)
        self.assertEqual(p.report()['today']['candidates'], 1)

    def test_repeated_token_is_not_completion(self):
        p = self.make(lambda *_: {'items': [], 'nextPageToken': 'same'})
        p.step()
        with self.assertRaisesRegex(RuntimeError, 'Repeated continuation'):
            p.step()
        self.assertEqual(p.report()['channels'][0]['state'], 'error')
        self.assertEqual(p.report()['today']['pages'], 1)

    def test_week_has_seven_completed_days(self):
        p = self.make(lambda *_: {})
        self.assertEqual(len(p.report()['daily']), 15)
        self.assertEqual(p.report()['weekly']['measured_days'], 0)
        self.assertEqual(p.report()['previous_week']['measured_days'], 0)

    def test_active_reactor_visible_during_request_and_cleared_after(self):
        observed = []
        def api(endpoint, params):
            report = p.report()
            observed.append(report['active_channel'])
            self.assertEqual(report['channels'][0]['display_state'], 'Scanning now')
            return {'items': []}
        p = self.make(api)
        p.step()
        self.assertEqual(observed[0]['name'], 'Test')
        self.assertEqual(observed[0]['page'], 1)
        self.assertEqual(observed[0]['phase'], 'Reading upload page')
        self.assertIsNone(p.report()['active_channel'])
        self.assertEqual(p.report()['channels'][0]['display_state'], 'Upload history exhausted')

if __name__ == '__main__':
    unittest.main()
