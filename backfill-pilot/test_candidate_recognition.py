import json
from pathlib import Path
import sqlite3
import sys
import tempfile
import unittest
from candidate_recognition import recognize_candidate, candidate_evidence

ROOT = Path(__file__).resolve().parent
FIXTURE = ROOT / 'candidate-fixtures.json'
if not FIXTURE.exists():
    FIXTURE = ROOT.parent / 'tests/fixtures/ms-candidates/golden-fixtures.json'


class CandidateTests(unittest.TestCase):
    def test_shared_golden_contract(self):
        data = json.loads(FIXTURE.read_text(encoding='utf-8'))
        for row in data['observedCases'] + data['syntheticCases']:
            with self.subTest(case=row['caseId']):
                self.assertEqual(recognize_candidate(row['input']), row['expectedRecognizer'])

    def test_replay_preserves_database_and_known_decisions(self):
        from replay_candidates import replay
        with tempfile.TemporaryDirectory() as folder:
            dbfile, output = Path(folder)/'campaign.sqlite3', Path(folder)/'audit.json'
            with sqlite3.connect(dbfile) as db:
                db.executescript('CREATE TABLE catalog(id TEXT,decision TEXT); CREATE TABLE videos(id TEXT,channel TEXT,title TEXT,classification TEXT,evidence TEXT);')
                for vid, decision in [('known','EXCLUDED'),('new','unmatched'),('gone','unavailable')]:
                    evidence=json.dumps({'snippet':{'title':'Missioned Soul band'}})
                    db.execute('INSERT INTO videos VALUES(?,?,?,?,?)',(vid,'UC'+'a'*22,'Missioned Soul band',decision if vid!='known' else 'existing:EXCLUDED',evidence))
                db.execute("INSERT INTO catalog VALUES('known','EXCLUDED')")
            db.close()
            before=dbfile.read_bytes()
            report=replay(dbfile,output)
            rows={r['id']:r for r in report['results']}
            self.assertEqual(rows['new']['proposed'],'review')
            self.assertEqual(rows['known']['proposed'],'existing:EXCLUDED')
            self.assertEqual(rows['gone']['proposed'],'unavailable')
            self.assertEqual(dbfile.read_bytes(),before)
            with self.assertRaises(ValueError): replay(dbfile,output)

    def test_live_capture_keeps_known_skip_and_review_only_evidence(self):
        from pilot import Pilot
        channel='UCZ77h_VX7l7SOOh7uAmZuVA'
        calls=[]
        def transport(endpoint,params):
            calls.append((endpoint,params))
            if endpoint=='playlistItems':return {'items':[{'contentDetails':{'videoId':v}} for v in ('candidate12','excluded123')]}
            return {'items':[{'id':'candidate12','snippet':{'channelId':channel,'title':'MS BAND / a song','publishedAt':'2020-01-01T00:00:00Z'}}]}
        with tempfile.TemporaryDirectory() as folder:
            pilot=Pilot(folder,transport)
            try:
                pilot.seed({'exported_at':'2026-10-29T00:00:00Z','channels':[{'id':channel,'name':'Bobcat','uploads':'UUtest','discovery_scope':'eligible'}],'catalog':[{'id':'excluded123','decision':'EXCLUDED'}]})
                pilot.step()
                rows={r['id']:dict(r) for r in pilot.db.execute('SELECT * FROM videos')}
                self.assertEqual(rows['candidate12']['classification'],'review')
                audit=json.loads(rows['candidate12']['evidence'])['_rj_candidate_recognition']
                self.assertEqual(audit['recognition']['primaryRuleId'],'bobcat_abbreviation')
                self.assertEqual(len(audit['policyHash']),64)
                self.assertEqual(rows['excluded123']['classification'],'existing:EXCLUDED')
                self.assertEqual(calls[1][1]['id'],'candidate12')
                self.assertEqual(pilot.db.execute('SELECT matcher_version FROM measurement_batches').fetchone()[0],audit['policyVersion'])
            finally:pilot.db.close()


if __name__ == '__main__':
    if sys.argv[1:] == ['--evidence-json']:
        print(json.dumps([candidate_evidence(row) for row in json.loads(sys.stdin.buffer.read())]))
    else:
        unittest.main()
