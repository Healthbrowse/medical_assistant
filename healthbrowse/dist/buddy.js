// Every reading mode uses the same user-opened, keyboard-accessible buddy.
import {setupBuddyWindow} from './buddy-window.js';
import {accountRequest} from './account-client.js';
import {createBuddyWelcome,createWelcomeTone} from './buddy-welcome.js';
export function setupBuddy(getContext){
 const $=id=>document.getElementById(id),dialog=$('buddyDialog'),launcher=$('buddyLauncher'),panel=$('copilot');
 let returnFocus=launcher;
 const welcome=$('buddyNudge'),sound=createWelcomeTone();
 const intro=createBuddyWelcome({
  claim:()=>accountRequest('/api/me/buddy-intro',{method:'POST',body:{}}),
  canShow:()=>document.visibilityState==='visible'&&!document.querySelector('dialog[open]'),
  onShow:()=>{welcome.hidden=false;launcher.classList.add('has-welcome')},
  onHide:()=>{welcome.hidden=true;launcher.classList.remove('has-welcome')},sound
 });
 document.addEventListener('research-ready',()=>{intro.arm();void intro.sync()});
 document.addEventListener('visibilitychange',()=>void intro.sync());
 window.addEventListener('pagehide',()=>intro.dismiss(),{once:true});
 dialog.append(panel);setupBuddyWindow(dialog,$('buddyClose'));document.body.classList.add('buddy-enabled');
 function close(){if(dialog.open)dialog.close()}
 function show(from=launcher){
  if(dialog.open)return true;intro.used();returnFocus=from;dialog.showModal();launcher.setAttribute('aria-expanded','true');document.body.classList.add('buddy-open');$('copilot-heading').focus();dialog.dispatchEvent(new Event('buddy-opened'));return true;
 }
 $('buddyMeet').onclick=()=>show(launcher);
 $('buddyDismiss').onclick=$('buddyLater').onclick=()=>{intro.dismiss();launcher.focus({preventScroll:true})};
 welcome.addEventListener('keydown',event=>{if(event.key==='Escape'){intro.dismiss();launcher.focus({preventScroll:true})}});
 launcher.onclick=()=>show();$('buddyClose').onclick=close;
 dialog.addEventListener('close',()=>{launcher.setAttribute('aria-expanded','false');document.body.classList.remove('buddy-open');(returnFocus?.isConnected?returnFocus:launcher).focus({preventScroll:true})});
 dialog.addEventListener('click',event=>{if(event.target===dialog){const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)close()}});
 return {show,close,sync(_mode,ready){
  launcher.disabled=false;launcher.hidden=false;$('buddyClose').hidden=false;panel.hidden=false;
  const context=getContext();
  launcher.setAttribute('aria-label',ready&&context?.topic?'Open Buddy for '+context.topic:'Open Buddy to ask a question or attach a document');

  void intro.sync();
 }};
}
