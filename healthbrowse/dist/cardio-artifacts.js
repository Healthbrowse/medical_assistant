import {prepareCorpus} from './cardio-planner.js';
export {visualForAnswer} from './cardio-answer.js';
import {renderBloodFlow} from './cited-diagram.js';

export async function load(name){
  const r=await fetch('/'+name);
  if(!r.ok)throw Error('The research assets could not be loaded. Reload to try again.');
  return r.json();
}
let pending;
export function loadAssets(){
  pending ??= Promise.all(['education-sources.json','education-figures.json','cardio-figure-index.json','cardio-policy.json'].map(load))
  .then(([sources,figures,index,policy])=>({corpus:prepareCorpus(sources,figures,index),policy})).catch(e=>{pending=undefined;throw e});
  return pending;
}
const imageURLs=new Map();
async function verifiedImage(id,expected){
  if(!imageURLs.has(id)){
    const pending=(async()=>{
      const response=await fetch('/'+id+'.jpg');
      if(!response.ok)throw Error('Missing illustration');
      const bytes=await response.arrayBuffer();
      const hash=new Uint8Array(await crypto.subtle.digest('SHA-256',bytes));
      if(Array.from(hash,b=>b.toString(16).padStart(2,'0')).join('')!==expected)throw Error('Image revision mismatch');
      // A verified data URL also works under the Worker's production image CSP.
      return new Promise((resolve,reject)=>{
        const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;
        reader.readAsDataURL(new Blob([bytes],{type:'image/jpeg'}));
      });
    })();
    imageURLs.set(id,pending);
    pending.catch(()=>imageURLs.delete(id));
  }
  return imageURLs.get(id);
}
function element(tag,text){const e=document.createElement(tag);e.textContent=text;return e}
function link(text,href){const a=element('a',text);a.href=href;a.target='_blank';a.rel='noopener noreferrer';return a}

export async function paintVisual(container,response,corpus){
  if(response.edges?.length)renderBloodFlow(container,response.edges);
  if(response.figure){
    const f=response.figure;
    const figure=element('figure',''),caption=element('figcaption',f.caption+' ');
    caption.append(link('OpenStax · '+f.title,f.sourceUrl),' · ',link(f.license,f.licenseUrl));
    try{
      const url=await verifiedImage(f.id,corpus.index.sha256[f.id]);
      const img=element('img','');img.alt=f.alt;img.src=url;
      figure.append(img,caption);container.append(figure);
    }catch{
      container.append(element('p','The illustration could not be verified. The cited text is available.'));
      return false;
    }
  }
  return true;
}
