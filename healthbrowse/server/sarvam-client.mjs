import {readDeepSeekResult,CompletionError} from './deepseek-client.mjs';
import {abortable} from '../dist/request-deadline.js';

// Opt-in server adapter. Model IDs are provider-specific and never aliases for
// HealthBrowse's Hugging Face checkpoints. No key, prompt or raw error is logged.
// API contract: https://docs.sarvam.ai/api-reference/chat/chat-completions-v2
export const SARVAM_API_BASE='https://api.sarvam.ai/v2';
export const SARVAM_FLASH_MODEL='deepseekv4.1-flash-1017';
const maxResponseBytes=240000,maxRequestBytes=250000;
const identifier=value=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/.test(value);
const metadata=value=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9._ /-]{0,79}$/.test(value);

export class SarvamError extends Error{
 constructor(code,status,usage){super(code);this.name='SarvamError';this.code=code;
  if(Number.isInteger(status))this.status=status;
  if(usage&&Object.keys(usage).length)this.usage=usage;
 }
}
function invalid(){throw new SarvamError('provider_output_invalid')}
function inputError(){throw new SarvamError('invalid_sarvam_input')}
function usageOf(usage){
 const result={};
 for(const [key,value] of Object.entries({promptTokens:usage?.prompt_tokens,completionTokens:usage?.completion_tokens,
  totalTokens:usage?.total_tokens,reasoningTokens:usage?.completion_tokens_details?.reasoning_tokens,
  cachedTokens:usage?.prompt_tokens_details?.cached_tokens})){
  if(Number.isSafeInteger(value)&&value>=0)result[key]=value;
 }
 return result;
}
function httpCode(status){
 if(status===401||status===403)return 'provider_access';
 if(status===402)return 'provider_credits';
 if(status===404)return 'provider_model_unavailable';
 if(status===429)return 'provider_busy';
 if(status===400||status===422)return 'provider_configuration';
 if(status>=300&&status<400)return 'provider_redirect';
 return 'provider_unavailable';
}
async function boundedJSON(response,signal){
 if(!response.body?.getReader)invalid();
 const reader=response.body.getReader(),decoder=new TextDecoder();let bytes=0,text='';
 try{
  while(true){
   const {done,value}=await abortable(reader.read(),signal);if(done)break;
   bytes+=value.byteLength;if(bytes>maxResponseBytes){void reader.cancel().catch(()=>{});invalid()}
   text+=decoder.decode(value,{stream:true});
  }
  try{return JSON.parse(text+decoder.decode())}catch{invalid()}
 }finally{reader.releaseLock()}
}
async function requestJSON(path,{apiKey,env,fetcher=fetch,signal,timeoutMs=15000},body){
 const key=apiKey??env?.SARVAM_API_KEY;
 if(typeof key!=='string'||!key||key.length>8192||/\s/.test(key))throw new SarvamError('sarvam_key_missing');
 if(typeof fetcher!=='function'||!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>120000)inputError();
 if(signal?.aborted)throw new SarvamError('request_cancelled');
 const controller=new AbortController(),abort=()=>controller.abort();
 signal?.addEventListener('abort',abort,{once:true});
 const timer=setTimeout(abort,timeoutMs);
 try{
  const serialized=body===undefined?undefined:JSON.stringify(body);
  if(serialized&&new TextEncoder().encode(serialized).length>maxRequestBytes)inputError();
  const response=await abortable(Promise.resolve().then(()=>fetcher(SARVAM_API_BASE+path,{
   // Workers supports manual/follow, not redirect:error. Reject 3xx below so
   // the subscription key is never forwarded to another endpoint.
   method:body===undefined?'GET':'POST',redirect:'manual',cache:'no-store',signal:controller.signal,
   headers:{'api-subscription-key':key,Accept:'application/json',...(body===undefined?{}:{'Content-Type':'application/json'})},
   ...(body===undefined?{}:{body:serialized})
  })),controller.signal);
  if(!response||typeof response.ok!=='boolean'||!Number.isInteger(response.status))invalid();
  if(!response.ok){void response.body?.cancel().catch(()=>{});throw new SarvamError(httpCode(response.status),response.status)}
  return await boundedJSON(response,controller.signal);
 }catch(error){
  if(error instanceof SarvamError)throw error;
  if(controller.signal.aborted)throw new SarvamError(signal?.aborted?'request_cancelled':'provider_timeout');
  throw new SarvamError('provider_network_error');
 }finally{clearTimeout(timer);signal?.removeEventListener('abort',abort)}
}

export async function listSarvamModels(options={}){
 const result=await requestJSON('/models',options);
 if(!Array.isArray(result?.data)||result.data.length>500||result.data.some(item=>!identifier(item?.id)))invalid();
 const seen=new Set(),models=[];
 for(const item of result.data){
  if(seen.has(item.id))continue;seen.add(item.id);
  models.push({id:item.id,...(metadata(item.owned_by)?{ownedBy:item.owned_by}:{}),...(metadata(item.access)?{access:item.access}:{})});
 }
 return {models};
}

// The shared final-output parser checks object types/required keys/IDs. Keep
// cardinality and scalar bounds too; provider schema decoding is not trusted.
function respectsBounds(value,schema){
 if(schema.enum&&!schema.enum.some(item=>JSON.stringify(item)===JSON.stringify(value)))return false;
 if(typeof value==='string'&&((schema.minLength!==undefined&&value.length<schema.minLength)||(schema.maxLength!==undefined&&value.length>schema.maxLength)))return false;
 if(typeof value==='number'&&((schema.minimum!==undefined&&value<schema.minimum)||(schema.maximum!==undefined&&value>schema.maximum)))return false;
 if(Array.isArray(value))return !(schema.minItems!==undefined&&value.length<schema.minItems)&&!(schema.maxItems!==undefined&&value.length>schema.maxItems)&&value.every(item=>respectsBounds(item,schema.items));
 if(value&&typeof value==='object')return Object.keys(value).every(key=>schema.properties?.[key]&&respectsBounds(value[key],schema.properties[key]));
 return true;
}

export async function completeSarvam({model,messages,schema,maxTokens=1800,reasoningEffort='none',timeoutMs=45000,...options}={}){
 if(!identifier(model)||!Array.isArray(messages)||!messages.length||messages.length>32||
  messages.some(message=>!message||!['system','developer','user','assistant'].includes(message.role)||typeof message.content!=='string')||
  !schema||schema.type!=='object'||!schema.properties||!Array.isArray(schema.required)||
  !Number.isInteger(maxTokens)||maxTokens<1||maxTokens>8000||!['none','low','medium','high','max'].includes(reasoningEffort))inputError();
 const body={model,messages:messages.map(({role,content})=>({role,content})),max_tokens:maxTokens,
  temperature:0,reasoning_effort:reasoningEffort,stream:false,
  response_format:{type:'json_schema',json_schema:{name:'healthbrowse',strict:true,schema}}};
 const data=await requestJSON('/chat/completions',{...options,timeoutMs},body),usage=usageOf(data?.usage);
 try{
  const choice=data?.choices?.[0];
  if(choice?.message?.refusal||data?.refusal||choice?.finish_reason==='content_filter')throw new CompletionError('provider_refusal');
  // Sarvam documents exact, case-sensitive model IDs. Require a reported ID;
  // the shared parser's permissive cross-provider aliases do not apply here.
  if(data?.model!==model)throw new CompletionError('provider_model_mismatch');
  if(!Array.isArray(data?.choices)||data.choices.length!==1)invalid();
  if(!choice?.finish_reason||choice.message?.tool_calls?.length)throw new CompletionError('provider_output_unexpected');
  const value=readDeepSeekResult(data,model,schema);
  if(!respectsBounds(value,schema))invalid();
  return {value,model,finishReason:'stop',usage};
 }catch(error){
  throw new SarvamError(error instanceof CompletionError||error instanceof SarvamError?error.code:'provider_output_invalid',undefined,usage);
 }
}
