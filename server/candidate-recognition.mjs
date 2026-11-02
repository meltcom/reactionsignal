import policy from './candidate-policy.json' with {type:'json'};

export const CANDIDATE_VERSION=policy.version;
export const CANDIDATE_REVIEW_SOURCE='Candidate review: ';
const normalize=value=>String(value||'').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
const narrative=value=>String(value||'').normalize('NFKC').split(/\r\n|[\n\r\u000B\u000C\u001C-\u001E\u0085\u2028\u2029]/)
 .filter(line=>!/^\s*(?:#|(?:original\s+(?:video|link)|credits?|source\s*[- ]?link)\b)/iu.test(line))
 .map(line=>line.replace(/https?:\/\/\S+|#[\p{L}\p{N}_]+/giu,' ')).join('\n');
export function candidateInput(input={}){
 return {channelId:String(input.channelId||''),description:String(input.description||''),id:input.id??null,tags:Array.isArray(input.tags)?input.tags.filter(t=>typeof t==='string'):[],title:String(input.title||'')};
}
export function recognizeCandidate(input={}){
 const data=candidateInput(input),fields={title:data.title,description:narrative(data.description)},hits=[];
 for(const strength of ['strong','weak'])for(const field of ['title','description'])for(const rule of policy.rulesInPriorityOrder){
  if(rule.strength!==strength||!rule.fields.includes(field)||rule.channels!=='any'&&!rule.channels.includes(data.channelId))continue;
  const value=fields[field].normalize('NFKC');
  const matched=rule.matching==='exact complete hashtag token'
   ? /(?:^|[^\p{L}\p{N}_])#missionedsouls(?![\p{L}\p{N}_])/u.test(value.toLowerCase())
   : ` ${normalize(value)} `.includes(` ${rule.phrase} `);
  if(matched)hits.push({rule,field});
 }
 if(!hits.length)return {...policy.noEvidence};
 const {rule,field}=hits[0];
 return {candidate:true,strength:rule.strength,primaryRuleId:rule.id,primaryField:field,normalizedMatch:rule.phrase,positiveTitleHint:hits.some(h=>h.field==='title'),emitsApprovalDecision:false};
}
const digest=async value=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(n=>n.toString(16).padStart(2,'0')).join('');
let policyHash;
export async function candidateEvidence(input){
 const data=candidateInput(input);
 policyHash ||= digest(JSON.stringify(policy));
 return {policyVersion:CANDIDATE_VERSION,policyHash:await policyHash,metadataHash:await digest(JSON.stringify(data)),input:data,recognition:recognizeCandidate(data)};
}
