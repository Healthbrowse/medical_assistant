import test from 'node:test';
import assert from 'node:assert/strict';
import {isModelDisabled} from '../server/model-policy.mjs';
import {buddyModelRoutes,buddyEndpoint,browserModelRoutes,modelEndpoint,modelReviewEndpoint,fallbackEndpoint,DEEPSEEK_MODELS,GROQ_CHAT_URL} from '../server/model-provider.mjs';
import {buddyModelNames} from '../server/public-config.mjs';
import {workersEndpoint,workersModels} from '../server/workers-ai.mjs';
import {modelAPI} from '../server/model-api.mjs';
import {planLiterature} from '../server/literature-plan.mjs';

const env={MODEL_PROVIDER:'deepseek',HF_TOKEN:'fixture-hf',GROQ_API_KEY:'fixture-groq',SARVAM_API_KEY:'fixture-sarvam',AI:{run(){assert.fail('No inference in routing tests')}}};
const disabled=(model,extra={})=>({...env,...extra,MODEL_DISABLED_MODELS:model});

test('disablement matches exact checkpoint IDs and leaves defaults or unknown entries unchanged',()=>{
 for(const setting of [undefined,'',' , unknown-model, ','DeepSeek-R1-Distill-Llama-8B',DEEPSEEK_MODELS.general.toUpperCase()]){
  const config={...env,MODEL_DISABLED_MODELS:setting};
  assert.equal(isModelDisabled(config,DEEPSEEK_MODELS.general),false);
  assert.deepEqual([...browserModelRoutes(config).keys()],[...browserModelRoutes(env).keys()]);
 }
 assert.equal(isModelDisabled(disabled('unknown-model, '+DEEPSEEK_MODELS.general+' ,'),DEEPSEEK_MODELS.general),true);
});

test('disabling one DeepSeek checkpoint removes that role everywhere and preserves other checkpoints',()=>{
 const config=disabled(DEEPSEEK_MODELS.general);
 assert.equal(modelEndpoint(config,'general'),null);
 assert.equal(modelReviewEndpoint(config,'general'),null);
 assert.equal(buddyEndpoint(config,'deepseek','general'),null);
 assert.equal(buddyModelRoutes(config,'general').has('deepseek'),false);
 assert.equal(browserModelRoutes(config).has(DEEPSEEK_MODELS.general),false);
 assert.equal(buddyModelNames(config).general,null);
 assert.equal(modelEndpoint(config,'professional').model,DEEPSEEK_MODELS.professional);
 assert.equal(modelEndpoint(config,'agent').model,DEEPSEEK_MODELS.agent);
 assert.equal(buddyModelNames(config).professional,DEEPSEEK_MODELS.professional);
 assert.equal(fallbackEndpoint({...config,MODEL_FALLBACK_PROVIDER:'groq'}).model,'openai/gpt-oss-120b');
});

test('disabled Workers and Sarvam checkpoints cannot bypass policy through named choices',()=>{
 const config=disabled(workersModels.professional,{MODEL_PROVIDER:'workers-ai'});
 assert.equal(workersEndpoint(config,'professional'),null);
 assert.equal(modelEndpoint(config,'professional'),null);
 assert.equal(buddyEndpoint(config,'workers-ai','professional'),null);
 assert.equal(browserModelRoutes(config).has(workersModels.professional),false);
 assert.equal(buddyModelNames(config).workers.professional,null);
 assert.equal(workersEndpoint(config,'general').model,workersModels.general);
 const sarvam='deepseekv4.1-flash-1017',sarvamConfig=disabled(sarvam,{MODEL_PROVIDER:'sarvam'});
 assert.equal(modelEndpoint(sarvamConfig,'general'),null);
 assert.equal(buddyModelNames(sarvamConfig).sarvam,undefined);
 assert.equal(browserModelRoutes(sarvamConfig).has(sarvam),false);
 assert.equal(modelEndpoint({...sarvamConfig,SARVAM_MODEL:sarvam+'-interactive'},'general').model,sarvam+'-interactive');
});

test('disablement reaches Groq fallback and automatic reviewers, including custom reviewer endpoints',()=>{
 const groq='openai/gpt-oss-120b',reviewer='openai/gpt-oss-20b';
 const primaryDisabled=disabled(groq,{MODEL_PROVIDER:'groq'});
 assert.equal(modelEndpoint(primaryDisabled,'general'),null);
 assert.equal(buddyEndpoint(primaryDisabled,'groq','agent'),null);
 assert.equal(fallbackEndpoint({...primaryDisabled,MODEL_PROVIDER:'deepseek',MODEL_FALLBACK_PROVIDER:'groq'}),null);
 const reviewDisabled=disabled(reviewer,{MODEL_PROVIDER:'groq'});
 assert.equal(modelEndpoint(reviewDisabled,'general').model,groq);
 assert.equal(modelReviewEndpoint(reviewDisabled,'general'),null);
 assert.equal(modelEndpoint({...reviewDisabled,GROQ_MODEL:reviewer},'general'),null);
 const custom={MODEL_PROVIDER:'custom',MODEL_GENERAL_URL:'https://model.example/v1/chat/completions',MODEL_GENERAL_KEY:'fixture-key',
  MODEL_GENERAL_ID:'custom-generator',MODEL_GENERAL_REVIEW_ID:'custom-reviewer',MODEL_GENERAL_PROTOCOL:'grounded-v2'};
 assert.equal(modelReviewEndpoint(custom,'general').model,'custom-reviewer');
 assert.equal(modelReviewEndpoint({...custom,MODEL_DISABLED_MODELS:'custom-reviewer'},'general'),null);
});

test('stale explicit selectors reject disabled checkpoints before authentication or inference',async t=>{
 t.mock.method(globalThis,'fetch',()=>assert.fail('A disabled checkpoint must not cause a request'));
 const config=disabled(DEEPSEEK_MODELS.general+','+workersModels.professional);
 const input={topic:'Pituitary gland',question:'What is the main function of the pituitary gland?',role:'General',mode:'chat',deck:0};
 for(const [patch,code] of [
  [{buddyModel:'deepseek'},'buddy_model_unavailable'],
  [{mode:'search',browserModel:DEEPSEEK_MODELS.general},'browser_model_unavailable'],
  [{role:'Clinicians',buddyModel:'workers-ai'},'buddy_model_unavailable']
 ]){
  const response=await modelAPI(new Request('https://site.test/api/ai/answer',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...input,...patch})}),config,{});
  assert.equal(response.status,400);assert.equal((await response.json()).code,code);
 }
});

test('disabling the hidden planner prevents its invocation while retaining an allowed automatic backup',async()=>{
 const config=disabled(DEEPSEEK_MODELS.agent,{MODEL_FALLBACK_PROVIDER:'groq'});
 const options={terms:'hypertension exercise outcomes',env:config};
 const explicit=await planLiterature({...options,buddyModel:'deepseek',fetcher:()=>assert.fail('Explicit disabled planner cannot use another provider')});
 assert.equal(explicit.planner,'deterministic');assert.equal(explicit.model,null);
 let calls=0;
 const automatic=await planLiterature({...options,fetcher:async(url,request)=>{
  calls++;assert.equal(url,GROQ_CHAT_URL);
  const {model}=JSON.parse(request.body);assert.equal(model,'openai/gpt-oss-120b');
  return Response.json({model,choices:[{finish_reason:'stop',message:{content:'{"searches":[]}'}}]});
 }});
 assert.equal(automatic.planner,'groq');assert.equal(calls,1);
});
