import {retrievalTerms} from './query-understanding.js';

// A matching publisher page is not necessarily an answer to the question.
// Share this check between the immediate browser excerpt and server selection.
const irregular={mitochondria:'mitochondrion',mitochondrial:'mitochondrion',nuclei:'nucleus',alveoli:'alveolus',bacteria:'bacterium',atria:'atrium'};
export const conceptWords=text=>(String(text||'').toLowerCase().match(/[a-z0-9]+/g)||[]).map(w=>irregular[w]||(w.length>4?w.replace(/ies$/,'y').replace(/s$/,''):w));
const normalized=text=>conceptWords(text).join(' ');
export function definitionSubject(question,topic=''){
 const q=String(question||'').trim();
 if(!/^(?:what (?:is|are)|define|tell me about|explain|describe)\b/i.test(q))return '';
 if(/\b(symptoms?|causes?|treatments?|diagnosis|prognosis|risk factors?|complications?|dosage)\b/i.test(q))return '';
 return normalized(retrievalTerms(q,{topic,context:true}));
}
function definitionInfo(source,question,topic){
 const subject=definitionSubject(question,topic);if(!subject)return null;
 const sentences=String(source.text||'').split(/(?<=[.!?])\s+(?=[A-Z“"‘])/u);
 const phrase=subject.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
 const predicate=new RegExp('^(?:(?:a|an|the|your) )?'+phrase+' (?:is|are|refer|mean|consist|produce|convert|control|regulate|secrete|contain|help|provide|function)(?: |$)');
 const index=sentences.findIndex(s=>predicate.test(normalized(s.replace(/\([^)]*\)/g,' '))));
 const heading=normalized(source.heading)===subject;
 return {subject,sentences,index,score:index<0?0:80+(heading?30:0)+(index===0?10:0)};
}
export function definitionScore(source,question,topic){return definitionInfo(source,question,topic)?.score||0}
export function definitionExcerpt(source,question,topic){
 const match=definitionInfo(source,question,topic);if(!match||match.index<0)return null;
 // Return contiguous, complete source sentences. Do not turn an adjacent
 // disease-treatment paragraph into the definition of a normal cell component.
 const out=[];
 for(const sentence of match.sentences.slice(match.index,match.index+5)){
  if(out.length&&/\b(?:if you have|when .+ defective|these diseases|these disorders|treatments?|no cures?|genetic mutations cause)\b/i.test(sentence)&&!/disease|disorder|cancer/.test(match.subject))break;
  if(out.length&&(out.join(' ').length+sentence.length>850))break;
  out.push(sentence);
 }
 return out.join(' ');
}
