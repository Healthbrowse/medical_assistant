import {generalQuestionIntent} from './general-question-intent.js';
import {definitionExcerpt,definitionSubject} from './answer-relevance.js';
import {insufficientClinicalContext,withAudienceDisclaimer,outsideMedicalScope,scopeAnswer} from './medical-contract.js';
import {applyDiagnosisResponse} from './diagnosis-response.js';
import {faqQuestions,generalTreatmentNotice} from './faq-spec.js';
import {assessBuddySafety,hasUnsafeBuddyOutput} from './buddy-policy.js';
import {prepareQuery,contextCareQuestion} from './query-input.js';
import {answerQuestion,questionDeck,inspectInput,inspectQuery,normalizeQuestion} from './clinical-engine.js';
import {verifyClaim} from './claim-check.js';
import {correctSpelling} from './medcard.js';
import {domains,orderedPassages} from './disease-framework.js';
import {readingProfile,readingGuidance,roleIndex} from './reading-profiles.js';

export const generalMode=role=>roleIndex(role)===0;
export const deckCount=()=>6;
export function isOverviewQuestion(context,query){
 const normalize=value=>String(value).toLowerCase().replace(/[’']/g,'').replace(/[^a-z0-9]+/g,' ').trim();
 const question=normalize(correctSpelling(query));
 const subject=question.replace(/^(?:what (?:is|are)|tell me about|give me an overview of|summari[sz]e|explain)\s+/,'');
 if(subject===question)return false;
 return [context.topic,...(context.aliases||[]),'it','this disease','this condition'].some(name=>normalize(name)===subject);
}
export const buddyQuestions=faqQuestions.map((label,i)=>({label,prompt:label,deck:i+1}));
export function passageCheck(context,p){
 if(!p||hasUnsafeBuddyOutput(p.text)||assessBuddySafety(p.text).action!=='allow')return null;
 const check=verifyClaim({kind:'passage',topic:context.topic,sourceUrl:p.sourceRecord||p.url,field:'text',value:p.text,record:p.record},{topic:context.topic,passages:context.passages});
 return check.status==='withheld'?null:check;
}
const intentLabels={definition:'What it means',risk:'Causes and risk factors',classification:'Classification',mechanism:'How it develops',identify:'Diagnosis and tests',symptoms:'Symptoms',therapy:'Treatment approaches',course:'Disease course',prognosis:'Outlook',complications:'Complications','public-health':'Prevention and population evidence',genes:'Genetics'};
function localContext(context) {
 const rows=context.passages||[];
 if(generalMode(context.role)||!rows.some(p=>!p.record))return context;
 // Legacy passage snapshots can carry only an upstream identifier or a URL.
 // The source still must pass authority and verbatim-text checks.
 return {...context,passages:rows.map(p=>p.record?p:{...p,record:String(p.id||p.sourceRecord||p.url||'')})};
}
function clinicianReference(passage,check,context) {
 // record is a passage locator from the retrieved snapshot (including MedQuAD
 // XML record/question IDs). The link goes to the independently checked source.
 const locator=passage.record||passage.id;
 const ambiguous=locator&&context.passages.some(p=>(p.record||p.id)===locator&&(p.sourceRecord||p.url)!==(passage.sourceRecord||passage.url));
 return {...check.citation,id:ambiguous||!locator?check.citation.url:locator,quote:passage.text,
  publisher:check.provenance?.publisher,date:passage.vintage,sourceType:passage.sourceType||'Source excerpt'};
}
function compose(context,matches,deck,{detail=false,gaps=[]}={}){
 const profile=readingProfile(context.role),clinical=profile.index===1,seen=new Set();
 const blocks=matches.filter(m=>m?.check&&m.check.status!=='withheld'&&!seen.has(m.check.text)&&seen.add(m.check.text)).map(m=>{
  const citation=clinical?clinicianReference(m.passage,m.check,context):m.check.citation;
  return {title:m.title||intentLabels[m.passage?.intent]||'Source explanation',text:m.check.text,citation,
   ...(clinical?{references:[citation]}:{}),check:m.check,sourceType:m.passage?.sourceType||'historical source'};
 });
 while(blocks.length&&blocks.reduce((n,b)=>n+b.text.length,0)>12000)blocks.pop();
 const guidance=blocks.length?readingGuidance(context.role,deck):null;
 const text=blocks.map((b,i)=>b.title+'\n'+b.text+' ['+(clinical?b.citation.id:i+1)+']').join('\n\n')+(gaps.length?'\n\n'+gaps.join(' '):'')+(guidance?'\n\n'+guidance.title+'\n'+guidance.text:'');
 return {text:text||insufficientClinicalContext,deck,blocks,style:profile.style,guidance,gaps,supported:blocks.length>0,citations:blocks.map((b,i)=>clinical?b.citation:{...b.citation,title:'['+(i+1)+'] '+b.citation.title}),checks:blocks.map(b=>b.check)};
}
// Metadata-only lookups (for example an ICD descriptor or publication date)
// can substantiate catalog fields, but cannot establish a clinical conclusion.
function clinicalMetadata(answer,records) {
 const cite=answer.citations[0],row=records.find(r=>r.url===cite.url&&r.title===cite.title);
 if(!row)return null;
 const labels={title:'Title',system:'Code system',code:'Code',studyDesign:'Study design',date:'Publication date',
  population:'Population',pmid:'PMID',doi:'DOI',authors:'Authors',detail:'Catalog description',license:'License'};
 const id=String(row.id||row.record||row.doi||(row.pmid?'PMID: '+row.pmid:row.url));
 const blocks=[];
 for(const key of answer.sourceFields||[]){
  const value=row[key],label=labels[key];
  const field=String(Array.isArray(value)?value.join(', '):value??'').trim();
  if(!label||!field||hasUnsafeBuddyOutput(field)||assessBuddySafety(field).action!=='allow')continue;
  const ref={...cite,id,quote:field,sourceType:'Catalog metadata'};
  blocks.push({title:label,text:field,citation:ref,references:[ref]});
 }
 if(!blocks.length)return null;
 return {...answer,blocks,text:blocks.map(b=>b.title+' — '+b.text+' ['+id+']').join('\n'),citations:[blocks[0].citation],
  supported:true,gaps:['These fields describe the source record and do not establish a clinical recommendation.']};
}
function requestedParts(query){
 // Split explicit question clauses, not disease names or a linked phrase such
 // as “signs and symptoms”. Each clause must be supported independently.
 return query.split(/\s+(?:and|also)\s+(?=(?:what|how|why|who|can|is|are|does|treatment|treatments|diagnosis|prevention|prognosis)\b)|[?;]+(?=\s*\w)/i).map(s=>s.trim()).filter(Boolean).slice(0,3);
}
function supplemental(context,deck,limit,exclude=new Set(),intent){
 const candidates=orderedPassages(context.passages.filter(p=>p.deck===deck&&!p.overview&&(!intent||p.intent===intent)),context.role,context.topic);
 const matches=[];
 for(const p of candidates){const check=passageCheck(context,p);if(!check||exclude.has(check.text))continue;exclude.add(check.text);matches.push({check,passage:p});if(matches.length>=limit)break}
 return matches;
}
export function searchAnswer(context,query,options={}){
 context=localContext(context);
 let result=sourcedSearchAnswer(context,query,options);
 if(inspectQuery(query)!=='ok')return withAudienceDisclaimer(result,context.role);
 // Excerpts can supply background while a comparison or prescribing question
 // awaits source review. A topic match alone cannot establish its conclusion.
 const needsAppraisal=/\b(?:compar(?:e|ed|ator|ison)|versus|vs\.?|placebo|control arm|trial|relative risk|hazard ratio|efficacy|mortality|contraindicat\w*|interact(?:ion|ions|s)?|dos(?:e|es|age|ing)|off[- ]label)\b/i.test(query);
 if(!generalMode(context.role)&&needsAppraisal&&result.blocks?.length){
  const gap='The available excerpts provide background. A reviewed conclusion for this specific question is unavailable.';
  result={...result,blocks:result.blocks.map(block=>({...block,section:'evidence'})),gaps:[...new Set([...(result.gaps||[]),gap])],supported:false};
 }
 // The diagnosis helper may use an exact testing excerpt from the retrieved
 // topic. Use the same provenance checks as the main local answer.
 const sources=()=>{
  const rows=(context.passages||[]).filter(p=>/blood test/i.test(p.text));
  return rows.flatMap(p=>{const check=passageCheck(context,p);return check?[{...clinicianReference(p,check,context),text:p.text}]:[]});
 };
 return withAudienceDisclaimer(applyDiagnosisResponse(result,{...context,question:query},{fallback:true,sources}),context.role);
}
function sourcedSearchAnswer(context,query,{detail=false,activeDeck=1}={}){
 const question=correctSpelling(query).trim(),profile=readingProfile(context.role);
 const status=inspectQuery(question);
 if(status==='unsafe')return {...prepareQuery(question,context.topic).safety,deck:activeDeck};
 if(status!=='ok')return {text:status==='emergency'?'If these symptoms or immediate danger are happening now, contact local emergency services now. Do not wait for a search response.':'Remove identifying details such as names, contact information, birth dates or record numbers. You can still describe symptoms in your own words.',citations:[],checks:[],blocks:[],supported:false,deck:activeDeck};
 if(outsideMedicalScope(question))return {...scopeAnswer(),deck:activeDeck};
 if(generalMode(context.role)&&/\b(?:should (?:i|we)|do (?:i|we) need to|when (?:should (?:i|we)|to)) (?:call|contact|see|visit|seek|go to|take .+? to)\b.*\b(?:doctor|provider|care|hospital|nurse|pediatrician)\b/i.test(question)){
  const concerns=/\b(?:when to (?:call|see|seek)|(?:call|contact|see|visit) (?:a|the|your|their) (?:doctor|health care provider|healthcare provider)|seek (?:urgent|immediate|medical) (?:help|care))\b/i;
  const passages=(context.passages||[]).filter(p=>concerns.test(p.text));
  const matches=passages.map(p=>({passage:p,check:passageCheck(context,p)})).filter(m=>m.check).slice(0,1);
  const message='I can’t tell from chat whether a visit is needed. A healthcare professional can assess the symptoms.';
  const response=compose(context,matches,5,{gaps:[message]});
  if(!matches.length)response.text=message+' I could not find specific guidance on when to seek care in the available sources for '+context.topic+'.';
  return response;
 }
 const followUp=generalMode(context.role)&&contextCareQuestion(question);
 if(followUp&&context.topic){
  const publicQuery=followUp==='nextSteps'?'How is '+context.topic+' treated?':'What causes '+context.topic+'?';
  return sourcedSearchAnswer(context,publicQuery,{detail,activeDeck});
 }
 if(inspectInput(question)==='private'){
  if(/\b(?:dos(?:e|es|age|ing)|prescrib\w*|(?:should|can|may) i (?:take|start|stop|change|increase|reduce)|how much should|which (?:medicine|medication|drug))\b/i.test(question))return {text:'I cannot choose a medicine, dose or treatment change for you. A clinician or pharmacist needs to check your circumstances. You can explore the cited general treatment information in Deck 5.',citations:[],checks:[],blocks:[],supported:false,deck:5};
  // Keep the original question intact for the model; the local fallback can
  // only explain public evidence, never evaluate the person's clinical details.
  const clause=question.match(/(?:^|[.!?,]\s*|\band\s+)((?:what|how|why|when|which|can|does|is|are)\b[^]*?)$/i)?.[1]?.trim();
  const publicClause=clause?.replace(/\b(?:it|this condition|this disease)\b/gi,context.topic);
  const intent=generalMode(context.role)?generalQuestionIntent(question):{};
  const cause='What causes '+context.topic+'?',management='How is '+context.topic+' treated?';
  const referenceQuestion=publicClause&&inspectInput(publicClause)==='ok'&&questionDeck(publicClause)?publicClause:
   intent.possibleCauses&&!intent.nextSteps?cause:intent.nextSteps&&!intent.possibleCauses?management:cause+' '+management;
  const response=searchAnswer(context,referenceQuestion,{detail,activeDeck});
  const scope=intent.caregiver?'These sources explain '+context.topic+' in general. They do not determine the cause of your family member’s symptoms.':generalMode(context.role)?'These sources explain '+context.topic+' in general. They do not determine the cause of your symptoms or assess your duration, medicines, age or other individual circumstances.':'Clinical reference for '+context.topic+'. Interpret the evidence alongside the history, examination, investigations and local protocols. These excerpts do not establish a patient-specific diagnosis.';
  return {...response,text:scope+'\n\n'+response.text,gaps:[...(response.gaps||[]),scope],educationalOnly:true};
 }
 if(/^(?:more|tell me more|more details|go on|continue|explain more)[?!. ]*$/i.test(question))return domainAnswer(context,Math.min(6,activeDeck),{detail:true});
 if(/^(?:hi|hello|hey|help|what can you do)[?!. ]*$/i.test(question))return {text:'Ask a question about '+context.topic+' and I’ll look for sources that address it.',deck:activeDeck,citations:[],checks:[],blocks:[],supported:false};
 const normalized=normalizeQuestion(question,context.topic,context.aliases||[]);
 const bare=[context.topic,...(context.aliases||[])].some(name=>normalized===normalizeQuestion(name));
 // Split before normalization removes question marks and sentence boundaries.
 const parts=requestedParts(bare?'What is '+context.topic+'?':question).map(part=>normalizeQuestion(part,context.topic,context.aliases||[])),matches=[],gaps=[];
 let primaryDeck=questionDeck(normalized)||activeDeck,primaryIntent=null;
 for(const part of parts){
  const answer=answerQuestion({...context,question:part,visibleTexts:[],history:[],deck:undefined,limit:detail?profile.detail:profile.summary});
  if(answer.matches?.length){if(!primaryIntent){primaryDeck=answer.deck;primaryIntent=answer.intent}matches.push(...(answer.intent==='definition'?answer.matches.slice(0,1):answer.matches).map((m,i)=>({...m,title:parts.length>1?part:(i===0?'Direct answer':intentLabels[answer.intent]||'Further detail')})))}
  else if(answer.citations.length && generalMode(context.role)){return {...answer,blocks:[],style:profile.style,supported:true}}
  else if(answer.citations.length){const metadata=clinicalMetadata(answer,context.records||[]);if(metadata)return {...metadata,style:profile.style};gaps.push('The requested metadata could not be linked to a source record.')}
  else gaps.push('No matching source passage was found for “'+part+'”. I won’t infer an answer from a different section.');
 }
 // Definitions stay focused on the requested concept; tests and treatment belong in their decks.
 const response=compose(context,matches,primaryDeck,{detail,gaps});
 if(primaryIntent==='definition'&&definitionSubject(question,context.topic)){
  response.blocks=response.blocks.map(block=>({...block,text:definitionExcerpt({text:block.text},question,context.topic)||block.text}));
  response.text=response.blocks.map((block,i)=>block.text+' ['+(block.citation.id||i+1)+']').join('\n\n');
  if(response.blocks.length)response.modelNotice='Source excerpt · an AI explanation may add detail when available.';
 }
 if(!response.supported)response.text=[insufficientClinicalContext,...gaps].join(' ');
 return response;
}
export function domainAnswer(context,number,{detail=true}={}){
 context=localContext(context);
 const domain=domains[number-1];if(!domain||number>6)return null;
 const profile=readingProfile(context.role),matches=supplemental(context,number,detail?profile.detail:profile.card);
 const gaps=matches.length?[]:[insufficientClinicalContext+' '+domain.empty];
 if(number===6)gaps.push('These excerpts do not establish a complete untreated timeline. Check treatment exposure and follow-up in the source.');
 const result=compose(context,matches,number,{detail,gaps});
 if(number===5&&generalMode(context.role)){result.treatmentNotice=generalTreatmentNotice;result.text+='\n\n'+generalTreatmentNotice;}
 return result;
}
// Bound requests even when a source never returns headers. Caller cancellation
// still wins, so an old search cannot replace the next search's result.
export async function fetchJSON(url,{signal,timeout=8000}={}){
 const local=new AbortController(),abort=()=>local.abort();
 if(signal?.aborted)abort();else signal?.addEventListener('abort',abort,{once:true});
 const timer=setTimeout(abort,timeout);
 try{const response=await fetch(url,{signal:local.signal});if(!response.ok)throw Error('Source unavailable');return await response.json()}
 finally{clearTimeout(timer);signal?.removeEventListener('abort',abort)}
}
