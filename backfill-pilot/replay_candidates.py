"""Append a versioned report from retained evidence; never change a campaign or call an API."""
import argparse
import datetime
import json
from pathlib import Path
import sqlite3
from contextlib import closing
from candidate_recognition import candidate_evidence, POLICY_VERSION, POLICY_HASH


def replay(database, output):
    database, output = Path(database).resolve(), Path(output).resolve()
    if database == output or output.exists():
        raise ValueError('Use a new report path; existing evidence is never overwritten')
    with closing(sqlite3.connect(database.as_uri() + '?mode=ro', uri=True)) as db:
        db.row_factory = sqlite3.Row
        db.execute('PRAGMA query_only=ON')
        catalog = dict(db.execute('SELECT id,decision FROM catalog'))
        rows = []
        for row in db.execute('SELECT id,channel,title,classification,evidence FROM videos ORDER BY id'):
            data = json.loads(row['evidence'])
            snippet = data.get('snippet', {})
            evidence = candidate_evidence(dict(id=row['id'], channelId=snippet.get('channelId') or row['channel'],
                                               title=snippet.get('title', row['title']), description=snippet.get('description', ''), tags=snippet.get('tags', [])))
            preserved = row['id'] in catalog or row['classification'].startswith('existing:') or row['classification'] == 'unavailable'
            proposed = 'existing:' + catalog[row['id']] if row['id'] in catalog else row['classification'] if preserved else 'review' if evidence['recognition']['candidate'] else 'unmatched'
            rows.append(dict(id=row['id'], stored=row['classification'], proposed=proposed, preserved=preserved,
                             evidence=evidence, scope='audit proposal only; review decisions and historical measurements unchanged'))
    report = dict(at=datetime.datetime.now(datetime.timezone.utc).isoformat(), policyVersion=POLICY_VERSION,
                  policyHash=POLICY_HASH, database=str(database), results=rows, networkCalls=0, databaseWrites=0,
                  changes=sum(r['stored'] != r['proposed'] for r in rows))
    with output.open('x', encoding='utf-8') as handle:
        json.dump(report, handle, ensure_ascii=False, indent=2)
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--database', required=True)
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    result = replay(args.database, args.output)
    print(json.dumps(dict(records=len(result['results']), proposedChanges=result['changes'], networkCalls=0, databaseWrites=0)))
