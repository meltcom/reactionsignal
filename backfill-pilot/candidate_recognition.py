"""Pure, review-only identity hints. The policy is shared with RJ's JavaScript adapter."""
import hashlib
import json
from pathlib import Path
import re
import unicodedata

_local = Path(__file__).with_name('candidate-policy.json')
POLICY_PATH = _local if _local.exists() else Path(__file__).resolve().parents[1] / 'server/candidate-policy.json'
POLICY = json.loads(POLICY_PATH.read_text(encoding='utf-8'))
POLICY_VERSION = POLICY['version']
_json = lambda value: json.dumps(value, ensure_ascii=False, separators=(',', ':'))
POLICY_HASH = hashlib.sha256(_json(POLICY).encode()).hexdigest()


def candidate_input(value):
    return dict(channelId=str(value.get('channelId') or ''), description=str(value.get('description') or ''),
                id=value.get('id'), tags=[t for t in value.get('tags', []) if isinstance(t, str)] if isinstance(value.get('tags', []), list) else [],
                title=str(value.get('title') or ''))


def _word(char):
    return unicodedata.category(char)[0] in ('L', 'N')


def _normalize(value):
    return ' '.join(''.join(c if _word(c) else ' ' for c in unicodedata.normalize('NFKC', value).lower()).split())


def _narrative(value):
    lines = []
    for line in unicodedata.normalize('NFKC', value).splitlines():
        if re.match(r'^\s*(?:#|(?:original\s+(?:video|link)|credits?|source\s*[- ]?link)\b)', line, re.I):
            continue
        line = re.sub(r'https?://\S+', ' ', line, flags=re.I)
        line = re.sub(r'#[^\W]+', ' ', line, flags=re.UNICODE)
        lines.append(line)
    return '\n'.join(lines)


def recognize_candidate(value):
    data = candidate_input(value)
    fields = dict(title=data['title'], description=_narrative(data['description']))
    hits = []
    for strength in ('strong', 'weak'):
        for field in ('title', 'description'):
            for rule in POLICY['rulesInPriorityOrder']:
                if rule['strength'] != strength or field not in rule['fields'] or (rule['channels'] != 'any' and data['channelId'] not in rule['channels']):
                    continue
                text = unicodedata.normalize('NFKC', fields[field])
                if rule.get('matching') == 'exact complete hashtag token':
                    text = text.lower()
                    matched = any((m.start() == 0 or not (_word(text[m.start()-1]) or text[m.start()-1] == '_'))
                                  and (m.end() == len(text) or not (_word(text[m.end()]) or text[m.end()] == '_'))
                                  for m in re.finditer('#missionedsouls', text))
                else:
                    matched = ' ' + rule['phrase'] + ' ' in ' ' + _normalize(text) + ' '
                if matched:
                    hits.append((rule, field))
    if not hits:
        return dict(POLICY['noEvidence'])
    rule, field = hits[0]
    return dict(candidate=True, strength=rule['strength'], primaryRuleId=rule['id'], primaryField=field,
                normalizedMatch=rule['phrase'], positiveTitleHint=any(f == 'title' for _, f in hits), emitsApprovalDecision=False)


def candidate_evidence(value):
    data = candidate_input(value)
    return dict(policyVersion=POLICY_VERSION, policyHash=POLICY_HASH,
                metadataHash=hashlib.sha256(_json(data).encode()).hexdigest(), input=data,
                recognition=recognize_candidate(data))
