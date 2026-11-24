import {actions, planQuestion, pickAction} from './cardio-planner.js';
import {examples, composeResponse} from './cardio-answer.js';
import {reviewSession} from './cardio-assignment.js';
import {loadAssets,load,paintVisual} from './cardio-artifacts.js';
import {screenGeneralQuery} from './response-mode.js';

const $=id=>document.getElementById(id);
function element(tag,text){const e=document.createElement(tag);e.textContent=text;return e}
function link(text,href){const a=element('a',text);a.href=href;a.target='_blank';a.rel='noopener noreferrer';return a}
loadAssets().then(({policy})=>{$('training').textContent=policy.training==='reviewer-rated'?'This candidate uses reviewer feedback.':'This experimental policy uses simulated feedback.'}).catch(e=>{$('message').textContent=e.message});
async function show(parent,q,role,assigned){
  const container=element('div','');parent.replaceChildren(container);
  const {corpus,policy} = await loadAssets();
  const screened=screenGeneralQuery(q);
  if(screened.status!=='ok'){
    container.append(element('p',screened.safety?.text||'This question is outside the scope of the pilot.'));
    return;
  }
  const plan=planQuestion(q,role,corpus);
  const response=composeResponse(q,plan,assigned??pickAction(plan,policy));
  if(response.message)container.append(element('p',response.message));
  if(response.choices){
    container.append(element('h3','Which aspect of the heart do you mean?'));
    for(const prompt of response.choices){
      if(assigned){container.append(element('p',prompt));continue}
      const b=element('button',prompt);b.type='button';
      b.onclick=()=>{$('question').value=prompt;$('search').requestSubmit()};container.append(b);
    }
  }
  for(const {text,ref} of response.blocks){
    const p=element('p',text+' ');p.append(link('Source',ref.url+'#'+ref.sourceParagraph));container.append(p);
  }
  const verified=await paintVisual(container,response,corpus);
  if(!verified&&assigned)throw Error('Image verification failed. Reload this assignment before rating.');
  const unique=new Map(response.blocks.map(b=>[b.ref.sourceParagraph,b.ref]));
  if(unique.size){
    const d=element('details','');d.append(element('summary','Read the evidence'));
    for(const ref of unique.values())d.append(element('blockquote',ref.text),link('Open source passage',ref.url+'#'+ref.sourceParagraph));
    container.append(d);
  }
}
$('search').onsubmit=async event=>{
  event.preventDefault();$('message').textContent='';
  try{await show($('answer'),$('question').value.trim(),$('audience').value)}
  catch(e){$('message').textContent=e.message}
};
const params=new URLSearchParams(location.search);
if(params.get('role')==='Clinicians')$('audience').value='Clinicians';
const example=params.get('example');
if(Object.hasOwn(examples,example)){$('question').value=examples[example];$('search').requestSubmit()}

let session,ratings=[],reviewReady=false,revision=0;
const storageKey=seed=>'hb-cardio-ratings-v1:'+seed;
async function next(){
  const token=++revision;reviewReady=false;
  $('rating').hidden=true;$('export').hidden=!ratings.length;
  if(ratings.length===session.items.length){$('reviewStatus').textContent='Assignment complete. Export your ratings.';return}
  const item=session.items[ratings.length];
  $('rating').reset();$('counter').textContent='Response '+(ratings.length+1)+' of '+session.items.length;
  $('reviewQuestion').textContent=item.role+' · '+item.question;
  await show($('reviewAnswer'),item.question,item.role,item.action);
  if(token!==revision)return;
  $('reviewStatus').textContent='';reviewReady=true;$('rating').hidden=false;
}
const resumeKey='hb-cardio-session-v1';
async function restore(data){
  session=data;ratings=JSON.parse(localStorage.getItem(storageKey(data.seed))||'[]');
  if(!Array.isArray(ratings)||ratings.some((r,i)=>r.id!==data.items[i]?.id))throw Error('Stored session does not match this assignment.');
  localStorage.setItem(resumeKey,JSON.stringify({study:data.study,seed:data.seed}));
  await next();
}
$('begin').onclick=async()=>{
  const button=$('begin');button.disabled=true;
  try{
    const book=await load('cardio-review-cases.json'),{policy} = await loadAssets();
    if(book.study!==policy.study)throw Error('The review materials changed. Reload the page.');
    const saved=JSON.parse(localStorage.getItem(resumeKey)||'null');
    const seed=(saved?.study===book.study)?saved.seed:Array.from(crypto.getRandomValues(new Uint8Array(16)),b=>b.toString(16).padStart(2,'0')).join('');
    await restore(await reviewSession(book,seed));
  }catch(e){$('reviewStatus').textContent=e.message}finally{button.disabled=false}
};
if(localStorage.getItem(resumeKey))$('begin').textContent='Resume review';
$('assignment').onchange=async event=>{
  const token=++revision;reviewReady=false;$('rating').hidden=true;$('export').hidden=true;
  try{
    const file=event.target.files[0];if(!file)return;
    const data=JSON.parse(await file.text()),{policy} = await loadAssets();
    if(token!==revision)return;
    if(data.study!==policy.study||!/^[a-f0-9]{32}$/.test(data.seed)||!Array.isArray(data.items)||!data.items.length||
      data.items.some(i=>typeof i.id!=='string'||typeof i.question!=='string'||!['Clinicians','General'].includes(i.role)||!actions.includes(i.action)))throw Error('Choose an assignment made for this study version.');
    await restore(data);
  }catch(e){$('reviewStatus').textContent=e.message}
};
$('rating').onsubmit=async event=>{
  event.preventDefault();if(!reviewReady)return;reviewReady=false;
  try{
    const item=session.items[ratings.length],form=new FormData($('rating'));
    const row={id:item.id,action:item.action,p:item.p};
    for(const k of ['support','relevance','agreement'])row[k]=Number(form.get(k));
    const updated=[...ratings,row];
    localStorage.setItem(storageKey(session.seed),JSON.stringify(updated));ratings=updated;
    await next();
  }catch(e){$('reviewStatus').textContent=e.message}
};
$('export').onclick=()=>{
  const data={study:session.study,seed:session.seed,ratings};
  const url=URL.createObjectURL(new Blob([JSON.stringify(data)],{type:'application/json'}));
  const a=document.createElement('a');a.href=url;a.download='cardio-ratings-'+session.seed+'.json';a.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
};
