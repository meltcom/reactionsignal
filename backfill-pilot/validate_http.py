"""Offline local HTTP workflow check using synthetic evidence in a temporary DB."""
import json
import re
import tempfile
import threading
import urllib.error
import urllib.request
from pilot import Pilot, make_server


def validate():
    def transport(endpoint, params):
        if endpoint == 'playlistItems':
            return {'items':[{'contentDetails':{'videoId':'testvideo01'}}]}
        return {'items':[{'id':'testvideo01','snippet':{'title':'Synthetic Missioned Souls reaction'}}]}
    with tempfile.TemporaryDirectory() as folder:
        pilot=Pilot(folder,transport)
        pilot.seed(dict(exported_at='2026-10-30T00:00:00Z',channels=[dict(id='UC'+'a'*22,name='Synthetic validation reactor',uploads='UUtest',discovery_scope='eligible')],catalog=[]))
        pilot.step()
        server=make_server(pilot,0)
        thread=threading.Thread(target=server.serve_forever,daemon=True)
        thread.start()
        base='http://127.0.0.1:'+str(server.server_address[1])
        def request(path,payload=None,token=None):
            headers={'X-Pilot-Token':token} if token else {}
            req=urllib.request.Request(base+path,data=json.dumps(payload).encode() if payload is not None else None,headers=headers)
            with urllib.request.urlopen(req,timeout=10) as response:
                return response.read().decode()
        try:
            html=request('/')
            assert '__MEASUREMENT_PANEL__' not in html
            assert 'Effectiveness and measurement quality' in html
            token=re.search(r'name="pilot-token" content="([^"]+)"',html)[1]
            assert 'renderMeasurements' in request('/measurement-ui.js')
            status=json.loads(request('/api/status'))
            assert status['measurements']['lifetime']['requests']==2
            evidence=json.loads(request('/api/evidence?classification=review'))
            assert evidence['total']==1
            try:
                request('/api/review',dict(video_id='testvideo01',outcome='false_positive',reason='Synthetic check'),None)
                raise AssertionError('Missing CSRF token accepted')
            except urllib.error.HTTPError as error:
                assert error.code==403
            sample=json.loads(request('/api/sample',dict(stratum='review',size=1,seed=7),token))
            request('/api/review',dict(video_id='testvideo01',outcome='false_positive',reason='Synthetic check',sample_id=sample['id'],review_seconds=4),token)
            status=json.loads(request('/api/status'))
            assert status['measurements']['review_outcomes']['false_positive']==1
            assert status['measurements']['audit_samples'][0]['complete']
            export=json.loads(request('/export.txt'))
            assert len(export['all_results'])==1
            assert len(export['audit']['reviews'])==1
            assert len(export['audit']['attempts'])==2
            print('Offline HTTP checks passed: UI assets, status, evidence, CSRF rejection, sampling, review correction and full text audit export.')
        finally:
            server.shutdown();server.server_close();thread.join();pilot.db.close()


if __name__=='__main__':
    validate()
