"""Versioned local evidence, review audit and reproducible measurements.

No production writes or YouTube requests. Nulls mean unavailable, never zero.
"""
import datetime as dt
import hashlib
import json
import math
import random
import uuid
from pathlib import Path

VERSION = 'measurements-v3-shared-broker'
MATCHER = 'ms-name-v1'
OUTCOMES = ('verified_missing', 'false_positive', 'duplicate', 'excluded', 'unresolved')
SOURCE_HASH = hashlib.sha256(b''.join((Path(__file__).parent / name).read_bytes()
                                     for name in ('pilot.py', 'measurements.py', 'broker.py'))).hexdigest()


def initialize(db):
    additions = {
        'attempts': {'batch_id': 'TEXT', 'status': 'TEXT', 'duration_ms': 'REAL', 'finished_at': 'TEXT', 'retry_index': 'INTEGER', 'quota_bucket': 'TEXT', 'quota_units': 'INTEGER', 'http_status': 'INTEGER', 'requested_ids': 'INTEGER', 'receipt_json': 'TEXT'},
        'pages': {'batch_id': 'TEXT'},
    }
    for table, columns in additions.items():
        existing = {row[1] for row in db.execute(f'PRAGMA table_info({table})')}
        for name, kind in columns.items():
            if name not in existing:
                db.execute(f'ALTER TABLE {table} ADD COLUMN {name} {kind}')
    db.executescript('''
        CREATE TABLE IF NOT EXISTS measurement_batches(
            id TEXT PRIMARY KEY, started_at TEXT, finished_at TEXT, day TEXT,
            strategy TEXT, measurement_version TEXT, matcher_version TEXT, config_hash TEXT, config_json TEXT,
            channel TEXT, query TEXT, window_start TEXT, window_end TEXT, page_depth INTEGER,
            status TEXT, duration_ms REAL, error TEXT,
            encountered INTEGER DEFAULT 0, existing_ids INTEGER DEFAULT 0,
            repeat_ids INTEGER DEFAULT 0, metadata_ids INTEGER DEFAULT 0,
            metadata_ids_avoided INTEGER DEFAULT 0, metadata_requests_avoided INTEGER DEFAULT 0,
            new_records INTEGER DEFAULT 0, candidates INTEGER DEFAULT 0);
        CREATE TABLE IF NOT EXISTS encounters(
            batch_id TEXT, video_id TEXT, disposition TEXT, is_new INTEGER,
            PRIMARY KEY(batch_id,video_id));
        CREATE TABLE IF NOT EXISTS reviews(
            id INTEGER PRIMARY KEY, video_id TEXT, at TEXT, day TEXT, outcome TEXT,
            reason TEXT, evidence TEXT, live_checked_at TEXT, review_seconds REAL, sample_id TEXT);
        CREATE TABLE IF NOT EXISTS audit_samples(
            id TEXT PRIMARY KEY, created_at TEXT, stratum TEXT, seed INTEGER,
            population INTEGER, sample_size INTEGER, video_ids_json TEXT);
        CREATE TABLE IF NOT EXISTS rj_monitor_samples(
            id TEXT PRIMARY KEY, exported_at TEXT, imported_at TEXT, payload_json TEXT);
        CREATE INDEX IF NOT EXISTS batch_day ON measurement_batches(day);
        CREATE INDEX IF NOT EXISTS attempt_batch ON attempts(batch_id);
        CREATE INDEX IF NOT EXISTS encounter_video ON encounters(video_id);
        CREATE INDEX IF NOT EXISTS review_video ON reviews(video_id,id);
        CREATE VIEW IF NOT EXISTS latest_reviews AS
            SELECT r.* FROM reviews r WHERE r.id=(SELECT MAX(x.id) FROM reviews x WHERE x.video_id=r.video_id);
    ''')
    if 'live_check_attested' not in {r[1] for r in db.execute('PRAGMA table_info(reviews)')}:
        db.execute('ALTER TABLE reviews ADD COLUMN live_check_attested INTEGER NOT NULL DEFAULT 0')
    db.commit()


def begin_batch(pilot, *, strategy='known-reactor-uploads', channel=None, query=None,
                window_start=None, window_end=None, page_depth=1):
    from pilot import now, day
    config = dict(daily_general_limit=pilot.limit, daily_search_limit=0,
                  snapshot_hash=pilot.setting('snapshot_hash'), cutoff=pilot.setting('cutoff'),
                  eligible_only=True, matcher=MATCHER, source_hash=SOURCE_HASH, metadata_policy='unknown-ids-only')
    config['broker_policy']=json.loads(pilot.setting('broker-status') or 'null')
    encoded = json.dumps(config, sort_keys=True)
    identifier = str(uuid.uuid4())
    pilot.db.execute('''INSERT INTO measurement_batches
        (id,started_at,day,strategy,measurement_version,matcher_version,config_hash,config_json,
         channel,query,window_start,window_end,page_depth,status)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,'started')''',
        (identifier, now(), day(), strategy, VERSION, MATCHER,
         hashlib.sha256(encoded.encode()).hexdigest(), encoded, channel, query,
         window_start, window_end, page_depth))
    pilot.db.commit()
    return identifier


def save_review(pilot, payload):
    from pilot import now, day
    vid = payload.get('video_id')
    outcome = payload.get('outcome')
    reason = str(payload.get('reason', '')).strip()
    evidence = str(payload.get('evidence', '')).strip()
    checked = payload.get('live_checked_at') or None
    seconds = payload.get('review_seconds')
    if outcome not in OUTCOMES or not reason or len(reason) > 4000 or len(evidence) > 4000:
        raise ValueError('Select an outcome and supply a reason (maximum 4000 characters)')
    if seconds is not None and (not isinstance(seconds, (int, float)) or not math.isfinite(seconds) or seconds < 0 or seconds > 86400):
        raise ValueError('Review seconds must be between 0 and 86400, or omitted')
    if checked:
        try:
            parsed = dt.datetime.fromisoformat(checked.replace('Z', '+00:00'))
            if parsed.tzinfo is None or parsed > dt.datetime.now(dt.timezone.utc):
                raise ValueError()
        except (ValueError, TypeError):
            raise ValueError('Live-check timestamp must be a past ISO timestamp with timezone') from None
    with pilot.lock, pilot.db:
        video = pilot.db.execute('SELECT * FROM videos WHERE id=?', (vid,)).fetchone()
        if not video:
            raise ValueError('Unknown evidence record')
        known = pilot.db.execute('SELECT decision FROM catalog WHERE id=?', (vid,)).fetchone()
        if outcome == 'verified_missing':
            if payload.get('live_check_attested') is not True:
                raise ValueError('Attest that you checked current RJ decisions, availability and reaction identity')
            if known or video['classification'].startswith('existing:'):
                raise ValueError('Existing RJ records cannot be marked verified missing')
            if not evidence or not checked:
                raise ValueError('Verified missing requires evidence and a fresh live RJ/availability check timestamp')
            if parsed < dt.datetime.fromisoformat(video['found'].replace('Z', '+00:00')):
                raise ValueError('Live check must be after candidate discovery')
            if dt.datetime.now(dt.timezone.utc) - parsed > dt.timedelta(hours=24):
                raise ValueError('Refresh the live RJ and availability check within 24 hours')
        sample_id = payload.get('sample_id') or None
        if sample_id:
            sample = pilot.db.execute('SELECT video_ids_json FROM audit_samples WHERE id=?', (sample_id,)).fetchone()
            if not sample or vid not in json.loads(sample[0]):
                raise ValueError('Video is not in the selected audit sample')
        pilot.db.execute('''INSERT INTO reviews(video_id,at,day,outcome,reason,evidence,live_checked_at,review_seconds,sample_id,live_check_attested)
            VALUES(?,?,?,?,?,?,?,?,?,?)''', (vid, now(), day(), outcome, reason, evidence, checked, seconds, sample_id, int(payload.get('live_check_attested') is True)))


def sample(pilot, stratum, size=20, seed=1):
    from pilot import now
    if stratum not in ('review', 'unmatched') or type(size) is not int or not 1 <= size <= 100 or type(seed) is not int:
        raise ValueError('Sample must be review or unmatched, size 1–100, with an integer seed')
    with pilot.lock, pilot.db:
        population = [r[0] for r in pilot.db.execute('SELECT id FROM videos WHERE classification=? ORDER BY id', (stratum,))]
        ids = random.Random(seed).sample(population, min(size, len(population)))
        identifier = str(uuid.uuid4())
        pilot.db.execute('INSERT INTO audit_samples VALUES(?,?,?,?,?,?,?)', (identifier, now(), stratum, seed, len(population), len(ids), json.dumps(ids)))
        return dict(id=identifier, stratum=stratum, seed=seed, population=len(population), sample_size=len(ids), video_ids=ids)


def import_monitor(pilot, payload):
    from pilot import now
    if payload.get('schema') != 'rj-readonly-monitor-v1':
        raise ValueError('Unsupported monitor snapshot')
    timestamp = dt.datetime.fromisoformat(payload['exported_at'].replace('Z', '+00:00'))
    if timestamp.tzinfo is None or timestamp > dt.datetime.now(dt.timezone.utc) + dt.timedelta(minutes=1):
        raise ValueError('Monitor timestamp invalid')
    for key in ('usage', 'health', 'observations', 'coverage'):
        if not isinstance(payload.get(key), list):
            raise ValueError('Monitor snapshot missing ' + key)
    for row in payload['usage']:
        if not isinstance(row.get('key'), str) or not str(row.get('value', '')).isdigit():
            raise ValueError('Invalid monitor usage counter')
    for row in payload['health']:
        instant = dt.datetime.fromisoformat(row['sampled_at'].replace('Z', '+00:00'))
        if instant.tzinfo is None or not all(isinstance(row.get(k), (int,float)) and row[k] >= 0 for k in ('eligible','checked')):
            raise ValueError('Invalid health sample')
        if not isinstance(row.get('run_status'), str):
            raise ValueError('Health sample missing run status')
    for row in payload['observations']:
        instant = dt.datetime.fromisoformat(row['discovered_at'].replace('Z', '+00:00'))
        if instant.tzinfo is None or (row.get('delay_seconds') is not None and not isinstance(row['delay_seconds'],(int,float))):
            raise ValueError('Invalid discovery observation')
    encoded = json.dumps(payload, sort_keys=True)
    digest = hashlib.sha256(encoded.encode()).hexdigest()
    with pilot.lock, pilot.db:
        pilot.db.execute('INSERT OR IGNORE INTO rj_monitor_samples VALUES(?,?,?,?)', (digest, payload['exported_at'], now(), encoded))


def ratio(a, b):
    return round(a / b, 4) if b else None


def report(pilot):
    """Called under pilot.lock. Attribute yield to first discovery batch, not every encounter."""
    from pilot import PT, now
    today = dt.datetime.now(PT).date()
    batches = [dict(r) for r in pilot.db.execute('SELECT * FROM measurement_batches ORDER BY started_at,id')]
    attempts = [dict(r) for r in pilot.db.execute('SELECT * FROM attempts ORDER BY id')]
    # Only current latest outcome counts. Earlier decisions remain an immutable audit trail.
    verified = {r[0] for r in pilot.db.execute("SELECT video_id FROM latest_reviews WHERE outcome='verified_missing'")}
    first = dict(pilot.db.execute('''SELECT e.video_id,e.batch_id FROM encounters e
        WHERE e.is_new=1 AND e.rowid=(SELECT MIN(x.rowid) FROM encounters x WHERE x.video_id=e.video_id AND x.is_new=1)'''))
    reviews = [dict(r) for r in pilot.db.execute('SELECT * FROM reviews ORDER BY id')]

    def summarize(selected, request_rows):
        ids = {b['id'] for b in selected}
        committed = [b for b in selected if b['status'] == 'committed']
        confirmed = sum(vid in verified and batch in ids for vid, batch in first.items())
        total = dict(pages=len(committed), requests=len(request_rows),
                     failures=sum(r['status'] == 'failed' for r in request_rows),
                     unfinished_requests=sum(r['status'] == 'reserved' for r in request_rows),
                     legacy_requests=sum(r['status'] is None for r in request_rows),
                     failed_batches=sum(b['status'] == 'failed' for b in selected),
                     incomplete_batches=sum(b['status'] in ('started', 'deferred', 'paused') for b in selected),
                     verified_missing=confirmed,
                     measured_days=len({r['day'] for r in request_rows}))
        total['cohort_requests'] = sum(a['batch_id'] in ids for a in attempts)
        total['metadata_ids_requested'] = sum(r['requested_ids'] or 0 for r in request_rows if r['endpoint']=='videos')
        total['broker_denials']=sum(r['status']=='blocked' for r in request_rows)
        total['general_units_confirmed']=sum(r['quota_units'] or 0 for r in request_rows if r['endpoint']!='search')
        total['general_units_unknown']=sum(r['quota_units'] is None for r in request_rows if r['endpoint']!='search')
        total['general_units_upper_bound']=total['general_units_confirmed']+total['general_units_unknown']
        for key in ('encountered', 'existing_ids', 'repeat_ids', 'metadata_ids', 'metadata_ids_avoided', 'metadata_requests_avoided', 'new_records', 'candidates'):
            # Cost savings are recorded at the decision, even if the page later fails.
            total[key] = sum(b[key] or 0 for b in selected)
        total['verified_per_request'] = ratio(confirmed, total['cohort_requests'])
        total['candidates_per_request'] = ratio(total['candidates'], total['cohort_requests'])
        total['duplicate_fraction'] = ratio(total['existing_ids'] + total['repeat_ids'], total['encountered'])
        durations = sorted(r['duration_ms'] for r in request_rows if r['duration_ms'] is not None)
        total['request_duration_samples'] = len(durations)
        total['request_ms'] = round(sum(durations), 2)
        total['p95_request_ms'] = round(durations[max(0, math.ceil(len(durations) * .95) - 1)], 2) if durations else None
        total['batch_ms'] = round(sum(b['duration_ms'] or 0 for b in selected), 2)
        return total

    daily = []
    for offset in range(15):
        date = (today - dt.timedelta(days=offset)).isoformat()
        daily.append(dict(day=date, partial=offset == 0, **summarize([b for b in batches if b['day'] == date], [a for a in attempts if a['day'] == date]),
                          review_events=sum(r['day'] == date for r in reviews)))
    def week(rows):
        dates = {r['day'] for r in rows}
        return summarize([b for b in batches if b['day'] in dates], [a for a in attempts if a['day'] in dates])
    groups = {}
    for batch in batches:
        key = (batch['strategy'], batch['matcher_version'], batch['config_hash'], batch['channel'], batch['query'], batch['window_start'], batch['window_end'], batch['page_depth'])
        groups.setdefault(key, []).append(batch)
    yields = []
    for key, rows in groups.items():
        ids = {r['id'] for r in rows}
        yields.append(dict(strategy=key[0], matcher=key[1], config_hash=key[2], channel=key[3], query=key[4], window_start=key[5], window_end=key[6], depth=key[7],
                           **summarize(rows, [a for a in attempts if a['batch_id'] in ids])))
    samples = []
    for row in pilot.db.execute('SELECT * FROM audit_samples ORDER BY created_at DESC'):
        item = dict(row)
        ids = json.loads(item.pop('video_ids_json'))
        resolved = {r['video_id']: r['outcome'] for r in pilot.db.execute("SELECT video_id,outcome FROM latest_reviews WHERE outcome<>'unresolved'")}
        reviewed = [v for v in ids if v in resolved]
        positive = sum(resolved[v] == 'verified_missing' for v in reviewed)
        item.update(video_ids=ids, reviewed=len(reviewed), positive=positive,
                    observed_positive_fraction=ratio(positive, len(reviewed)),
                    complete=len(reviewed) == len(ids) and bool(ids))
        if item['complete']:
            n = len(ids)
            fraction, z = positive / n, 1.96
            centre = (fraction + z*z/(2*n)) / (1 + z*z/n)
            half = z * math.sqrt(fraction*(1-fraction)/n + z*z/(4*n*n)) / (1+z*z/n)
            item['wilson_95_interval'] = [round(max(0, centre-half),4), round(min(1,centre+half),4)]
        else:
            item['wilson_95_interval'] = None
        samples.append(item)
    outcomes = {r[0]: r[1] for r in pilot.db.execute('SELECT outcome,COUNT(*) FROM latest_reviews GROUP BY outcome')}
    seconds = [r['review_seconds'] for r in reviews if r['review_seconds'] is not None]
    return dict(version=VERSION, matcher=MATCHER, as_of=now(), timezone='America/Los_Angeles',
                daily=daily, weekly=week(daily[1:8]), previous_week=week(daily[8:15]),
                lifetime=summarize(batches, attempts), yields=yields, audit_samples=samples,
                review_outcomes=outcomes, review_events=len(reviews), review_seconds=sum(seconds), review_time_samples=len(seconds),
                monitor=monitor_report(pilot, attempts),
                broker=json.loads(pilot.setting('broker-status') or 'null'),
                notes=['Verified yield is attributed to first discovery; later reviews can revise historical cohorts.',
                       'Review outcomes and live checks are operator attestations, not automatic verification.',
                       'Yield uses all request attempts attributed to the selected discovery batches, including attempts across midnight. Calendar request totals use request date.',
                       'Sampling estimates apply only to the saved stratum; they do not establish overall recall.',
                       'Legacy rows lack attribution and are not reconstructed as measured batches.'])


def monitor_report(pilot, attempts):
    from pilot import now
    row = pilot.db.execute('SELECT payload_json FROM rj_monitor_samples ORDER BY exported_at DESC LIMIT 1').fetchone()
    if not row:
        return dict(status='missing', quota_complete=False, message='No RJ monitor snapshot. Shared headroom and fresh-discovery impact are unverified.')
    payload = json.loads(row[0])
    age = (dt.datetime.fromisoformat(now()) - dt.datetime.fromisoformat(payload['exported_at'].replace('Z', '+00:00'))).total_seconds()
    usage = payload.get('usage', [])
    utc_dates = {r['key'].split(':')[1] for r in usage if r['key'].startswith('youtube-requests:')}
    rj_general_upper = sum(int(r['value']) for r in usage if r['key'].startswith('youtube-requests:') and not r['key'].endswith(':search'))
    # RJ endpoint counters are UTC-day totals, so overlapping full UTC days are a conservative upper bound.
    pilot_general = sum(a['quota_bucket'] == 'general' and a['day'] == payload.get('quota_day') for a in attempts)
    health = sorted(payload.get('health', []), key=lambda r:r['sampled_at'])
    observations = payload.get('observations', [])
    first_attempt = next((a['at'] for a in attempts if a['batch_id']), None)
    def summarize_health(rows, delays):
        fresh = sorted(r['delay_seconds'] for r in delays if isinstance(r.get('delay_seconds'), (int,float)) and 0 <= r['delay_seconds'] <= 86400)
        return dict(health_samples=len(rows), fresh_delay_samples=len(fresh),
                    minimum_coverage=min((r['checked']/r['eligible'] for r in rows if r.get('eligible')), default=None),
                    failed_runs=sum(r['run_status']!='succeeded' for r in rows),
                    median_fresh_delay_seconds=(fresh[(len(fresh)-1)//2]+fresh[len(fresh)//2])/2 if fresh else None,
                    p90_fresh_delay_seconds=fresh[max(0,math.ceil(len(fresh)*.9)-1)] if fresh else None)
    # Normalize ISO strings before comparison: RJ uses Z and Python uses +00:00.
    def instant(value):
        return dt.datetime.fromisoformat(value.replace('Z', '+00:00'))
    first_instant = instant(first_attempt) if first_attempt else None
    before_rows = [r for r in health if not first_instant or instant(r['sampled_at']) < first_instant]
    during_rows = [r for r in health if first_instant and instant(r['sampled_at']) >= first_instant]
    before_obs = [r for r in observations if not first_instant or instant(r['discovered_at']) < first_instant]
    during_obs = [r for r in observations if first_instant and instant(r['discovered_at']) >= first_instant]
    health_age = (dt.datetime.fromisoformat(now()) - instant(health[-1]['sampled_at'])).total_seconds() if health else None
    return dict(status='fresh' if age <= 1800 else 'stale', age_seconds=round(age), quota_complete=False,
                health_status='missing' if health_age is None else 'fresh' if health_age <= 1800 else 'stale',
                health_sample_age_seconds=health_age,
                exported_at=payload['exported_at'], utc_counter_dates=sorted(utc_dates),
                observed_rj_general_upper_bound=rj_general_upper, pilot_general=pilot_general,
                observed_combined_general_upper_bound=rj_general_upper + pilot_general,
                coverage=payload.get('coverage'), latest_health=health[-1] if health else None,
                pilot_started_at=first_attempt,
                before_pilot=summarize_health(before_rows, before_obs), during_pilot=summarize_health(during_rows, during_obs),
                comparison_note='Observed before/during cohorts, not causal evidence; baseline and during periods may have different lengths and sample counts.',
                other_consumers='unknown', payload=payload,
                message='Read-only observations; UTC counters overlap the Pacific day. Other consumers and atomic quota reservations remain unverified. This monitor does not authorize scanning.')
