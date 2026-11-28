import test from 'node:test';
import assert from 'node:assert/strict';
import {setupBuddyLayout,resizeBuddyInput} from '../dist/buddy-layout.js';
import {setupBuddy} from '../dist/buddy.js';
import {createDictation} from '../dist/mobile-voice.js';
import {buddyModelNames} from '../server/public-config.mjs';

test('the message input grows, stays bounded for long questions and shrinks after sending',()=>{
 const input={style:{},scrollHeight:96};resizeBuddyInput(input);assert.equal(input.style.height,'96px');
 input.scrollHeight=220;resizeBuddyInput(input);assert.equal(input.style.height,'144px');assert.equal(input.style.overflowY,'auto');
 input.scrollHeight=24;resizeBuddyInput(input);assert.equal(input.style.height,'48px');assert.equal(input.style.overflowY,'hidden');
});
test('voice state restores the compact controls on completion, explicit stop and startup failure',()=>{
 const states=[],records=[];class Recognition{constructor(){records.push(this)}start(){}abort(){}}
 const api=createDictation({Recognition,onText(){},onStatus(){},onState:s=>states.push(s),schedule:()=>1,unschedule(){}});
 api.start();records[0].onend();api.start();api.stop();records[1].onend();
 assert.deepEqual(states,[true,false,true,false]);
 createDictation({Recognition:class{start(){throw new Error('Denied')}},onText(){},onStatus(){},onState:s=>states.push(s)}).start();assert.equal(states.at(-1),false);
});

// Small DOM fixture exercises node moves and navigation without making provider requests.
class Element{
 constructor(tag){this.tagName=tag;this.children=[];this.listeners={};this.style={};this.attrs={};this.hidden=false;this.scrollHeight=48;this.className='';}
 setAttribute(k,v){this.attrs[k]=v} getAttribute(k){return this.attrs[k]}
 matches(s){return s.startsWith('#')?this.id===s.slice(1):s.startsWith('.')?this.className.split(' ').includes(s.slice(1)):this.tagName===s}
 all(){return this.children.flatMap(c=>[c,...c.all()])} querySelector(s){return this.all().find(c=>c.matches(s))||null}
 append(...nodes){for(const n of nodes){assert.ok(n,'Missing existing control');n.remove();n.parent=this;this.children.push(n)}}
 prepend(...nodes){for(const n of nodes.reverse()){n.remove();n.parent=this;this.children.unshift(n)}}
 after(n){n.remove();n.parent=this.parent;this.parent.children.splice(this.parent.children.indexOf(this)+1,0,n)}
 insertBefore(n,b){n.remove();n.parent=this;this.children.splice(this.children.indexOf(b),0,n)}
 remove(){if(this.parent){this.parent.children.splice(this.parent.children.indexOf(this),1);this.parent=null}}
 focus(){this.focused=true} addEventListener(k,f){(this.listeners[k]??=[]).push(f)}
 dispatchEvent(e){for(const fn of this.listeners[e.type]||[])fn(e);return !e.defaultPrevented}
}
function fixture(t){
 const document=new Element('document');document.createElement=tag=>new Element(tag);document.createElementNS=(_,tag)=>new Element(tag);document.getElementById=id=>document.querySelector('#'+id);
 const prior={document:globalThis.document,window:globalThis.window};globalThis.document=document;globalThis.window=new Element('window');t.after(()=>{for(const [k,v] of Object.entries(prior))if(v===undefined)delete globalThis[k];else globalThis[k]=v});
 const add=(parent,tag,id='',className='')=>{const n=Object.assign(new Element(tag),{id,className});parent.append(n);return n};
 const dialog=add(document,'dialog','buddyDialog');dialog.open=true;const panel=add(dialog,'section','copilot'),head=add(panel,'header','','copilot-head');
 add(head,'div','','eyebrow');add(head,'h2','copilot-heading');add(head,'button','buddyClose');add(head,'p','copilotScope');
 const inner=add(panel,'div','','copilot-inner');for(const id of ['buddyWelcome','buddyQuestions'])add(inner,'div',id);
 const toolbar=add(inner,'div','','chat-toolbar');add(toolbar,'strong','chatTitle');const newChat=add(toolbar,'button','newChat');
 add(inner,'details','chatHistoryPanel');add(inner,'p','chatSaveStatus');add(inner,'p','copilotHint');add(inner,'div','thread');
 const form=add(inner,'form','ask');add(form,'label');add(form,'textarea','question');add(form,'button');add(inner,'button','buddyStop');add(inner,'details','buddyResearch');add(inner,'div','','copilot-actions');
 return {document,dialog,panel,inner,form,newChat};
}
test('Buddy preserves existing form and new-chat controls when moving tools out of the conversation',t=>{
 const f=fixture(t);const layout=setupBuddyLayout();assert.equal(f.document.getElementById('ask'),f.form);assert.equal(f.document.getElementById('newChat'),f.newChat);
 assert.equal(f.newChat.parent.className,'buddy-toolbar');assert.equal(f.form.parent,layout.composer);assert.equal(f.inner.querySelector('#chatHistoryPanel'),null);
 const toolbar=f.panel.querySelector('.buddy-toolbar'),explore=toolbar.children[0],history=toolbar.children[1];
 history.onclick();assert.equal(f.inner.hidden,true);assert.equal(layout.composer.hidden,true);assert.equal(history.getAttribute('aria-expanded'),'true');
 const cancel={type:'cancel',preventDefault(){this.defaultPrevented=true}};f.dialog.dispatchEvent(cancel);assert.equal(cancel.defaultPrevented,true);assert.equal(f.inner.hidden,false);assert.equal(layout.composer.hidden,false);assert.equal(history.focused,true);
 explore.onclick();f.dialog.dispatchEvent({type:'close'});assert.equal(f.inner.hidden,false);assert.equal(explore.getAttribute('aria-expanded'),'false');
 f.document.dispatchEvent({type:'healthbrowse-chat-updated',detail:{count:1}});assert.equal(f.inner.querySelector('.buddy-empty').hidden,true);
 f.document.dispatchEvent({type:'healthbrowse-chat-updated',detail:{count:0}});assert.equal(f.inner.querySelector('.buddy-empty').hidden,false);
});

test('closing Buddy restores its visible opener and falls back when the rail is hidden or removed',async t=>{
 const {document,dialog}=fixture(t),focus=[];
 const add=(parent,tag,id)=>{const node=Object.assign(new Element(tag),{id});parent.append(node);return node};
 const classes=()=>{const values=new Set();return {add:value=>values.add(value),remove:value=>values.delete(value)}};
 document.body=document;document.classList=classes();
 const launcher=add(document,'button','buddyLauncher');launcher.classList=classes();launcher.focus=options=>focus.push({id:launcher.id,options});
 const rail=add(document,'aside','researchRail'),opener=add(rail,'button','railBuddy');
 Object.defineProperty(opener,'isConnected',{get:()=>document.all().includes(opener)});
 opener.getClientRects=()=>rail.hidden?[]:[{width:120,height:44}];
 opener.focus=options=>focus.push({id:opener.id,options});
 const welcome=add(document,'aside','buddyNudge');
 for(const id of ['buddyMeet','buddyDismiss','buddyLater'])add(welcome,'button',id);
 const close=document.getElementById('buddyClose');close.before=node=>close.parent.insertBefore(node,close);
 dialog.open=false;dialog.showModal=()=>{dialog.open=true};dialog.close=()=>{dialog.open=false;dialog.dispatchEvent(new Event('close'))};
 const priorLocation=globalThis.location;globalThis.location={origin:'https://example.test'};
 t.after(()=>{if(priorLocation===undefined)delete globalThis.location;else globalThis.location=priorLocation});
 // Welcome tracking has no account service in this DOM-only regression.
 t.mock.method(globalThis,'fetch',async()=>new Response(null,{status:503}));
 const buddy=setupBuddy(()=>null);

 buddy.show(opener);assert.equal(launcher.getAttribute('aria-expanded'),'true');buddy.close();
 assert.deepEqual(focus.pop(),{id:'railBuddy',options:{preventScroll:true}});
 buddy.show(opener);rail.hidden=true;buddy.close();
 assert.deepEqual(focus.pop(),{id:'buddyLauncher',options:{preventScroll:true}});
 rail.hidden=false;buddy.show(opener);opener.remove();buddy.close();
 assert.deepEqual(focus.pop(),{id:'buddyLauncher',options:{preventScroll:true}});
 assert.equal(launcher.getAttribute('aria-expanded'),'false');
 await new Promise(resolve=>setImmediate(resolve));
});

test('the picker shows the role-specific model ID and keeps the selected provider on role changes',t=>{
 const {form}=fixture(t);
 const names={general:'deepseek-ai/DeepSeek-R1-Distill-Llama-8B',professional:'deepseek-ai/DeepSeek-R1-Distill-Qwen-14B',groq:'openai/gpt-oss-120b'};
 const layout=setupBuddyLayout(names),select=form.querySelector('#buddyModel'),label=select.parent.querySelector('span');
 assert.deepEqual(select.children.map(option=>[option.value,option.textContent]),[['deepseek',names.general],['groq',names.groq]]);
 assert.equal(label.textContent,names.general);
 layout.setModelRole('Medical professional');
 assert.equal(label.textContent,names.professional);
 select.value='groq';select.dispatchEvent({type:'change'});
 layout.setModelRole('General reader');
 assert.equal(select.value,'groq');assert.equal(label.textContent,names.groq);
 assert.equal(select.children[0].textContent,names.general);assert.equal(select.title,names.groq);
});

test('Workers AI picker follows the reading role and retains an explicit DeepSeek selection',t=>{
 const {form}=fixture(t);
 const names={general:'DeepSeek 8B',professional:'DeepSeek 32B',groq:'GPT-OSS',preferred:'workers-ai',workers:{general:'@cf/google/gemma-4-26b-a4b-it',professional:'@cf/qwen/qwen3.8-27b'}};
 const layout=setupBuddyLayout(names),select=form.querySelector('#buddyModel');
 assert.deepEqual(select.children.map(option=>option.value),['workers-ai','deepseek','groq']);
 assert.equal(select.value,'workers-ai');assert.equal(select.title,names.workers.general);
 layout.setModelRole('Medical professional');assert.equal(select.title,names.workers.professional);
 select.value='deepseek';select.dispatchEvent({type:'change'});
 layout.setModelRole('General reader');assert.equal(select.title,names.general);
});

test('Sarvam picker names the actual served checkpoint and preserves an explicit provider choice',t=>{
 const {form}=fixture(t),model='deepseekv4.1-flash-1017';
 const names={general:'DeepSeek R1 8B',professional:'DeepSeek R1 32B',groq:'GPT-OSS',preferred:'sarvam',sarvam:{general:model,professional:model}};
 const layout=setupBuddyLayout(names),select=form.querySelector('#buddyModel');
 assert.deepEqual(select.children.map(option=>option.value),['sarvam','deepseek','groq']);
 assert.equal(select.value,'sarvam');assert.equal(select.title,model+' · Sarvam');
 layout.setModelRole('Medical professional');assert.equal(select.title,model+' · Sarvam');
 select.value='deepseek';select.dispatchEvent({type:'change'});
 assert.equal(select.title,names.professional);
 layout.setModelRole('General reader');assert.equal(select.value,'deepseek');assert.equal(select.title,names.general);
});

test('a Groq-only deployment selects its configured checkpoint without phantom DeepSeek choices',t=>{
 const {form}=fixture(t),model='openai/gpt-oss-20b';
 const names=buddyModelNames({MODEL_PROVIDER:'groq',GROQ_API_KEY:'test-key',GROQ_MODEL:model});
 const layout=setupBuddyLayout(names),select=form.querySelector('#buddyModel');
 assert.deepEqual(select.children.map(option=>[option.value,option.textContent]),[['groq',model]]);
 assert.equal(select.value,'groq');assert.equal(select.disabled,false);
 layout.setModelRole('Medical professional');
 assert.equal(select.value,'groq');assert.equal(select.title,model);
});

test('a role change removes unavailable choices and selects a configured alternative',t=>{
 const {form}=fixture(t);
 const names=buddyModelNames({MODEL_PROVIDER:'deepseek',HF_TOKEN:'test-hf-key',GROQ_API_KEY:'test-groq-key',DEEPSEEK_CLINICIAN_MODEL:'invalid-checkpoint'});
 const layout=setupBuddyLayout(names),select=form.querySelector('#buddyModel');
 assert.equal(select.value,'deepseek');
 layout.setModelRole('Medical professional');
 assert.deepEqual(select.children.map(option=>option.value),['groq']);
 assert.equal(select.value,'groq');assert.equal(select.title,names.groq);
 layout.setModelRole('General reader');
 assert.deepEqual(select.children.map(option=>option.value),['deepseek','groq']);
 assert.equal(select.value,'groq','Keep a provider that remains available after a role change');
});

test('the picker handles a missing binding or empty catalog without inventing model availability',t=>{
 const {form}=fixture(t);
 const layout=setupBuddyLayout(buddyModelNames({MODEL_PROVIDER:'workers-ai'})),select=form.querySelector('#buddyModel');
 assert.equal(select.disabled,true);assert.equal(select.value,'');
 assert.deepEqual(select.children.map(option=>option.textContent),['No model configured']);
 layout.setModelRole('Medical professional');
 assert.equal(select.disabled,true);assert.equal(select.children.length,1);
 assert.equal(select.title,'No model configured');
});

test('Enter submits the Buddy form once and leaves Shift+Enter and composition to the textarea',t=>{
 const {document,form}=fixture(t);
 setupBuddyLayout();
 const textarea=document.getElementById('question');
 assert.equal(textarea.getAttribute('enterkeyhint'),'send');
 let sends=0;
 form.requestSubmit=()=>{sends++};
 function press(key,modifiers={}){
  const event={type:'keydown',key,...modifiers,defaultPrevented:false,preventDefault(){this.defaultPrevented=true}};
  textarea.dispatchEvent(event);
  return event.defaultPrevented;
 }
 assert.equal(press('Enter',{shiftKey:true}),false);
 assert.equal(press('Enter',{isComposing:true}),false);
 assert.equal(press('Enter',{keyCode:229}),false);
 assert.equal(press('Tab'),false);
 assert.equal(sends,0);
 assert.equal(press('Enter'),true);
 assert.equal(press('Enter',{repeat:true}),true);
 assert.equal(sends,1);
});
