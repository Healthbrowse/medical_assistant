const gemma='@cf/google/gemma-4-26b-a4b-it';
const qwen='@cf/qwen/qwen3.8-27b';

export const workersModels=Object.freeze({general:gemma,professional:qwen,agent:gemma});
export const workersProtocol='workers-ai-cited-v1';

export function offersWorkersModels(env){
 return env.MODEL_PROVIDER==='workers-ai'||(env.MODEL_PROVIDER==='deepseek'&&typeof env.AI?.run==='function');
}

export function workersEndpoint(env,route){
 const model=workersModels[route];
 if(!offersWorkersModels(env)||typeof env.AI?.run!=='function'||!model)return null;
 return {model,ai:env.AI,protocol:workersProtocol,compact:false};
}

// Raw responses preserve quota and availability errors for the shared failover logic.
export function runWorkersCompletion(config,messages,maxTokens,schema,signal){
 return config.ai.run(config.model,{
  messages,stream:false,temperature:0,max_completion_tokens:maxTokens,
  ...(config.model===qwen?{reasoning_effort:'low'}:{}),
  response_format:{type:'json_schema',json_schema:{name:'healthbrowse',strict:true,schema}}
 },{signal,returnRawResponse:true});
}
