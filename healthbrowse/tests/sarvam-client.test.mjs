import test from 'node:test';
import assert from 'node:assert/strict';
import {SARVAM_API_BASE,SARVAM_FLASH_MODEL,SarvamError,listSarvamModels,completeSarvam} from '../server/sarvam-client.mjs';

const apiKey='fixture-sarvam-key';
const schema={type:'object',properties:{answer:{type:'array',maxItems:1,items:{type:'object',
 properties:{text:{type:'string',minLength:10,maxLength:200},sources:{type:'array',minItems:1,maxItems:1,items:{type:'string',enum:['S1']}}},
 required:['text','sources'],additionalProperties:false}}},required:['answer'],additionalProperties:false};
const value={answer:[{text:'The supplied passage describes the reported finding.',sources:['S1']}]};
const messages=[{role:'system',content:'Return the evidence-backed schema JSON.'},{role:'user',content:'Synthetic test question.'}];
const response=overrides=>({model:SARVAM_FLASH_MODEL,choices:[{finish_reason:'stop',message:{role:'assistant',content:JSON.stringify(value)}}],
 usage:{prompt_tokens:18,completion_tokens:24,total_tokens:42,completion_tokens_details:{reasoning_tokens:2},prompt_tokens_details:{cached_tokens:0}},...overrides});
const complete=options=>completeSarvam({apiKey,model:SARVAM_FLASH_MODEL,messages,schema,...options});
const rejectsCode=async(promise,code,status)=>assert.rejects(promise,error=>{
 assert.ok(error instanceof SarvamError);assert.equal(error.code,code);assert.equal(error.message,code);
 if(status!==undefined)assert.equal(error.status,status);
 assert.ok(!JSON.stringify(error).includes(apiKey));return true;
});

test('model inventory uses the fixed authenticated endpoint and returns bounded metadata, not provider internals',async()=>{
 let calls=0;
 const result=await listSarvamModels({env:{SARVAM_API_KEY:apiKey},baseUrl:'https://untrusted.example',fetcher:async(url,options)=>{
  calls++;assert.equal(url,SARVAM_API_BASE+'/models');assert.equal(options.method,'GET');
  assert.equal(options.headers['api-subscription-key'],apiKey);assert.equal(options.redirect,'manual');assert.equal(options.cache,'no-store');
  assert.ok(options.signal instanceof AbortSignal);assert.equal(options.body,undefined);
  return Response.json({object:'list',private:apiKey,data:[
   {id:SARVAM_FLASH_MODEL,owned_by:'sarvam',access:'serverless',private:apiKey},
   {id:'deepseekv4-pro',owned_by:'sarvam',access:'provisioned'},
   {id:SARVAM_FLASH_MODEL,owned_by:'sarvam'}
  ]});
 }});
 assert.equal(calls,1);
 assert.deepEqual(result,{models:[{id:SARVAM_FLASH_MODEL,ownedBy:'sarvam',access:'serverless'},{id:'deepseekv4-pro',ownedBy:'sarvam',access:'provisioned'}]});
 assert.ok(!JSON.stringify(result).includes(apiKey));
 await rejectsCode(listSarvamModels({apiKey,fetcher:async()=>Response.json({data:[{id:'https://untrusted.example?secret=x'}]})}),'provider_output_invalid');
});

test('completion pins the exact model and JSON schema, disables reasoning by default, and returns only final output and safe usage',async()=>{
 let calls=0;
 const result=await complete({maxTokens:700,fetcher:async(url,options)=>{
  calls++;assert.equal(url,SARVAM_API_BASE+'/chat/completions');assert.equal(options.method,'POST');assert.equal(options.redirect,'manual');
  assert.equal(options.headers['api-subscription-key'],apiKey);
  const body=JSON.parse(options.body);assert.equal(body.model,SARVAM_FLASH_MODEL);assert.equal(body.max_tokens,700);
  assert.equal(body.reasoning_effort,'none');assert.equal(body.stream,false);assert.equal(body.temperature,0);
  assert.deepEqual(body.response_format,{type:'json_schema',json_schema:{name:'healthbrowse',strict:true,schema}});
  assert.ok(!options.body.includes(apiKey));assert.equal(body.tools,undefined);
  const data=response();data.choices[0].message.reasoning_content='Private analysis must never be returned.';
  data.usage.untrusted=apiKey;data.internal=apiKey;return Response.json(data);
 }});
 assert.equal(calls,1);assert.deepEqual(result,{value,model:SARVAM_FLASH_MODEL,finishReason:'stop',usage:{promptTokens:18,completionTokens:24,totalTokens:42,reasoningTokens:2,cachedTokens:0}});
 assert.ok(!JSON.stringify(result).includes('Private analysis'));assert.ok(!JSON.stringify(result).includes(apiKey));
});

test('reported model must match exactly and old DeepSeek checkpoint names are never silently remapped',async()=>{
 for(const reported of [undefined,'deepseek-ai/DeepSeek-V3.2',SARVAM_FLASH_MODEL.toUpperCase(),SARVAM_FLASH_MODEL+':provider']){
  await rejectsCode(complete({fetcher:async()=>Response.json(response({model:reported}))}),'provider_model_mismatch');
 }
 let requested;
 await rejectsCode(complete({model:'deepseek-ai/DeepSeek-V3.2',fetcher:async(_url,options)=>{
  requested=JSON.parse(options.body).model;return Response.json(response());
 }}),'provider_model_mismatch');
 assert.equal(requested,'deepseek-ai/DeepSeek-V3.2');
});

test('refusal, truncation and tool output are terminal, preserve billed usage, and expose no raw content',async()=>{
 for(const [finish,refusal,code] of [['length',null,'provider_output_truncated'],['content_filter',null,'provider_refusal'],['stop','PRIVATE REFUSAL '+apiKey,'provider_refusal'],['tool_calls',null,'provider_output_unexpected']]){
  let calls=0;
  const data=response();data.choices[0].finish_reason=finish;data.choices[0].message.refusal=refusal;
  await assert.rejects(complete({fetcher:async()=>{calls++;return Response.json(data)}}),error=>{
   assert.equal(error.code,code);assert.equal(error.message,code);assert.equal(error.usage.totalTokens,42);
   assert.ok(!JSON.stringify(error).includes(apiKey));return true;
  });assert.equal(calls,1);
 }
 const missing=response();delete missing.choices[0].finish_reason;
 await rejectsCode(complete({fetcher:async()=>Response.json(missing)}),'provider_output_unexpected');
});

test('HTTP failures are sanitized and never automatically retried, including credits and authentication',async()=>{
 for(const [status,code] of [[401,'provider_access'],[403,'provider_access'],[402,'provider_credits'],[404,'provider_model_unavailable'],[429,'provider_busy'],[400,'provider_configuration'],[422,'provider_configuration'],[503,'provider_unavailable']]){
  let calls=0;
  await rejectsCode(complete({fetcher:async()=>{calls++;return Response.json({error:{message:'Private provider detail '+apiKey}},{status})}}),code,status);
  assert.equal(calls,1);
 }
 await rejectsCode(complete({fetcher:async()=>{throw Error('Network error containing '+apiKey)}}),'provider_network_error');
});

test('manual redirects fail closed without forwarding credentials to the Location endpoint',async()=>{
 for(const status of [301,302,303,307,308]){
  const calls=[];
  const fetcher=async(url,options)=>{
   calls.push(url);assert.ok(url.startsWith(SARVAM_API_BASE+'/'));
   assert.equal(options.redirect,'manual');assert.equal(options.headers['api-subscription-key'],apiKey);
   return new Response(null,{status,headers:{Location:'https://untrusted.example/collect'}});
  };
  await rejectsCode(listSarvamModels({apiKey,fetcher}),'provider_redirect',status);
  assert.deepEqual(calls,[SARVAM_API_BASE+'/models']);calls.length=0;
  await rejectsCode(complete({fetcher}),'provider_redirect',status);
  assert.deepEqual(calls,[SARVAM_API_BASE+'/chat/completions']);
 }
});

test('schema output checks reject extra fields, fabricated IDs and over-limit claims even after provider decoding',async()=>{
 const badValues=[{...value,internal:'unexpected'},
  {answer:[{...value.answer[0],sources:['NOT_RETRIEVED']}]},
  {answer:[value.answer[0],value.answer[0]]},
  {answer:[{...value.answer[0],text:'x'.repeat(201)}]},
  {answer:[{...value.answer[0],sources:[]}]}];
 for(const invalid of badValues){
  const data=response();data.choices[0].message.content=JSON.stringify(invalid);
  await rejectsCode(complete({fetcher:async()=>Response.json(data)}),'provider_output_invalid');
 }
 const data=response();data.choices[0].message.content='{not json}';
 await rejectsCode(complete({fetcher:async()=>Response.json(data)}),'provider_output_invalid');
});

test('timeouts and caller cancellation stop the wait without exposing provider errors',async()=>{
 await rejectsCode(complete({timeoutMs:5,fetcher:async()=>new Promise(()=>{})}),'provider_timeout');
 const controller=new AbortController();controller.abort();let calls=0;
 await rejectsCode(complete({signal:controller.signal,fetcher:async()=>{calls++;return Response.json(response())}}),'request_cancelled');
 assert.equal(calls,0);
});

test('missing credentials and oversized requests/responses fail before use or unsafe output',async()=>{
 let calls=0;const fetcher=async()=>{calls++;return Response.json(response())};
 await rejectsCode(complete({apiKey:undefined,fetcher}),'sarvam_key_missing');
 await rejectsCode(complete({messages:[{role:'user',content:'x'.repeat(250001)}],fetcher}),'invalid_sarvam_input');
 assert.equal(calls,0);
 await rejectsCode(complete({fetcher:async()=>new Response('x'.repeat(240001))}),'provider_output_invalid');
 const data=response({usage:{prompt_tokens:-1,completion_tokens:Infinity,total_tokens:'42',completion_tokens_details:{reasoning_tokens:4}}});
 const result=await complete({fetcher:async()=>Response.json(data)});
 assert.deepEqual(result.usage,{reasoningTokens:4});
});
