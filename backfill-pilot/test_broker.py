import io
import json
import os
import tempfile
import unittest
import urllib.error
from unittest.mock import patch
from broker import BrokerClient,BrokerError,PROTOCOL
from pilot import Pilot


class Reply(io.BytesIO):
    def __init__(self,payload):
        super().__init__(json.dumps(payload).encode())
        self.headers={'X-RJ-Quota-Protocol':PROTOCOL}


class BrokerTests(unittest.TestCase):
    def test_origin_and_redirect_protection(self):
        for origin in ('http://reactionjourney.com','https://reactionjourney.com.attacker.test','https://user:secret@reactionjourney.com','https://reactionjourney.com/path'):
            with patch.dict(os.environ,{'RJ_BACKFILL_ORIGIN':origin,'RJ_BACKFILL_TOKEN':'x'*40}):
                with self.assertRaises(BrokerError):BrokerClient().configuration()

    def test_receipt_and_no_youtube_key_in_request(self):
        client=BrokerClient()
        class Opener:
            def open(self,request,timeout):
                self.request=request
                return Reply(dict(data={'items':[]},receipt=dict(protocol=PROTOCOL,units=1,requestId='fixture',quotaDay='2026-10-30')))
        opener=Opener();client.opener=opener
        with patch.dict(os.environ,{'RJ_BACKFILL_TOKEN':'fixture-token-'*4,'RJ_BACKFILL_ORIGIN':'https://reactionjourney.com','YOUTUBE_BACKFILL_API_KEY':'unused-key'}):
            result=client.execute('videos',dict(id='testvideo01'),'UC'+'a'*22)
        self.assertEqual(result['_rj_quota_receipt']['units'],1)
        self.assertNotIn('unused-key',str(opener.request.headers)+opener.request.data.decode())
        self.assertEqual(opener.request.full_url,'https://reactionjourney.com/api/backfill/execute')
        self.assertTrue(opener.request.get_header('User-agent').startswith('ReactionJourneyBackfillPilot/'))

    def test_denial_has_zero_provider_cost_and_lost_response_is_ambiguous(self):
        client=BrokerClient()
        class Opener:
            def open(self,*_,**__):
                raise urllib.error.HTTPError('redacted',429,'Denied',{'X-RJ-Quota-Charged':'0'},io.BytesIO(b'{"code":"fresh_reserve_protected"}'))
        client.opener=Opener()
        with patch.dict(os.environ,{'RJ_BACKFILL_TOKEN':'x'*40}):
            with self.assertRaises(BrokerError) as caught:client.status()
        self.assertEqual(caught.exception.quota_units,0)
        self.assertFalse(caught.exception.retryable)
        class Offline:
            def open(self,*_,**__):raise urllib.error.URLError('network failure')
        client.opener=Offline()
        with patch.dict(os.environ,{'RJ_BACKFILL_TOKEN':'x'*40}):
            with self.assertRaises(BrokerError) as caught:client.status()
        self.assertIsNone(caught.exception.quota_units)

    def test_quota_denial_defers_page_without_marking_reactor_bad(self):
        with tempfile.TemporaryDirectory() as folder:
            p=Pilot(folder)
            p.seed(dict(exported_at='2026-10-30T00:00:00Z',channels=[dict(id='UC'+'a'*22,name='Test',uploads='UUtest',discovery_scope='eligible')],catalog=[]))
            def deny(*_):raise BrokerError('fresh_reserve_protected',units=0)
            p.transport=deny
            with self.assertRaises(BrokerError):p.step()
            report=p.report()
            self.assertEqual(report['channels'][0]['state'],'queued')
            self.assertIsNone(report['channels'][0]['token'])
            self.assertEqual(report['measurements']['lifetime']['broker_denials'],1)
            self.assertEqual(report['measurements']['lifetime']['general_units_confirmed'],0)
            self.assertEqual(report['measurements']['lifetime']['general_units_unknown'],0)
            self.assertEqual(report['measurements']['lifetime']['failed_batches'],0)
            p.db.close()

    def test_start_requires_ready_broker_and_unconfigured_status_fails_closed(self):
        with tempfile.TemporaryDirectory() as folder:
            p=Pilot(folder)
            p.seed(dict(exported_at='2026-10-30T00:00:00Z',channels=[],catalog=[]))
            with patch.dict(os.environ,{},clear=True):
                status=p.check_broker()
                self.assertFalse(status['ready'])
                with self.assertRaises(ValueError):p.start()
            self.assertIsNone(p.worker)
            p.db.close()

    def test_ready_verified_gate_can_start_a_controlled_empty_campaign(self):
        with tempfile.TemporaryDirectory() as folder:
            p=Pilot(folder,lambda *_:{'items':[]})
            p.seed(dict(exported_at='2026-10-30T00:00:00Z',channels=[],catalog=[]))
            p.broker.status=lambda:dict(protocol=PROTOCOL,ready=True,tracking=True,verified=True,enabled=True,baselineComplete=True,healthy=True,searchLimit=0,backfillLimit=10,reserve=2000)
            p.start()
            p.worker.join(timeout=2)
            self.assertEqual(p.limit,10)
            self.assertFalse(p.starting)
            self.assertEqual(p.db.execute('SELECT COUNT(*) FROM attempts').fetchone()[0],0)
            p.db.close()


if __name__=='__main__':unittest.main()
