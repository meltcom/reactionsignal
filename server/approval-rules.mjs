// The same evidence rules apply to every channel and covered performer.
const normalize=s=>String(s||'').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
export const mentionsPerformer=(text,aliases)=>aliases.some(a=>normalize(a)&&` ${normalize(text)} `.includes(` ${normalize(a)} `));
export const reactionWording=title=>/\b(reacts?|reactions?|reacting)\b|\bfirst\s+time\s+(?:hearing|listening(?:\s+to)?)\b/i.test(title);
export const explicitShort=title=>/#shorts?\b|\b(?:YT|YouTube)\s+shorts?\b/i.test(title);
export const ambiguousContext=title=>/\bwatch\s*party\b|\btour\s+updates?\b|\bbehind\s+the\s+scenes\b|\bbefore\b.*\bthere\s+was\b/i.test(title);
export function reactionEvidence(title,aliases,description='') {
 if(ambiguousContext(title))return false;
 const inTitle=mentionsPerformer(title,aliases);
 // A tag list or a link to the original is not reaction evidence.
 const inDescription=String(description).split(/[\n.!?]+/).some(sentence=>
  !/https?:\/\/|^\s*#|\boriginal\s+(?:video|link)\b/i.test(sentence)&&mentionsPerformer(sentence,aliases)&&reactionWording(sentence));
 return inTitle||reactionWording(title)&&inDescription;
}
