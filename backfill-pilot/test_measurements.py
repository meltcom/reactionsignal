import datetime as dt
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest
import urllib.error
import measurements
import test_pilot
from pilot import Pilot, day, now, PT


class MeasurementTests(unittest.TestCase):
    def make(self, transport):
        return test_pilot.PilotTests.make(self, transport)

    def scan(self):
        calls = []
        def transport(endpoint, params):
            calls.append((endpoint, params))
            if endpoint == 'playlistItems':
                return {'nextPageToken': 'second' if not params.get('pageToken') else None,
                        'items': [{'contentDetails': {'videoId': vid}} for vid in ['excluded123', 'candidate12', 'unmatched12']]}
            return {'items': [{'id': vid, 'snippet': {'title': 'Missioned Souls reaction' if vid == 'candidate12' else 'Other title'}} for vid in params['id'].split(',')]}
        p = self.make(transport)
        p.step()
        p.step()
        return p, calls

    def test_early_dedupe_counts_id_savings_without_inventing_request_savings(self):
        p, calls = self.scan()
        metadata = [params for endpoint, params in calls if endpoint == 'videos']
        self.assertEqual(len(metadata), 1)
        self.assertEqual(metadata[0]['id'], 'candidate12,unmatched12')
        m = p.report()['measurements']['lifetime']
        self.assertEqual(m['requests'], 3)
        self.assertEqual(m['encountered'], 6)
        self.assertEqual(m['existing_ids'], 2)
        self.assertEqual(m['repeat_ids'], 2)
        self.assertEqual(m['metadata_ids_avoided'], 4)
        self.assertEqual(m['metadata_requests_avoided'], 1)
        self.assertEqual(m['metadata_ids_requested'], 2)
        self.assertEqual(m['candidates'], 1)
        self.assertEqual(m['new_records'], 2)
        self.assertEqual(m['verified_missing'], 0)
        self.assertEqual(m['request_duration_samples'], 3)
        self.assertEqual(len(p.report()['measurements']['yields']), 2)

    def test_verified_outcome_requires_evidence_attestation_and_new_live_check(self):
        p, _ = self.scan()
        base = dict(video_id='candidate12', outcome='verified_missing', reason='Qualifying reaction', evidence='Reviewed video and live RJ catalog', live_checked_at=now())
        with self.assertRaisesRegex(ValueError, 'Attest'):
            measurements.save_review(p, base)
        base['live_check_attested'] = True
        base['live_checked_at'] = '2020-01-01T00:00:00Z'
        with self.assertRaises(ValueError):
            measurements.save_review(p, base)
        base['live_checked_at'] = now()
        measurements.save_review(p, base)
        m = p.report()['measurements']
        self.assertEqual(m['lifetime']['verified_missing'], 1)
        self.assertEqual(m['lifetime']['verified_per_request'], round(1/3,4))
        self.assertEqual(sum(g['verified_missing'] for g in m['yields']), 1)
        measurements.save_review(p, dict(video_id='candidate12', outcome='false_positive', reason='Correction after review', review_seconds=12))
        self.assertEqual(p.report()['measurements']['lifetime']['verified_missing'], 0)
        self.assertEqual(p.db.execute('SELECT COUNT(*) FROM reviews').fetchone()[0], 2)
        self.assertEqual(p.report()['measurements']['review_seconds'], 12)
        base['video_id'] = 'excluded123'
        base['live_checked_at'] = now()
        with self.assertRaisesRegex(ValueError, 'Existing RJ'):
            measurements.save_review(p, base)

    def test_saved_sample_reproducible_and_interval_only_after_review(self):
        p, _ = self.scan()
        sample = measurements.sample(p, 'unmatched', 20, 42)
        self.assertEqual(sample['population'], 1)
        self.assertEqual(sample['video_ids'], measurements.sample(p, 'unmatched', 20, 42)['video_ids'])
        self.assertIsNone(p.report()['measurements']['audit_samples'][0]['wilson_95_interval'])
        measurements.save_review(p, dict(video_id='unmatched12', outcome='false_positive', reason='Not MS', sample_id=sample['id']))
        result = p.report()['measurements']['audit_samples'][0]
        self.assertTrue(result['complete'])
        self.assertEqual(result['positive'], 0)
        self.assertGreater(result['wilson_95_interval'][1], .5)  # One negative is weak evidence.
        with self.assertRaises(ValueError):
            measurements.save_review(p, dict(video_id='candidate12', outcome='unresolved', reason='Wrong sample', sample_id=sample['id']))

    def test_failed_reserved_and_legacy_are_separate(self):
        p = self.make(lambda *_: {})
        with p.db:
            for status in ('failed', 'reserved', None):
                p.db.execute('INSERT INTO attempts(at,day,endpoint,status) VALUES(?,?,?,?)', (now(), day(), 'videos', status))
        m = p.report()['measurements']['lifetime']
        self.assertEqual(m['requests'], 3)
        self.assertEqual(m['failures'], 1)
        self.assertEqual(m['unfinished_requests'], 1)
        self.assertEqual(m['legacy_requests'], 1)
        self.assertEqual(p.report()['today']['failures'], 1)

    def test_retry_cost_and_duration_not_lost(self):
        count = 0
        def transport(*_):
            nonlocal count
            count += 1
            if count == 1:
                raise urllib.error.HTTPError('redacted', 503, 'Unavailable', {}, None)
            return {'items': []}
        p = self.make(transport)
        p.stop.wait = lambda _: False
        p.step()
        rows = list(p.db.execute('SELECT retry_index,status,http_status,duration_ms FROM attempts ORDER BY id'))
        self.assertEqual([r[0] for r in rows], [0,1])
        self.assertEqual([r[1] for r in rows], ['failed','succeeded'])
        self.assertEqual(rows[0][2], 503)
        self.assertTrue(all(r[3] >= 0 for r in rows))

    def test_week_boundaries_and_today_exclusion(self):
        p = self.make(lambda *_: {})
        today = dt.datetime.now(PT).date()
        with p.db:
            for offset in (0,1,7,8,14,15):
                date = (today-dt.timedelta(days=offset)).isoformat()
                p.db.execute("INSERT INTO attempts(at,day,endpoint,status) VALUES(?,?,?,'succeeded')", (now(), date, 'videos'))
        m = p.report()['measurements']
        self.assertEqual(m['daily'][0]['requests'], 1)
        self.assertEqual(m['weekly']['requests'], 2)
        self.assertEqual(m['previous_week']['requests'], 2)
        self.assertEqual(m['weekly']['measured_days'], 2)

    def test_legacy_migration_preserves_unknown_history(self):
        with tempfile.TemporaryDirectory() as folder:
            db = sqlite3.connect(Path(folder)/'campaign.sqlite3')
            db.execute('CREATE TABLE attempts(id INTEGER PRIMARY KEY,at TEXT,day TEXT,endpoint TEXT,success INTEGER DEFAULT 0,error TEXT)')
            db.execute('INSERT INTO attempts(at,day,endpoint,success) VALUES(?,?,?,1)', (now(), day(), 'videos'))
            db.commit()
            db.close()
            p = Pilot(folder)
            self.assertEqual(p.report()['measurements']['lifetime']['legacy_requests'], 1)
            self.assertEqual(p.report()['measurements']['lifetime']['pages'], 0)
            self.assertIsNone(p.db.execute('SELECT duration_ms FROM attempts').fetchone()[0])
            p.db.close()

    def test_cross_midnight_yield_uses_discovery_cohort_cost(self):
        p, _ = self.scan()
        yesterday = (dt.datetime.now(PT).date()-dt.timedelta(days=1)).isoformat()
        with p.db:
            p.db.execute('UPDATE measurement_batches SET day=?', (yesterday,))
        measurements.save_review(p, dict(video_id='candidate12',outcome='verified_missing',reason='Controlled fixture',evidence='Synthetic verification',live_checked_at=now(),live_check_attested=True))
        report = p.report()['measurements']
        self.assertEqual(report['daily'][0]['requests'], 3)
        self.assertEqual(report['daily'][1]['requests'], 0)
        self.assertEqual(report['daily'][1]['cohort_requests'], 3)
        self.assertEqual(report['daily'][1]['verified_per_request'], round(1/3,4))

    def test_health_baseline_available_before_first_pilot_request(self):
        p = self.make(lambda *_: {})
        payload = dict(schema='rj-readonly-monitor-v1',exported_at=now(),quota_day=day(),usage=[],coverage=[dict(eligible=437,checked=437)],
                       health=[dict(sampled_at=now(),eligible=437,checked=437,run_status='succeeded')],
                       observations=[dict(discovered_at=now(),delay_seconds=600),dict(discovered_at=now(),delay_seconds=90000)])
        measurements.import_monitor(p,payload)
        result = p.report()['measurements']['monitor']
        self.assertEqual(result['before_pilot']['health_samples'],1)
        self.assertEqual(result['before_pilot']['fresh_delay_samples'],1)
        self.assertEqual(result['before_pilot']['median_fresh_delay_seconds'],600)
        self.assertEqual(result['during_pilot']['health_samples'],0)
        self.assertEqual(result['health_status'],'fresh')

    def test_monitor_staleness_unknown_consumers_and_no_implicit_authorization(self):
        p = self.make(lambda *_: {})
        self.assertEqual(p.report()['measurements']['monitor']['status'], 'missing')
        payload = dict(schema='rj-readonly-monitor-v1', exported_at=(dt.datetime.now(dt.timezone.utc)-dt.timedelta(hours=2)).isoformat(), quota_day=day(), usage=[{'key':'youtube-requests:2026-10-30:videos','value':'123'}], health=[], observations=[], coverage=[])
        measurements.import_monitor(p, payload)
        measurements.import_monitor(p, payload)
        m = p.report()['measurements']['monitor']
        self.assertEqual(m['status'], 'stale')
        self.assertFalse(m['quota_complete'])
        self.assertEqual(m['observed_rj_general_upper_bound'], 123)
        self.assertEqual(p.db.execute('SELECT COUNT(*) FROM rj_monitor_samples').fetchone()[0], 1)
        self.assertIsNone(p.worker)


if __name__ == '__main__':
    unittest.main()
