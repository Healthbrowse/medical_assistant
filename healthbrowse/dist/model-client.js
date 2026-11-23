import {evidencePacket} from './evidence-packet.js';
import {normalizeReadingRole} from './reading-profiles.js';
import {getAccessToken} from './account-client.js';
function abortable(promise,signal){return new Promise((resolve,reject)=>{const abort=()=>reject(new DOMException('Aborted','AbortError'));if(signal.aborted)return abort();signal.addEventListener('abort',abort,{once:true});promise.then(resolve,reject).finally(()=>signal.removeEventListener('abort',abort))})}
function browserSummary(context,history){
 const summary=[context.answerSummary||'',history.at(-1)?.text||''].filter(Boolean).join(' ').slice(0,850);
 const titles=(context.browserSources||[]).slice(0,5).map(ref=>ref.title).filter(Boolean).join(' | ');
 return [summary,titles].filter(Boolean).join('\n').slice(0,1200);
}
export async function requestSynthesis(context,question,{mode='search',deck=0,history=[],signal,fetcher=fetch,tokenProvider=getAccessToken}={}){
 const controller=new AbortController(),abort=()=>controller.abort();
 if(signal?.aborted)abort();else signal?.addEventListener('abort',abort,{once:true});
 const timer=setTimeout(abort,150000);
 let statusTimer;
 try{
  const route=normalizeReadingRole(context.role)==='Medical professional'?'professional':'general';
  statusTimer=setTimeout(abort,5000);
  const status=await abortable(Promise.resolve().then(()=>fetcher('/api/ai/status',{signal:controller.signal,cache:'no-store'})),controller.signal);
  if(!status.ok)throw Error('AI synthesis is temporarily unavailable.');
  const capabilities=await abortable(status.json(),controller.signal);clearTimeout(statusTimer);
  // Retrieval remains available even if the model is temporarily unconfigured.
  const token=await abortable(Promise.resolve().then(tokenProvider),controller.signal);if(!token)return {status:'unavailable',message:'Sign in to use AI synthesis. Source excerpts are available below.'};
  if(controller.signal.aborted)throw new DOMException('Aborted','AbortError');
  const response=await fetcher('/api/ai/answer',{method:'POST',redirect:'error',signal:controller.signal,cache:'no-store',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
   body:JSON.stringify({topic:context.topic||'Research question',question,searchQuery:context.query||context.topic,role:normalizeReadingRole(context.role),mode,deck,history:history.slice(-4).map(t=>typeof t==='string'?t:t.question),...(mode==='chat'&&context.attachments?.length?{attachments:context.attachments}:{}),...(mode==='chat'?{browserContext:browserSummary(context,history)}:{})})});
  const data=await response.json();
  if(data.status==='clarification'&&data.clarification)return data;
  if(['blocked','platform'].includes(data.status)&&data.answer)return {...data,decks:[]};
  const retryable=['provider_busy','rate_limited','evidence_unavailable'].includes(data.code);
  const delay=Number.isFinite(data.retryAfterSeconds)&&data.retryAfterSeconds>=0&&data.retryAfterSeconds<=604800?data.retryAfterSeconds:null;
  const retry=retryable?{retryAt:delay===null?null:Date.now()+delay*1000}:{};
  if(!response.ok||data.status==='unavailable'){
   const packet=evidencePacket(data.retrieval?.evidencePacket);
   return {status:'unavailable',message:data.error||'AI synthesis could not finish. Source excerpts are shown below.',code:data.code,...retry,...(packet?{retrieval:{evidencePacket:packet}}:{})};
  }
  if(!['generated','sourced'].includes(data.status)||!data.answer||typeof data.answer!=='object'||Array.isArray(data.answer))throw Error('Invalid AI response');
  // Full reports have a version-independent shape. Browser and focused chat
  // replies never inherit cards from an older server.
  const decks=data.decks;
  const fullReport=mode==='chat' && deck===0 && !context.attachments?.length &&
    Array.isArray(decks) && decks.length===6 && decks.every((entry,i)=>
      entry?.deck===i+1 && typeof entry.title==='string' && entry.title.trim() && Array.isArray(entry.blocks));
  return {...data,decks:fullReport?decks:[],...retry};
 }catch(error){if(signal?.aborted)throw error;return {status:'unavailable',message:'AI synthesis could not finish. Source excerpts are shown below.'}}
 finally{clearTimeout(timer);clearTimeout(statusTimer);signal?.removeEventListener('abort',abort)}
}
export const synthesisKey=c=>JSON.stringify([c?.topic,c?.role,c?.query,...(c?.attachmentVersion?[c.attachmentVersion]:[])]);

export async function requestLiteratureEvidence(context,{signal,tokenProvider=getAccessToken,fetcher=fetch}={}){
 if(context.responseMode!=='medical'||context.attachments?.length||!context.query?.trim())
  throw new Error('Choose a medical research question to retrieve its evidence.');
 const deadline=AbortSignal.timeout(90000);
 const bounded=signal?AbortSignal.any([signal,deadline]):deadline;
 const token=await abortable(Promise.resolve().then(tokenProvider),bounded);
 if(!token)throw new Error('Sign in to retrieve the literature evidence.');
 bounded.throwIfAborted();
 const res=await fetcher('/api/ai/evidence',{method:'POST',cache:'no-store',redirect:'error',signal:bounded,
  headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
  body:JSON.stringify({topic:context.topic,question:context.query,role:normalizeReadingRole(context.role),mode:'search',deck:0})});
 const data=await res.json();
 if(!res.ok)throw new Error(res.status===401?'Sign in to retrieve the literature evidence.':data.error||'The evidence service could not complete this request.');
 const packet=evidencePacket(data);
 if(!packet)throw new Error('The evidence service returned an incomplete packet.');
 return packet;
}
