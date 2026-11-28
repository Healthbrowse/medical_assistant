// Presentation only: existing chat, source verification and account handlers retain ownership.
const el=(tag,text='',className='')=>Object.assign(document.createElement(tag),{textContent:text,className});
const $=id=>document.getElementById(id);
const paths = {
 send: 'M12 20V4m-7 7 7-7 7 7',
 add: 'M12 5v14M5 12h14',
 explore: 'M21 12a9 9 0 1 1-18 0 9 9 0 1 1 18 0ZM16 8l-2.6 5.4L8 16l2.6-5.4Z',
 history: 'M3.6 10A8.5 8.5 0 1 1 5 17.3M3 4.5V10h5.5M12 7.5v5l3.3 2',
 compose: 'M12 4.5H6a2.5 2.5 0 0 0-2.5 2.5v11A2.5 2.5 0 0 0 6 20.5h11a2.5 2.5 0 0 0 2.5-2.5v-6M19.9 4.1a1.9 1.9 0 0 0-2.7 0l-7.7 7.7-.8 3.5 3.5-.8 7.7-7.7a1.9 1.9 0 0 0 0-2.7Z',
 more: 'M6 12h.01M12 12h.01M18 12h.01',
 shield: 'M12 2.8c2.9 2 5.7 2.8 8 3.3v5.5c0 4.3-3 7.8-8 10-5-2.2-8-5.7-8-10V6.1c2.3-.5 5.1-1.3 8-3.3ZM8.8 12l2.2 2.2 4.3-4.5',
 maximize: 'M8 4H4v4m12-4h4v4M4 16v4h4m12-4v4h-4',
 restore: 'M8 7V5a1.5 1.5 0 0 1 1.5-1.5h9A1.5 1.5 0 0 1 20 5v9a1.5 1.5 0 0 1-1.5 1.5h-2M5.5 8.5h9A1.5 1.5 0 0 1 16 10v9a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 4 19v-9a1.5 1.5 0 0 1 1.5-1.5Z',
 close: 'M6.5 6.5l11 11m0-11-11 11',
 resize: 'M5 12v7h7m-7 0L18 6',
 back: 'M19 12H5m6-6-6 6 6 6',
 voice: 'M9 5a3 3 0 0 1 6 0v7a3 3 0 0 1-6 0zM5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8'
};
export function buddyIcon(name){
 const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
 svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('aria-hidden','true');svg.setAttribute('focusable','false');
 const path=document.createElementNS(svg.namespaceURI,'path');
 path.setAttribute('d',paths[name]||paths.more);if(name==='more')path.setAttribute('stroke-width','3.4');
 svg.append(path);return svg;
}
export function setBuddyIcon(control,icon,label){
 control.textContent='';control.append(buddyIcon(icon));
 control.setAttribute('aria-label',label);control.title=label;
}
function shouldSendBuddyKey(event){
 return event.key==='Enter' && !event.shiftKey && !event.isComposing && event.keyCode!==229;
}
export function resizeBuddyInput(input){input.style.height='auto';input.style.height=Math.max(48,Math.min(144,input.scrollHeight||48))+'px';input.style.overflowY=input.scrollHeight>144?'auto':'hidden'}
export function setupBuddyLayout(modelNames){
 const dialog=$('buddyDialog'),panel=$('copilot'),inner=panel.querySelector('.copilot-inner'),head=panel.querySelector('.copilot-head');
 const avatar=Object.assign(el('img','','buddy-header-avatar'),{src:'/buddy-avatar.svg',alt:'',width:42,height:42});
 const identity=el('div','','buddy-identity');identity.append(head.querySelector('.eyebrow'),$('copilot-heading'),$('copilotScope'));head.prepend(avatar,identity);$('copilot-heading').textContent='Buddy';
 const safety=el('p','','buddy-safety-copy'),notice=el('details','','buddy-pinned-notice'),summary=el('summary');
 setBuddyIcon(summary,'shield','Read educational safety note');notice.append(summary,safety);
 const toolbar=el('nav','','buddy-toolbar');toolbar.setAttribute('aria-label','Buddy tools');
 const windowActions=el('div','','buddy-window-actions');
 windowActions.append(notice);
 const toggle=head.querySelector('.buddy-window-toggle');if(toggle)windowActions.append(toggle);
 windowActions.append($('buddyClose'));head.append(toolbar,windowActions);
 const aux=el('section','','buddy-tool-view');aux.hidden=true;aux.id='buddyTools';aux.setAttribute('aria-labelledby','buddyToolTitle');inner.after(aux);
 const back=el('button','','buddy-back');back.type='button';setBuddyIcon(back,'back','Back to chat');const title=el('h3');title.id='buddyToolTitle';title.tabIndex=-1;aux.append(back,title);
 const newChat=$('newChat');
 const panes={explore:el('div'),history:el('div'),more:el('div')};Object.values(panes).forEach(p=>{p.hidden=true;aux.append(p)});
 panes.explore.append($('buddyWelcome'),$('buddyQuestions'));
 panes.history.append($('chatTitle'),$('chatHistoryPanel'),$('chatSaveStatus'));$('chatHistoryPanel').open=true;
 panes.more.append($('buddyResearch'),panel.querySelector('.copilot-actions'));
 inner.querySelector('.chat-toolbar')?.remove();
 const composer=el('div','','buddy-composer'),voiceTools=el('div','','buddy-voice-tools'),consent=el('div','','voice-consent');consent.hidden=true;
 const form=$('ask'),input=$('question'),send=form.querySelector('button');send.type='submit';send.setAttribute('aria-label','Send question');send.title='Send question';send.textContent='';send.append(buddyIcon('send'));
 input.rows=1;input.placeholder='Ask Buddy a follow-up…';input.setAttribute('aria-label','Message Buddy');input.setAttribute('enterkeyhint','send');
 input.addEventListener('keydown',event=>{
  if(!shouldSendBuddyKey(event))return;
  event.preventDefault();
  if(!event.repeat)form.requestSubmit();
 });
 const footer=el('div','','buddy-composer-footer'),hint=el('span','Enter to send · Shift + Enter for a new line','buddy-key-hint');footer.append(hint);
 const actions=el('div','','buddy-composer-actions');
 const picker=el('div','','buddy-model-picker'),shown=el('span');
 shown.setAttribute('aria-hidden','true');
 const model=el('select');model.id='buddyModel';model.setAttribute('aria-label','Buddy model');
 let options=[];
 function showSelection(){
  shown.textContent=options.find(option=>option.value===model.value)?.textContent||'No model configured';
  model.title=shown.textContent;
 }
 function setModelRole(role){
  const route=role==='Medical professional'?'professional':'general';
  const selected=model.value;
  for(const option of options)option.remove();
  options=[
   ['sarvam',modelNames?.sarvam?.[route]],
   ['workers-ai',modelNames?.workers?.[route]],
   ['deepseek',modelNames?.[route]],
   ['groq',modelNames?.groq]
  ].filter(([,id])=>typeof id==='string'&&id.trim()).map(([value,id])=>{
   const option=el('option',id+(value==='sarvam'?' · Sarvam':''));option.value=value;return option;
  });
  model.disabled=!options.length;
  if(!options.length){const option=el('option','No model configured');option.value='';options=[option];}
  model.append(...options);
  model.value=options.some(option=>option.value===selected)?selected:
   options.some(option=>option.value===modelNames?.preferred)?modelNames.preferred:options[0].value;
  showSelection();
 }
 setModelRole('General reader');
 model.addEventListener('change',showSelection);
 picker.append(shown,model);
 actions.append(picker,voiceTools,send);form.append(actions);
 const progress=el('div','','buddy-progress');progress.append($('copilotHint'),$('buddyStop'));
 composer.append(consent,progress,form,footer);panel.append(composer);
 const greeting=el('section','','buddy-empty');const greetingTitle=el('h3','A little clarity, one question at a time.');greeting.append(Object.assign(el('img'),{src:'/buddy-avatar.svg',alt:'',width:64,height:64}),greetingTitle);
 const greetingText=el('p');greeting.append(greetingText);inner.prepend(greeting);
 let active='',opener;
 const buttons={};
 function showChat({focus=true}={}){const previous=opener;active='';aux.hidden=true;inner.hidden=false;composer.hidden=false;for(const button of Object.values(buttons))button.setAttribute('aria-expanded','false');resizeBuddyInput(input);if(focus&&dialog.open)previous?.focus({preventScroll:true})}
 function showTool(name,button){notice.open=false;if(active===name){showChat();return}active=name;opener=button;inner.hidden=true;composer.hidden=true;aux.hidden=false;for(const [key,pane] of Object.entries(panes))pane.hidden=key!==name;for(const [key,item] of Object.entries(buttons))item.setAttribute('aria-expanded',String(key===name));title.textContent={explore:'Explore this topic',history:'Your conversations',more:'Research & chat tools'}[name];if(name==='history'){$('chatHistoryPanel').open=false;$('chatHistoryPanel').open=true}title.focus({preventScroll:true});aux.scrollTop=0;}
 for(const [name,label] of [['explore','Explore'],['history','History'],['more','More']]){const button=el('button');button.type='button';setBuddyIcon(button,name,label);button.setAttribute('aria-controls',aux.id);button.setAttribute('aria-expanded','false');button.onclick=()=>showTool(name,button);buttons[name]=button;toolbar.append(button)}
 setBuddyIcon(newChat,'compose','New chat');toolbar.insertBefore(newChat,buttons.more);newChat.addEventListener('click',()=>{showChat({focus:false});input.focus()});
 const explore=el('button','Explore this topic','buddy-empty-action');explore.type='button';explore.onclick=()=>showTool('explore',buttons.explore);greeting.append(explore);
 back.onclick=()=>showChat();panes.explore.addEventListener('click',event=>{if(event.target.closest('#buddyQuestions button')){showChat({focus:false});$('copilot-heading').focus({preventScroll:true})}},true);
 document.addEventListener('healthbrowse-chat-restored',()=>showChat());
 dialog.addEventListener('cancel',event=>{if(notice.open){event.preventDefault();notice.open=false;summary.focus();return}if(active){event.preventDefault();showChat()}});
 dialog.addEventListener('close',()=>{showChat({focus:false});notice.open=false});
 dialog.addEventListener('buddy-opened',()=>resizeBuddyInput(input));
 dialog.addEventListener('buddy-return-to-chat',()=>showChat({focus:false}));
 dialog.addEventListener('buddy-verification',()=>showChat({focus:false}));
 input.addEventListener('input',()=>resizeBuddyInput(input));window.addEventListener('resize',()=>resizeBuddyInput(input));
 document.addEventListener('healthbrowse-chat-updated',event=>{greeting.hidden=event.detail.count>0;resizeBuddyInput(input)});
 return {composer,voiceTools,consent,safety,greeting:greetingText,more:panes.more,showChat,setModelRole};
}
