import {insufficientClinicalContext} from './medical-contract.js';
import {clinicalSections} from './clinical-sections.js';
import {renderRetry} from './retry-control.js';
import {isDocumentReference} from './document-policy.js';
import {renderClinicalResponseExtras} from './clinical-response-extras.js';
const element=(tag,text,cls)=>Object.assign(document.createElement(tag),{textContent:text||'',className:cls||''});
function sourceLink(cite,label){
 if(isDocumentReference(cite)){const b=element('button',label,'document-citation');b.type='button';b.onclick=()=>document.dispatchEvent(new CustomEvent('healthbrowse-document-source',{detail:cite}));return b}
 try{const url=new URL(cite.url);if(!['https:','http:'].includes(url.protocol)||url.username||url.password)return null;const a=element('a',label+' ↗');a.href=url.href;a.target='_blank';a.rel='noopener noreferrer';return a}catch{return null}
}
export function renderAnswer(parent,answer={},renderCheck,onRetry){
 const guidance=(text,refs,cls)=>{const p=element('p',text,cls);for(const ref of refs||[]){const link=sourceLink(ref,'['+(ref.id||'CDC')+']');if(link){link.setAttribute('aria-label','Source: '+ref.title);const span=element('span','','inline-citations');span.append(link);p.append(span)}}return p};
 if(answer.diagnosisNotice)parent.append(guidance(answer.diagnosisNotice,answer.diagnosisReferences,'diagnosis-lead'));
 const blocks=(answer.blocks||[]).filter(b=>typeof b?.text==='string'&&b.text.trim()
  &&!(b.kind==='diagnosis-lead'&&answer.diagnosisNotice)
  &&!(b.kind==='care-advice'&&answer.careAdvice)
  &&!(b.kind==='follow-up'&&answer.followUpQuestions?.length));
 if(blocks.length){
  const list=answer.list?element('ul','','symptom-list'):null;if(list)parent.append(list);
  blocks.forEach((block,i)=>{
   const box=element('section','', 'answer-block');
   if(block.title&&block.title!=='Direct answer')box.append(element('h4',block.title));
   const text=element('p',block.text.replace(/ • /g,'\n• '),'answer-text');
   const refs=block.references?.length?block.references:block.citation?[block.citation]:[];
   const valid=refs.map((ref,j)=>({ref,link:sourceLink(ref,'['+(ref.id||String(i+1)+(refs.length>1?'.'+(j+1):''))+']')})).filter(r=>r.link);
   if(valid.length){const links=element('span','','inline-citations');for(const {ref,link} of valid){link.title=ref.title||'Supporting source';link.setAttribute('aria-label',[ref.id,ref.title||'Supporting passage'].filter(Boolean).join(' · '));if(!isDocumentReference(ref))link.addEventListener('click',event=>{if(event.button||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;const request=new CustomEvent('healthbrowse-source',{cancelable:true,detail:ref});if(!document.dispatchEvent(request))event.preventDefault()});links.append(link)}text.append(links)}
   box.append(text);
   if(valid.length){
    const detail=element('details','', 'source-evidence');detail.append(element('summary','Sources & verification'));
    for(const {ref} of valid){const a=sourceLink(ref,ref.title||'Supporting source');if(a)detail.append(a);if(ref.date)detail.append(element('small',ref.date,'meta'));if(ref.sourceType)detail.append(element('small',ref.sourceType,'meta'));
     if(answer.clinicalSynthesis){
      for(const [label,value] of [['Study design',ref.studyDesign],['Study population',ref.population]]){
       if(typeof value==='string' && value.trim())detail.append(element('small',label+' · '+value,'meta'));
      }
     }
     if(ref.attribution)detail.append(element('small',ref.attribution,'meta'));if(ref.quote)detail.append(element('blockquote',ref.quote));}
    if(block.verification)detail.append(element('small',block.verification,'meta'));
    renderCheck?.(detail,block.check);box.append(detail);
   }
   if(list){const item=element('li');item.append(box);list.append(item)}else parent.append(box);
  });
  for(const gap of answer.gaps||[])if(gap.trim())parent.append(element('p',gap,'coverage-gap'));
 }else{
  const text=typeof answer.text==='string'&&answer.text.trim()?answer.text:insufficientClinicalContext;
  // The structured lead and questions are rendered separately below/above.
  const body=answer.diagnosisNotice?text.replace(answer.diagnosisNotice,'').split('A few questions to understand your situation:')[0].replace(answer.careAdvice?.text||'\u0000','').trim():text;
  if(body)parent.append(element('p',body,'answer-text'));
  for(const cite of answer.citations||[]){const a=sourceLink(cite,cite.title);if(a)parent.append(a)}
  for(const check of answer.checks||[])renderCheck?.(parent,check);
 }
 if(answer.treatmentNotice&&(blocks.length||!answer.text?.includes(answer.treatmentNotice)))parent.append(element('p',answer.treatmentNotice,'treatment-notice'));
 if(answer.careAdvice)parent.append(guidance(answer.careAdvice.text,answer.careAdvice.references,'care-next-step'));
 renderFollowUps(parent,answer.followUpQuestions);
 if(answer.audienceDisclaimer&&(blocks.length||!answer.text?.includes(answer.audienceDisclaimer)))parent.append(element('p',answer.audienceDisclaimer,'query-interpretation'));
 renderAnswerFooter(parent,answer,onRetry);
}

function renderFollowUps(parent,questions) {
 if(!questions?.length)return;
 const section=element('section','','symptom-follow-up');
 section.append(element('h4','A few questions to understand your situation'));
 const list=element('ol');
 for(const question of questions)list.append(element('li',question));
 section.append(list);parent.append(section);
}

function renderAnswerFooter(parent,answer,onRetry) {
 // Operational and audience labels never replace or precede the actual answer.
 if(answer.modelNotice){const notice=element('p',answer.modelNotice,'model-notice');notice.setAttribute('role','status');parent.append(notice)}
 renderRetry(parent,answer,onRetry);
 if(answer.routingNotice)parent.append(element('small',answer.routingNotice,'meta'));
 if(answer.style)parent.append(element('small',answer.style,'answer-mode'));
 if(answer.generation)parent.append(element('small',(answer.generation.label||'AI synthesis')+' · '+answer.generation.model+(answer.generation.corrected?' · revised after source review':''),'meta'));
}

// Used for medical clinician answers in both the browser and Buddy. Render only
// blocks with resolved claim-level references, including when synthesis is offline.
export function renderClinicalSynthesis(parent, answer = {}, renderCheck, onRetry) {
 const report=element('div','','clinical-report');
 for(const group of clinicalSections(answer)){
  const section=element('section','','clinical-report-section');
  section.dataset.clinicalSection=group.key;
  const heading=element('h3',group.title);heading.tabIndex=-1;section.append(heading);
  if(group.blocks.length)renderAnswer(section,{blocks:group.blocks,clinicalSynthesis:true},renderCheck);
  for(const note of group.notes)section.append(element('p',note,'clinical-coverage-note'));
  report.append(section);
 }
 renderFollowUps(report,answer.followUpQuestions);
 renderAnswerFooter(report,answer,onRetry);
 if(answer.clinicalInteraction)renderClinicalResponseExtras(report,answer);
 parent.append(report);
}
