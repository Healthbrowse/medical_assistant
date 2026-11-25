import {pressureDecks} from '../dist/blood-pressure-routine.js';
import {conceptWords,definitionScore} from '../dist/answer-relevance.js';
import {authorityFor} from '../dist/authorities.js';
import {hasUnsafeBuddyOutput,assessBuddySafety} from '../dist/buddy-policy.js';
import {domainTitle} from '../dist/disease-framework.js';
import {buddyLearningQuestions} from '../dist/learning-questions.js';
import {canSaveResearchQuestion} from '../dist/query-input.js';
import {retrievalTerms} from '../dist/query-understanding.js';
import {roleIndex} from '../dist/reading-profiles.js';
import {assessSafety,hasUnsafeInstructions,personalDiagnosisNotice} from '../dist/safety-policy.js';
import {containsReasoningTag} from './clinician-synthesis.mjs';
import {guidelineHosts} from './literature-guidelines.mjs';

export const isBuddyOverview = input => input.mode === 'chat' && input.deck === 0 && !input.attachments
 && canSaveResearchQuestion(input.question) && !personalDiagnosisNotice(input.question,input.topic);

function eligibleSource(source) {
 if (!source.id || !source.title || !source.text || source.historical || source.text.length > 2200) return false;
 if (/\b\d+(?:\.\d+)?\s*(?:mg|mcg|µg|ml)\b/i.test(source.text)) return false;
 let url;
 try { url = new URL(source.url); } catch { return false; }
 if (url.protocol !== 'https:' || url.username || url.password || url.port) return false;
 const textbook = url.origin === 'https://github.com' && source.sourceRevision && source.sourceParagraph
   && url.pathname.startsWith('/openstax/osbooks-anatomy-physiology/blob/' + source.sourceRevision + '/modules/');
 if (!authorityFor(source.url) && !guidelineHosts.has(url.hostname) && !textbook) return false;
 return !containsReasoningTag(source.text) && !hasUnsafeInstructions(source.text) && !hasUnsafeBuddyOutput(source.text)
   && assessSafety(source.text).action === 'allow' && assessBuddySafety(source.text).action === 'allow';
}

const learningCues = [
 /\b(is|are|refers to|consists? of)\b/i,
 /\b(oxidative|respiration|membranes?|matrix|transport\w*|process\w*|pathway|enzym\w*|bind\w*|metaboli\w*|secretes?|releases?|stores?|signal\w*|produces?)\b/i,
 /\b(function\w*|responsible|needed|necessary|important|role|supply|provides?|energy|regulat\w*|control\w*|maintain\w*|growth)\b/i,
 /\b(measur\w*|assays?|test(?:s|ed|ing)?|microscop\w*|biops\w*|imaging|diagnos\w*)\b/i,
 /\b(abnormal\w*|deficien\w*|dysfunction|disorders?|diseases?|mutations?|excess|defect\w*|damag\w*)\b/i,
 /\b(responsible|provid\w*|control\w*|ener(?:gy|getic)|regulat\w*|function\w*|hormones?|ATP|produces?)\b/i
];

function learningCandidates(source, terms) {
 const sentences = source.text.split(/(?<=[.!?])\s+(?=[A-Z“"‘])/u);
 const candidates = [];
 for (const [index,text] of sentences.entries()) {
  const words = new Set(conceptWords(text));
  if (!terms.every(term => words.has(term)) || text.length < 30 || !/[.!?]["”']?$/.test(text)) continue;
  if (/^(?:it|they|this|these|those|for example|however|in addition)\b|\b(?:this process|visit this link|click here)\b/i.test(text) || text.endsWith('?')) continue;
  for (let i=0;i<learningCues.length;i++) {
   if (!learningCues[i].test(text)) continue;
   if (i !== 4 && /\b(diseases?|disorders?|mutations?|deficien\w*|defective|dysfunction)\b/i.test(text)) continue;
   candidates.push({deck:i+1,text,lead:index===0});
  }
 }
 return candidates;
}

// Group the passages from this request, keeping each quote intact and traceable.
export function buddyOverviewDecks(input, evidence) {
 if (!isBuddyOverview(input) || evidence.documentMode) return [];
 if (evidence.dailyPressure) return pressureDecks();
 const clinical = roleIndex(input.role) === 1;
 const subject = input.topic;
 const terms = conceptWords(retrievalTerms(subject));
 const titles = evidence.learningMode ? buddyLearningQuestions(input.role) : null;
 const used = new Set();
 const byDeck = Array.from({length:6}, () => []);
 // One textbook paragraph may have been indexed under several learning areas.
 const seenPassages = new Set();
 for (const source of evidence.sources) {
  if (!terms.length || !eligibleSource(source)) continue;
  const heading = new Set(conceptWords([source.title,source.heading].filter(Boolean).join(' ')));
  const textWords = new Set(conceptWords(source.text));
  if (!terms.every(term => textWords.has(term) || heading.has(term))) continue;
  let score = terms.filter(term => textWords.has(term)).length * 3;
  if (terms.every(term => heading.has(term))) score += 12;
  const education = /patient.education|medlineplus health.topic/i.test(source.sourceType || '');
  if (clinical && /guideline|study|trial|publication|abstract|textbook/i.test((source.sourceType || '').replace(/not a clinical guideline/gi,''))) score += 5;
  if (!clinical && education) score += 6;
  if (source.abstractOnly && !clinical) score -= 5;

  if (evidence.learningMode) {
   const key = source.url + '|' + source.text;
   if (seenPassages.has(key)) continue;
   seenPassages.add(key);
   for (const entry of learningCandidates(source,terms)) {
    const definition = entry.deck === 1 ? definitionScore({text:entry.text,heading:source.heading},'What is '+subject+'?',subject) : 0;
    const familiarDefinition = definition && /\bis (?:a|an|the)\b/i.test(entry.text) ? 15 : 0;
    byDeck[entry.deck-1].push({source,text:entry.text,score:score + definition + familiarDefinition + (entry.lead?4:0)});
   }
  } else if (Number.isInteger(source.deck) && source.deck >= 1 && source.deck <= 6 && (!source.overview || source.deck === 2)) {
   byDeck[source.deck-1].push({source,text:source.text,score});
  }
 }
 return byDeck.map((candidates,i) => {
  const deck = i+1;
  const title = titles ? titles[i] : domainTitle(deck,input.role);
  candidates.sort((a,b) => b.score-a.score || a.text.length-b.text.length);
  const chosen = candidates.find(({source,text}) => !used.has(text) &&
    (!source.scopeTerms?.length || source.scopeTerms.some(term => text.toLowerCase().includes(term.toLowerCase()))));
  if (!chosen) return {deck,title,blocks:[]};
  const {source,text} = chosen;
  used.add(text);
  const ref = {...source,quote:text};
  return {deck,title,blocks:[{text,citation:ref,references:[ref],verification:'Verbatim source excerpt.'}]};
 });
}
