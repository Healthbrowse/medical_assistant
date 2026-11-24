import {buddyLearningQuestions} from './learning-questions.js';
import {buddyDeckIntent} from './buddy-deck-intent.js';
import {invitationTopic,invitationChoices,invitationReply} from './buddy-invitation.js';
import {localBuddyDecks,renderBuddyDecks} from './buddy-decks.js';
import {getAttachments,attachmentKey} from './attachments.js';
import {auditBrowserAnswer,generalBuddyAnswer} from './buddy-audit.js';
import {screenGeneralQuery,classifyResponseMode} from './response-mode.js';
import {clarifyQuery,renderClarification,retrievalTerms,usesActiveTopic,isMedicalSectionFollowUp} from './query-understanding.js';
import {withAudienceDisclaimer} from './medical-contract.js';
import {notifySafety} from './safety-notification.js';
import {safetyAnswer} from './safety-policy.js';
import {buddyHelpAnswer} from './buddy-policy.js';
import {deckCount,domainAnswer,searchAnswer,isOverviewQuestion} from './search-experience.js';
import {prepareQuery,canSaveResearchQuestion,missingSymptomTopic} from './query-input.js';
import {readingProfile,roleQuestions} from './reading-profiles.js';
import {requestSynthesis,requestLiteratureEvidence} from './model-client.js';
import {createPacketReader,evidencePacket,packetDisclosure} from './evidence-packet.js';
import {renderAnswer,renderClinicalSynthesis} from './answer-view.js';
import {frameworkVersion,domains,domainTitle,roleLabel} from './disease-framework.js';
import {renderCheck} from './research-session.js';
export const deckNames=domains.map(d=>d.title);
const $=id=>document.getElementById(id);
const node=(tag,text)=>Object.assign(document.createElement(tag),{textContent:text});
export function guardMessage(status){return status==='unsafe'?safetyAnswer().text:status==='emergency'?'If these symptoms or immediate danger are happening now, contact local emergency services now or ask someone nearby to call. Do not wait for a search response.':'Please remove identifying details, passwords, tokens, contact information, birth dates or record numbers. You can still describe symptoms in your own words. This input was not sent for retrieval.'}
function save(key,value){try{sessionStorage.setItem(key,JSON.stringify(value))}catch{}}
export function readSession(key,fallback){try{return JSON.parse(sessionStorage.getItem(key))??fallback}catch{return fallback}}
export function isBrowserAuditQuestion(question){
 return /\b(?:check|audit|verify|fact[- ]?check|trace|compare)\b.{0,36}\b(?:(?:this|that|these|the|your|browser) (?:browser )?(?:claims?|answer|sources?|information|citations?|summary)|the information in (?:it|this))\b/i.test(question)
  || /^(?:explain|check|review|show)(?: (?:me|the|its|their))* (?:methodology|methods)(?: and (?:limitations|validation))?(?: (?:of|in) (?:this|the) (?:answer|study|report))?[.?!]*$/i.test(question.trim());
}
function isRecordListing(question){
 return /^(?:(?:please |can you )?(?:list|find|show|locate)(?: me)?|which institutions|what (?:institutions|grants|trials) are)\b/i.test(question.trim())
  && /\b(?:papers|publications|studies|trials|grants|institutions)\b/i.test(question)
  && !/\b(?:compar(?:e|ison)|versus|efficacy|benefits?|harms?|outcomes?|limitations?|effect sizes?)\b/i.test(question);
}
export function setupCopilot(browserContext,actions={}){
 function getContext(){
  const browser=browserContext()||{topic:'',query:'',role:'General reader',responseMode:'general',passages:[],records:[],sections:[]};
  const attachments=getAttachments();
  return attachments.length?{...browser,attachments,attachmentVersion:attachmentKey()}:browser;
 }
 let sequence=0,active=1,history=[],identity='',publicTurns=[],busy=false,modelRequest=null,privateConversation=false,conversationTopic='',learningTopic='',generalConversation=null;
 // Keep evidence in the current session independently of saved transcript data.
 const packetViews=new Map();
 const deckViews=new WeakMap();
 const expandedInvitations=new WeakSet();
 function forgetPacket(turn){
  const entry=packetViews.get(turn);
  entry?.ownedReader?.dispose();entry?.view.remove();packetViews.delete(turn);
 }
 function clearPackets(){for(const turn of packetViews.keys())forgetPacket(turn)}
 function showPacket(turn,reader,owned=false){
  if(reader)packetViews.set(turn,{view:packetDisclosure(reader),ownedReader:owned?reader:null});
 }
 document.addEventListener('healthbrowse-session-cleared',()=>{sequence++;modelRequest?.abort();busy=false;clearPackets()});
 window.addEventListener('pagehide',clearPackets);
 const questions=c=>c?.deckQuestions?.length===6?c.deckQuestions.map((label,i)=>({deck:i+1,label,prompt:label})):roleQuestions(c?.role);
 const controls=[$('deckSelect'),$('question'),$('ask').querySelector('button[type=submit]')];
 controls.forEach(control=>control.disabled=true);
 function conversationContext(browser) {
  if(generalConversation)return {...browser,...generalConversation};
  const learning=conversationTopic && conversationTopic===learningTopic;
  if(!conversationTopic||conversationTopic===browser.topic){
   return learning?{...browser,learningMode:true,deckQuestions:buddyLearningQuestions(browser.role)}:browser;
  }
  return {...browser,topic:conversationTopic,query:conversationTopic,responseMode:'medical',
   passages:actions.passagesForTopic?.(conversationTopic)||[],sections:[],records:[],aliases:[],visibleTexts:[],
   answerSummary:'',directAnswer:null,browserSources:[],deckSummaries:[],learningMode:!!learning,deckQuestions:learning?buddyLearningQuestions(browser.role):null,packetReader:null};
 }
 function renderInvitation(response,turn,c) {
  if(!turn.inviteTopic)return;
  const prompt='Would you like to know more about '+turn.inviteTopic+'?';
  if(turn!==history.at(-1)||busy||$('scopeQuestion').childElementCount){
   response.append(node('p',prompt));return;
  }
  const details=node('details','');details.className='buddy-invitation';
  details.open=expandedInvitations.has(turn);
  details.ontoggle=()=>{if(details.isConnected){if(details.open)expandedInvitations.add(turn);else expandedInvitations.delete(turn)}};
  details.append(node('summary',prompt));
  const buttons=node('div','');
  for(const choice of invitationChoices(turn,questions(c),c.responseMode==='general',c.role)){
   const b=node('button',choice.label);b.type='button';b.className='act';
   b.onclick=()=>void ask(choice.prompt,true,choice.deck);buttons.append(b);
  }
  details.append(buttons);response.append(details);
 }
 function sync(){
  const browser=getContext();if(!browser)return;
  let c=browser;
  const scope=frameworkVersion+'|audience-v2|'+(c.responseMode||'medical')+'|'+c.topic+'|'+c.role+'|'+(c.attachmentVersion||'');
  if(identity!==scope){clearPackets();generalConversation=null;learningTopic='';conversationTopic=c.topic;modelRequest?.abort();history=[];publicTurns=[];privateConversation=false;busy=false;++sequence;$('scopeQuestion').replaceChildren();const last=readSession('hb-context',{});active=last.scope===scope&&Number.isInteger(last.deck)?Math.max(1,Math.min(last.deck,6)):1;if(last.scope===scope){history=publicTurns=readSession('hb-transcript',[]);conversationTopic=history.at(-1)?.topic||c.topic}identity=scope}
  c=conversationContext(browser);
  controls.forEach(control=>control.disabled=busy);
  $('buddyStop').hidden=!busy;
  if(c.attachments?.length||c.responseMode==='general'||!canSaveResearchQuestion(c.query)){save('hb-transcript',[])}else{save('hb-context',{topic:c.topic,role:c.role,scope,deck:active});save('hb-transcript',publicTurns)}
  [...$('deckSelect').options].forEach((option,i)=>{option.textContent=(i+1)+' · '+(c.deckQuestions?.[i]||domainTitle(i+1,c.role));option.hidden=i>=deckCount(c.role)});
  $('deckSelect').value=String(active);$('copilotScope').textContent=c.attachments?.length?'Reviewing attached documents':conversationTopic||c.topic||'Research and document review';
  $('copilotHint').textContent=busy?'Checking sources…':'';
  const medical=!!c.topic&&!c.attachments?.length&&c.responseMode!=='general';
  $('buddyWelcome').hidden=false;$('buddyQuestions').hidden=false;
  $('buddyWelcome').replaceChildren(node('p',medical?'Explore '+c.topic+' with Buddy.':'Ask about the answer, compare its sources or attach a document for review.'));
  $('buddyQuestions').replaceChildren();
  const choices=c.attachments?.length?['Summarize the documents and cite the relevant passages.','Compare the stated controls, supporting evidence and gaps.']:
   !medical&&c.answerSummary?['Check the claims in the browser answer.','Explain the methodology and limitations.']:[];
  for(const prompt of choices){const b=node('button',prompt);b.type='button';b.disabled=busy;b.onclick=()=>ask(prompt);$('buddyQuestions').append(b)}
  if(medical)for(const choice of questions(c)){const b=node('button',choice.label);b.type='button';b.disabled=busy;b.onclick=()=>ask(choice.prompt,true,choice.deck);$('buddyQuestions').append(b)}
  $('deckPicker').hidden=!medical;$('buddyResearch').hidden=!medical;
  const notice=document.querySelector('.buddy-pinned-notice');if(notice)notice.hidden=!medical;
  $('ask').querySelector('label').textContent='Ask a follow-up question';$('ask').querySelector('button[type=submit]').textContent='↑';$('copilot').querySelector('.eyebrow').textContent='HEALTHBROWSE';
  for(const turn of packetViews.keys())if(!history.includes(turn))forgetPacket(turn);
  $('thread').replaceChildren();
  for(const t of history){const turn=node('div','');turn.className='turn';const question=node('p',t.question);question.className='buddy-user-message';question.setAttribute('aria-label','You');const response=node('div','');response.className='buddy-response';const author=node('span','Buddy');author.className='buddy-message-author';response.append(author);turn.append(question,response);
   const renderTurn=t.clinicalSynthesis&&!t.buddyDecks?renderClinicalSynthesis:renderAnswer;
   renderTurn(response,{...t,blocks:t.blocks||[],style:t.style||''},renderCheck,t===history.at(-1)&&!busy?()=>{history=history.filter(item=>item!==t);publicTurns=publicTurns.filter(item=>item!==t);void ask(t.question,true,t.buddyDecks?0:t.deck)}:undefined);
   if(t.buddyDecks){
    // Enrichment updates a turn in place while the reader may have a deck open.
    const previous=deckViews.get(t);
    const expanded=previous&&[...previous.querySelectorAll('.buddy-deck')].map(item=>item.open);
    renderBuddyDecks(response,t.buddyDecks,renderCheck);
    if(expanded)response.querySelectorAll('.buddy-deck').forEach((item,i)=>item.open=expanded[i]??false);
    deckViews.set(t,response);
   }
   if(packetViews.has(t))response.append(packetViews.get(t).view);
   if(t.frameworkVersion!==frameworkVersion)response.append(node('small','Saved using the previous framework. Section numbers refer to that version.'));
   renderInvitation(response,t,c);
   $('thread').append(turn);
  }
  $('followups').replaceChildren();
  if(medical&&!history.at(-1)?.buddyDecks&&!history.at(-1)?.safety){
   const overview=node('button','Show all six decks');overview.type='button';overview.className='act';
   overview.disabled=busy;overview.onclick=()=>void ask('Show all six decks',true);
   $('followups').append(overview);
  }
  document.dispatchEvent(new CustomEvent('healthbrowse-chat-updated',{detail:{count:history.length,busy}}));
 }
 async function respond(q,fromSuggestion=false,guidedDeck=0){
  const browser=getContext();if(!browser||!q.trim())return;
  let c=conversationContext(browser);
  const fileMode=!!c.attachments?.length;
  const audit=!fileMode&&c.directAnswer&&isBrowserAuditQuestion(q);
  const queryMode=actions.classify?.(q,c)??classifyResponseMode(q,{topic:c.topic,previousMode:c.responseMode||'medical'});
  const intent=buddyDeckIntent(q,{...c,queryMode});
  const sectionFollowUp=c.topic&&c.responseMode!=='general'&&isMedicalSectionFollowUp(q);
  const general=!fileMode&&!guidedDeck&&(audit?c.responseMode==='general':queryMode==='general'&&!intent.overview&&!sectionFollowUp);
  const prepared=(fileMode||general||audit)?{...screenGeneralQuery(q,[c.topic,history.at(-1)?.question].filter(Boolean).join(' ')),query:q}:prepareQuery(q,[c.topic,c.query,history.at(-1)?.question].filter(Boolean).join(' ')),status=prepared.status;q=prepared.query;$('question').value='';$('scopeQuestion').replaceChildren();
  if(status!=='ok')notifySafety({status,safety:prepared.safety?.safety});
  if(status==='ok'&&(prepared.ephemeral||!canSaveResearchQuestion(q,c.query)))privateConversation=true;
  const saveable=status==='ok'&&!privateConversation&&!fileMode&&!audit&&!general;
  const run=++sequence,scope=identity;
  const narrativeTopic=status==='ok'&&!general&&!audit&&!guidedDeck&&!fileMode&&readingProfile(c.role).index===0?actions.personalTopic?.(q,c.topic):null;
  const missingDeckTopic=intent.explicit&&!intent.topic&&!c.topic?{
   title:'Which medical topic should the six decks cover?',text:'Enter a condition or a biology topic.',choices:[],allowEdit:true
  }:null;
  const clarification=status==='ok'&&!fileMode&&!guidedDeck&&missingDeckTopic?missingDeckTopic:narrativeTopic===''?missingSymptomTopic:status==='ok'&&!general&&!audit&&!guidedDeck&&!fileMode?clarifyQuery(q,{topic:c.topic,context:true}):null;
  if(clarification){renderClarification($('scopeQuestion'),clarification,query=>void ask(query),draft=>{if(draft!==undefined)$('question').value=draft;$('question').focus()});return;}
  const choices=narrativeTopic==null&&status==='ok'&&!general&&!audit&&!fileMode&&!guidedDeck?actions.scopeChoice?.(q)||[]:[];
  const previousTopic=c.topic;
  const namedQuestion=/^(?:what (?:is|are)|what about|explain|describe|tell me about|how does)\b/i.test(q);
  const changesSubject=narrativeTopic||intent.topic||(!intent.explicit&&!usesActiveTopic(q)&&(choices.length||namedQuestion||intent.overview));
  if(status==='ok'&&!general&&!audit&&!fileMode&&!guidedDeck&&changesSubject){
   generalConversation=null;
   const terms=retrievalTerms(q);
   const normalFunction=/\b(?:functions?|anatomy|physiology) (?:of|does)\b/i.test(q);
   const next=narrativeTopic||intent.topic||(intent.overview||normalFunction?terms:choices.length===1?choices[0]:terms);
   if(next&&next.toLowerCase()!==c.topic.toLowerCase()){conversationTopic=next[0].toUpperCase()+next.slice(1);c={...conversationContext(browser),query:q};active=1;}
  }
  const help=status==='ok'&&!fileMode&&!audit?buddyHelpAnswer(q):null;
  // Introduce a new medical subject with a direct answer and the six sections.
  // Once the conversation is underway, a targeted follow-up can stay focused.
  const newSubject=!!c.topic&&(!history.length||previousTopic!==c.topic);
  const asksForBrief=/\b(?:brief(?:ly)?|short answer|one sentence|just the answer|only|(?:no|without|skip|omit|avoid|do not|don.t)\b[^.!?]{0,35}\bdecks?)\b/i.test(q);
  const fullTopic=intent.explicit||(!asksForBrief&&(intent.overview||newSubject&&!isRecordListing(q)));
  const report=status==='ok'&&fullTopic&&!help&&!general&&!audit&&!fileMode&&!guidedDeck&&!prepared.ephemeral&&canSaveResearchQuestion(q);
  const localQuestion=report&&intent.explicit?c.topic:q;
  let answer=status!=='ok'?{...(prepared.safety||{text:guardMessage(status),citations:[],checks:[]}),deck:active}:help?{...help,deck:active}:audit?auditBrowserAnswer(c,q):fileMode||general?{text:'Checking the sources…',blocks:[],citations:[]}:guidedDeck?domainAnswer(c,guidedDeck):searchAnswer(c,localQuestion,{detail:true,activeDeck:active});
  if(!answer)return;
  if(status==='ok'&&c.attachments?.length&&!help)answer={text:'Reading the attached documents…',blocks:[],citations:[],checks:[],deck:active};
  if(status==='ok'&&!help&&!general&&!audit&&!fileMode)answer=withAudienceDisclaimer(answer,c.role);
  const clinicalQuestion=status==='ok'&&!help&&!general&&!audit&&!fileMode&&readingProfile(c.role).index===1;
  if(report&&!answer.safety)answer={...answer,buddyDecks:localBuddyDecks(c),deck:active};
  if(clinicalQuestion&&!report&&!answer.safety&&answer.blocks?.length)answer={...answer,clinicalSynthesis:true};
  // Give the visitor the source-backed response now; optional remote services
  // can enrich this same turn without holding the conversation blank.
  const turn={...answer,frameworkVersion,topic:c.topic,question:status==='ok'?q:'Input withheld',overview:report||isOverviewQuestion(c,q)};
  if(status==='ok'){active=answer.deck||active;if(!help&&!audit&&!general&&!fileMode)turn.modelNotice='Checking for additional evidence. You can read the cited response below.'}
  if(status==='ok'&&audit&&!fileMode&&c.responseMode==='medical'&&c.topic===browser.topic)showPacket(turn,c.packetReader);
  history=[...history.slice(-9),turn];if(fromSuggestion&&saveable)publicTurns=[...publicTurns.slice(-9),turn];
  sync();$('thread').lastElementChild?.scrollIntoView({block:'nearest'});
  let researchAnswer=null;
  if(status==='ok'&&!report&&!help&&!general&&!audit&&!guidedDeck&&!prepared.ephemeral&&!fileMode&&(!clinicalQuestion||isRecordListing(q))){try{researchAnswer=await actions.research?.(q)}catch{}if(run!==sequence||identity!==scope)return}
  if(researchAnswer)answer=researchAnswer;
  else if(status==='ok'&&general&&!audit&&!help){
   modelRequest?.abort();modelRequest=new AbortController();
   try{answer=await generalBuddyAnswer(q,c.responseMode==='general'?c.topic:'',modelRequest.signal)}
   catch{if(modelRequest.signal.aborted)return;answer={text:'The research service is unavailable. Please try again.',blocks:[],citations:[]}}
  }else if(status==='ok'&&!help&&!audit){
   modelRequest?.abort();modelRequest=new AbortController();
   const result=await requestSynthesis(c,q,{mode:'chat',deck:report?0:guidedDeck||active,history:history.slice(0,-1).filter(turn=>turn.topic===c.topic),signal:modelRequest.signal});
   if(run!==sequence||identity!==scope)return;
   if(!fileMode&&!general&&!answer.safety&&['generated','sourced','unavailable'].includes(result.status)){
    const packet=evidencePacket(result.retrieval?.evidencePacket);
    const target={topic:c.topic,query:q,role:c.role,responseMode:'medical'};
    const shared=!packet&&q===browser.query&&c.topic===browser.topic&&browser.responseMode==='medical'&&browser.packetReader;
    if(shared)showPacket(turn,shared);
    else showPacket(turn,createPacketReader(signal=>packet||requestLiteratureEvidence(target,{signal})),true);
   }
   if(result.status==='blocked')notifySafety({status:'blocked',safety:result.answer?.safety});
   if(result.status==='clarification'){renderClarification($('scopeQuestion'),result.clarification,query=>void ask(query),draft=>{if(draft!==undefined)$('question').value=draft;$('question').focus()});answer={text:result.clarification.text,blocks:[],citations:[],checks:[],supported:false};}
   else if(['generated','sourced','blocked','platform'].includes(result.status)){
    const grounded=['sourced','generated'].includes(result.status);
    if(grounded&&!general&&!fileMode&&result.learningMode)learningTopic=c.topic;
    const decks=report&&grounded?(result.decks?.length===6?result.decks:answer.buddyDecks):null;
    answer=decks?{...result.answer,deck:active,buddyDecks:decks}:result.answer;
    if(clinicalQuestion&&!report&&grounded)answer={...answer,clinicalSynthesis:true};
   }else answer={...answer,...(clinicalQuestion&&!report&&!answer.safety?{clinicalSynthesis:true}:{}),...(fileMode?{text:'Buddy could not complete the document review.'}:{}),modelNotice:result.message,code:result.code,retryAt:result.retryAt};
  }
  if(run!==sequence||identity!==scope)return;
  if(general&&!audit&&answer?.topic&&answer?.blocks?.length){
   conversationTopic=answer.topic;
   generalConversation={query:q,topic:answer.topic,responseMode:'general',answerSummary:answer.text,directAnswer:answer,browserSources:answer.citations};
  }
  if(status==='ok'){active=answer.deck||active;if(!help&&!general&&!audit&&!fileMode)answer=withAudienceDisclaimer(answer,c.role);}
  // Preserve the shared turn object, but replace all provisional response fields
  // so an enriched answer cannot inherit an obsolete coverage-gap message.
  for(const key of Object.keys(turn))delete turn[key];
  const finalTopic=general&&!audit?answer.topic:c.topic;
  Object.assign(turn,answer,{frameworkVersion,topic:finalTopic||c.topic,question:status==='ok'?q:'Input withheld',overview:report||isOverviewQuestion(c,q)});
  if(status==='ok'&&!privateConversation&&!prepared.symptom&&!help&&!audit&&!guidedDeck&&!fileMode)
   turn.inviteTopic=invitationTopic(answer,finalTopic,q);
  if(status==='ok'&&saveable){void actions.onChat?.(c,active);try{void actions.onTurn?.(turn)}catch{}}
  else if(status==='ok'&&(fileMode||privateConversation))$('chatSaveStatus').textContent=fileMode?'Document conversations stay in memory and are not saved to your account.':'Personal questions stay in this tab and are not saved to your account.';
 }
 async function ask(q,fromSuggestion=false,guidedDeck=0){
  if(busy||!q.trim())return;
  const invite=$('thread').lastElementChild?.querySelector('.buddy-invitation');
  const reply=invite&&!guidedDeck&&invitationReply(q);
  if(reply){
   $('question').value='';
   if(reply==='open'){
    invite.open=true;expandedInvitations.add(history.at(-1));invite.querySelector('button')?.focus();
   }else{
    history.at(-1).inviteTopic='';sync();$('question').focus();
   }
   return;
  }
  busy=true;sync();let failed=false;const scope=identity;
  let run;
  try{const response=respond(q,fromSuggestion,guidedDeck);run=sequence;await response}catch{failed=true}
  finally{if(scope===identity&&run===sequence){busy=false;sync();if(failed&&!modelRequest?.signal.aborted){const error=node('p','Additional evidence could not be loaded. The cited response remains available.');error.setAttribute('role','status');$('thread').append(error)}$('thread').lastElementChild?.scrollIntoView({block:'nearest'})}}
 }
 deckNames.forEach((name,i)=>$('deckSelect').append(new Option((i+1)+' · '+name,String(i+1))));
 $('deckSelect').onchange=()=>{active=Number($('deckSelect').value);sync()};
 $('ask').onsubmit=e=>{e.preventDefault();ask($('question').value)};
  $('buddyStop').onclick=()=>{sequence++;modelRequest?.abort();busy=false;if(history.at(-1))history.at(-1).modelNotice='Additional lookup stopped. The available cited response is shown below.';sync()};
  $('clearChat').onclick=()=>{sequence++;modelRequest?.abort();busy=false;$('scopeQuestion').replaceChildren();history=[];publicTurns=[];privateConversation=false;generalConversation=null;conversationTopic=getContext()?.topic||'';sync()};
 document.addEventListener('healthbrowse-documents-changed',sync);
 $('buddyDialog').addEventListener('buddy-opened',sync);
 return {sync,verify(){
  $('buddyDialog').dispatchEvent(new Event('buddy-verification'));
  if(busy){modelRequest?.abort();++sequence;busy=false}
  const c=getContext();generalConversation=null;conversationTopic=c.topic;
  const prompt=c.query?'Source check for “'+c.query+'”':'Check the browser answer';
  const result=auditBrowserAnswer(c);
  const turn={...result,question:prompt,frameworkVersion,topic:c.topic,deck:active};
  if(!c.attachments?.length&&c.responseMode==='medical')showPacket(turn,c.packetReader);
  history=[...history.slice(-9),turn];
  sync();$('thread').lastElementChild?.scrollIntoView({block:'nearest'})
 },askDomain(n){const choice=questions(conversationContext(getContext()))[n-1];if(choice)void ask(choice.prompt,true,n)},clear(){sequence++;modelRequest?.abort();busy=false;history=[];publicTurns=[];privateConversation=false;generalConversation=null;conversationTopic=getContext()?.topic||'';$('scopeQuestion').replaceChildren();save('hb-transcript',[]);sync()},restore(turns){
  sequence++;modelRequest?.abort();busy=false;publicTurns=[];generalConversation=null;
  privateConversation=turns.some(t=>!canSaveResearchQuestion(t.question));
  history=turns.map(t=>t.buddyDecks&&!privateConversation?{...t,inviteTopic:invitationTopic(t,t.topic,t.question)}:t);
  conversationTopic=turns.at(-1)?.topic||getContext()?.topic||'';
  learningTopic=turns.some(turn=>turn.topic===conversationTopic&&turn.buddyDecks?.[0]?.title===buddyLearningQuestions(getContext()?.role)[0])?conversationTopic:'';
  active=turns.at(-1)?.frameworkVersion===frameworkVersion?turns.at(-1).deck:1;sync();
 },activate(deck,focus=false){active=deck;sync();if(focus)$('question').focus({preventScroll:true})}};
}
