"""Read-only RJ D1 snapshot via existing local Wrangler login. No YouTube calls."""
import argparse
import datetime as dt
import json
from pathlib import Path
import subprocess

def export(checkout, destination):
    queries = {
        'channels': 'SELECT id,name,uploads,discovery_scope FROM channels ORDER BY id',
        'catalog': "SELECT v.id,CASE WHEN e.video_id IS NOT NULL THEN 'EXCLUDED' ELSE COALESCE(m.status,'KNOWN') END decision FROM videos v LEFT JOIN matches m ON m.video_id=v.id AND m.performer_id='missioned-souls' LEFT JOIN exclusions e ON e.video_id=v.id AND e.performer_id='missioned-souls' UNION SELECT video_id,'EXCLUDED' FROM exclusions WHERE performer_id='missioned-souls'",
    }
    snapshot = {'exported_at': dt.datetime.now(dt.timezone.utc).isoformat()}
    for key, sql in queries.items():
        command = ['npx.cmd', 'wrangler@4', 'd1', 'execute', 'DB', '--remote', '--json', '--command', sql]
        result = subprocess.run(command, cwd=checkout, capture_output=True, text=True, encoding='utf-8', timeout=90)
        if result.returncode:
            raise RuntimeError('Wrangler read failed: ' + result.stderr[-1500:])
        data = json.loads(result.stdout)
        if not data or any(not part.get('success') for part in data):
            raise RuntimeError('Snapshot query failed')
        snapshot[key] = [row for part in data for row in part['results']]
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps(snapshot, indent=2), encoding='utf-8')
    print(f'Saved {len(snapshot["channels"])} channels and {len(snapshot["catalog"])} catalog decisions to {destination}')

if __name__ == '__main__':
    p = argparse.ArgumentParser()
    p.add_argument('--checkout', type=Path, required=True)
    p.add_argument('--out', type=Path, required=True)
    a = p.parse_args()
    export(a.checkout, a.out)
