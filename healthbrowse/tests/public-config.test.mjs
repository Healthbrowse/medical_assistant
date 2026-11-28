import test from 'node:test';
import assert from 'node:assert/strict';
import {browserConfig,buddyModelNames} from '../server/public-config.mjs';
import {buddyModelRoutes,buddyEndpoint,browserModelRoutes,modelEndpoint,fallbackEndpoint,DEEPSEEK_MODELS} from '../server/model-provider.mjs';
import {offersWorkersModels,workersModels} from '../server/workers-ai.mjs';
test('the public configuration never exposes service secrets',()=>{
 const y=key=>browserConfig({SUPABASE_URL:'https://demo.supabase.co',SUPABASE_ANON_KEY:key}).supabaseAnonKey;
 assert.equal(y('sb_secret_example'),'');assert.equal(y('a.'+btoa('{"role":"service_role"}')+'.b'),'');
 assert.equal(y('sb_publishable_example'),'sb_publishable_example');
});

test('public model names contain only configured role endpoints and no credentials',()=>{
 const AI={run(){}},sarvam='deepseekv4.1-flash-1017';
 const env={MODEL_PROVIDER:'sarvam',HF_TOKEN:'private-hf-token',GROQ_API_KEY:'private-groq-key',SARVAM_API_KEY:'private-sarvam-key',AI};
 const names=buddyModelNames(env);
 assert.deepEqual(names,{general:DEEPSEEK_MODELS.general,professional:DEEPSEEK_MODELS.professional,groq:'openai/gpt-oss-120b',
  workers:{general:workersModels.general,professional:workersModels.professional},sarvam:{general:sarvam,professional:sarvam},preferred:'sarvam'});
 assert.doesNotMatch(JSON.stringify(names),/private-|key|token|api\.sarvam|https:/);
 for(const role of ['general','professional']){
  const routes=buddyModelRoutes(env,role);
  assert.deepEqual([...routes.keys()],['sarvam','workers-ai','deepseek','groq']);
  for(const [choice,config] of routes){
   assert.equal(buddyEndpoint(env,choice,role).model,config.model);
   assert.ok(browserModelRoutes(env).has(config.model));
  }
 }
 assert.equal(buddyModelRoutes(env,'agent').has('sarvam'),false);
 assert.equal(browserModelRoutes(env).has(DEEPSEEK_MODELS.agent),false);
 assert.equal(buddyEndpoint(env,'unknown-provider','general'),null);
});

test('absent credentials and missing AI binding do not advertise a configured model',()=>{
 for(const env of [{},{MODEL_PROVIDER:'workers-ai'},{MODEL_PROVIDER:'deepseek',HF_TOKEN:' '},
  {MODEL_PROVIDER:'sarvam',SARVAM_API_KEY:''},{MODEL_PROVIDER:'groq',GROQ_API_KEY:' '}]){
  assert.deepEqual(buddyModelNames(env),{general:null,professional:null});
  assert.deepEqual([...buddyModelRoutes(env,'general')],[]);
  assert.deepEqual([...browserModelRoutes(env)],[]);
  assert.equal(offersWorkersModels(env),false);
 }
 const env={MODEL_PROVIDER:'sarvam',AI:{run(){}}};
 assert.equal(offersWorkersModels(env),true);
 assert.equal(buddyModelNames(env).preferred,'workers-ai');
 assert.equal(buddyEndpoint(env,'workers-ai','professional').model,workersModels.professional);
});

test('invalid role overrides remove only that capability without deleting valid model IDs',()=>{
 const env={MODEL_PROVIDER:'deepseek',HF_TOKEN:'test-hf-token',DEEPSEEK_GENERAL_MODEL:'invalid-private-value',
  DEEPSEEK_CLINICIAN_MODEL:'deepseek-ai/DeepSeek-R1-Distill-Qwen-14B',GROQ_API_KEY:'test-groq-key',
  SARVAM_API_KEY:'test-sarvam-key',SARVAM_MODEL:DEEPSEEK_MODELS.general};
 const names=buddyModelNames(env);
 assert.equal(names.general,null);
 assert.equal(names.professional,env.DEEPSEEK_CLINICIAN_MODEL);
 assert.equal(names.sarvam,undefined);
 assert.equal(buddyModelRoutes(env,'general').has('deepseek'),false);
 assert.equal(buddyModelRoutes(env,'professional').has('deepseek'),true);
 const light='deepseek-ai/DeepSeek-R1-0528-Qwen3-8B';
 for(const role of ['general','professional'])assert.equal(buddyModelRoutes({...env,DEEPSEEK_GENERAL_MODEL:light,DEEPSEEK_CLINICIAN_MODEL:light},role).get('deepseek').model,light);
});

test('the configured Groq checkpoint is consistent in automatic, Buddy, Browser and fallback routing',()=>{
 const model='openai/gpt-oss-20b',env={MODEL_PROVIDER:'groq',GROQ_API_KEY:'test-groq-key',GROQ_MODEL:model};
 assert.deepEqual(buddyModelNames(env),{general:null,professional:null,groq:model,preferred:'groq'});
 assert.equal(modelEndpoint(env,'general').model,model);
 assert.equal(buddyEndpoint(env,'groq','professional').model,model);
 assert.deepEqual([...browserModelRoutes(env).keys()],[model]);
 const secondary={...env,MODEL_PROVIDER:'workers-ai'};
 assert.equal(buddyEndpoint(secondary,'groq','general').model,model);
 assert.equal(fallbackEndpoint(secondary),null,'A configured manual choice does not enable automatic fallback');
 assert.equal(fallbackEndpoint({...secondary,MODEL_FALLBACK_PROVIDER:'groq'}).model,model);
 assert.equal(buddyModelNames({...env,GROQ_MODEL:'unsupported-checkpoint'}).groq,undefined);
});
