"""Read-only RJ quota and fresh-discovery observations; never grants a scan budget."""
import argparse
import datetime as dt
import json
from pathlib import Path
import subprocess
from zoneinfo import ZoneInfo


def export(checkout, destination):
    at = dt.datetime.now(dt.timezone.utc)
    local = at.astimezone(ZoneInfo('America/Los_Angeles'))
    start = local.replace(hour=0, minute=0, second=0, microsecond=0)
    dates = sorted({start.astimezone(dt.timezone.utc).date().isoformat(),
                    (start + dt.timedelta(days=1) - dt.timedelta(microseconds=1)).astimezone(dt.timezone.utc).date().isoformat()})
    since = (at - dt.timedelta(days=15)).isoformat().replace('+00:00', 'Z')
    since24 = (at - dt.timedelta(hours=24)).isoformat().replace('+00:00', 'Z')
    clauses = ' OR '.join(f"key LIKE 'youtube-requests:{date}:%'" for date in dates)
    queries = dict(
        usage=f"SELECT key,value FROM state WHERE {clauses} OR key='search-attempt-budget:{local.date().isoformat()}' ORDER BY key",
        health=f"SELECT * FROM discovery_health_samples WHERE sampled_at>='{since}' ORDER BY sampled_at",
        observations=f"SELECT discovered_at,delay_seconds,source FROM discovery_observations WHERE discovered_at>='{since}' ORDER BY discovered_at",
        coverage=f"SELECT COUNT(*) eligible,SUM(CASE WHEN recent_checked_at>='{since24}' THEN 1 ELSE 0 END) checked FROM channels WHERE discovery_scope='eligible'",
    )
    result = dict(schema='rj-readonly-monitor-v1', exported_at=at.isoformat(), quota_day=local.date().isoformat(),
                  timezone='America/Los_Angeles', source='Wrangler D1 read-only SELECT', usage_counter_timezone='UTC',
                  consumers_complete=False, project_quota_limit=None, key_project_association_verified=False)
    for name, sql in queries.items():
        proc = subprocess.run(['npx.cmd', 'wrangler@4', 'd1', 'execute', 'DB', '--remote', '--json', '--command', sql],
                              cwd=checkout, capture_output=True, text=True, encoding='utf-8', timeout=90)
        if proc.returncode:
            raise RuntimeError(f'Wrangler read failed for {name}; no monitor snapshot was written')
        parts = json.loads(proc.stdout)
        if not parts or any(not part.get('success') for part in parts):
            raise RuntimeError('Incomplete D1 response')
        result[name] = [row for part in parts for row in part['results']]
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps(result, indent=2), encoding='utf-8')
    print(f'Read-only RJ monitor snapshot saved: {destination}')


if __name__ == '__main__':
    p = argparse.ArgumentParser()
    p.add_argument('--checkout', type=Path, required=True)
    p.add_argument('--out', type=Path, required=True)
    args = p.parse_args()
    export(args.checkout, args.out)
