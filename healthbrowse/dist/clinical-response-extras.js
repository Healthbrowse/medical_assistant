import {accountRequest} from './account-client.js';
import {clinicalSections} from './clinical-sections.js';
import {isDocumentReference,documentHasIdentifiers} from './document-policy.js';
import {renderEducationalVisual} from './education-visual.js';

const element=(tag,text='',className='')=>Object.assign(document.createElement(tag),{textContent:text,className});
const string=value=>typeof value==='string'?value.trim():'';
export const clinicalFeedbackTags=Object.freeze([
 'Accurate Reasoning','PDF/Guideline Grounded','Right Level of Depth','Clear Next Steps',
 'Needs More Detail','Too Verbose','Missing Nuance / Edge Case'
]);

function safeUrl(value){
 try{const url=new URL(value);return ['https:','http:'].includes(url.protocol)&&!url.username&&!url.password?url.href:''}
 catch{return ''}
}

function sourceLink(reference,label){
 if(isDocumentReference(reference)){
  const button=element('button',label,'clinical-source-link');button.type='button';
  button.onclick=()=>document.dispatchEvent(new CustomEvent('healthbrowse-document-source',{detail:reference}));
  return button;
 }
 const url=safeUrl(reference?.url);if(!url)return null;
 return Object.assign(element('a',label),{href:url,target:'_blank',rel:'noopener noreferrer'});
}

// Use only claims accepted by the existing clinical renderer. A title match or
// an extra bibliography entry cannot create a clinical takeaway.
export function clinicalReadingSources(answer={}){
 const rows=new Map();
 for(const group of clinicalSections(answer))for(const block of group.blocks){
  for(const reference of block.references){
   const title=string(reference.title);if(!title)continue;
   const documentSource=isDocumentReference(reference),url=documentSource?'':safeUrl(reference.url);
   if(!documentSource&&!url)continue;
   const canonical=documentSource?reference.documentId:new URL(url);if(!documentSource)canonical.hash='';
   const key=documentSource?'document:'+canonical:canonical.href;
   if(rows.has(key)){
    const existing=rows.get(key);existing.uses++;
    if(documentSource&&!existing.pages.includes(reference.page)){existing.pages.push(reference.page);existing.pageReferences.push(reference)}
    continue;
   }
   rows.set(key,{reference,title,url,documentSource,pages:documentSource?[reference.page]:[],pageReferences:documentSource?[reference]:[],
    source:string(reference.journal)||string(reference.publisher)||string(reference.sourceType)||(url?new URL(url).hostname:'Uploaded PDF'),
    sourceType:string(reference.sourceType),date:string(reference.date),
    takeaway:block.text,companionSources:block.references,uses:1,order:rows.size});
  }
 }
 return [...rows.values()].sort((a,b)=>b.uses-a.uses||a.order-b.order).slice(0,5);
}

function renderReading(parent,answer){
 const section=element('section','','clinical-extra-section clinical-reading');
 section.append(element('h3','Matching clinical sources'));
 const rows=clinicalReadingSources(answer);
 if(!rows.length)section.append(element('p','No source with a verified citation was available for this answer.','meta'));
 else{
  section.append(element('p','Selected from the sources cited above. This is not an exhaustive literature review.','meta'));
  const list=element('ol');
  for(const row of rows){
   const item=element('li'),heading=sourceLink(row.reference,row.title);
   if(!heading)continue;
   item.append(heading,element('small',row.source,'meta'));
   if(row.sourceType&&row.sourceType!==row.source)item.append(element('small',row.sourceType,'meta'));
   if(row.documentSource){
    const pages=element('div','','clinical-source-companions');
    pages.append(element('small','Document locations: '));
    for(const ref of row.pageReferences.sort((a,b)=>a.page-b.page)){
     const location=ref.title.match(/\b(slide|section)\s+\d+/i)?.[1]||'page';
     const link=sourceLink(ref,location+' '+ref.page);if(link)pages.append(link);
    }
    item.append(pages);
   }
   if(row.date)item.append(element('small','Source date metadata: '+row.date,'meta'));
   const multiple=row.companionSources.length>1;
   item.append(element('p','Why it matches: '+(multiple?'Cited with the companion sources below for this answer point.':'Cited in support of the answer point below.'),'clinical-source-match'));
   item.append(element('p','Key takeaway: '+row.takeaway,'clinical-source-takeaway'));
   if(multiple){
    const companions=element('div','','clinical-source-companions');
    companions.append(element('small','Read the supporting sources together: '));
    for(const ref of row.companionSources){const link=sourceLink(ref,'['+ref.id+']');if(link)companions.append(link)}
    item.append(companions);
   }
   list.append(item);
  }
  section.append(list);
 }
 parent.append(section);
}

function renderVisual(parent,answer){
 const section=element('section','','clinical-extra-section clinical-visual');
 section.append(element('h3','Relevant clinical visual'));
 const visual=answer.clinicalVisual;
 const eligible=visual&&['title','alt','sourceUrl','attribution','src'].every(key=>typeof visual[key]==='string'&&visual[key].trim());
 // The shared renderer checks catalog identity, the asset route and attribution.
 // An arbitrary image URL or a model-supplied picture is never embedded here.
 if(!eligible||!renderEducationalVisual(section,visual))section.append(element('p','No suitable verified visual was matched to this answer. The cited text remains the reference.','meta'));
 parent.append(section);
}

const safeMetadata=value=>typeof value==='string'&&/^[A-Za-z0-9@][A-Za-z0-9._:/@-]{0,119}$/.test(value)?value:'unavailable';
export function clinicalFeedbackPayload(answer,{rating='',tags=[],note=''}={}){
 const score=String(rating),selected=clinicalFeedbackTags.filter(tag=>tags.includes(tag)),correction=string(note);
 if(score&&!/^[1-5]$/.test(score))throw Error('Choose a rating from 1 to 5.');
 if(correction.length>1000)throw Error('Keep the correction or preference note within 1,000 characters.');
 if(documentHasIdentifiers(correction))throw Error('Remove personal identifiers and patient records from the note.');
 if(!score&&!selected.length&&!correction)throw Error('Choose a rating or tag, or add a short note.');
 const message=[
  'Clinical answer feedback (self-reported; requires review).',
  'Prompt version: '+safeMetadata(answer.clinicalInteraction?.promptVersion),
  'Model: '+safeMetadata(answer.generation?.model),
  score?'Overall clinical utility and accuracy: '+score+'/5 (reviewer assessment).':'',
  selected.length?'Tags: '+selected.join('; '):'',
  correction?'Correction or preference note: '+correction:''
 ].filter(Boolean).join('\n');
 // Never copy the query, case, response, PDF text, or source identifiers here.
 return {message,category:correction||selected.includes('Missing Nuance / Edge Case')?'source-correction':'usability'};
}

function renderFeedback(parent,answer,{request,makeId}){
 const disclosure=element('details','','clinical-feedback');
 disclosure.append(element('summary','Rate this clinical answer (optional)'));
 const form=element('form');
 form.append(element('p','Ratings reflect your assessment. Feedback awaits review and does not retrain the model automatically.','meta'));
 const rating=element('label','Overall clinical utility & accuracy '),score=element('select');
 score.setAttribute('aria-label','Overall clinical utility and accuracy, your assessment');
 score.append(Object.assign(element('option','Choose a rating'),{value:''}));
 for(let value=1;value<=5;value++)score.append(Object.assign(element('option',value+' / 5'),{value:String(value)}));
 rating.append(score);form.append(rating);
 const tags=element('fieldset');tags.append(element('legend','Feedback dimensions (optional)'));
 const inputs=[];
 for(const tag of clinicalFeedbackTags){
  const label=element('label'),input=element('input');input.type='checkbox';input.value=tag;
  label.append(input,element('span',tag));tags.append(label);inputs.push(input);
 }
 form.append(tags);
 const correction=element('label','Correction or preference note (optional)'),note=element('textarea');
 note.rows=3;note.maxLength=1000;note.placeholder='Describe a source correction or preferred depth. Leave out patient identifiers and case details.';
 note.setAttribute('aria-label','Optional correction or preference note, without patient identifiers or case details');
 correction.append(note);form.append(correction);
 form.append(element('p','Only your selected rating, tags, note, prompt version and model are submitted. The case and answer are not attached.','meta'));
 const button=element('button','Submit feedback','act'),status=element('p','','clinical-feedback-status');button.type='submit';
 status.setAttribute('role','status');status.setAttribute('aria-live','polite');
 form.append(button,status);disclosure.append(form);parent.append(disclosure);
 let attempt=null,pending=false,submitted=false;
 form.onsubmit=async event=>{
  event.preventDefault();if(pending||submitted)return;
  let body;
  try{body=clinicalFeedbackPayload(answer,{rating:score.value,tags:inputs.filter(input=>input.checked).map(input=>input.value),note:note.value})}
  catch(error){status.textContent=error.message;return}
  const signature=JSON.stringify(body);
  if(attempt?.signature!==signature)attempt={signature,id:makeId()};
  pending=true;button.disabled=true;form.setAttribute('aria-busy','true');status.textContent='Submitting feedback…';
  try{
   const result=await request('/api/feedback',{method:'POST',body:{...body,requestId:attempt.id}});
   if(!result?.requestId&&!result?.feedback?.id)throw Error('Feedback receipt could not be confirmed. Retry to check its status.');
   submitted=true;button.textContent='Feedback submitted';score.disabled=true;note.disabled=true;for(const input of inputs)input.disabled=true;
   status.textContent='Feedback received for review. Ratings and corrections remain unverified until reviewed.';
  }catch(error){status.textContent=error.message||'Your feedback could not be submitted. Please try again.'}
  finally{pending=false;button.disabled=submitted;form.removeAttribute('aria-busy')}
 };
}

export function renderClinicalResponseExtras(parent,answer={},options={}){
 if(!answer.clinicalInteraction||answer.safety||answer.clarification||answer.kind==='clarification'||!clinicalSections(answer).some(group=>group.blocks.length))return false;
 const container=element('div','','clinical-response-extras');
 renderVisual(container,answer);renderReading(container,answer);
 renderFeedback(container,answer,{request:options.request||accountRequest,makeId:options.makeId||(()=>crypto.randomUUID())});
 parent.append(container);return true;
}
