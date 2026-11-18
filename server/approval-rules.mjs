// The same evidence rules apply to every channel and covered performer.
const normalize=s=>String(s||'').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
export const mentionsPerformer=(text,aliases)=>aliases.some(a=>normalize(a)&&` ${normalize(text)} `.includes(` ${normalize(a)} `));
export const reactionWording=title=>/\b(reacts?|reactions?|reacting)\b|\bfirst\s+time\s+(?:hearing|listening(?:\s+to)?)\b/i.test(title);
export const explicitShort=title=>/#shorts?\b|\b(?:YT|YouTube)\s+shorts?\b/i.test(title);
export const ambiguousContext=title=>/\bwatch\s*party\b|\btour\s+updates?\b|\bbehind\s+the\s+scenes\b|\bbefore\b.*\bthere\s+was\b/i.test(title);
const descriptionSentences=description=>String(description||'').normalize('NFKC').split(/[\n\r\u0085\u2028\u2029]+/)
 .filter(line=>!/https?:\/\/|^\s*(?:#|(?:original\s+(?:video|link)|credits?|source\s*[- ]?link)\b)/i.test(line))
 .flatMap(line=>line.split(/[.!?;]+/)).map(sentence=>sentence.trim());
// Preserve the existing title-plus-description route and the broker prefilter.
export const narrativeReactionEvidence=(aliases,description='')=>String(description||'').split(/[\n.!?]+/)
 .some(sentence=>!/https?:\/\/|^\s*#|\boriginal\s+(?:video|link)\b/i.test(sentence)&&mentionsPerformer(sentence,aliases)&&reactionWording(sentence));
const nonReactionFraming=/\b(?:interview|podcast|tribute|biography|profile|news|announcement|trailer|teaser|preview|livestream|live stream|tomorrow|coming soon|next week)\b/i;
const unrelatedNarrative=/\b(?:not|never|without|instead|rather|unlike|inspired|influenced|recommended|suggested|thanks|fan|requested|tomorrow|next week|coming soon|copyright|disclaimer|fair use|section\s*107|original\s+(?:video|link)|interview|tribute|biography|profile|announcement|preview|playlist)\b/i;
export function explicitDescriptionReaction(title,aliases,description='') {
 if(ambiguousContext(title)||nonReactionFraming.test(title))return false;
 // Only an explicit statement about this reaction can supply missing title
 // identity. Links, tags, boilerplate, third-party quotes and future plans cannot.
 return descriptionSentences(description).some(sentence=>sentence.length<=240&&!sentence.includes('#')
  &&/^(?:(?:today|in this video)[,:]?\s+)?(?:reacting\s+to\b|(?:i am|i'm|we are|we're|i|we)\s+(?:reacting|react)\s+to\b)/i.test(sentence)
  &&mentionsPerformer(sentence,aliases)&&!unrelatedNarrative.test(sentence));
}
export function reactionEvidence(title,aliases,description='') {
 if(ambiguousContext(title))return false;
 const inTitle=mentionsPerformer(title,aliases);
 return inTitle||reactionWording(title)&&narrativeReactionEvidence(aliases,description)
  ||explicitDescriptionReaction(title,aliases,description);
}
