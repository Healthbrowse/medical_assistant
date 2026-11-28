import {workersEndpoint,workersProtocol} from './workers-ai.mjs';
import {SARVAM_API_BASE,SARVAM_FLASH_MODEL} from './sarvam-client.mjs';
import {isModelDisabled} from './model-policy.mjs';
// Credentials are resolved only on the server, never in the browser bundle.
export const HF_CHAT_URL='https://router.huggingface.co/v1/chat/completions';
export const GENERAL_MODEL='meta-llama/Meta-Llama-3-8B-Instruct:featherless-ai';
export const GROQ_CHAT_URL='https://api.groq.com/openai/v1/chat/completions';
export const GROQ_MODEL='openai/gpt-oss-120b';
const configuredKey=value=>typeof value==='string'&&!!value.trim();
export function groqModelId(env){
 const model=env.GROQ_MODEL||GROQ_MODEL;
 return ['openai/gpt-oss-120b','openai/gpt-oss-20b'].includes(model)?model:null;
}
function groqEndpoint(env){
 const model=groqModelId(env);
 if(!configuredKey(env.GROQ_API_KEY)||!model||isModelDisabled(env,model))return null;
 return {url:GROQ_CHAT_URL,key:env.GROQ_API_KEY,model,protocol:'groq-cited-v1',compact:false};
}
export const sarvamProtocol='sarvam-cited-v1';
const sarvamModels=new Set([SARVAM_FLASH_MODEL,SARVAM_FLASH_MODEL+'-interactive']);
export function sarvamModelId(env){
 const model=env.SARVAM_MODEL||SARVAM_FLASH_MODEL;
 return sarvamModels.has(model)?model:null;
}
export function sarvamEndpoint(env,route){
 const model=sarvamModelId(env);
 if(!['general','professional'].includes(route)||typeof env.SARVAM_API_KEY!=='string'||!env.SARVAM_API_KEY.trim()||!model||isModelDisabled(env,model))return null;
 // This is a separate hosted checkpoint, never an alias for the R1/V3 models.
 // Endpoint, credential and served model are kept together on the server.
 return {url:SARVAM_API_BASE+'/chat/completions',key:env.SARVAM_API_KEY,model,protocol:sarvamProtocol,compact:false};
}
const modelFamily='deepseek-ai/';
export const DEEPSEEK_MODELS=Object.freeze({
 general:modelFamily+'DeepSeek-R1-Distill-Llama-8B',
 professional:modelFamily+'DeepSeek-R1-Distill-Qwen-32B',
 agent:modelFamily+'DeepSeek-V3.2'
});
const lightweight=modelFamily+'DeepSeek-R1-0528-Qwen3-8B';
const deepseekChoices={
 general:[DEEPSEEK_MODELS.general,lightweight],
 professional:[DEEPSEEK_MODELS.professional,modelFamily+'DeepSeek-R1-Distill-Qwen-14B',lightweight],
 agent:[DEEPSEEK_MODELS.agent]
};
export function deepseekModelId(env,route){
 const option={general:env.DEEPSEEK_GENERAL_MODEL,professional:env.DEEPSEEK_CLINICIAN_MODEL}[route];
 const model=option||DEEPSEEK_MODELS[route];
 return deepseekChoices[route]?.includes(model)?model:null;
}
function deepseekEndpoint(env,route){
 const model=deepseekModelId(env,route);
 if(!configuredKey(env.HF_TOKEN)||!model||isModelDisabled(env,model))return null;
 // Hugging Face routes the canonical model ID to an available provider. Transport
 // and credentials are fixed together; legacy URLs and keys are never consulted.
 return {url:HF_CHAT_URL,key:env.HF_TOKEN,model,protocol:'deepseek-cited-v1',compact:false};
}
export function usesRoleModels(env){
 return ['deepseek','workers-ai','sarvam'].includes(env.MODEL_PROVIDER);
}
export function fallbackEndpoint(env){
 if(!['deepseek','workers-ai'].includes(env.MODEL_PROVIDER)||env.MODEL_FALLBACK_PROVIDER!=='groq')return null;
 return groqEndpoint(env);
}
// Configured capabilities, not a provider health check. The default provider
// controls automatic routing; a named selection resolves its own credential.
export function buddyModelRoutes(env,route){
 if(!Object.hasOwn(DEEPSEEK_MODELS,route))return new Map();
 return new Map([
  ['sarvam',sarvamEndpoint(env,route)],
  ['workers-ai',workersEndpoint(env,route)],
  ['deepseek',deepseekEndpoint(env,route)],
  ['groq',groqEndpoint(env)]
 ].filter(([,config])=>config));
}
// Buddy accepts named choices only. Credentials and endpoints stay server-side.
export function buddyEndpoint(env,choice,route){
 return choice===undefined?modelEndpoint(env,route):buddyModelRoutes(env,route).get(choice)||null;
}
// Only expose model IDs with a configured, server-owned cited-answer endpoint.
export function browserModelRoutes(env){
 const roles=['general','professional'].map(role=>buddyModelRoutes(env,role)),endpoints=[];
 for(const choice of ['sarvam','workers-ai','deepseek','groq'])
  for(const routes of roles)endpoints.push(routes.get(choice));
 return new Map(endpoints.filter(Boolean).map(config=>[config.model,config]));
}
export function usesCitedProtocol(config){
 return config?.protocol==='groq-cited-v1'||config?.protocol==='deepseek-cited-v1'||config?.protocol===workersProtocol||config?.protocol===sarvamProtocol;
}
export function modelEndpoint(env,route){
 if(!Object.hasOwn(DEEPSEEK_MODELS,route))return null;
 if(env.MODEL_PROVIDER==='sarvam')return sarvamEndpoint(env,route);
 if(env.MODEL_PROVIDER==='workers-ai')return workersEndpoint(env,route);
 if(env.MODEL_PROVIDER==='deepseek')return deepseekEndpoint(env,route);
 if(route==='agent')return null;
 if(env.MODEL_PROVIDER==='groq'){
  // Both reading modes use the hosted model, with different evidence/prompt styles.
  // Never forward a Hugging Face or DR7 key to Groq.
  return groqEndpoint(env);
 }
 const general=route==='general',prefix=general?'MODEL_GENERAL_':'MODEL_PROFESSIONAL_';
 const url=env[prefix+'URL']||(general?HF_CHAT_URL:''),model=env[prefix+'ID']||(general?GENERAL_MODEL:'');
 // An HF token must never fall through to a different provider or the clinician route.
 const key=env[prefix+'KEY']||(general&&url===HF_CHAT_URL?env.HF_TOKEN:'');
 if(!url||!key||!model||isModelDisabled(env,model))return null;
 try{const u=new URL(url);if(u.protocol!=='https:'||u.username||u.password||u.hash||u.search||!u.hostname.includes('.')||/^(?:[\d.]+|\[)/.test(u.hostname)||/\.(?:local|internal|localhost)$/.test(u.hostname))return null}catch{return null}
 const llama3=model.split(':')[0]==='meta-llama/Meta-Llama-3-8B-Instruct';
 // Dedicated adapters can opt into the same context profile using this setting.
 const compact=llama3||(general&&env.MODEL_GENERAL_CONTEXT_TOKENS==='8192');
 const protocol=env[prefix+'PROTOCOL']||'legacy';
 if(!['legacy','grounded-v2'].includes(protocol))return null;
 return {url,key,model,compact,protocol};
}

// A format-trained generator must not silently replace the support reviewer.
// Reuse its credential only on the exact same endpoint URL.
export function modelReviewEndpoint(env,route){
 const generator=modelEndpoint(env,route);if(!generator)return null;
 if(generator.protocol==='deepseek-cited-v1'||generator.protocol===workersProtocol||generator.protocol===sarvamProtocol)return generator;
 if(generator.protocol==='groq-cited-v1'){
  const model='openai/gpt-oss-20b';
  return isModelDisabled(env,model)?null:{...generator,model};
 }
 const prefix=route==='general'?'MODEL_GENERAL_':'MODEL_PROFESSIONAL_';
 if(!env[prefix+'REVIEW_ID']&&!env[prefix+'REVIEW_URL']&&!env[prefix+'REVIEW_KEY'])return generator.protocol==='grounded-v2'?null:generator;
 const url=env[prefix+'REVIEW_URL']||generator.url;
 const key=env[prefix+'REVIEW_KEY']||(url===generator.url?generator.key:'');
 const model=env[prefix+'REVIEW_ID'];if(!model)return null;
 return modelEndpoint({MODEL_DISABLED_MODELS:env.MODEL_DISABLED_MODELS,[prefix+'URL']:url,[prefix+'KEY']:key,[prefix+'ID']:model,
                       [prefix+'CONTEXT_TOKENS']:env[prefix+'CONTEXT_TOKENS'],[prefix+'PROTOCOL']:env[prefix+'PROTOCOL']},route);
}
