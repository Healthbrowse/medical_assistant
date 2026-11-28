import {evidencePacket} from './evidence-packet.js';
import {normalizeReadingRole} from './reading-profiles.js';
import {getAccessToken} from './account-client.js';
import {abortable} from './request-deadline.js';
function browserSummary(context,history){
 const summary=[context.answerSummary||'',history.at(-1)?.text||''].filter(Boolean).join(' ').slice(0,850);
 const titles=(context.browserSources||[]).slice(0,5).map(ref=>ref.title).filter(Boolean).join(' | ');
 return [summary,titles].filter(Boolean).join('\n').slice(0,1200);
}
function describeFallback(detail){
 if(!detail?.primaryModel || !detail.fallbackModel)return '';
 const primary=detail.primaryModel.split('/').pop(), backup=detail.fallbackModel.split('/').pop();
 const action=detail.phase==='support_review'?'source review':'answer generation';
 const http={401:'access was rejected',402:'provider credits were unavailable',403:'access was denied',404:'model was unavailable',410:'model was retired',429:'provider rate or usage limit was reached'};
 const reason=detail.reason==='timeout'?'request timed out':detail.reason==='network_error'?'connection failed':
  detail.reason==='provider_output_invalid'?'the response format was invalid':detail.reason==='provider_output_truncated'?'the response was incomplete':
  detail.reason==='primary_unconfigured'?'binding or credentials unavailable':
  (http[detail.httpStatus]||'provider unavailable')+(Number.isInteger(detail.httpStatus)?' (HTTP '+detail.httpStatus+')':'');
 return primary+' — '+reason+'. Switched to '+backup+' for '+action+'.';
}
export async function requestSynthesis(context,question,{mode='search',buddyModel,deck=0,history=[],signal,fetcher=fetch,tokenProvider=getAccessToken}={}){
 const controller=new AbortController(),abort=()=>controller.abort();
 if(signal?.aborted)abort();else signal?.addEventListener('abort',abort,{once:true});
 const timer=setTimeout(abort,mode==='chat'&&!context.attachments?.length?35000:150000);
 let statusTimer;
 try{
  if(mode!=='chat'){
   statusTimer=setTimeout(abort,5000);
   const status=await abortable(Promise.resolve().then(()=>fetcher('/api/ai/status',{signal:controller.signal,cache:'no-store'})),controller.signal);
   if(!status.ok)throw Error('AI synthesis is temporarily unavailable.');
   await abortable(status.json(),controller.signal);clearTimeout(statusTimer);
  }
  // Retrieval remains available even if the model is temporarily unconfigured.
  const token=await abortable(Promise.resolve().then(tokenProvider),controller.signal);if(!token)return {status:'unavailable',message:'Sign in to use AI synthesis. Source excerpts are available below.'};
  if(controller.signal.aborted)throw new DOMException('Aborted','AbortError');
  const response=await abortable(fetcher('/api/ai/answer',{method:'POST',redirect:'error',signal:controller.signal,cache:'no-store',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
   body:JSON.stringify({topic:context.topic||'Research question',question,searchQuery:context.query||context.topic,role:normalizeReadingRole(context.role),mode,deck,history:history.slice(-4).map(t=>typeof t==='string'?t:t.question),...(mode==='chat'&&context.attachments?.length?{attachments:context.attachments}:{}),...(mode==='chat'&&normalizeReadingRole(context.role)==='Medical professional'&&context.clinicalContext?{clinicalContext:context.clinicalContext}:{}),...(mode==='chat'?{buddyModel,browserContext:browserSummary(context,history)}:context.browserModel?{browserModel:context.browserModel}:{})})}),controller.signal);
  const data=await abortable(response.json(),controller.signal);
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
  const routingNotice=describeFallback(data.modelFallback);
  return {...data,answer:routingNotice?{...data.answer,routingNotice}:data.answer,decks:fullReport?decks:[],...retry};
 }catch(error){if(signal?.aborted)throw error;return {status:'unavailable',message:'AI synthesis could not finish. Source excerpts are shown below.'}}
 finally{clearTimeout(timer);clearTimeout(statusTimer);signal?.removeEventListener('abort',abort)}
}
export const synthesisKey=c=>JSON.stringify([c?.topic,c?.role,c?.query,...(c?.browserModel?[{browserModel:c.browserModel}]:[]),...(c?.attachmentVersion?[c.attachmentVersion]:[])]);

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
