import {recognizeCandidate} from './candidate-recognition.mjs';
import {reactionEvidence,mentionsPerformer,ambiguousContext} from './approval-rules.mjs';

export const AUTOMATIC_MATCH_POLICY='automatic-matches-v1';
export function automaticMatch(row,item){
 if(row.review_mode!=='auto'||/moderator|manual/i.test(row.source||''))return {status:null,reason:'Explicit review policy or manual decision is protected.'};
 if(item?.status?.privacyStatus!=='public'||item.snippet?.channelId!==row.channel_id)return {status:null,reason:'Public metadata or channel identity could not be verified.'};
 const title=item.snippet.title||'',description=item.snippet.description||'',aliases=JSON.parse(row.aliases);
 if(item.snippet.liveBroadcastContent==='upcoming')return {status:null,deferred:true,reason:'Upcoming video will be retried after publication.'};
 // Promotional announcements are not the reaction they advertise. Do not infer
 // identity from tags, links, or the channel's unrelated videos.
 const promotion=/\b(?:tomorrow\s*release|new\s+reaction\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)|watch\s*party|tour\s+updates?|behind\s+the\s+scenes)\b|\bwatch\s*party\b.*\b(?:today|ready)\b/i.test(title);
 if(promotion||ambiguousContext(title))return {status:'REJECTED',reason:'Promotional, watch-party or ambiguous non-reaction context.'};
 if(reactionEvidence(title,aliases,description))return {status:'CONFIRMED',reason:'Exact performer title or explicit narrative reaction evidence.'};
 const candidate=row.performer_id==='missioned-souls'?recognizeCandidate({id:item.id,...item.snippet}):null;
 const titleIdentity=candidate?.positiveTitleHint;
 const narrativeReaction=candidate?.strength==='strong'&&/\b(?:reacts?|reactions?|reacting|reagindo)\b/i.test(title);
 if(row.discovery_scope==='eligible'&&(titleIdentity||narrativeReaction))return {status:'CONFIRMED',reason:'Eligible reactor with exact title hashtag, performer variant or channel-scoped identity rule.'};
 return {status:'REJECTED',reason:mentionsPerformer(description,aliases)?'Description mention without sufficient reaction context.':'No supported performer/reaction identity in current metadata.'};
}
