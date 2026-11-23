import {audienceInstructions,generationMessages,reviewMessages} from './model-evidence.mjs';
import {clinicalMode,clinicianProtocol} from './clinician-synthesis.mjs';
import {learningInstructions} from './learning-decks.mjs';
import {buddySecurityRules,compactBuddySecurityRules} from './buddy-prompt.mjs';

export class ContextLimit extends Error {}
// Llama 3 uses byte-level BPE. UTF-8 byte length is a conservative upper bound,
// not a chars/4 estimate. Reserve 256 tokens for the provider's chat template.
export const contextCost=(messages,maxTokens)=>new TextEncoder().encode(JSON.stringify(messages)).length+maxTokens+256;
const fits=(messages,maxTokens)=>contextCost(messages,maxTokens)<=8192;
const compactSource=({id,deck,text,focus,date,historical,sourceType,publicationTypes,abstractOnly},clinical)=>({id,deck,text,focus,date,historical,...(clinical?{sourceType,publicationTypes,abstractOnly}:{})});

export function compactGeneration(input,evidence,repair=''){
 const maxTokens=2048,clinical=clinicalMode(input,evidence);
 const messagesFor=sources=>{
  const messages=generationMessages(input,{...evidence,sources:sources.map(s=>compactSource(s,clinical))},repair.slice(0,350));
  messages[0].content=messages[0].content.replace(buddySecurityRules,compactBuddySecurityRules)
   .replace(audienceInstructions['General reader'],'General: answer directly in natural, connected everyday English. Start with a familiar description. Explain essential jargon immediately; omit unnecessary specialist names. No personal diagnosis or treatment advice. Cite every factual explanation.')
   .replace(audienceInstructions['Medical professional'],'Clinicians: precise medical and educational language; preserve population, subtype and date limits. Source-supported mechanisms and clinical distinctions only. No individual diagnosis or prescription.')
   .replace(clinicianProtocol,'Direct claims require section synthesis, evidence, or limitations. Cite both sides of conflicts. Use only retrieved, population-matched evidence and documented study designs. No inferred dosage, drug interaction, off-label indication or guideline. Return final claims only.')
   .replace(learningInstructions,'Knowledge question: explain normal meaning and function before related disorders. Do not portray a substance or healthy organ as a disease. Images are not extra claim evidence.');
  messages[0].content+=' For this short-context request: at most '+(clinical?'3':'2')+' direct-answer claims, at most 200 characters per claim and 200 per quote. Use complete sentences.';
  return messages;
 };
 const selected=[],seen=new Set();
 if(!fits(messagesFor([]),maxTokens))throw new ContextLimit();
 // Retrieval ranks evidence for the question. Keep complete passages and
 // reserve space for distinct sources when a passage has multiple taxonomy tags.
 const ordered=input.mode==='chat'&&input.deck
  ?[...evidence.sources].sort((a,b)=>Number(b.deck===input.deck)-Number(a.deck===input.deck))
  :evidence.sources;
 for(const source of ordered){
  const key=(source.url||source.documentId||'')+'|'+source.text;
  if(seen.has(key))continue;
  seen.add(key);
  if(fits(messagesFor([...selected,source]),maxTokens))selected.push(source);
 }
 if(!selected.length)throw new ContextLimit();
 return {messages:messagesFor(selected),evidence:{...evidence,sources:selected},maxTokens};
}

export function compactReviews(draft,evidence,input){
 const maxTokens=1200,clinical=clinicalMode(input,evidence);
 const ids=new Set(draft.answer.claims.flatMap(claim=>claim.support.map(s=>s.id)));
 // Keep competing clinical evidence in the same review, including uncited
 // passages. Dropping them to fit could hide a contradictory finding.
 const sources=evidence.sources.filter(s=>clinical||ids.has(s.id)).map(s=>compactSource(s,clinical));
 const messages=reviewMessages(draft,{...evidence,sources},input);
 if(!fits(messages,maxTokens))throw new ContextLimit();
 return [{draft,messages,maxTokens}];
}
