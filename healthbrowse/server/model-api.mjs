import {withModelFallback} from './model-failover.mjs';
import {educationalVisual} from './education-visuals.mjs';
import {learningDecks} from './learning-decks.mjs';
import {isBuddyOverview,buddyOverviewDecks} from './buddy-decks.mjs';
import {buddyDeckIntent} from '../dist/buddy-deck-intent.js';
import {educationEvidence,addEducation} from './education-evidence.mjs';
import {clarifyQuery} from '../dist/query-understanding.js';
import {retrieveEvidence,medicalTopicIndex,retrieveLiteraturePacket} from './live-evidence.mjs';
import {classifyResponseMode} from '../dist/response-mode.js';
import {outsideMedicalScope,scopeAnswer,insufficientClinicalContext,medicalPersona} from '../dist/medical-contract.js';
import {assessSafety,safetyAnswer,safetyPolicyVersion,securityFlagFor} from '../dist/safety-policy.js';
import {securityVariants,assessBuddySafety,buddySafetyAnswer,buddyHelpAnswer,buddyPolicyVersion} from '../dist/buddy-policy.js';
import {citedEvidence,prepareCited,presentCited,prepareCitedReview,applyCitedReview} from './model-cited.mjs';
import {isReadingRole,normalizeReadingRole} from '../dist/reading-profiles.js';
import {inspectQuery} from '../dist/clinical-engine.js';
import {evidenceFor,generationMessages,validateDraft,reviewMessages,reviewPasses,presentDraft} from './model-evidence.mjs';
import {modelEndpoint as endpoint,modelReviewEndpoint,usesCitedProtocol,buddyEndpoint,fallbackEndpoint,deepseekModelId,GROQ_MODEL} from './model-provider.mjs';
import {deepseekPayload,readDeepSeekResult as readStructuredResult} from './deepseek-client.mjs';
import {compactGeneration,compactReviews,ContextLimit} from './model-context.mjs';
import {documentEvidence} from './document-evidence.mjs';
import {validateDocuments} from '../dist/document-policy.js';
import {groundedEvidence,prepareGrounded,decodeGrounded,groundedReview,groundedReviewPasses,presentGrounded} from './model-grounded.mjs';
const headers={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};
const reply=(body,status=200)=>Response.json(body,{status,headers:{...headers,...(body.retryAfterSeconds!==undefined?{'Retry-After':String(body.retryAfterSeconds)}:{})}});
class Failure extends Error{constructor(status,code,message,retryAfterSeconds){super(message);this.status=status;this.code=code;this.retryAfterSeconds=retryAfterSeconds}}
const fail=(status,code,message,retryAfterSeconds)=>{throw new Failure(status,code,message,retryAfterSeconds)};
export function retryDelay(value,now=Date.now()){
 if(typeof value!=='string'||!value.trim())return undefined;
 const raw=value.trim();const seconds=/^\d+(?:\.\d+)?$/.test(raw)?Number(raw):(Date.parse(raw)-now)/1000;
 return Number.isFinite(seconds)&&seconds>=0&&seconds<=604800?Math.ceil(seconds):undefined;
}
export function modelStatus(env){
 const deepseek=env.MODEL_PROVIDER==='deepseek';
 function routeStatus(route){
  const primary=endpoint(env,route);
  const config=primary||fallbackEndpoint(env);
  return {configured:!!config,...(deepseek?{primaryConfigured:!!primary}:{}),...(deepseek&&config?{model:config.model}:{})};
 }
 return {general:routeStatus('general'),professional:routeStatus('professional'),
  ...(deepseek?{provider:'deepseek',agent:routeStatus('agent'),...(env.MODEL_FALLBACK_PROVIDER==='groq'?{fallback:{provider:'groq',configured:!!fallbackEndpoint(env),model:GROQ_MODEL}}:{})}:{}),
  validation:deepseek||env.MODEL_PROVIDER==='groq'?'Server-resolved citations; AI interpretation is not independently clinically validated':'Automated support review; independent clinical validation pending'};
}
function evidenceMode(input,assets){
 const index=medicalTopicIndex(assets);
 return classifyResponseMode(input.question,{index,topic:input.topic,previousMode:classifyResponseMode(input.topic,{index})});
}
async function boundedJSON(stream,max){
 const reader=stream?.getReader();if(!reader)throw Error('Missing body');const decoder=new TextDecoder();let n=0,text='';
 try{while(true){const {value,done}=await reader.read();if(done)break;n+=value.byteLength;if(n>max){await reader.cancel();throw Error('Body too large')}text+=decoder.decode(value,{stream:true})}}finally{reader.releaseLock()}
 return JSON.parse(text+decoder.decode());
}
async function identity(request,env){
 const token=request.headers.get('authorization')?.match(/^Bearer ([^\s]{10,8192})$/i)?.[1];
 if(!token)fail(401,'sign_in','Sign in to use AI synthesis.');
 let base;try{base=new URL(env.SUPABASE_URL);if(base.protocol!=='https:'||base.username||base.password||base.pathname!=='/'||base.search||base.hash)throw Error()}catch{fail(503,'auth_unavailable','The sign-in service is not configured.')}
 const res=await fetch(base.origin+'/auth/v1/user',{headers:{apikey:env.SUPABASE_ANON_KEY,Authorization:'Bearer '+token},redirect:'manual',signal:AbortSignal.timeout(8000)});
 if(!res.ok)fail(res.status===401||res.status===403?401:503,'auth_unavailable','Sign-in could not be verified.');
 const user=await res.json();if(!/^[a-f\d-]{36}$/i.test(user.id||''))fail(401,'sign_in','Invalid sign-in session.');return user.id;
}
async function reserve(env,user){
 if(!env.DB)fail(503,'quota_unavailable','AI request limits are not configured.');
 const bucket=Math.floor(Date.now()/60000);
 // Store only one rolling counter per user, never the medical question.
 const result=await env.DB.prepare(`INSERT INTO hb_model_limits (user_id, bucket, requests) VALUES (?, ?, 1)
 ON CONFLICT(user_id) DO UPDATE SET bucket=excluded.bucket, requests=CASE WHEN hb_model_limits.bucket=excluded.bucket THEN hb_model_limits.requests+1 ELSE 1 END
 WHERE hb_model_limits.bucket<>excluded.bucket OR hb_model_limits.requests<6`).bind(user,bucket).run();
 if(!result.meta?.changes)fail(429,'rate_limited','Your request limit has been reached. The cited sources remain available.',Math.ceil((60000-Date.now()%60000)/1000));
}
async function requestCompletion(config,messages,signal,maxTokens,schema,validateBackup){
 const deepseek=config.protocol==='deepseek-cited-v1';
 const payload=deepseek?deepseekPayload(config.model,messages,maxTokens,schema):config.protocol==='groq-cited-v1'&&schema?{model:config.model,messages,temperature:0,max_completion_tokens:maxTokens,stream:false,reasoning_effort:'low',include_reasoning:false,response_format:{type:'json_schema',json_schema:{name:'healthbrowse_answer',strict:true,schema}}}:{model:config.model,messages,temperature:0,max_tokens:maxTokens,stream:false,response_format:schema?{type:'json_schema',json_schema:{name:'healthbrowse',strict:true,schema}}:{type:'json_object'}};
 const res=await fetch(config.url,{method:'POST',headers:{Authorization:'Bearer '+config.key,'Content-Type':'application/json'},redirect:'manual',signal,
  body:JSON.stringify(payload)});
 if(!res.ok)return {response:res};
 const data=await boundedJSON(res.body,120000);
 if(deepseek||validateBackup)return {response:res,value:readStructuredResult(data,config.model,schema)};
 const content=data.choices?.[0]?.message?.content;
 if(data.choices?.[0]?.finish_reason==='length'||typeof content!=='string')throw Error('Incomplete model response');
 return {response:res,value:JSON.parse(content.replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,''))};
}
async function checkedCompletion(primary,backup,messages,signal,maxTokens,schema,validateModel=false,onFallback){
 const result=await withModelFallback(primary,backup,signal,35000,(config,attemptSignal)=>
  requestCompletion(config,messages,attemptSignal,maxTokens,schema,validateModel||config===backup),onFallback);
 const {response:res,config}=result;
 if(!res.ok){
  if(res.status===401||res.status===403)fail(503,'provider_access','The AI provider rejected access. The site owner must check the token and model access.');
  if(res.status===402)fail(503,'provider_credits','AI provider credits are unavailable. Showing source excerpts instead.');
  if(res.status===429)fail(503,'provider_busy','The AI service has reached a usage limit. '+(config.protocol==='groq-cited-v1'?'The reading modes share this provider quota. ':'')+'Cited source excerpts remain available.',retryDelay(res.headers.get('retry-after')));
  if(res.status===400||res.status===404||res.status===422)fail(503,'provider_configuration','The AI provider could not accept this model request. Showing source excerpts instead.');
  fail(503,'provider_unavailable','The AI provider is temporarily unavailable. Showing source excerpts instead.');
 }
 return result;
}
async function complete(config,messages,signal,maxTokens=6000,schema){
 return (await checkedCompletion(config,null,messages,signal,maxTokens,schema)).value;
}
export async function modelAPI(request,env,assets){
 const url=new URL(request.url);
 if(url.pathname==='/api/ai/status'&&request.method==='GET')return reply(modelStatus(env));
 const evidenceOnly=url.pathname==='/api/ai/evidence';
 if(!evidenceOnly&&url.pathname!=='/api/ai/answer')return reply({error:'Unknown AI route.'},404);
 if(request.method!=='POST')return reply({error:'Use POST.'},405);
 let phase='input',fallbackEvidence=null,fallbackInput=null;
 const routing={};
 try{
  if(request.headers.get('origin')&&request.headers.get('origin')!==url.origin)fail(403,'origin','Cross-origin requests are not supported.');
  if(!request.headers.get('content-type')?.startsWith('application/json'))fail(415,'body','Use JSON.');
  let b;try{b=await boundedJSON(request.body,450000)}catch{fail(400,'body','Invalid or oversized question or document.')}
  if(!b||Array.isArray(b)||Object.keys(b).some(k=>!['topic','question','role','mode','deck','history','searchQuery','browserContext','attachments','buddyModel'].includes(k)))fail(400,'body','Unexpected input.');
  if(b.buddyModel!==undefined&&(b.mode!=='chat'||!['deepseek','groq'].includes(b.buddyModel)))
   fail(400,'body','Choose a supported model for Buddy chat.');
  if(evidenceOnly){
   if(Object.keys(b).some(k=>!['topic','question','role','mode','deck'].includes(k))||
      (b.mode!==undefined&&b.mode!=='search')||(b.deck!==undefined&&b.deck!==0))fail(400,'body','Evidence retrieval accepts a search question, topic and reading mode.');
   b.mode='search';b.deck=0;
  }
  const documentMode=b.attachments!==undefined;
  if(documentMode&&b.mode!=='chat')fail(400,'buddy_upload_only','Open Buddy to ask about an attached file.');
  if(documentMode){try{validateDocuments(b.attachments)}catch(error){fail(400,'document_input',error.message)}}
  else if(JSON.stringify(b).length>12000)fail(400,'body','Invalid or oversized question.');
  if(typeof b.topic!=='string'||b.topic.length>160||typeof b.question!=='string'||!b.question.trim()||b.question.length>1600||!isReadingRole(b.role)||!['search','chat'].includes(b.mode)||!Number.isInteger(b.deck)||b.deck<0||b.deck>6)fail(400,'body','Check the topic, question and reading mode.');
  if(b.history!==undefined&&(!Array.isArray(b.history)||b.history.length>4||b.history.some(q=>typeof q!=='string'||q.length>1600)))fail(400,'body','Invalid follow-up context.');
  if(b.searchQuery!==undefined&&(typeof b.searchQuery!=='string'||b.searchQuery.length>1600))fail(400,'body','Invalid browser context.');
  if(b.browserContext!==undefined&&(typeof b.browserContext!=='string'||b.browserContext.length>1200))fail(400,'body','Invalid browser summary.');
  const context=[b.topic,b.searchQuery||'',...(b.history||[])].join(' ');
  const screened=assessSafety(b.question,context);
  const inputs=[b.question,b.topic,b.searchQuery||'',b.browserContext||'',...(b.history||[])];
  const expanded=inputs.flatMap(securityVariants);
  const clinicalDecision=screened.action!=='allow'?screened:expanded.map(text=>assessSafety(text,context)).find(result=>result.action!=='allow');
  const buddyDecision=inputs.map(assessBuddySafety).find(result=>result.action!=='allow');
  const statuses=inputs.map(inspectQuery);
  const clarification=documentMode?null:clarifyQuery(b.question,{topic:b.topic,context:!!b.topic});
  const outOfScope=!documentMode&&(outsideMedicalScope(b.question)||(evidenceOnly&&!clarification&&evidenceMode(b,assets)!=='medical'));
  // Log only policy outcomes, never query text, identity, tokens or medical details.
  const category=statuses.includes('emergency')?'emergency':statuses.includes('private')?'private':clinicalDecision?.category||buddyDecision?.category||(statuses.includes('unsafe')?'unsafe_context':outOfScope?'out_of_scope':'educational');
  console.info(JSON.stringify({event:'safety_screened',policyVersion:buddyDecision&&!clinicalDecision?buddyPolicyVersion:safetyPolicyVersion,action:category==='educational'?'allow':'redirect',category}));
  const flag=securityFlagFor(clinicalDecision?.category||buddyDecision?.category);
  if(flag)console.warn(JSON.stringify({event:'security_flag',...flag,action:'blocked'}));
  if(statuses.includes('emergency'))fail(422,'emergency','If this danger is happening now, contact local emergency services. Do not wait for an AI response.');
  if(statuses.includes('private'))return reply({status:'blocked',code:'private',answer:buddySafetyAnswer('private_input'),decks:[]},422);
  if(category==='out_of_scope')return reply({status:'blocked',code:'out_of_scope',answer:scopeAnswer(),decks:[]},422);
  if(category!=='educational'){
   return reply({status:'blocked',code:'unsafe_request',answer:clinicalDecision?safetyAnswer(clinicalDecision.category):buddySafetyAnswer(buddyDecision?.category),decks:[]},422);
  }
  if(clarification&&!evidenceOnly)return reply({status:'clarification',clarification,decks:[]});
  b.persona=medicalPersona(b.role);b.role=normalizeReadingRole(b.role);
  const help=b.mode==='chat'&&!documentMode?buddyHelpAnswer(b.question):null;
  if(help){phase='authentication';await identity(request,env);return reply({status:'platform',answer:help,decks:[]})}
  const route=b.role==='Medical professional'?'professional':'general';
  const backup=b.buddyModel==='groq'?null:fallbackEndpoint(env);
  const primary=buddyEndpoint(env,b.buddyModel,route);
  const config=primary||backup;
  const reviewer=b.buddyModel?config:modelReviewEndpoint(env,route)||backup;
  phase='authentication';
  const user=await identity(request,env),grounded=config?.protocol==='grounded-v2';
  phase='quota';
  await reserve(env,user);
  phase='evidence';
  if(evidenceOnly){
   if(clarification)return reply({query_decomposition:[],retrieved_sources:[],evidence_gaps:[clarification.text]});
   return reply(await retrieveLiteraturePacket(b,env,request.signal,fetch,assets));
  }
  if (isBuddyOverview(b)) {
   const intent = buddyDeckIntent(b.question,{topic:b.topic,index:medicalTopicIndex(assets),queryMode:evidenceMode(b,assets)});
   if (intent.explicit && (intent.topic || b.topic)) {
    const subject = (intent.topic || b.topic).trim();
    b = {...b,topic:subject,question:'What is ' + subject + '?'};
   }
  }
  const local=documentMode?null:grounded?groundedEvidence(assets,b):usesCitedProtocol(config)||!config?citedEvidence(assets,b):evidenceFor(assets,b.topic,b.role,b.question);
  const evidence=documentMode?documentEvidence(b.attachments,b):grounded?local:learningDecks(addEducation(await retrieveEvidence(b,local,env,request.signal,fetch,assets),educationEvidence(assets,b),b),b,local);
  if(evidence&&!documentMode)evidence.visual=educationalVisual(assets,b);
  if(documentMode&&!evidence.sources.length)return reply({status:'unavailable',code:'document_evidence',error:'No usable passages were found in the attachments. Check the extracted text; embedded instructions and unsupported content are excluded.'},422);
  if(!evidence?.sources.length){
   const interrupted=evidence?.retrieval?.providers?.some(p=>p.status==='unavailable');
   return reply({status:'unavailable',code:interrupted?'evidence_unavailable':'no_evidence',error:interrupted?'The medical sources could not be reached. Please retry shortly; your question was accepted.':'No sufficiently relevant passage was retrieved for this question. Add a medical detail or inspect the sources; no answer has been invented.',retrieval:evidence?.retrieval,...(interrupted?{retryAfterSeconds:15}:{})},interrupted?503:200);
  }
  if(!grounded||documentMode){fallbackEvidence=evidence;fallbackInput=b;}
  if(!config)fail(503,'model_not_configured',b.buddyModel?'The selected Buddy model is unavailable. Choose another model or read the cited excerpts.':'The AI service is not configured. Retrieved source passages are shown below.');
  if(grounded&&documentMode)fail(503,'document_model_unavailable','The document review model is unavailable. Retrieved document passages are shown below.');
  if(!reviewer)fail(503,'reviewer_not_configured','The support reviewer is not configured. Showing source excerpts instead.');
  // The deadline includes both generation, review and one possible repair.
  const started=Date.now(),deadline=AbortSignal.timeout(120000);
  // Incoming Request.signal is absent on older Workers compatibility dates.
  const signal=request.signal?AbortSignal.any([request.signal,deadline]):deadline;
  if(usesCitedProtocol(config)){
   // A generation failover carries through review, so an answer switches once at most.
   const recordFallback=detail=>{
    routing.modelFallback={phase,primaryModel:deepseekModelId(env,route),fallbackModel:backup.model,...detail};
    console.warn(JSON.stringify({event:'ai_model_fallback',...routing.modelFallback}));
   };
   const prepared=prepareCited(b,evidence);
   phase='generation';
   const draft=await checkedCompletion(primary,backup,prepared.messages,signal,prepared.maxTokens,prepared.schema,!!b.buddyModel,recordFallback);
   const check=prepareCitedReview(draft.value,prepared,b);
   phase='support_review';
   // Once Groq has taken over, review there too. A reviewer-only outage
   // retries the review of the same draft and evidence without regenerating it.
   const reviewAt=draft.config===backup?backup:reviewer;
   const review=check.claims.length
    ?await checkedCompletion(reviewAt,backup,check.messages,signal,check.maxTokens,check.schema,!!b.buddyModel,recordFallback)
    :null;
   phase='presentation';
   const approved=applyCitedReview(review?.value||{checks:[]},check,prepared,b);
   return reply({...presentCited(approved,prepared,b,draft.config.model),protocol:draft.config.protocol,...routing,
    ...(backup||b.buddyModel?{reviewModel:review?.config.model||null}:{}),retrieval:evidence.retrieval});
  }
  let reason='';
  for(let attempt=0;attempt<2;attempt++){
   // Do not start another whole generation/review cycle when the first cycle
   // already consumed more than the remaining budget (plus a small margin).
   // This is a conservative estimate, not a latency guarantee.
   if(grounded&&attempt&&Date.now()-started+5000>=120000-(Date.now()-started))
    fail(503,'repair_budget_exhausted','The draft failed checks and there is insufficient time to recheck a replacement. Showing source excerpts instead.');
   try{
    if(grounded){
     const prepared=prepareGrounded(b,evidence,reason);
     phase='generation';
     const raw=await complete(config,prepared.messages,signal,prepared.maxTokens,prepared.schema);
     const draft=decodeGrounded(raw,b,prepared),check=groundedReview(draft,prepared,b);
     phase='support_review';
     const review=await complete(reviewer,check.messages,signal,check.maxTokens,check.schema);
     if(!groundedReviewPasses(review,draft,prepared)){reason='Claim support or direct-answer facet coverage failed: '+JSON.stringify(review).slice(0,350);continue;}
     phase='presentation';
     return reply({...presentGrounded(draft,prepared,b,config.model,attempt>0),...(isBuddyOverview(b)?{decks:buddyOverviewDecks(b,evidence)}:{}),visual:evidence.visual||null});
    }
    const prepared=config.compact?compactGeneration(b,evidence,reason):{messages:generationMessages(b,evidence,reason),evidence,maxTokens:6000};
    phase='generation';
    const raw=await complete(config,prepared.messages,signal,prepared.maxTokens);
    const draft=validateDraft(raw,b,prepared.evidence);
    const batches=(config.compact||reviewer.compact)?compactReviews(draft,prepared.evidence,b):[{draft,messages:reviewMessages(draft,prepared.evidence,b),maxTokens:2500}];
    let passed=true;
    for(const batch of batches){
     phase='support_review';
     const review=await complete(reviewer,batch.messages,signal,batch.maxTokens);
     if(!reviewPasses(review,batch.draft)){passed=false;reason='The direct answer was incomplete or a claim was unsupported. '+JSON.stringify(review).slice(0,300);break}
    }
    if(!passed)continue;
    return reply({...presentDraft(draft,prepared.evidence,b,config.model,attempt>0),decks:buddyOverviewDecks(b,evidence),visual:evidence.visual||null,learningMode:!!evidence.learningMode,retrieval:evidence.retrieval});
   }catch(error){
    if(error instanceof ContextLimit)fail(422,'context_limit','This question and its evidence exceed the model context. Try asking about one part of the question.');
    if(signal.aborted){
     if(request.signal?.aborted)fail(499,'request_cancelled','The request was cancelled.');
     fail(503,'model_timeout','AI generation and verification exceeded the response deadline. Showing source excerpts instead.');
    }
    if(error instanceof Failure)throw error;
    reason='The draft failed validation: '+error.message;
   }
  }
  fail(502,'verification_failed','The generated answer did not pass source checks. Showing source excerpts instead.');
 }catch(error){
  // Never log questions, tokens, provider bodies, identities or error messages.
  if(error.code==='provider_busy')console.warn(JSON.stringify({event:'ai_provider_limited',phase,...(error.retryAfterSeconds!==undefined?{retryAfterSeconds:error.retryAfterSeconds}:{})}));
  if(!(error instanceof Failure))console.error(JSON.stringify({event:'ai_request_failed',phase,kind:['TypeError','SyntaxError','TimeoutError','AbortError'].includes(error?.name)?error.name:'Error'}));
  if(fallbackEvidence?.sources.length&&fallbackInput&&(isBuddyOverview(fallbackInput)||fallbackEvidence.documentMode||env.MODEL_PROVIDER==='deepseek'||env.RETRIEVAL_LIVE!=='off')){
   const prepared=prepareCited(fallbackInput,fallbackEvidence);const result=presentCited({answer:[]},prepared,fallbackInput,'');
   const message=error instanceof Failure?error.message:'AI synthesis could not finish. Retrieved source excerpts remain available.';
   return reply({...result,protocol:'source-excerpts-v1',decks:buddyOverviewDecks(fallbackInput,fallbackEvidence),status:'sourced',code:error.code||'model_unavailable',message,retrieval:fallbackEvidence.retrieval,...routing,...(error.retryAfterSeconds!==undefined?{retryAfterSeconds:error.retryAfterSeconds}:{})});
  }
  if(evidenceOnly&&phase==='evidence')return reply({query_decomposition:[],retrieved_sources:[],evidence_gaps:['Evidence retrieval could not be completed.']},503);
  return reply({status:'unavailable',code:error.code||'model_unavailable',error:error instanceof Failure?error.message:'AI synthesis is temporarily unavailable. Showing source excerpts instead.',...(error.retryAfterSeconds!==undefined?{retryAfterSeconds:error.retryAfterSeconds}:{})},error.status||503)}
}
