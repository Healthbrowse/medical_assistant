import {mobileDestinations,citationURL} from './mobile-model.js';
import {normalizeReadingRole} from './reading-profiles.js';
import {setupBuddyLayout,buddyIcon} from './buddy-layout.js';
import {patientDisclaimer} from './medical-contract.js';
import {isDocumentReference} from './document-policy.js';
import {createDictation,createLocalReader,bindLongPress} from './mobile-voice.js';
import {glossary,annotateMedicalTerms} from './mobile-glossary.js';
const $=id=>document.getElementById(id);
const n=(tag,text='',cls='')=>Object.assign(document.createElement(tag),{textContent:text,className:cls});
const b=(text,action,cls='')=>{const x=n('button',text,cls);x.type='button';x.onclick=action;return x};
const paths={home:'M3 10l9-7 9 7M5 9v12h5v-7h4v7h5V9',search:'M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',notes:'M5 3h14v18H5zM8 8h8M8 12h8M8 16h5',cards:'M5 5h15v16H5zM2 2h15',sources:'M3 5l8-2 10 2v15l-10-2-8 2zM11 3v15',evidence:'M4 4h16v16H4zM8 12l3 3 5-7',history:'M3 11a9 9 0 1 1 2 7M3 4v7h7M12 7v6l4 2',saved:'M6 3h12v18l-6-4-6 4z',account:'M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0M4 21v-2a8 8 0 0 1 16 0v2'};
function icon(name){const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('aria-hidden','true');const p=document.createElementNS(svg.namespaceURI,'path');p.setAttribute('d',paths[name]||paths.search);svg.append(p);return svg}
function safeLink(ref,label){const href=citationURL(ref.url);if(!href)return null;const a=n('a',label||ref.title||'Open source');a.href=href;a.target='_blank';a.rel='noopener noreferrer';return a}
export function setupMobileWorkspace({buddy,verify}){
 let state={topic:'',role:'General reader',responses:[]},identity='';
 document.body.classList.add('mobile-ready');
 // Keep one search form in the main research panel at every viewport size.
 const form=$('find');
 const tools=n('section','','mobile-tools');tools.setAttribute('aria-label','Research shortcuts');document.querySelector('.searchbox').after(tools);
 const nav=n('nav','','mobile-bottom-nav');nav.setAttribute('aria-label','Mobile navigation');document.body.append(nav);
 const live=n('p','','mobile-status');live.setAttribute('role','status');tools.append(live);
 function goHome(){window.scrollTo({top:0,behavior:matchMedia('(prefers-reduced-motion:reduce)').matches?'instant':'smooth'});const title=document.querySelector('.hero h1');if(title){title.setAttribute('tabindex','-1');title.focus({preventScroll:true})}}
 function focusSearch(){form.scrollIntoView({block:'nearest'});$('query').focus()}
 function reportHeading(section){return $('card').querySelector('[data-clinical-section="'+section+'"] h3')}
 function showReportSection(section){
  const heading=reportHeading(section);
  if(!heading){allSources();return}
  heading.scrollIntoView({block:'start'});heading.focus({preventScroll:true});
 }
 function sheet(id,title){const dialog=n('dialog','','mobile-sheet');dialog.id=id;dialog.setAttribute('aria-labelledby',id+'Title');const head=n('header','','sheet-head'),heading=n('h2',title);heading.id=id+'Title';const close=b('×',()=>dialog.close(),'sheet-close');close.setAttribute('aria-label','Close '+title);head.append(heading,close);const body=n('div','','sheet-body');dialog.append(head,body);document.body.append(dialog);dialog.addEventListener('close',()=>reader.stop());dialog.addEventListener('click',e=>{if(e.target===dialog){const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)dialog.close()}});return {dialog,body,heading};}
 const source=sheet('sourceSheet','Source passage');
 const voiceStatus=n('p','','voice-status');voiceStatus.setAttribute('role','status');
 const sourceAudioStatus=n('p','','meta');sourceAudioStatus.setAttribute('role','status');
 const reader=createLocalReader({synthesis:window.speechSynthesis,Utterance:window.SpeechSynthesisUtterance,onStatus:text=>{voiceStatus.textContent=text;sourceAudioStatus.textContent=text}});
 document.addEventListener('pointerdown',()=>reader.stop(),true);document.addEventListener('keydown',e=>{if(e.key==='Escape')reader.stop()});
 function showSource(ref){
  source.heading.textContent=ref.title||'Supporting source';source.body.replaceChildren(n('p',ref.date||'Publication date not supplied','meta'));if(ref.sourceType)source.body.append(n('p',ref.sourceType,'meta'));if(ref.attribution)source.body.append(n('p',ref.attribution,'meta'));
  if(ref.quote||ref.text){source.body.append(n('p','Supporting passage','label'),n('blockquote',ref.quote||ref.text,'source-passage'));}
  else source.body.append(n('p','Open the publisher page to read the original material.'));
  const link=safeLink(ref,'Open original source ↗');if(link)source.body.append(link);
  if(!source.dialog.open)source.dialog.showModal();
 }
 document.addEventListener('healthbrowse-source',event=>{if(!citationURL(event.detail?.url))return;event.preventDefault();showSource(event.detail)});
 function allSources(){source.heading.textContent=state.topic?'Sources for '+state.topic:'Your sources';source.body.replaceChildren();
  const refs=[...new Map(state.responses.flatMap(r=>[...(r.citations||[]),...(r.blocks||[]).flatMap(x=>x.references||[x.citation])]).filter(r=>r&&(isDocumentReference(r)||citationURL(r.url))).map(r=>[isDocumentReference(r)?r.documentId+':'+r.page:r.url,r])).values()];
  if(!refs.length)source.body.append(n('p','Sources will appear here when your search returns a cited answer.'),b('Search for a topic',()=>{source.dialog.close();focusSearch()},'source-choice'));
  for(const ref of refs){const row=b(ref.title||'Supporting source',()=>{if(isDocumentReference(ref)){source.dialog.close();document.dispatchEvent(new CustomEvent('healthbrowse-document-source',{detail:ref}))}else showSource(ref)},'source-choice');row.append(n('small',ref.date||'Date not supplied'));source.body.append(row)}
  source.dialog.showModal();
 }
 function run(name,from){if(name==='home')goHome();else if(name==='sources')allSources();else if(name==='evidence'){if(state.responseMode==='general')verify(from);else{
  showReportSection('evidence');
 }}else location.assign('/account.html#'+({history:'chats',account:'profile'}[name]));}
 // Mobile and desktop share chat data, with a dedicated responsive conversation layout.
 const {composer,voiceTools,consent,safety,greeting,more,showChat}=setupBuddyLayout();
 let voiceApproved=false;
 const dictation=createDictation({Recognition:window.SpeechRecognition||window.webkitSpeechRecognition,onText:text=>{const input=$('question');input.value=(input.value?input.value+' ':'')+text;input.value=input.value.slice(0,input.maxLength);input.dispatchEvent(new Event('input',{bubbles:true}));},onStatus:text=>voiceStatus.textContent=text,onState:listening=>{stopVoice.hidden=!listening;voiceButton.setAttribute('aria-pressed',String(listening));voiceButton.setAttribute('aria-label',listening?'Voice input is listening':'Dictate a question')}});
 function startVoice(){consent.hidden=true;voiceApproved=true;dictation.start()}
 function requestVoice(){if(!buddy.show())return;showChat({focus:false});if(!(window.SpeechRecognition||window.webkitSpeechRecognition)){voiceStatus.textContent='Voice typing is unavailable. Use your keyboard microphone or type your question.';$('question').focus();return}if(voiceApproved)startVoice();else consent.hidden=false;}
 consent.append(n('p','Your browser may send audio to its speech service. Use a public question and omit personal or confidential details. Review the text before sending.'),b('Start voice input',startVoice),b('Cancel',()=>consent.hidden=true));
 const voiceButton=b('',requestVoice,'buddy-voice-button');voiceButton.append(buddyIcon('voice'));voiceButton.title='Dictate a question';voiceButton.setAttribute('aria-label','Dictate a question');voiceButton.setAttribute('aria-pressed','false');
 const stopVoice=b('Stop voice',()=>dictation.stop(),'buddy-stop-voice');stopVoice.hidden=true;voiceTools.append(voiceButton,stopVoice);
 more.prepend(b('Read the latest answer aloud',()=>{showChat({focus:false});const text=$('thread').lastElementChild?.querySelector('.buddy-response')?.innerText;if(text)reader.read(text);else voiceStatus.textContent='Ask a question first to read an answer aloud.'},'buddy-read-latest'));
 composer.append(voiceStatus);
 bindLongPress($('buddyLauncher'),requestVoice);$('buddyLauncher').title='Open Buddy. Hold for voice input.';
 $('buddyDialog').addEventListener('close',()=>{dictation.stop();reader.stop();consent.hidden=true});
 window.addEventListener('pagehide',()=>{dictation.stop();reader.stop()});document.addEventListener('visibilitychange',()=>{if(document.hidden){dictation.stop();reader.stop()}});
 const observer=new MutationObserver(()=>{if(state.responseMode!=='general')annotateMedicalTerms($('thread'))});observer.observe($('thread'),{childList:true,subtree:true});
 document.addEventListener('click',event=>{const term=event.target.closest?.('button[data-term]')?.dataset.term;if(!glossary[term])return;const g=glossary[term];source.heading.textContent=term[0].toUpperCase()+term.slice(1);source.body.replaceChildren(n('p',g.definition),n('p',g.pronunciation,'meta'),b('Hear term',()=>reader.read(term)),n('p','Plain-language explanation based on the NCI Dictionary of Cancer Terms.','meta'));source.body.append(safeLink(g,'NCI definition & pronunciation ↗'),sourceAudioStatus);source.dialog.showModal()});
 const feedback=n('p','','mobile-safety-feedback');feedback.hidden=true;feedback.setAttribute('role','status');document.body.append(feedback);let warningTimer;
 document.addEventListener('healthbrowse-safety-alert',()=>{feedback.textContent='Safety guidance is available in your response.';feedback.hidden=false;document.body.classList.add('safety-feedback');clearTimeout(warningTimer);warningTimer=setTimeout(()=>{feedback.hidden=true;document.body.classList.remove('safety-feedback')},3500);if(!matchMedia('(prefers-reduced-motion:reduce)').matches){try{navigator.vibrate?.(40)}catch{}}});
 function viewport(){const v=window.visualViewport;if(v&&v.scale!==1)return;document.documentElement.style.setProperty('--mobile-vh',(v?.height||window.innerHeight)+'px');document.documentElement.style.setProperty('--visual-top',(v?.offsetTop||0)+'px');document.body.classList.toggle('keyboard-open',!!v&&window.innerHeight-v.height>130&&/^(INPUT|TEXTAREA)$/.test(document.activeElement?.tagName||''))}
 window.visualViewport?.addEventListener('resize',viewport);window.visualViewport?.addEventListener('scroll',viewport);window.addEventListener('resize',viewport);document.addEventListener('focusin',viewport);document.addEventListener('focusout',()=>setTimeout(viewport,100));viewport();
 return {update(next){
  state={...next,role:normalizeReadingRole(next.role)};document.body.dataset.reader=state.role==='Medical professional'?'clinical':'general';
  const general=state.responseMode==='general';
  const key=[state.topic,state.role,state.responseMode].join('|');if(key!==identity){identity=key;dictation.stop();reader.stop();if(source.dialog.open)source.dialog.close();}
  nav.replaceChildren();for(const [name,label] of mobileDestinations(state.role)){const item=b('',event=>run(name,event.currentTarget));item.dataset.destination=name;if(name==='home')item.setAttribute('aria-current','page');item.append(icon(name),n('span',label));nav.append(item)}
  tools.replaceChildren();const intro=n('div','','mobile-tools-heading');
  if(general)intro.append(n('h2','Review this answer'));
  else intro.append(n('small',state.role==='Medical professional'?'CLINICAL KNOWLEDGE & EDUCATION':'YOUR RESEARCH COMPANION'),n('h2',state.role==='Medical professional'?'Explore this clinical answer':'Explore this answer'));
  tools.append(intro);
  const shortcuts=n('div','','mobile-shortcuts');
  if(general){
   shortcuts.append(b('Check with Buddy',event=>verify(event.currentTarget)),b('View sources',allSources));
  }
  else if(state.role==='Medical professional'){
   for(const [section,label] of [['evidence','Evidence breakdown'],['limitations','Limitations']]){
    if(reportHeading(section))shortcuts.append(b(label,()=>showReportSection(section)));
   }
   shortcuts.append(b('Ask Buddy',()=>{if(buddy.show())$('question').focus()}));
  }
  else {shortcuts.append(b('Ask Buddy',()=>{buddy.show();$('question').focus()}),b('Explain in simple terms',()=>{if(!buddy.show())return;$('question').value='Explain '+state.topic+' in simple terms using the cited sources.';$('question').focus()}),b('Questions for my doctor',()=>{if(!buddy.show())return;$('question').value='What questions could I discuss with a clinician about '+state.topic+'?';$('question').focus()}))}
  for(const control of shortcuts.children)control.disabled=!state.topic||!state.responses.length;tools.append(shortcuts,live);
  safety.closest('details').hidden=general;
  safety.textContent=general?'':state.role==='General reader'?patientDisclaimer:'Medical knowledge and educational reference. Apply professional judgment, current guidelines and local protocols.';
  greeting.textContent=general?'Ask Buddy to check a claim against the sources, or attach a report for a closer look.':'Ask a follow-up about '+(state.topic||'your topic')+', or explore one area at a time. I’ll use the sources from your research.';
  if(!general)annotateMedicalTerms($('card'));
 }};
}
