import {inspectInput} from '../dist/clinical-engine.js';
import {hasUnsafeBuddyOutput} from '../dist/buddy-policy.js';
import {modelEndpoint} from './model-provider.mjs';
import {matchesDeepSeekModel} from './deepseek-client.mjs';

const maxQueries=3;
const searchTool='plan_literature_search';
const protocol='deepseek-cited-v1';

// Planning receives public search terms only. It never receives a transcript,
// uploaded passages, patient identifiers, or a URL supplied by the model.
export function eligibleLiteratureTerms(value) {
 if(typeof value!=='string'||!value.trim()||value.length>280)return false;
 const text=value.normalize('NFKC').trim();
 if(!/^[\p{L}\p{N}\s,-]+$/u.test(text)||/\d{5,}|\b(?:mrn|ssn|patient id|postal code|home address|date of birth|patient named|patient called|record number|my name|full name|ignore .*instructions|system prompt|fetch url)\b/i.test(text))return false;
 return inspectInput(text)==='ok'&&!hasUnsafeBuddyOutput(text);
}

const normalized=value=>value.normalize('NFKC').toLowerCase().replace(/[,\s]+/g,' ').trim();
const facetPatterns=[
 ['clinical guideline',/\b(guidelines?|recommendations?|standard of care|contraindications?)\b/i],
 ['systematic review',/\b(review|evidence|effectiveness|efficacy|outcomes?|risk|benefit|harm|trial|placebo)\b/i],
 ['randomized trial',/\b(randomi[sz]ed|trial|placebo|versus|intervention|comparator)\b/i],
 ['diagnostic accuracy',/\b(diagnos\w*|screening|sensitivit\w*|specificit\w*)\b/i],
 ['adverse effects',/\b(adverse|safety|tolerab\w*|contraindications?|complications?)\b/i]
];
const genericWords=new Set('guideline guidelines trial trials review reviews systematic patient patients adults adolescents children study studies effect effects efficacy effectiveness diagnosis diagnostic safety comparison comparator outcomes treatment interventions mechanism evidence placebo versus'.split(' '));
const unique=items=>[...new Set(items)];
function vocabulary(terms,meshTerms) {
 const words=unique(normalized(terms).split(' ')).slice(0,16);
 const mesh=unique((Array.isArray(meshTerms)?meshTerms:[]).map(item=>typeof item==='string'?item:item?.label).filter(eligibleLiteratureTerms).map(normalized)).slice(0,6);
 const facets=facetPatterns.filter(([,pattern])=>pattern.test(terms)).map(([name])=>name);
 const anchors=words.filter(w=>w.length>2&&!genericWords.has(w));
 return {words,mesh,facets,anchors};
}

function deterministicPlan(vocab) {
 const {words,mesh,facets,anchors}=vocab,queries=[words.join(' ')];
 // Prefer the indexed subject heading, then a question-specific study focus.
 for(const label of mesh){
  const remaining=words.filter(w=>!label.split(' ').includes(w));
  queries.push(unique([label,...remaining]).join(' '));
  if(queries.length>=maxQueries)break;
 }
 if(facets.length&&anchors.length)queries.push(unique([...anchors,...facets[0].split(' ')]).join(' '));
 return unique(queries).slice(0,maxQueries);
}

const selectionSchema={
 type:'object',additionalProperties:false,required:['searches'],properties:{
  searches:{type:'array',items:{type:'object',additionalProperties:false,required:['terms','mesh','focus'],properties:{
   terms:{type:'array',items:{type:'integer'}},
   mesh:{type:'array',items:{type:'integer'}},
   focus:{type:'integer'}
  }}}
 }
};
const instructions='Plan up to two additional searches for biomedical evidence. Use plan_literature_search to select indices from the supplied public words, indexed MeSH headings and optional publication or clinical focus. The full input terms already form the first search. Use zero-based indices. Use focus -1 for no focus. Retain the central condition or intervention in each search. Separate relevant clinical comparisons or populations and keep each search specific to the original subject. Return selections only. Do not answer the medical question.';

function selected(indices,list) {
 if(!Array.isArray(indices)||indices.length>list.length||indices.some(n=>!Number.isInteger(n)||n<0||n>=list.length))throw Error('Invalid indices');
 return unique(indices).map(i=>list[i]);
}
function materialize(plan,vocab) {
 if(!plan||typeof plan!=='object'||Object.keys(plan).length!==1||!Array.isArray(plan.searches)||plan.searches.length>maxQueries-1)throw Error('Invalid search plan');
 const queries=[vocab.words.join(' ')];
 for(const entry of plan.searches){
  if(!entry||Object.keys(entry).sort().join(',')!=='focus,mesh,terms'||!Number.isInteger(entry.focus)||entry.focus< -1||entry.focus>=vocab.facets.length)throw Error('Invalid focus');
  const words=selected(entry.terms,vocab.words),mesh=selected(entry.mesh,vocab.mesh);
  if(!mesh.length&&!words.some(w=>vocab.anchors.includes(w)))throw Error('Missing subject');
  const focus=entry.focus<0?[]:vocab.facets[entry.focus].split(' ');
  const query=unique([...mesh.flatMap(term=>term.split(' ')),...words,...focus]).join(' ');
  if(!eligibleLiteratureTerms(query))throw Error('Invalid query');
  if(!queries.includes(query))queries.push(query);
 }
 return queries;
}

async function boundedJSON(response) {
 if(!response.body||Number(response.headers.get('content-length'))>40000)throw Error('Invalid model response');
 const reader=response.body.getReader(),decoder=new TextDecoder();let size=0,text='';
 try {
  while(true){
   const {done,value}=await reader.read();if(done)break;
   size+=value.length;if(size>40000){await reader.cancel();throw Error('Invalid model response');}
   text+=decoder.decode(value,{stream:true});
  }
 }finally{reader.releaseLock();}
 return JSON.parse(text+decoder.decode());
}
function readPlan(data) {
 const choice=data?.choices?.[0],message=choice?.message;
 if(!['stop','tool_calls'].includes(choice?.finish_reason))throw Error('Incomplete plan');
 if(message?.tool_calls){
  const calls=message.tool_calls;
  if(!Array.isArray(calls)||calls.length!==1||calls[0].type!=='function'||calls[0].function?.name!==searchTool)throw Error('Unknown tool');
  return JSON.parse(calls[0].function.arguments);
 }
 // A JSON-only endpoint can return the same restricted schema as content.
 if(typeof message?.content!=='string'||message.content.length>2600)throw Error('Missing search plan');
 return JSON.parse(message.content);
}

export async function planLiterature({terms,meshTerms=[],env={},signal,fetcher=fetch}) {
 if(signal?.aborted)signal.throwIfAborted();
 if(!eligibleLiteratureTerms(terms))return {queries:[],planner:'blocked',model:null,reason:'no_public_search_terms'};
 const vocab=vocabulary(terms,meshTerms);
 const fallback=reason=>({queries:deterministicPlan(vocab),planner:'deterministic',model:null,reason});
 const config=modelEndpoint(env,'agent');
 if(!config||config.protocol!==protocol)return fallback('planner_unconfigured');
 const timer=AbortSignal.timeout(8500),deadline=signal?AbortSignal.any([signal,timer]):timer;
 const payload={model:config.model,stream:false,max_tokens:900,messages:[
  {role:'system',content:instructions},
  {role:'user',content:JSON.stringify({words:vocab.words,mesh:vocab.mesh,focus:vocab.facets})}
 ]};
 const send=extras=>fetcher(config.url,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+config.key},
  signal:deadline,redirect:'manual',body:JSON.stringify({...payload,...extras})});
 try{
  let response=await send({tools:[{type:'function',function:{name:searchTool,description:'Select public search terms from the supplied lists.',parameters:selectionSchema}}],tool_choice:'auto'});
  if(response.status===400||response.status===422){
   // Some exact-model hosts expose JSON completions without native tool calls.
   await response.body?.cancel();
   payload.messages[0]={role:'system',content:instructions+' Return a JSON object with searches, each containing terms (integer array), mesh (integer array), and focus (integer).'};
   response=await send({response_format:{type:'json_object'}});
  }
  if(!response.ok){await response.body?.cancel();return fallback('planner_unavailable');}
  const data=await boundedJSON(response);
  if(!matchesDeepSeekModel(data.model,config.model))return fallback('planner_unavailable');
  const proposal=readPlan(data);
  return {queries:materialize(proposal,vocab),planner:'deepseek',model:config.model};
 }catch{
  if(signal?.aborted)signal.throwIfAborted();
  return fallback('planner_unavailable');
 }
}
