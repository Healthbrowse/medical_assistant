import {healthQuestions,buddyHealthTask} from './health-questions.js';
import {heartIntent,heartParagraphs} from './heart-visual.js';
import {enrichResult} from './result-enrichment.js';
import {classifyResponseMode,screenGeneralQuery} from './response-mode.js';
import {educationalSubject,clarifyQuery,renderClarification,retrievalTerms,studyFollowUp} from './query-understanding.js';
import {setupAttachments,clearAttachments} from './attachments.js';
import {researchResources} from './research-resources.js';
import {publicConfig} from './account-client.js';
import {setupMobileWorkspace} from './mobile-workspace.js';
import {notifySafety} from './safety-notification.js';
import {personalDiagnosisNotice} from './safety-policy.js';
import {answerReferences,answerMarkdown} from './answer-export.js';
import {createQuerySuggestions,attachQueryCompletion} from './query-completion.js';
import {readingProfile,readingRoles,normalizeReadingRole} from './reading-profiles.js';
import {searchUI} from './search-startup.js';
import {requestSynthesis,synthesisKey} from './model-client.js';
import {renderAnswer,renderClinicalSynthesis} from './answer-view.js';
import {generalMode,searchAnswer,fetchJSON} from './search-experience.js';
import {buddyLearningQuestions} from './learning-questions.js';
import {setupBuddy} from './buddy.js';
import {frameworkVersion,professionalRole,medlinePassages,orderedPassages,sectionLinks} from './disease-framework.js';
import {createChatHistory} from './chat-history.js';
import {saveControls,recordTopic} from './personal.js';
import {questionDeck} from './clinical-engine.js';
import {prepareQuery,publicQuestionTopic,missingSymptomTopic,canSaveResearchQuestion} from './query-input.js';
import {setupCopilot,readSession,guardMessage} from './workspace.js';
import {resolveSearch,findFigures,topicIndex} from './discovery.js';
import {newSubjects,inScopeChoices} from './topic-scope.js';
import {createResearchDesk,renderCheck} from './research-session.js';
import {authorities} from './authorities.js';
import {sectionNames,remapPassages,sectionSources,correctSpelling,codeQuery} from './medcard.js';
import {medlineIndex} from './medline.js';
import {renderCare} from './care.js';
import {searchEvidence} from './evidence.js';
const $=id=>document.getElementById(id);
function el(tag,txt,cls){let e=document.createElement(tag);if(txt!==undefined)e.textContent=txt;if(cls)e.className=cls;return e}
function button(text,fn,cls='act'){let b=el('button',text,cls);b.onclick=fn;return b}
const roles=readingRoles;
let taxonomy, depts, assignments;
let catalog,topic='Leukemia',role=0,live=null,controller=null;
const provenance='Document B · inventory dated 31 Oct 2026 · independent clinical review pending';
function linkRecord(r){const box=el('div',undefined,'item'),a=el('a',r.title+' ↗');let u=new URL(r.url);if(!['http:','https:'].includes(u.protocol))return box;a.href=u.href;a.target='_blank';a.rel='noopener noreferrer';box.append(el('div',(r.publisher||'Europe PMC')+' · '+(r.kind||'Publication'),'meta'),a);if(r.detail)box.append(el('p',r.detail));return box}
const filtered=(...k)=>(Object.hasOwn(catalog,topic)?catalog[topic]:[]).filter(r=>k.includes(r.kind));
function panel(parent,text){parent.append(el('div',text,'panel'))}
let passages={},allowedTopics=new Map(),activeQuery='',lookupIndex,queryNotice='';
let medlineLookup=medlineIndex({topics:[]}),codes=null,carePanel=null,careTopic=null,unresolved=false;
let feed={topics:[]};
function medicalRecord(name){return medlineLookup.find(name)}
function textRecords(name=topic,record){
  if(!name||(name===topic&&unresolved))return [];
  record??=medicalRecord(name);
  return orderedPassages([...medlinePassages(record,name,feed),...(Object.hasOwn(passages,name)?passages[name]:[])],role,name);
}
let activeResearchReady=false;
let responseMode='medical',generalResult=null,displayedEvidence=null;
let synthesis=null,synthesisController=null,aiRequested=false;
function refreshSynthesis(context){
 const key=synthesisKey(context);if(!context||!aiRequested||synthesis?.key===key)return;
 synthesisController?.abort();const controller=new AbortController();synthesisController=controller;synthesis={key,status:'loading'};
 const pending=requestSynthesis(context,context.query||context.topic,{signal:controller.signal});
 void pending.then(result=>{
  if(controller!==synthesisController||key!==synthesisKey(currentContext()))return;
  synthesis={key,...result};$('notice').textContent=result.status==='generated'?'Your answer is ready.':result.status==='sourced'?'Retrieved sources are ready. The AI explanation could not finish.':result.message||'Choose an option to continue.';if(result.status==='blocked')notifySafety({status:'blocked',safety:result.answer?.safety});render();
 }).catch(()=>{});
}
function currentContext(){
  const selection={topic:topic||'',role:roles[role],query:activeQuery,responseMode,frameworkVersion,
    passages:[],records:[],sections:[],visibleTexts:[],answerSummary:'',browserSources:[],directAnswer:null,deckSummaries:[]};
  if(unresolved)return {...selection,topic:'',query:''};
  if(responseMode==='general')return {...selection,...displayedEvidence};
  if(!topic||!catalog)return {...selection,topic:'',query:''};
  const resources=catalog[topic]||[];
  const currentAnswer=['generated','sourced'].includes(synthesis?.status)&&synthesis.key===synthesisKey({topic,role:roles[role],query:activeQuery});
  const learningMode=currentAnswer&&!!synthesis.learningMode;
  return {...selection,aliases:[...(medicalRecord(topic)?.aliases||[]),...(taxonomy?.entities.find(e=>e.name===topic)?.aliases||[])],
    learningMode,deckQuestions:learningMode?buddyLearningQuestions(roles[role]):null,
    ...displayedEvidence,
    passages:textRecords(),records:[...resources,...(live?.records||[]),...(codes?.rows||[]).map(r=>({...r,kind:'terminology',title:r.label}))],
    sections:sectionNames.map((_,i)=>sectionSources(i+1,resources,activeQuery,role).map(x=>x.r)),
    visibleTexts:[...$('card').querySelectorAll('.excerpt')].filter(e=>e.getClientRects().length).map(e=>e.textContent)};
}
function scopeChoice(input){
  return lookupIndex?newSubjects(input,lookupIndex,topic,medlineLookup):[];
}
function switchPrompt(container,input,target,continueSearch){
  container.replaceChildren();const prompt=el('div',undefined,'scope-prompt');prompt.setAttribute('role','status');
  prompt.append(el('p','You’re researching '+topic+'. Switch the workspace to '+target+'?'));
  prompt.append(button('Switch topic',()=>{container.replaceChildren();continueSearch()}),button('Stay on '+topic,()=>{container.replaceChildren();$('notice').textContent='Continuing with '+topic+'.'}));container.append(prompt);prompt.scrollIntoView({block:'nearest'});
}
const buddy=setupBuddy(currentContext);
const mobile=setupMobileWorkspace({buddy,verify:openVerification,buddyModels:publicConfig?.buddyModels});
setupAttachments();
const resourceGuide=el('details',undefined,'source-directory research-resource-guide');resourceGuide.append(el('summary','Research sources & dataset guide'),el('p','Live evidence, research datasets and model candidates have different purposes. Reviewed 17 November 2026.'));
for(const r of researchResources){const row=el('section');row.append(el('strong',r.status));reference(row,r.name,r.url);row.append(el('p',r.use));resourceGuide.append(row)}
$('clinicalNotice').after(resourceGuide);
document.addEventListener('healthbrowse-session-cleared',()=>{
 synthesisController?.abort();synthesisController=null;synthesis=null;aiRequested=false;
});
window.addEventListener('pageshow',event=>{if(event.persisted&&catalog)render()});
const chats=createChatHistory(currentContext);
const copilot=setupCopilot(currentContext,{
  classify:(q,c)=>classifyResponseMode(q,{index:lookupIndex,topic:c.topic,previousMode:c.responseMode}),
  passagesForTopic:name=>{
    const exact=allowedTopics.get(name.toLowerCase());
    if(exact)return textRecords(exact);
    const record=medlineLookup.findExact(name);
    return record?textRecords(name,record):[];
  },
  personalTopic:(q,current)=>publicQuestionTopic(correctSpelling(q),lookupIndex,current),
  onChat:(c,section)=>recordTopic(c.topic,'chat',section),onTurn:turn=>chats.saveTurn(turn),scopeChoice,confirm:(q,name)=>switchPrompt($('scopeQuestion'),q,name,()=>search(q,name,true)),
  research:q=>{if(!/\b(papers?|publications?|studies|trials?|grants?|funding|institutions?|literature|systematic reviews?)\b/i.test(q))return null;research.sync();return research.answer(q)},expand:n=>openDomain(n),
  show:()=>{$('researchBrief').scrollIntoView({block:'start'})}
});
const research=createResearchDesk(currentContext,(n,focus)=>copilot.activate(n,focus));
chats.setHandlers({newChat:()=>copilot.clear(),restore:async data=>{
  clearAttachments();
  displayedEvidence=null;generalResult=null;responseMode='medical';queryNotice='';
  role=Math.max(0,roles.indexOf(normalizeReadingRole(data.chat.readingMode)));
  if(Object.hasOwn(catalog,data.chat.topic)||allowedTopics.has(data.chat.topic.toLowerCase())){
    topic=data.chat.topic;activeQuery=topic;unresolved=false;live=null;codes=null;$('query').value=topic;render();
  }else await search(data.chat.topic,null,true);
  copilot.restore(data.turns);
}});
document.addEventListener('research-ready',()=>{activeResearchReady=true});
$('buddyResearch').addEventListener('toggle',()=>{if($('buddyResearch').open&&responseMode==='medical'&&currentContext().topic)research.sync()});
function openVerification(from){
  if(buddy.show(from)){copilot.sync();copilot.verify();}
}
function verificationCallout(){
  const section=el('section',undefined,'verification-callout');
  const heading=el('h3','More Detailed Analysis — Check the Information with Buddy');
  const open=button('Check with Buddy',()=>openVerification(open),'act verification-button');
  section.append(heading,el('p','Inspect the cited passages, review a study’s methods, or attach SOX decks and audit trails in Buddy.'),open);
  return section;
}
function answerHandoff(direct,sources){
  return {directAnswer:direct,answerSummary:direct?.text||direct?.blocks?.map(block=>block.text).join('\n')||'',browserSources:sources};
}
function responseBadge(mode){
  return el('span',mode==='medical'?'Medical Response':'General Response','response-mode-badge');
}
function renderGeneral(){
  const card=$('card');card.hidden=false;card.setAttribute('aria-label','General response');
  card.replaceChildren(responseBadge('general'),el('h2',generalResult?.topic||activeQuery));
  $('results').hidden=true;$('clinicalNotice').hidden=true;$('buddyResearch').hidden=true;
  const data=generalResult;
  const sources=data?.articles||[];
  const direct=data?{text:data.answer,blocks:(data.blocks||[]).map(block=>({text:block.text,references:sources.filter(ref=>block.sourceIds?.includes(ref.id))})),citations:sources}:null;
  const body=el('section',undefined,'overview-note search-answer');
  if(direct)renderAnswer(body,direct);else body.append(el('p','Looking up supporting sources…','meta'));
  card.append(body);
  displayedEvidence=direct?answerHandoff(direct,answerReferences(direct)):null;
  if(data?.status==='answered'){
    enrichResult(body,{readingParent:card,mode:'general',topic,query:activeQuery,answer:direct,articles:sources,visual:data.visual,illustrationPageId:data.illustrationPageId,allowLookup:canSaveResearchQuestion(activeQuery),signal:imageView?.signal});
    card.append(verificationCallout());
  }
  if(data?.status==='unavailable')card.append(button('Retry search',()=>search(activeQuery)));
  mobile.update({responseMode,topic,role:roles[role],responses:direct?[direct]:[]});
  research.reset();buddy.sync(true,Boolean(direct));copilot.sync();
}
function openDomain(n){buddy.show(document.activeElement);copilot.activate(n);copilot.askDomain(n)}
function reference(parent,title,url){
  if(!url||!/^https?:\/\//.test(url))return;
  const a=el('a',title+' ↗');a.href=url;a.target='_blank';a.rel='noopener noreferrer';parent.append(a);
}
function renderCodes(body){
  const items=codes?.rows||[];
  const box=el('details',undefined,'resource-list');
  const topicData=medicalRecord(topic);
  if(topicData?.mesh?.length){const mesh=el('p','MedlinePlus indexing terms: ');for(const m of topicData.mesh){reference(mesh,m.label+' ('+m.id+') ','https://id.nlm.nih.gov/mesh/'+m.id)}box.append(mesh)}
  box.append(el('summary','Clinical terminology'+(items.length?' · '+items.length+' candidates':'')));
  box.append(el('p',codes?.message||'Codes are listed with the source classification and exact label. Subtype candidates require confirmation.','meta'));
  for(const item of items){const row=el('p');reference(row,item.system+' '+item.code+' · '+item.label,item.url);box.append(row)}
  if(Object.values(codes?.sourceStatus||{}).includes('unavailable'))box.append(el('p','An ICD source was unavailable for this lookup.','meta'));
  box.append(el('p',codes?.snomedStatus||'SNOMED CT lookup requires licensed terminology access.','meta'));body.append(box);
}
function render(){
  mobile.setModelRole(roles[role]);
  for(const input of $('readingMode').querySelectorAll('input'))input.checked=input.value===roles[role];
  $('deskTitle').textContent='HealthBrowse research desk';$('deskIntro').textContent='Search medical topics, research, and enterprise documentation.';
  $('roleHint').textContent=readingProfile(role).guide;
  if(responseMode==='general'){renderGeneral();return;}
  $('clinicalNotice').hidden=false;$('buddyResearch').hidden=false;
  if(synthesis?.status==='clarification'){renderClarification($('card'),synthesis.clarification,q=>search(q,null,true),draft=>{if(draft!==undefined)$('query').value=draft;$('query').focus()});$('notice').textContent='Choose a meaning or add the missing subject.';return;}
  if(synthesis?.status==='blocked'){const message=el('div',undefined,'overview-note search-answer');message.setAttribute('role','alert');message.append(el('h2',synthesis.answer.title||'A safer way to proceed'));renderAnswer(message,synthesis.answer,renderCheck);$('card').replaceChildren(message);mobile.update({topic:'',role:roles[role],responses:[]});buddy.sync(true,false);return;}
  const general=generalMode(role),card=$('card');
  document.body.classList.add('buddy-enabled');$('copilot-heading').textContent='Buddy';
  card.setAttribute('aria-label',general?'Medical answer':'Clinical report');
  const sameResult=card.dataset.query===activeQuery&&card.dataset.role===roles[role];
  const openResources=sameResult&&!!card.querySelector('.resource-shelf')?.open;
  card.replaceChildren();card.dataset.query=activeQuery;card.dataset.role=roles[role];
  let direct=null;
  const header=el('div',undefined,'cardhead');header.append(responseBadge('medical'),el('h2',unresolved?'Topic not resolved':topic),el('p','View: '+(professionalRole(role)?'Clinical Professional':'General Public'),'deck-subtitle'));
  if(!unresolved && assignments[topic])header.append(el('span',assignments[topic].map(i=>depts[i]).join(' · '),'badge'));
  if(unresolved){
    const feedback=el('div',undefined,'overview-note search-answer');
    feedback.append(el('h3','Let’s clarify your question'),el('p',activeQuery||$('query').value,'answer-question'),el('p','I could not find a supporting passage for this question in the available medical sources. Try adding the organ, medicine, condition or process you mean. No answer has been generated.'));
    const diagnosis=personalDiagnosisNotice(activeQuery,topic);if(diagnosis)feedback.append(el('p',diagnosis,'query-interpretation'));header.append(feedback);
  }
  if(!unresolved){
    const sources=textRecords(),context={...currentContext(),topic,role:roles[role],aliases:[...(medicalRecord(topic)?.aliases||[]),...(taxonomy.entities.find(e=>e.name===topic)?.aliases||[])],passages:sources,records:currentContext()?.records||[]};
    const overview=el('div',undefined,'overview-note search-answer');
    if(general)overview.append(el('h3','Browser Summary'));
    overview.append(el('p',activeQuery||topic,'answer-question'));
    refreshSynthesis(context);
    direct=synthesis?.key===synthesisKey(context)&&['generated','sourced'].includes(synthesis.status)?synthesis.answer:searchAnswer(context,activeQuery||topic);
    if(synthesis?.status==='loading'&&!direct.supported&&!direct.diagnosisNotice)direct={text:'Looking up supporting medical sources for your question…',blocks:[],citations:[],checks:[],supported:false};
    direct.modelNotice=synthesis?.key===synthesisKey(context)?(synthesis.status==='loading'?'Preparing your answer from the cited sources…':synthesis.message||direct.modelNotice||''):'';
    const state=synthesis?.key===synthesisKey(context)?synthesis:null;
    const clinicalReport=!general && !direct.safety && direct.kind!=='platform' && !(state?.status==='loading'&&!direct.blocks?.length);
    if(clinicalReport)direct={...direct,clinicalSynthesis:true};
    const renderDirect=clinicalReport?renderClinicalSynthesis:renderAnswer;
    renderDirect(overview,{...direct,code:state?.code,retryAt:state?.retryAt},renderCheck,()=>{if(synthesis?.key!==synthesisKey(context))return;synthesis=null;render()});
    if(queryNotice)overview.append(el('small',role===1?'Clinical reference; interpret evidence against the patient context and local protocols.'+(queryNotice.includes('not saved')?' This personal question is not saved to chat history.':''):queryNotice,'query-interpretation'));
    overview.classList.add('primary-medical-response');
    header.append(overview,saveControls(topic));
    const guide=el('details',undefined,'source-directory');guide.append(el('summary','Source guide · 10 medical and public-health organizations'),el('p','These organizations have different responsibilities. A publisher citation does not mean it reviewed or certified this HealthBrowse response.'));
    for(const a of authorities){const item=el('p');reference(item,a.name,a.url);item.append(document.createTextNode(' · '+a.scope));guide.append(item)}header.append(guide)
  }
  card.append(header);
  $('clinicalNotice').textContent=professionalRole(role)?'Professional research reference. Check current guidelines, patient context and local protocols before clinical use. This tool is not clinically validated.':'HealthBrowse provides general education, not a diagnosis or an individual treatment plan. Discuss care with a licensed healthcare professional.';
  if(direct){
    const refs=answerReferences(direct);
    const citations=el('section',undefined,'answer-citations');citations.setAttribute('aria-label','Authorized citations');
    citations.append(el('h3','Authorized Citations'));
    if(refs.length){
      const list=el('ol');
      for(const ref of refs){const row=el('li');reference(row,ref.title||'Supporting source',ref.url);if(ref.date)row.append(el('small',ref.date,'meta'));list.append(row)}
      citations.append(list);
    }else citations.append(el('p','No supporting citations are available for this response.'));
    const copyStatus=el('span',undefined,'meta');copyStatus.setAttribute('role','status');
    citations.append(button('Copy answer',async()=>{try{
      await navigator.clipboard.writeText(answerMarkdown({topic,role:roles[role],answer:direct}));copyStatus.textContent='Answer copied.';
    }catch{copyStatus.textContent='Clipboard unavailable. Select the answer text to copy it.'}}),copyStatus);
    card.append(citations);
    displayedEvidence=answerHandoff(direct,refs);
    if(!direct.safety && direct.kind!=='platform' && (direct.supported||direct.blocks?.length||direct.generation)){
      enrichResult(header.querySelector('.primary-medical-response'),{readingParent:card,mode:'medical',topic,query:activeQuery,role:roles[role],answer:direct,
        articles:[...(live?.records||[]),...refs,...Object.values(medicalRecord(topic)?.links||{}).flat()],visual:synthesis?.key===synthesisKey(currentContext())?synthesis.visual:null,allowLookup:canSaveResearchQuestion(activeQuery),signal:imageView?.signal});
      card.append(verificationCallout());
    }
    card.append(researchResourcesPanel(openResources));
  }else if(codes)renderCodes(card);
  mobile.update({responseMode,topic,role:roles[role],responses:direct?[direct]:[]});
  buddy.sync(true,!unresolved);copilot.sync();if(!unresolved&&$('buddyResearch').open)research.sync();else if(unresolved)research.reset();
}
function researchResourcesPanel(open){
  const resources=catalog[topic]||[];
  const shelf=el('details',undefined,'resource-shelf');shelf.open=open;
  shelf.append(el('summary','Research papers, datasets & care resources'));
  const content=el('div',undefined,'research-resource');
  if(codes||medicalRecord(topic)?.mesh?.length)renderCodes(content);
  content.append(el('p',live?.message||'Search the index for publications about this topic.','meta'),button('Refresh publication index',runLive));
  if(live?.records?.length){
    const papers=el('details');papers.append(el('summary','Indexed publications ('+live.records.length+')'));
    live.records.forEach(r=>papers.append(linkRecord(r)));content.append(papers,button('Export search record',download));
  }
  const directory=el('details',undefined,'resource-list');directory.append(el('summary','Further research sources'));
  for(const r of sectionLinks(medicalRecord(topic),7)){const row=el('p');reference(row,r.title+' · '+r.publisher,r.url);directory.append(row)}
  const ranked=sectionSources(7,resources,activeQuery,role);
  for(const item of ranked){const row=linkRecord(item.r);row.append(el('small',item.why,'meta'));directory.append(row)}
  if(!ranked.length)for(const [title,url] of [['NCBI GEO datasets','https://www.ncbi.nlm.nih.gov/gds/?term='],['Hugging Face datasets','https://huggingface.co/datasets?search='],['GitHub research repositories','https://github.com/search?type=repositories&q=']]){
    const row=el('p');reference(row,title,url+encodeURIComponent(topic));directory.append(row);
  }
  content.append(directory);
  if(careTopic!==topic||!carePanel){careTopic=topic;carePanel=el('div');renderCare(carePanel,topic,resources.filter(r=>r.kind==='facility'))}
  content.append(carePanel);shelf.append(content);return shelf;
}
let searchRequest, imageView;
function resultGroup(label){
  const group=el('details'),summary=el('summary',label),body=el('div');
  group.open=false;group.append(summary,body);$('resultsBody').append(group);
  return body;
}
function extractCondition(input){
  const value=input.trim().replace(/^what (?:is|are) (?:the )?/i,'').replace(/[?!.]+$/,'').trim();
  return /^[A-Za-z][A-Za-z -]{2,65}$/.test(value)&&value.split(/\s+/).length<=6?value:null;
}
async function terminology(term,signal){
  try{return await fetchJSON('/api/terminology?term='+encodeURIComponent(term),{signal,timeout:7000})}
  catch{return {rows:[],message:'Terminology lookup unavailable. Try a disease name or choose one of the listed topics.'}}
}
let searchSequence=0;
async function search(input,chosenTopic,confirmed=false){
  const query=String(input||'').trim();if(!query)return;
  const buddyTask=buddyHealthTask(query);
  if(buddyTask && screenGeneralQuery(query).status==='ok'){
    const opener=document.activeElement;
    if(buddy.show(opener))copilot.showHealthGuide(buddyTask,query);
    return;
  }
  if(synthesis?.key===synthesisKey(currentContext())&&prepareQuery(query).query===activeQuery&&(synthesis.status==='loading'||synthesis.retryAt>Date.now()))return;
  const sequence=++searchSequence;
  $('searchSubmit').textContent='Searching…';$('find').setAttribute('aria-busy','true');$('notice').textContent='Looking for a sourced answer…';
  try{await performSearch(query,chosenTopic,confirmed)}catch{if(sequence===searchSequence){$('notice').textContent='This search could not finish. Your question is still in the search box. Please try again.';}}
  finally{if(sequence===searchSequence){$('searchSubmit').textContent='Search ↗';$('find').setAttribute('aria-busy','false')}}
}
async function performSearch(input,chosenTopic,confirmed=false){
  // A publication lookup can time out while the same browser answer stays on screen.
  // Keep image freshness tied to replacing the question rather than that service's deadline.
  imageView?.abort();imageView=new AbortController();
  synthesisController?.abort();synthesisController=null;synthesis=null;aiRequested=false;
  queryNotice='';
  $('searchSwitch').replaceChildren();$('scopeQuestion').replaceChildren();

  searchRequest?.abort(); controller?.abort();controller=null;
  const request=new AbortController();searchRequest=request;
  const priorMode=responseMode,priorTopic=topic;
  displayedEvidence=null;generalResult=null;
  responseMode=classifyResponseMode(input,{index:lookupIndex,topic:priorTopic,previousMode:activeResearchReady?priorMode:undefined});
  const screened=screenGeneralQuery(input);
  const prepared=screened.status==='ok'&&responseMode==='medical'?prepareQuery(input):screened,status=prepared.status;
  if(status!=='ok'){
    notifySafety({status,safety:prepared.safety?.safety});
    $('notice').textContent=status==='unsafe'?'Buddy’s response is below.':guardMessage(status);$('results').hidden=true;$('resultsBody').replaceChildren();
    topic='';unresolved=true;activeQuery='';live=null;codes=null;mobile.update({topic:'',role:roles[role],responses:[]});buddy.sync(true,false);
    copilot.sync();research.reset();
    const message=el('div',undefined,'overview-note search-answer');
    message.setAttribute('role','alert');message.append(el('h2',prepared.safety?.title||(status==='emergency'?'Get urgent help now':'Remove identifying details to continue')));
    renderAnswer(message,prepared.safety||{text:guardMessage(status)},renderCheck);
    if(status!=='emergency')message.append(button('Edit question',()=>{$('query').focus();$('query').scrollIntoView({block:'center'})}));
    $('card').hidden=false;$('card').replaceChildren(message);$('card').focus({preventScroll:true});$('card').scrollIntoView({block:'start'});
    return;
  }
  if(responseMode==='general'){
    activeQuery=input;topic=input;unresolved=false;live=null;codes=null;
    $('card').hidden=false;$('query').value=input;render();$('card').focus({preventScroll:true});$('card').scrollIntoView({block:'start'});
    const timer=setTimeout(()=>request.abort(),16000);
    try{
      const response=await fetch('/api/browser/general',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({question:input,...(priorMode==='general'&&priorTopic&&priorTopic.length<=180?{topic:priorTopic}:{})}),signal:request.signal,cache:'no-store'});
      const data=await response.json();
      if(searchRequest!==request)return;
      if(!['answered','insufficient','blocked'].includes(data.status))throw Error('Source service unavailable');
      generalResult=data;topic=data.topic||input;activeResearchReady=data.status==='answered';
      $('notice').textContent=data.status==='answered'?'Your response and sources are ready.':'See the response below.';
    }catch{
      if(searchRequest!==request)return;
      generalResult={status:'unavailable',topic:input,answer:'The source service could not finish this search. Please try again.'};
      $('notice').textContent='Search could not finish.';
    }finally{clearTimeout(timer)}
    render();return;
  }
  if(priorMode==='general'){topic='';activeQuery='';unresolved=true;activeResearchReady=false;}
  input=prepared.query;queryNotice=prepared.notice||'';
  const narrativeTopic=generalMode(role)?publicQuestionTopic(correctSpelling(input),lookupIndex):null;
  const clarification=narrativeTopic===''?missingSymptomTopic:clarifyQuery(input,{topic,browser:true,context:!!activeQuery&&!unresolved});
  if(clarification){unresolved=true;copilot.sync();$('card').hidden=false;$('results').hidden=true;renderClarification($('card'),clarification,q=>search(q,null,true),draft=>{if(draft!==undefined)$('query').value=draft;$('query').focus()});$('notice').textContent='Choose a meaning or add the missing subject.';return;}
  $('card').hidden=false;$('copilot').hidden=false;
  const corrected=correctSpelling(input),code=codeQuery(input);
  let {choices,keywords}=resolveSearch(corrected,lookupIndex);choices=inScopeChoices(choices);
  if(chosenTopic && choices.includes(chosenTopic))choices=[chosenTopic];
  if(!choices.length && activeQuery && !unresolved && /\b(it|its|this condition|this disease)\b/i.test(input) && questionDeck(input))choices=[topic];
  const related=!code&&!choices.length?medlineLookup.resolveQuestion(corrected):null;
  let exact=allowedTopics.get(keywords.toLowerCase())||related?.topic,codeResult=null;
  if(code){
    const phrase=code || extractCondition(corrected);
    if(phrase){
      $('notice').textContent='Checking official terminology…';
      codeResult=await terminology(phrase,request.signal);
      if(searchRequest!==request)return;
      if(codeResult.canonical){
        choices=[];exact=codeResult.canonical;
        const linked=(codeResult.education||[]).filter(r=>medicalRecord(r.title)?.url===r.url);
        if(linked.length===1){
          const source=Object.keys(catalog).find(name=>medicalRecord(name)?.url===linked[0].url);
          exact=source||linked[0].title;
          codeResult.message='MedlinePlus Connect links this code to the educational topic '+exact+'. Its exact classification label is listed below.';
        }
      }
    }
    if(!exact&&!choices.length){
      unresolved=true;topic='';codes=codeResult;live=null;activeQuery=input;
      $('notice').textContent=codeResult?.message||(code?.toUpperCase().startsWith('SNOMED')?codeResult?.snomedStatus:null)||'No supporting medical source was found for this question. Try a more specific medical topic.';
      $('results').hidden=true;render();$('card').focus({preventScroll:true});$('card').scrollIntoView({block:'start',behavior:'smooth'});return;
    }
  }
  if(narrativeTopic){exact=narrativeTopic;choices=[];}
  const followUpStudy=priorMode==='medical'&&activeResearchReady&&priorTopic&&!choices.length&&studyFollowUp(input);
  if(followUpStudy)exact=priorTopic;
  const heartLesson=Object.hasOwn(heartParagraphs,heartIntent(corrected));
  const learningSubject=narrativeTopic||followUpStudy?'':heartLesson?'heart':educationalSubject(corrected);
  if(!code&&!chosenTopic&&learningSubject){exact=learningSubject[0].toUpperCase()+learningSubject.slice(1);choices=[];}
  // A clear question is eligible even when it has no local disease-title match.
  // Multiple named subjects are preserved as one question for server retrieval.
  if(!code&&(!choices.length&&!exact||choices.length>1)){exact=retrievalTerms(corrected)||corrected.slice(0,160);exact=exact[0].toUpperCase()+exact.slice(1);choices=[];}
  unresolved=false;
  const results=$('results');results.hidden=false;$('resultsBody').replaceChildren();
  $('query').value=choices.join(' / ')||exact;$('resultTitle').textContent='Research sources for '+$('query').value;
  $('resultTitle').focus({preventScroll:true});
  $('notice').textContent=corrected!==input?'Showing results for “'+corrected+'”.':'';
  if(choices.length>1){
    unresolved=true;codes=null;live=null;topic='';activeQuery='';render();
    $('notice').textContent='Several topics matched. Choose one so I can give a focused answer.';results.scrollIntoView();panel($('resultsBody'),'Choose a condition to narrow the search.');
    choices.forEach(name=>$('resultsBody').append(button(name,()=>search(input,name,true))));return;
  }
  const subject=choices[0]||exact,match=Object.hasOwn(catalog,subject)?subject:null;
  aiRequested=true;
  codes=codeResult;activeQuery=input;topic=subject;if(!prepared.ephemeral)void recordTopic(subject,'search',questionDeck(input)||1);activeResearchReady=true;live={message:'Searching Europe PMC…'};
  $('card').querySelectorAll('details[open]').forEach(d=>d.open=false);
  render();
  $('notice').textContent=(corrected!==input?'Understood as “'+corrected+'”. ':'')+'Preparing your cited answer…';
  const target=questionDeck(corrected);
  if(target)copilot.activate(target);
  $('query').value=input;
  $('card').focus({preventScroll:true});$('card').scrollIntoView({block:'start'});
  if(match){
    const local=resultGroup('Medical sources · '+match);
    const sources=filtered('core','guideline').slice(0,3);
    sources.forEach(r=>local.append(linkRecord(r)));local.append(button('View answer',()=>$('card').scrollIntoView()));
  }else panel($('resultsBody'),'Searching medical education and published evidence beyond the local topic catalog.');
  const papers=resultGroup('Additional indexed publications'),figures=resultGroup('Published figures');
  $('searchSubmit').textContent='Search ↗';$('find').setAttribute('aria-busy','false');
  const timeout=setTimeout(()=>request.abort(),12000);
  async function fill(container,load,empty){
    container.replaceChildren(el('p','Searching Europe PMC…','meta'));
    try{
      const rows=await load();
      if(searchRequest!==request)return;
      container.replaceChildren();
      if(rows.length)rows.forEach(r=>container.append(linkRecord(r)));else panel(container,empty);
    }catch{
      if(searchRequest!==request)return;
      if(container===papers && !controller){live={message:'Publication search unavailable. Retry retrieval or inspect the source inventory.'};render()}
      container.replaceChildren();panel(container,'This source did not respond successfully.');
      container.append(button('Retry search',()=>search(input)));
    }
  }
  await Promise.all([
    codeResult?Promise.resolve():terminology(subject,request.signal).then(result=>{if(searchRequest===request){codes=result;render()}}),
    fill(papers,async()=>{
      const response=await searchEvidence(subject,request.signal,!match);
      if(searchRequest===request && !controller){live={...response,message:response.records.length+' publications retrieved '+response.queriedAt};render()}
      return response.records;
    },'No publications met the topic and evidence-type filters. Try a broader medical term.'),
    fill(figures,()=>findFigures(match?(taxonomy.entities.find(e=>e.name===match)?.aliases?.[0]||match):subject,request.signal),'No figures were found in the sampled open-access articles.')
  ]);
  clearTimeout(timeout);
}
async function runLive(){controller?.abort();const c=new AbortController();controller=c;live={message:'Searching Europe PMC…'};render();const timer=setTimeout(()=>c.abort(),15000);try{const result=await searchEvidence(topic,c.signal,!Object.hasOwn(catalog,topic));if(controller!==c)return;live={...result,message:result.records.length+' qualifying records · metadata retrieved '+result.queriedAt+' · clinical appraisal pending.'}}catch{if(controller!==c)return;live={message:'The live search could not be completed. The cataloged reading list remains available. Retry the search or open the publisher directly.'}}finally{clearTimeout(timer)}render()}
function download(){const url=URL.createObjectURL(new Blob([JSON.stringify({topic,source:'Europe PMC',...live},null,2)],{type:'application/json'}));const a=el('a');a.href=url;a.download='healthbrowse-evidence.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
for(let i=0;i<20;i++){let p=document.createElementNS('http://www.w3.org/2000/svg','path');p.setAttribute('d','M 0 '+(95-i*2)+' C 42 '+(125-i*4)+' 62 '+(8+i)+' 100 '+(18+i*3)+' S 159 '+(145-i*3)+' 210 '+(80-i*2));$('waves').append(p)}
try{
  const files=['catalog.json','taxonomy.json','clinical-passages.json','topic-list.json','medline-topics.json'];
  const loaded=await Promise.allSettled(files.map(file=>fetchJSON(file)));
  const content=(i,fallback)=>loaded[i].status==='fulfilled'?loaded[i].value:fallback;
  catalog=content(0,{});taxonomy=content(1,{departments:[],entities:[]});passages=remapPassages(content(2,{}));allowedTopics=new Map(content(3,[]).map(t=>[t.toLowerCase(),t]));feed=content(4,{topics:[]});

  allowedTopics.set('asthma','Asthma');
  medlineLookup=medlineIndex(feed);
  for(const item of feed.topics)if(!allowedTopics.has(item.title.toLowerCase()))allowedTopics.set(item.title.toLowerCase(),item.title);
  lookupIndex=topicIndex([...feed.topics.map(t=>({name:t.title,aliases:(t.aliases||[]).filter(a=>medlineLookup.find(a)===t)})),...taxonomy.entities],allowedTopics.values());
  const examples=el('details',undefined,'focus-directory health-question-examples');
  examples.append(el('summary','Try a health question'));
  const exampleList=el('div');
  for(const question of healthQuestions){
    const choice=button(question,()=>searchUI.send(question));
    choice.type='button';exampleList.append(choice);
  }
  examples.append(exampleList);$('searchSwitch').before(examples);
  Object.keys(catalog).forEach(name=>$('focusTopics').append(button(name,()=>search(name))));
  attachQueryCompletion({input:$('query'),popup:$('querySuggestionPopup'),list:$('querySuggestions'),status:$('querySuggestionStatus'),form:$('find'),suggest:createQuerySuggestions([...Object.keys(catalog).map(name=>({name,aliases:medicalRecord(name)?.aliases||[]})),...feed.topics])});

  const last=readSession('hb-context',{});if(Object.hasOwn(passages,last.topic)||Object.hasOwn(catalog,last.topic)||allowedTopics.has(String(last.topic).toLowerCase()))topic=last.topic;
  activeQuery=topic;
depts=taxonomy.departments.map(d=>d.name);assignments=Object.fromEntries(taxonomy.entities.map(e=>[e.name,e.departmentIds.map(id=>taxonomy.departments.findIndex(d=>d.id===id))]));role=Math.max(0,roles.indexOf(normalizeReadingRole(readSession('hb-reader',''))));
$('readingMode').disabled=false;
$('readingMode').addEventListener('change',event=>{
  const next=roles.indexOf(event.target.value);if(next<0||next===role)return;
  role=next;try{sessionStorage.setItem('hb-reader',JSON.stringify(roles[role]))}catch{}
  render();
});
render();
$('notice').textContent='Ready. Ask a research question.';
const queued=searchUI.ready(search);
void chats.init();
const params=new URLSearchParams(location.search);
const requested=params.get('q')||params.get('topic'),section=Number(params.get('section'));
if(params.get('chat'))await chats.load(params.get('chat'));
else if(params.get('newchat')==='1')chats.reset();
if(!queued && !params.get('chat') && requested){
  await search(requested,null,true);if(Number.isInteger(section)&&section>=1&&section<=7)research.select(section);
}
}catch{searchUI.fail()}
