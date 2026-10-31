"""Narrow authenticated RJ transport. The YouTube key remains in RJ's Worker."""
import json
import os
import urllib.error
import urllib.request
import urllib.parse
import uuid

PROTOCOL='rj-backfill-broker-v1'


class BrokerError(RuntimeError):
    def __init__(self, code, *, units=None, retryable=False):
        super().__init__('RJ broker: '+code)
        self.broker_code=code
        self.quota_units=units
        self.retryable=retryable


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *_):
        return None


class BrokerClient:
    def __init__(self):
        self.opener=urllib.request.build_opener(NoRedirect())

    def configuration(self):
        origin=os.environ.get('RJ_BACKFILL_ORIGIN','https://reactionjourney.com').rstrip('/')
        url=urllib.parse.urlsplit(origin)
        staging=url.hostname and url.hostname.startswith(('reactionsignal-preview.','reactionsignal-staging.')) and url.hostname.endswith('.workers.dev')
        if url.scheme!='https' or url.username or url.password or url.query or url.fragment or url.path or url.port not in (None,443) or not(url.hostname=='reactionjourney.com' or staging):
            raise BrokerError('invalid_broker_origin',units=0)
        token=os.environ.get('RJ_BACKFILL_TOKEN','')
        if len(token)<32:
            raise BrokerError('set_RJ_BACKFILL_TOKEN_in_local_environment',units=0)
        return origin,token

    def request(self,path,payload=None):
        origin,token=self.configuration()
        headers={'Authorization':'Bearer '+token,'Accept':'application/json'}
        if payload is not None:
            headers['Content-Type']='application/json'
        request=urllib.request.Request(origin+path,data=json.dumps(payload).encode() if payload is not None else None,headers=headers)
        try:
            with self.opener.open(request,timeout=25) as response:
                result=json.load(response)
                if response.headers.get('X-RJ-Quota-Protocol')!=PROTOCOL:
                    raise BrokerError('unverified_broker_protocol')
                return result
        except urllib.error.HTTPError as error:
            charged=error.headers.get('X-RJ-Quota-Charged')
            units=int(charged) if charged in ('0','1') else None
            try:
                code=json.load(error).get('code','http_'+str(error.code))
            except (ValueError,AttributeError):
                code='http_'+str(error.code)
            # Never expose arbitrary remote error bodies, credentials, URLs or headers.
            if not isinstance(code,str) or len(code)>100 or not all(c.isalnum() or c=='_' for c in code):
                code='request_rejected'
            raise BrokerError(code,units=units,retryable=error.code>=500 and code in ('upstream_error','upstream_rejected')) from None
        except (urllib.error.URLError,TimeoutError,OSError,ValueError):
            # A lost response may still have consumed one provider request. Never refund it.
            raise BrokerError('response_unknown',units=None,retryable=True) from None

    def status(self):
        result=self.request('/api/backfill/status')
        if result.get('protocol')!=PROTOCOL:
            raise BrokerError('unverified_broker_protocol',units=0)
        allowed=('protocol','tracking','verified','enabled','generalLimit','backfillLimit','reserve','minimumCoverage','searchLimit','timezone','quotaDay','baselineDay','baselineComplete','ledger','health','healthy','ready','reason')
        return {k:result.get(k) for k in allowed}

    def execute(self,endpoint,params,channel_id):
        result=self.request('/api/backfill/execute',dict(endpoint=endpoint,params=params,channel_id=channel_id,request_id=str(uuid.uuid4())))
        receipt=result.get('receipt',{})
        if receipt.get('protocol')!=PROTOCOL or receipt.get('units')!=1 or not isinstance(result.get('data'),dict):
            raise BrokerError('invalid_receipt',units=None)
        return {**result['data'],'_rj_quota_receipt':receipt}
