import {insufficientClinicalContext,patientDisclaimer} from './medical-contract.js';
import {clinicalSections} from './clinical-sections.js';
import {roleIndex} from './reading-profiles.js';

const safeText=value=>String(value||'').replace(/[\r\n]+/g,' ').replace(/([\\`*_{}\[\]<>])/g,'\\$1');
const safeIdentifier=value=>String(value||'').replace(/[\r\n]+/g,' ').replace(/([\\\[\]<>])/g,'\\$1');
function validSource(source){
 try{const u=new URL(source.url);return ['https:','http:'].includes(u.protocol)&&!u.username&&!u.password}catch{return false}
}
const referencesFor=block=>block.references?.length?block.references:block.citation?[block.citation]:[];
function generalBlocks(answer){
 const blocks=[];
 if(answer.diagnosisNotice)blocks.push({text:answer.diagnosisNotice,references:answer.diagnosisReferences});
 const body=(answer.blocks||[]).filter(block=>block.text&&
  !(block.kind==='diagnosis-lead'&&answer.diagnosisNotice)&&!(block.kind==='care-advice'&&answer.careAdvice)&&
  !(block.kind==='follow-up'&&answer.followUpQuestions?.length));
 if(body.length)blocks.push(...body);
 else if(!answer.blocks?.length&&answer.text&&answer.text!==answer.diagnosisNotice)blocks.push({text:answer.text,references:answer.citations});
 if(answer.careAdvice?.text)blocks.push(answer.careAdvice);
 return blocks;
}

export function answerReferences(answer){
 const blocks=answer.clinicalSynthesis?clinicalSections(answer).flatMap(section=>section.blocks):generalBlocks(answer);
 const refs=blocks.flatMap(referencesFor).filter(validSource);
 return [...new Map(refs.map(ref=>[ref.url,ref])).values()];
}

export function answerMarkdown({topic,role,answer={}}){
 const clinical=roleIndex(role)===1;
 const out=['# '+safeText(topic),'*View: '+(clinical?'Clinical Professional':'General Public')+'*',''];
 const citations=new Map();
 function writeClaim(block){
  const links=[];
  for(const r of referencesFor(block).filter(validSource)){
   const key=JSON.stringify([r.id||'',r.url]);
   if(!citations.has(key))citations.set(key,{...r,label:r.id||String(citations.size+1),quotes:new Set()});
   const entry=citations.get(key);
   if(r.quote)entry.quotes.add(r.quote);
   links.push('['+safeIdentifier(entry.label)+']');
  }
  out.push([safeText(block.text),...links].join(' '),'');
 }
 if(clinical){
  for(const group of clinicalSections(answer)){
   out.push('## '+group.title,'');
   group.blocks.forEach(writeClaim);
   for(const note of group.notes)out.push(safeText(note),'');
  }
 }else{
  out.push('## Browser Summary','');
  const blocks=generalBlocks(answer);
  if(blocks.length)blocks.forEach(writeClaim);else out.push(insufficientClinicalContext,'');
  for(const note of answer.gaps||[])out.push(safeText(note),'');
 }
 if(answer.followUpQuestions?.length){
  out.push('## Follow-up questions','');
  for(const question of answer.followUpQuestions)out.push('- '+safeText(question));
  out.push('');
 }
 if(answer.modelNotice)out.push(safeText(answer.modelNotice),'');
 out.push('## Authorized Citations','');
 for(const r of citations.values()){
  out.push('* ['+safeIdentifier(r.label)+'] ['+safeText(r.title||'Source')+'](<'+new URL(r.url).href.replace(/>/g,'%3E')+'>)'+(r.date?' · '+safeText(r.date):''));
  if(clinical)for(const quote of r.quotes)out.push('  > '+safeText(quote));
 }
 if(!citations.size)out.push('No supporting citations are available for this response.');
 if(!clinical&&!generalBlocks(answer).some(block=>block.text?.includes(patientDisclaimer)))out.push('',patientDisclaimer);
 return out.join('\n');
}
