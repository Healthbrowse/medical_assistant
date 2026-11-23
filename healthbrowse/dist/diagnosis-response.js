import {personalDiagnosisNotice} from './safety-policy.js';
import {normalizeReadingRole} from './reading-profiles.js';

// Curated, attributed summaries of CDC guidance, checked 17 November 2026.
// These are application guidance, not model output or clinical validation.
const cdc={id:'CDC-DENGUE',title:'Symptoms of Dengue and Testing · CDC',url:'https://www.cdc.gov/dengue/signs-symptoms/',date:'Updated 2026-10-19; checked 2026-11-17',sourceType:'CDC public health guidance'};
const testing={id:'CDC-TESTING',title:'Clinical Testing Guidance for Dengue · CDC',url:'https://www.cdc.gov/dengue/hcp/diagnosis-testing/',date:'Updated 2025-08-26; checked 2026-11-17',sourceType:'CDC clinical guidance'};
export const diagnosisGenerationRules=`For a personal confirmation question such as "Do I have dengue?", do not imply a diagnosis from symptom overlap. The interface will lead with a diagnostic limitation and ask focused follow-up questions. Give only 1–2 short explanatory paragraphs. Avoid repeating the limitation or adding a speculative differential. Do not assume missing temperature units, symptom duration, test results, travel or other personal details. Explain general evidence without calling the user's symptoms typical, a match, or diagnostic. A blood count or platelet count alone does not confirm dengue. Clinical care must not be delayed while waiting for dengue tests. Include medical facts only when the supplied evidence supports them.`;

export function hasUnstatedTemperatureUnit(question,text){
 if(!/\b(?:fever|temperature|temp)\b/i.test(question))return false;
 const readings=[...String(question).matchAll(/\b(?:fever|temperature|temp)\s*(?:of|is|at|:)?\s*(\d{2,3}(?:\.\d+)?)(?![\d.])/gi)].map(m=>m[1]);
 return readings.some(n=>!new RegExp('\\b'+n.replace('.','\\.')+'\\s*(?:°\\s*)?(?:[fc]\\b|degrees?\\s*(?:fahrenheit|celsius|[fc]\\b))','i').test(question)
  &&new RegExp('\\b'+n.replace('.','\\.')+'\\s*(?:°\\s*)?(?:[fc]\\b|degrees?\\s*(?:fahrenheit|celsius|[fc]\\b))','i').test(text));
}

function clinicianDiagnosis(answer,sources,dengue,missingUnit) {
 let diagnosisNotice="I can't confirm a diagnosis from symptoms alone in this chat.";
 const references=[];
 if(dengue){
  const candidates=typeof sources==='function'?sources():sources||[];
  for(const source of candidates){
   if(!source.id||!source.url||!source.title)continue;
   const sentence=(source.text||'').split(/(?<=[.!?])\s+/).find(line=>line.length<=350&&/^(?:There is a blood test|A blood test|Blood tests)\b/i.test(line)&&/\bdengue\b/i.test(line));
   if(!sentence)continue;
   diagnosisNotice+=' '+sentence;
   references.push({...source,quote:sentence});
   break;
  }
 }
 const questions=['When did the symptoms start, and how have they changed?'+(missingUnit?' Was the reported temperature in °F or °C?':''),
  'What other symptoms or examination findings are present?', 'What assessments or test results are available?'];
 const supporting=(answer.blocks||[]).filter(b=>!['diagnosis-lead','care-advice','follow-up'].includes(b.kind));
 const blocks=[{kind:'diagnosis-lead',section:'synthesis',text:diagnosisNotice,references},...supporting,
  {kind:'follow-up',text:questions.join('\n'),references:[]}];
 const citations=[...new Map([...references,...(answer.citations||[])].map(r=>[r.id||r.url,r])).values()];
 const text=blocks.map(b=>[b.text,...(b.references||(b.citation?[b.citation]:[])).filter(r=>r.id).map(r=>'['+r.id+']')].join(' ')).join('\n\n');
 return {...answer,blocks,text,citations,diagnosisNotice,diagnosisReferences:references,followUpQuestions:questions};
}

export function applyDiagnosisResponse(answer,input,{fallback=false,sources}={}){
 const notice=personalDiagnosisNotice(input.question,input.topic);
 if(!notice||answer.safety)return answer;
 const dengue=/\bdengue\b/i.test(input.topic||'')&&/\bdengue\b/i.test(input.question);
 const clinical=normalizeReadingRole(input.role)==='Medical professional';
 const diagnosisNotice=dengue?"I can't confirm whether you have dengue from symptoms alone. A clinician needs to assess you and choose appropriate dengue blood tests.":notice;
 const missingUnit=/\b(?:fever|temperature|temp)\s*(?:of|is|at|:)?\s*\d{2,3}(?:\.\d+)?\b/i.test(input.question)&&!/(?:°\s*[fc]\b|\b\d+(?:\.\d+)?\s*[fc]\b|fahrenheit|celsius)/i.test(input.question);
 if(clinical)return clinicianDiagnosis(answer,sources,dengue,missingUnit);
 const followUpQuestions=dengue?[
  'How long have you had the fever?'+(missingUnit?' Is the temperature you mentioned in °F or °C?':''),
  'Do you also have a headache, pain behind your eyes, a rash, nausea or vomiting?',
  'Have you recently been in an area where dengue is occurring, and have you had any medical assessment or tests?'
 ]:['When did the symptoms start, and are they changing?','What other symptoms have you noticed?','Have you already had a medical assessment or any relevant tests?'];
 const careAdvice=dengue?{text:'Seek urgent medical care if you have severe belly pain, repeated vomiting, bleeding, or feel extremely tired or restless—even if the fever has gone down. Do not wait for test results or a chat reply.',references:[cdc,testing]}:undefined;
 // Carry guidance in ordinary answer blocks as well as named fields. Clients
 // that were already open before this release must still show the lead first.
 let blocks=(answer.blocks||[]).filter(b=>!['diagnosis-lead','care-advice','follow-up'].includes(b.kind));
 const needsExplanation=!blocks.some(b=>/\bdengue\b/i.test(b.text)&&/\b(?:spread|mosquito|viral|fever|arthralgia|myalgia)\b/i.test(b.text));
 if(dengue&&(fallback||needsExplanation)){
  const explanation={text:'Dengue is spread through mosquito bites. It can cause fever, aching muscles or joints, headache, nausea, vomiting or a rash. Other illnesses can cause similar symptoms, so symptoms alone cannot tell us the cause.',references:[cdc],citation:cdc,verification:'Curated summary of CDC guidance; not an individual diagnosis.'};
  blocks=fallback?[explanation]:[explanation,...blocks];
 }
 const body=blocks.length?blocks.map(b=>b.text+' '+(b.references||(b.citation?[b.citation]:[])).map(r=>'['+(r.id||r.title)+']').join(' ')).join('\n\n'):answer.text||'';
 const references=dengue?[cdc,testing]:[];
 const responseBlocks=[{kind:'diagnosis-lead',text:diagnosisNotice,references},...blocks,
  ...(careAdvice?[{kind:'care-advice',text:careAdvice.text,references:careAdvice.references}]:[]),
  {kind:'follow-up',title:'A few questions to understand your situation',text:followUpQuestions.map((q,i)=>(i+1)+'. '+q).join('\n'),references:[]}];
 return {...answer,blocks:responseBlocks,diagnosisNotice,diagnosisReferences:references,followUpQuestions,careAdvice,
  ...(dengue&&fallback?{supported:true,gaps:[],modelNotice:'CDC guidance · general information; not a diagnosis.'}:{}),
  citations:[...new Map([...(dengue&&fallback?[]:answer.citations||[]),...references].map(r=>[r.url,r])).values()],
  text:[diagnosisNotice,body,careAdvice?.text,'A few questions to understand your situation:',...followUpQuestions].filter(Boolean).join('\n\n')};
}
