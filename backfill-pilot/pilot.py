"""RJ historical catalog pilot. Python 3.12+, standard library only."""
import argparse
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import sqlite3
import threading
import time
import urllib.request
import urllib.parse
import urllib.error
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from zoneinfo import ZoneInfo
import measurements
from broker import BrokerClient, BrokerError

ROOT = Path(__file__).resolve().parent
PT = ZoneInfo('America/Los_Angeles')
OFFICIAL = 'UCeTfwcnUVurw7Qrk_KF5Idw'

def now():
    return dt.datetime.now(dt.timezone.utc).isoformat()

def day():
    return dt.datetime.now(PT).date().isoformat()

class Pilot:
    def __init__(self, folder, transport=None):
        self.folder = Path(folder)
        self.folder.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(self.folder / 'campaign.sqlite3', check_same_thread=False)
        self.db.row_factory = sqlite3.Row
        self.lock = threading.RLock()
        self.stop = threading.Event()
        self.worker = None
        self.starting = False
        self.broker = BrokerClient()
        self.injected_transport = transport is not None
        self.active_channel = None
        self.message = 'Ready for snapshot and quota configuration'
        self.transport = transport or self.http
        self.db.executescript('''
        PRAGMA journal_mode=WAL;
        CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT);
        CREATE TABLE IF NOT EXISTS channels(id TEXT PRIMARY KEY,name TEXT,uploads TEXT,token TEXT,state TEXT DEFAULT 'queued',pages INTEGER DEFAULT 0,touched TEXT DEFAULT '',error TEXT);
        CREATE TABLE IF NOT EXISTS catalog(id TEXT PRIMARY KEY,decision TEXT);
        CREATE TABLE IF NOT EXISTS videos(id TEXT PRIMARY KEY,channel TEXT,title TEXT,published TEXT,classification TEXT,evidence TEXT,found TEXT,day TEXT);
        CREATE TABLE IF NOT EXISTS attempts(id INTEGER PRIMARY KEY,at TEXT,day TEXT,endpoint TEXT,success INTEGER DEFAULT 0,error TEXT);
        CREATE TABLE IF NOT EXISTS pages(id INTEGER PRIMARY KEY,at TEXT,day TEXT,channel TEXT,token TEXT,next TEXT,items INTEGER);
        ''')
        self.db.commit()
        measurements.initialize(self.db)
        self.limit = 300

    def setting(self, key, value=None):
        if value is not None:
            self.db.execute('INSERT OR REPLACE INTO settings VALUES(?,?)', (key, value))
            self.db.commit()
        row = self.db.execute('SELECT value FROM settings WHERE key=?', (key,)).fetchone()
        return row[0] if row else None

    def seed(self, snapshot):
        with self.lock:
            if self.setting('cutoff'):
                raise ValueError('Campaign already seeded; create a new data directory for a new snapshot')
            channels = snapshot['channels']
            for c in channels:
                if not re.fullmatch(r'UC[\w-]{22}', c['id']):
                    raise ValueError('Invalid channel ID')
            with self.db:
                for c in channels:
                    if c.get('discovery_scope') == 'eligible' and c['id'] != OFFICIAL:
                        self.db.execute('INSERT INTO channels(id,name,uploads) VALUES(?,?,?)', (c['id'], c.get('name', c['id']), c.get('uploads')))
                for v in snapshot['catalog']:
                    self.db.execute('INSERT OR REPLACE INTO catalog VALUES(?,?)', (v['id'], v['decision']))
            self.setting('snapshot_at', snapshot['exported_at'])
            self.setting('cutoff', now())
            self.setting('snapshot_hash', hashlib.sha256(json.dumps(snapshot, sort_keys=True).encode()).hexdigest())

    def http(self, endpoint, params):
        if not self.active_channel:
            raise BrokerError('missing_reactor_context',units=0)
        return self.broker.execute(endpoint,params,self.active_channel['id'])

    def api(self, endpoint, **params):
        if endpoint not in ('channels', 'playlistItems', 'videos'):
            raise ValueError('Endpoint prohibited')
        for retry in range(3):
            with self.lock:
                if self.active_channel:
                    self.active_channel['phase'] = {'channels': 'Looking up uploads playlist', 'playlistItems': 'Reading upload page', 'videos': 'Checking video metadata'}[endpoint]
            if self.stop.is_set():
                raise RuntimeError('Paused')
            with self.lock:
                self.db.execute('BEGIN IMMEDIATE')
                used = self.db.execute('SELECT COUNT(*) FROM attempts WHERE day=?', (day(),)).fetchone()[0]
                if used >= self.limit:
                    self.db.rollback()
                    raise RuntimeError('Daily request cap reached; resume tomorrow')
                batch_id = self.active_channel.get('batch_id') if self.active_channel else None
                requested_ids = len(params.get('id', '').split(',')) if endpoint == 'videos' and params.get('id') else 0
                cur = self.db.execute('''INSERT INTO attempts(at,day,endpoint,batch_id,status,retry_index,quota_bucket,quota_units,requested_ids)
                    VALUES(?,?,?,?,'reserved',?,'general',?,?)''', (now(), day(), endpoint, batch_id, retry, 1 if self.injected_transport else None, requested_ids))
                attempt = cur.lastrowid
                self.db.commit()  # Reserve before network; failed/crashed attempts count.
            started = time.perf_counter()
            try:
                result = self.transport(endpoint, params)
                receipt=result.pop('_rj_quota_receipt',None)
                if not self.injected_transport and not receipt:
                    raise BrokerError('missing_receipt',units=None)
                with self.lock, self.db:
                    self.db.execute("UPDATE attempts SET success=1,status='succeeded',duration_ms=?,finished_at=?,quota_units=?,receipt_json=? WHERE id=?", ((time.perf_counter()-started)*1000, now(), 1, json.dumps(receipt) if receipt else None, attempt))
                return result
            except Exception as error:
                code = getattr(error, 'code', None)
                label = error.broker_code if isinstance(error,BrokerError) else 'HTTP ' + str(code) if code else type(error).__name__
                with self.lock, self.db:
                    units=error.quota_units if isinstance(error,BrokerError) else 1 if self.injected_transport else None
                    state='blocked' if isinstance(error,BrokerError) and units==0 else 'failed'
                    self.db.execute("UPDATE attempts SET error=?,status=?,duration_ms=?,finished_at=?,http_status=?,quota_units=? WHERE id=?", (label, state, (time.perf_counter()-started)*1000, now(), code, units, attempt))
                if isinstance(error,BrokerError) and (not error.retryable or retry==2):
                    raise
                if code in (400, 401, 403, 404) or retry == 2:
                    raise RuntimeError(label) from None
                if self.stop.wait(2 ** (retry + 1)):
                    raise RuntimeError('Paused')

    def step(self):
        with self.lock:
            c = self.db.execute("SELECT * FROM channels WHERE state='queued' ORDER BY touched,id LIMIT 1").fetchone()
        if not c:
            return False
        with self.lock:
            self.active_channel = dict(id=c['id'], name=c['name'], page=c['pages'] + 1, started_at=now(), phase='Preparing page')
            batch_id = measurements.begin_batch(self, channel=c['id'], page_depth=c['pages']+1,
                                               window_end=self.setting('cutoff'))
            self.active_channel['batch_id'] = batch_id
        started = time.perf_counter()
        try:
            uploads = c['uploads']
            if not uploads:
                data = self.api('channels', part='contentDetails', id=c['id'])
                uploads = data.get('items', [{}])[0].get('contentDetails', {}).get('relatedPlaylists', {}).get('uploads')
                if not uploads:
                    raise RuntimeError('Channel uploads unavailable')
            params = dict(part='snippet,contentDetails', playlistId=uploads, maxResults=50)
            if c['token']:
                params['pageToken'] = c['token']
            page = self.api('playlistItems', **params)
            ids = list(dict.fromkeys(x['contentDetails']['videoId'] for x in page.get('items', []) if x.get('contentDetails', {}).get('videoId')))
            playlist_items = {x.get('contentDetails', {}).get('videoId'): x for x in page.get('items', [])}
            with self.lock:
                existing = {vid: self.db.execute('SELECT decision FROM catalog WHERE id=?', (vid,)).fetchone() for vid in ids}
                seen = {vid for vid in ids if self.db.execute('SELECT 1 FROM videos WHERE id=?', (vid,)).fetchone()}
                unknown = [vid for vid in ids if not existing[vid] and vid not in seen]
                avoided = (1 if ids else 0) - (1 if unknown else 0)
                self.db.execute('''UPDATE measurement_batches SET encountered=?,existing_ids=?,repeat_ids=?,metadata_ids=?,
                    metadata_ids_avoided=?,metadata_requests_avoided=? WHERE id=?''',
                    (len(ids), sum(bool(existing[v]) for v in ids), sum(v in seen and not existing[v] for v in ids), len(unknown), len(ids)-len(unknown), avoided, batch_id))
                self.db.commit()
            data = self.api('videos', part='snippet,contentDetails,status', id=','.join(unknown)) if unknown else {'items': []}
            byid = {v['id']: v for v in data.get('items', [])}
            next_token = page.get('nextPageToken')
            if next_token and next_token == c['token']:
                raise RuntimeError('Repeated continuation token; review required')
            with self.lock, self.db:
                new_records = candidates = 0
                for vid in ids:
                    if vid in seen:
                        self.db.execute('INSERT INTO encounters VALUES(?,?,?,0)', (batch_id, vid, 'existing' if existing[vid] else 'repeat'))
                        continue
                    v = byid.get(vid, {})
                    snippet = v.get('snippet', {}) if v else playlist_items.get(vid, {}).get('snippet', {})
                    published = v.get('snippet', {}).get('publishedAt', '') if v else playlist_items.get(vid, {}).get('contentDetails', {}).get('videoPublishedAt', '')
                    if not existing[vid] and published and dt.datetime.fromisoformat(published.replace('Z', '+00:00')) > dt.datetime.fromisoformat(self.setting('cutoff')):
                        self.db.execute('INSERT INTO encounters VALUES(?,?,?,0)', (batch_id, vid, 'after_cutoff'))
                        continue
                    known = existing[vid]
                    text = snippet.get('title', '') + ' ' + snippet.get('description', '')
                    classification = 'existing:' + known[0] if known else 'review' if re.search(r'missioned[\s_-]*souls', text, re.I) else 'unmatched'
                    if not v and not known:
                        classification = 'unavailable'
                    if known:
                        v = {'playlist_evidence': playlist_items.get(vid), 'metadata_skipped': 'Known RJ ID', 'snapshot_decision': known[0]}
                    self.db.execute('INSERT OR IGNORE INTO videos VALUES(?,?,?,?,?,?,?,?)', (vid, c['id'], snippet.get('title', vid), published, classification, json.dumps(v), now(), day()))
                    is_new = not bool(known)
                    new_records += is_new
                    candidates += is_new and classification == 'review'
                    self.db.execute('INSERT INTO encounters VALUES(?,?,?,?)', (batch_id, vid, 'existing' if known else classification, int(is_new)))
                self.db.execute('INSERT INTO pages(at,day,channel,token,next,items,batch_id) VALUES(?,?,?,?,?,?,?)', (now(), day(), c['id'], c['token'], next_token, len(ids), batch_id))
                self.db.execute('UPDATE channels SET uploads=?,token=?,state=?,pages=pages+1,touched=?,error=NULL WHERE id=?', (uploads, next_token, 'queued' if next_token else 'exhausted', now(), c['id']))
                self.db.execute("UPDATE measurement_batches SET status='committed',finished_at=?,duration_ms=?,new_records=?,candidates=? WHERE id=?", (now(), (time.perf_counter()-started)*1000, new_records, candidates, batch_id))
            return True
        except Exception as error:
            message = str(error)
            status = 'paused' if message == 'Paused' else 'deferred' if message.startswith('Daily request cap') or isinstance(error,BrokerError) else 'failed'
            with self.lock, self.db:
                self.db.execute('UPDATE measurement_batches SET status=?,finished_at=?,duration_ms=?,error=? WHERE id=?', (status, now(), (time.perf_counter()-started)*1000, message if isinstance(error, RuntimeError) else type(error).__name__, batch_id))
            if message not in ('Paused', 'Daily request cap reached; resume tomorrow') and not isinstance(error,BrokerError):
                with self.lock, self.db:
                    self.db.execute("UPDATE channels SET state='error',error=?,touched=? WHERE id=?", (message, now(), c['id']))
            raise
        finally:
            with self.lock:
                self.active_channel = None

    def start(self):
        with self.lock:
            if self.starting or (self.worker and self.worker.is_alive()):
                raise ValueError('Already running')
            if not self.setting('cutoff'):
                raise ValueError('Import RJ snapshot first')
            self.starting=True
        try:
            status=self.broker.status()
            with self.lock:
                self.setting('broker-status',json.dumps(dict(checked_at=now(),**status)))
                if status.get('ready') is not True:
                    raise ValueError('RJ quota gate: '+str(status.get('reason') or 'not_ready'))
                if not all(status.get(k) is True for k in ('tracking','verified','enabled','baselineComplete','healthy')) or status.get('searchLimit')!=0 or not isinstance(status.get('backfillLimit'),int) or not 1<=status['backfillLimit']<=300 or not isinstance(status.get('reserve'),int) or status['reserve']<2000:
                    raise ValueError('Unverified quota policy')
                self.limit=min(self.limit,status['backfillLimit'])
                self.stop.clear()
                self.worker=threading.Thread(target=self.run,daemon=True)
                self.worker.start()
        except BrokerError as error:
            raise ValueError(str(error)) from None
        finally:
            with self.lock:
                self.starting=False

    def check_broker(self):
        try:
            status=self.broker.status()
        except BrokerError as error:
            status=dict(ready=False,reason=error.broker_code,protocol='rj-backfill-broker-v1')
        with self.lock:
            self.setting('broker-status',json.dumps(dict(checked_at=now(),**status)))
        return status

    def run(self):
        self.message = 'Running'
        try:
            while not self.stop.is_set():
                if not self.step():
                    self.message = 'Sweep complete; review unresolved candidates and errors'
                    return
                if self.stop.wait(3):
                    break
            self.message = 'Paused at checkpoint'
        except Exception as error:
            self.message = str(error) if isinstance(error, RuntimeError) else type(error).__name__

    def report(self):
        with self.lock:
            today = dt.datetime.now(PT).date()
            days = [(today - dt.timedelta(days=i)).isoformat() for i in range(15)]
            daily = []
            for d in days:
                daily.append(dict(day=d, requests=self.db.execute('SELECT COUNT(*) FROM attempts WHERE day=?', (d,)).fetchone()[0], failures=self.db.execute('SELECT COUNT(*) FROM attempts WHERE day=? AND (status="failed" OR (status IS NULL AND error IS NOT NULL))', (d,)).fetchone()[0], pages=self.db.execute('SELECT COUNT(*) FROM pages WHERE day=?', (d,)).fetchone()[0], examined=self.db.execute('SELECT COUNT(*) FROM videos WHERE day=?', (d,)).fetchone()[0], candidates=self.db.execute("SELECT COUNT(*) FROM videos WHERE day=? AND classification='review'", (d,)).fetchone()[0]))
            def aggregate(rows):
                totals = {key: sum(r[key] for r in rows) for key in ('requests', 'failures', 'pages', 'examined', 'candidates')}
                totals['measured_days'] = sum(r['requests'] > 0 for r in rows)
                totals['candidates_per_request'] = round(totals['candidates'] / totals['requests'], 4) if totals['requests'] else None
                return totals
            channels = [dict(r) for r in self.db.execute("""
                SELECT c.*, COALESCE(v.examined,0) examined, COALESCE(v.candidates,0) candidates
                FROM channels c LEFT JOIN (
                    SELECT channel,COUNT(*) examined,SUM(classification='review') candidates
                    FROM videos GROUP BY channel
                ) v ON v.channel=c.id ORDER BY c.touched,c.id
            """)]
            for c in channels:
                c['display_state'] = 'Scanning now' if self.active_channel and self.active_channel['id'] == c['id'] else {'queued': 'Waiting for next page' if c['pages'] else 'Not started', 'exhausted': 'Upload history exhausted', 'error': 'Needs attention'}[c['state']]
            active = dict(self.active_channel) if self.active_channel else None
            return dict(measurements=measurements.report(self), message=self.message, running=bool(self.worker and self.worker.is_alive()), today=daily[0], weekly=aggregate(daily[1:8]), previous_week=aggregate(daily[8:15]), daily=daily, channels=channels, active_channel=active, results=[dict(r) for r in self.db.execute('SELECT id,title,classification,published FROM videos ORDER BY found DESC LIMIT 100')], totals={r[0]: r[1] for r in self.db.execute('SELECT classification,COUNT(*) FROM videos GROUP BY classification')}, cutoff=self.setting('cutoff'), snapshot_at=self.setting('snapshot_at'), limit=self.limit, search_calls=0)

def make_server(pilot, port):
    token = secrets.token_urlsafe(32)
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_):
            pass
        def reply(self, body, kind='application/json', status=200):
            if isinstance(body, str):
                body = body.encode()
            self.send_response(status)
            self.send_header('Content-Type', kind)
            self.send_header('Cache-Control', 'no-store')
            self.send_header('X-Content-Type-Options', 'nosniff')
            self.end_headers()
            self.wfile.write(body)
        def trusted(self):
            return self.headers.get('Host') == f'127.0.0.1:{self.server.server_address[1]}'
        def do_GET(self):
            if not self.trusted():
                return self.reply('{}', status=403)
            if urllib.parse.urlsplit(self.path).path == '/':
                html = (ROOT / 'index.html').read_text(encoding='utf-8').replace('__TOKEN__', token)
                html = html.replace('__MEASUREMENT_PANEL__', (ROOT / 'measurement-panel.html').read_text(encoding='utf-8'))
                return self.reply(html, 'text/html; charset=utf-8')
            if self.path == '/measurement-ui.js':
                return self.reply((ROOT / 'measurement-ui.js').read_text(encoding='utf-8'), 'text/javascript; charset=utf-8')
            if self.path == '/api/status':
                return self.reply(json.dumps(pilot.report()))
            if urllib.parse.urlsplit(self.path).path == '/api/evidence':
                query = urllib.parse.parse_qs(urllib.parse.urlsplit(self.path).query)
                classification = query.get('classification', ['review'])[0]
                if classification not in ('review', 'unmatched', 'unavailable', 'all'):
                    return self.reply('{"error":"Invalid classification"}', status=400)
                try:
                    offset = max(0, int(query.get('offset', ['0'])[0]))
                except ValueError:
                    return self.reply('{"error":"Invalid offset"}', status=400)
                with pilot.lock:
                    where, args = ('', []) if classification == 'all' else ('WHERE v.classification=?', [classification])
                    sample_id = query.get('sample', [''])[0]
                    if sample_id:
                        saved = pilot.db.execute('SELECT video_ids_json FROM audit_samples WHERE id=?', (sample_id,)).fetchone()
                        if not saved:
                            return self.reply('{"error":"Unknown sample"}', status=400)
                        where, args = 'WHERE v.id IN (SELECT value FROM json_each(?))', [saved[0]]
                    total = pilot.db.execute(f'SELECT COUNT(*) FROM videos v {where}', args).fetchone()[0]
                    rows = [dict(r) for r in pilot.db.execute(f'''SELECT v.*,r.outcome,r.reason,r.live_checked_at
                        FROM videos v LEFT JOIN latest_reviews r ON r.video_id=v.id {where}
                        ORDER BY v.id LIMIT 50 OFFSET ?''', [*args, offset])]
                return self.reply(json.dumps(dict(total=total, offset=offset, rows=rows)))
            if self.path == '/export.txt':
                with pilot.lock:
                    rows = [dict(r) for r in pilot.db.execute('SELECT * FROM videos ORDER BY found,id')]
                    audit = {table: [dict(r) for r in pilot.db.execute('SELECT * FROM ' + table)] for table in
                             ('measurement_batches', 'attempts', 'encounters', 'reviews', 'audit_samples', 'rj_monitor_samples')}
                    export = {'report': pilot.report(), 'all_results': rows, 'audit': audit}
                return self.reply(json.dumps(export, indent=2), 'text/plain; charset=utf-8')
            self.reply('{}', status=404)
        def do_POST(self):
            if not self.trusted() or self.headers.get('X-Pilot-Token') != token:
                return self.reply('{}', status=403)
            try:
                length = int(self.headers.get('Content-Length', '0'))
                if not 0 <= length <= 1_000_000:
                    raise ValueError('Request body too large')
                payload = json.loads(self.rfile.read(length)) if length else {}
                if not isinstance(payload, dict):
                    raise ValueError('Request body must be a JSON object')
                if self.path == '/api/start':
                    pilot.start()
                elif self.path == '/api/pause':
                    pilot.stop.set()
                elif self.path == '/api/review':
                    measurements.save_review(pilot, payload)
                elif self.path == '/api/sample':
                    return self.reply(json.dumps(measurements.sample(pilot, payload.get('stratum'), payload.get('size', 20), payload.get('seed', 1))))
                elif self.path == '/api/monitor':
                    measurements.import_monitor(pilot, payload)
                elif self.path == '/api/broker-check':
                    return self.reply(json.dumps(pilot.check_broker()))
                else:
                    return self.reply('{}', status=404)
                self.reply('{"ok":true}')
            except ValueError as error:
                self.reply(json.dumps({'error': str(error)}), status=400)
            except (KeyError, TypeError):
                self.reply('{"error":"Missing or invalid fields"}', status=400)
    return ThreadingHTTPServer(('127.0.0.1', port), Handler)


def serve(pilot, port):
    server = make_server(pilot, port)
    print(f'Pilot UI: http://127.0.0.1:{server.server_address[1]}', flush=True)
    server.serve_forever()

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--data', type=Path, default=ROOT / 'data')
    parser.add_argument('--snapshot', type=Path)
    parser.add_argument('--port', type=int, default=8765)
    parser.add_argument('--monitor', type=Path, help='Import a read-only RJ monitor snapshot')
    args = parser.parse_args()
    pilot = Pilot(args.data)
    if args.snapshot:
        pilot.seed(json.loads(args.snapshot.read_text(encoding='utf-8-sig')))
    if args.monitor:
        measurements.import_monitor(pilot, json.loads(args.monitor.read_text(encoding='utf-8-sig')))
    serve(pilot, args.port)

if __name__ == '__main__':
    main()
