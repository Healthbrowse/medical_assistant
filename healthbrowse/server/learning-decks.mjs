import {retrievalTerms} from '../dist/query-understanding.js';
import {buddyLearningQuestions} from '../dist/learning-questions.js';
export function learningDecks(evidence,input,local){
 if(!evidence||evidence.documentMode||!evidence.sources.some(s=>s.sourceType?.includes('foundational medical education')))return evidence;
 const normalize=s=>String(s||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
 const subject=normalize(retrievalTerms(input.question,{topic:input.topic,context:input.mode==='chat'}));
 // A disease page reached through an organ/substance alias does not make the query a disease question.
 if(local?.sources?.some(s=>normalize(s.title?.split(' · ')[0])===subject))return evidence;
 // Browser answers use retrieved passages directly. Keep numeric areas for
 // existing Buddy threads that refer to a selected area.
 if(input.mode==='search')return {...evidence,learningMode:true};
 const mapping={0:[0,1],1:[5],2:[2,3],3:[5],4:[4],5:[5],6:[5]};
 const sources=[],seen=new Set();
 for(const s of evidence.sources)for(const deck of (s.overview?[0,1,6]:mapping[s.deck]||[])){const key=deck+'|'+s.url+'|'+s.text;if(seen.has(key))continue;seen.add(key);sources.push({...s,id:'S'+(sources.length+1),deck,overview:deck===0});}
 const questions=buddyLearningQuestions(input.role);
 return {...evidence,sources,learningMode:true,deckQuestions:questions,domains:questions.map((title,i)=>({id:i+1,title,question:title,scope:title}))};
}
export const learningInstructions='This is a medical or biology KNOWLEDGE question. Explain the subject itself first, including its normal function when relevant. For substances such as bilirubin, explain what it is and how the body handles it when the evidence supports that explanation. Do not describe the substance itself as an illness. A textbook figure is a visual aid and cannot support additional clinical claims.';
