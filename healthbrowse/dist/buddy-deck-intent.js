import {classifyResponseMode} from './response-mode.js';

const deckRequest = /\b(?:(?:all\s+(?:of\s+)?(?:the\s+)?)?(?:six|6)[\s-]+(?:medical\s+)?decks?|all\s+(?:of\s+)?(?:the\s+)?(?:medical\s+)?decks)\b/i;
const overviewPrefix = /^(?:what(?:'s| is| are)|define|explain|describe|summari[sz]e|tell me (?:more )?about|what about|(?:give me |provide |show me )?(?:an? |the )?(?:general |clinical |medical )?overview (?:of|on))\s+/i;
const currentSubject = /^(?:it|this|that|(?:the|this|that|my|our)(?: (?:current|active|same|selected))? (?:topic|condition|disease|subject|question|disorder)|(?:the )?(?:current|active|same|selected) topic)$/i;
const focused = /\b(?:caus(?:e|es|ed)|pathogenesis|mechanisms?|functions?|symptoms?|signs?|diagnos(?:is|tic|ed)|tests?|treat(?:ed|ment|ments)|therap(?:y|ies)|medications?|dos(?:e|es|age|ing)|risks?|prevention|complications?|prognosis|outlook|follow[- ]?up|contraindications?|side effects?|criteria|incidence|prevalence|epidemiology|mortality|management|compare|versus|difference|how|why|which|when|where|who|do|does|should|can|could|my|your|i|recommend|list|studies|trials|papers)\b/i;

function normalize(text) {
  return String(text || '').normalize('NFKC').trim().replace(/[’]/g, "'").replace(/\s+/g, ' ')
    .replace(/^(?:hey buddy[, ]+|buddy[, ]+)?(?:(?:can|could|would) you\s+)?(?:please\s+)?/i, '')
    .replace(/[?!.\s]+$/, '').replace(/,?\s+please$/i, '');
}

function explicitSubject(q, match) {
  const after = q.slice(match.index + match[0].length).trim();
  const suffix = after.match(/^(?:(?:overview|breakdown|answer|response|report|format)\s+)?(?:for|about|on|of|covering)\s+(.+)$|^[:–—-]\s*(.+)$/i);
  const before = q.slice(0, match.index);
  const front = before.match(/^(.+?)(?:\s*[,;:]\s*|\s+(?:in|as|using|with|through|across|broken into)\s+(?:the\s+)?)$/i);
  const precedingQuestion = before.match(/^(.+?)[?!.]\s*(?:(?:please )?(?:give|show|provide|include|use)(?: me)?(?: all)?(?: the)?\s*)?$/i);
  const subject = (suffix?.[1] || suffix?.[2] || front?.[1] || precedingQuestion?.[1] || '').trim().replace(overviewPrefix, '');
  return currentSubject.test(subject) ? '' : subject;
}

// Input intent only. Callers must still screen the original question before retrieval.
export function buddyDeckIntent(question, context = {}) {
  const q = normalize(question);
  const match = deckRequest.exec(q);
  const subject = match ? explicitSubject(q, match) : q.replace(overviewPrefix, '');
  const selected = String(context.topic || '').toLowerCase();
  const aliases = [selected, ...(context.aliases || []).map(s => s.toLowerCase())].filter(Boolean);
  const namedTopic = aliases.includes(subject.toLowerCase());
  const medical = classifyResponseMode(subject || q, {index: context.index}) === 'medical'
    || (namedTopic && context.responseMode !== 'general')
    || context.queryMode === 'medical'
    || /\b[a-z]{3,}(?:itis|opathy|penia|plasia|iasis|emia|aemia|sarcoma|carcinoma)\b/i.test(subject);
  if (match) {
    const activeMedical = !subject && (context.responseMode !== 'general' || !selected);
    const declined = /\b(?:don'?t|do not|no|without|skip|avoid|omit)\b[^.!?]{0,32}$/i.test(q.slice(0, match.index));
    const allowed = !declined && (medical || activeMedical) && !/\b(?:SOX|audit|financial|sales|pitch|slide|marketing|PowerPoint|tarot|playing cards)\b/i.test(q);
    return {explicit: allowed, topic: allowed ? subject : '', overview: allowed};
  }
  const inherited = currentSubject.test(subject) && !!selected && context.responseMode !== 'general';
  const bareSubject = q.split(' ').length <= 8 && /^[\p{L}\d' /-]+$/u.test(q);
  const broad = !focused.test(subject) && (subject !== q || bareSubject);
  return {explicit: false, topic: '', overview: Boolean(subject && broad && (medical || inherited))};
}
