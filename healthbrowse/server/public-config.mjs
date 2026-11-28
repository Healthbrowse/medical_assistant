import {buddyModelRoutes} from './model-provider.mjs';

export function buddyModelNames(env){
  const general=buddyModelRoutes(env,'general'),professional=buddyModelRoutes(env,'professional');
  const names=choice=>({general:general.get(choice)?.model||null,professional:professional.get(choice)?.model||null});
  const choices=[...new Set([...general.keys(),...professional.keys()])];
  const preferred=choices.includes(env.MODEL_PROVIDER)?env.MODEL_PROVIDER:choices[0];
  return {
    ...names('deepseek'),
    ...(choices.includes('groq')?{groq:general.get('groq')?.model||professional.get('groq').model}:{}),
    ...(choices.includes('workers-ai')?{workers:names('workers-ai')}:{}),
    ...(choices.includes('sarvam')?{sarvam:names('sarvam')}:{}),
    ...(preferred?{preferred}:{})
  };
}

// Reject accidentally supplied secret/service-role keys before returning any browser config.
export function browserConfig(env){
  const key=env.SUPABASE_ANON_KEY||'';
  let publishable=key.startsWith('sb_publishable_');
  if(!publishable && key.split('.').length===3)try{
    const payload=key.split('.')[1].replace(/-/g,'+').replace(/_/g,'/');
    publishable=JSON.parse(atob(payload)).role==='anon';
  }catch{}
  try{
    const origin=new URL(env.SUPABASE_URL||'');
    if(!publishable || origin.username || origin.password || origin.search || origin.hash || origin.pathname!=='/' ||
      !(origin.protocol==='https:' || (origin.protocol==='http:' && ['localhost','127.0.0.1','[::1]'].includes(origin.hostname))))throw Error();
    return {supabaseUrl:origin.origin,supabaseAnonKey:key};
  }catch{return {supabaseUrl:'',supabaseAnonKey:''}}
}
