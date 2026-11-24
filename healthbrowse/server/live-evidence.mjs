import {topicIndex,resolveSearch} from '../dist/discovery.js';
import {inspectInput,inspectQuery} from '../dist/clinical-engine.js';
import {decode,plainText} from './retrieval-text.mjs';
import {planLiterature} from './literature-plan.mjs';
import {runLiteratureSearch} from './literature-search.mjs';
export {plainText} from './retrieval-text.mjs';
import {contextCareQuestion,publicQuestionTopic} from '../dist/query-input.js';
import {retrievalTerms,usesActiveTopic} from '../dist/query-understanding.js';
import {domains} from '../dist/disease-framework.js';
import {faqQuestions} from '../dist/faq-spec.js';
import {readingProfile} from '../dist/reading-profiles.js';
import {assessBuddySafety,hasUnsafeBuddyOutput} from '../dist/buddy-policy.js';
import {assessSafety} from '../dist/safety-policy.js';
import {parseFullText} from './pmc-fulltext.mjs';
const cache=new Map(),pending=new Map(),ttl=12*60*60*1000;
class RetrievalFailure extends Error{constructor(reason,status){super(reason);this.reason=reason;this.status=status;}}
function providerFailure(name,error){
 const reason=error instanceof RetrievalFailure?error.reason:['TimeoutError','AbortError'].includes(error?.name)?'timeout_or_cancelled':error instanceof SyntaxError?'invalid_response':'request_failed';
 const result={name,status:'unavailable',reason,...(Number.isInteger(error?.status)?{httpStatus:error.status}:{})};
 // Operational metadata only: never log the query, identity, URL or response body.
 console.warn(JSON.stringify({event:'evidence_provider_unavailable',...result}));return result;
}
const signals=[/\b(?:epidemiolog\w*|incidence|prevalence|risk|population|prevent\w*|more common|most common)\b/i,/\b(?:function\w*|mechanism\w*|caus\w*|etiolog\w*|pathogen\w*|hormone\w*|produce\w*|regulat\w*|genetic\w*|cell\w*|physiolog\w*|metabol\w*)\b/i,/\b(?:symptoms?|signs?|pain|headaches?|vision|fatigue|fever|presentation|manifestation\w*)\b/i,/\b(?:diagnos\w*|tests?|assay\w*|screen\w*|biops\w*|imaging|examination)\b/i,/\b(?:treat\w*|therap\w*|management|medicines?|medications?|surgery|rehabilitation)\b/i,/\b(?:prognos\w*|outcomes?|complication\w*|follow.up|survival|mortality|natural history|progress\w*|monitor\w*)\b/i];
const safe=text=>text.length>=35&&!hasUnsafeBuddyOutput(text)&&assessBuddySafety(text).action==='allow'&&assessSafety(text).action==='allow';
const stem=s=>s.length>4?s.replace(/ies$/,'y').replace(/s$/,''):s;
function relevant(text,terms){const present=new Set((text.toLowerCase().match(/[a-z][a-z-]*/g)||[]).map(stem)),wanted=terms.split(' ').map(stem);return wanted.length&&wanted.filter(t=>present.has(t)).length>=Math.max(1,Math.ceil(wanted.length*.6));}
export function sourcePassages(text,meta,{verifiedText=false}={}){
 // Inspect before stripping markup: role/audio markers must not disappear into
 // otherwise plausible medical prose. Never accept an instruction-bearing source.
 const raw=decode(decode(text));
 if(hasUnsafeBuddyOutput(raw)||assessBuddySafety(raw).action!=='allow')return [];
 const rows=[];
 for(const p of (verifiedText?text:plainText(text)).split('\n')){
  // Keep complete paragraphs. A long abstract is split only at sentence boundaries.
  let buffer='';const parts=[];
  for(const sentence of (p.length<=1800?[p]:p.split(/(?<=[.!?])\s+(?=[A-Z])/))){if((buffer+sentence).length>1800){if(buffer)parts.push(buffer.trim());buffer=''}if(sentence.length<=1800)buffer+=(buffer?' ':'')+sentence;}
  if(buffer)parts.push(buffer.trim());
  for(const part of parts){if(!safe(part))continue;rows.push({...meta,text:part,deck:0,overview:true});
   signals.forEach((pattern,i)=>{if(pattern.test(part))rows.push({...meta,text:part,deck:i+1,overview:false});});
  }
 }
 return rows;
}
export function parseMedline(xml,terms,now=new Date().toISOString()){
 const rows=[];
 for(const match of xml.matchAll(/<document\b([^>]*)>([\s\S]*?)<\/document>/g)){
  const url=decode(match[1].match(/\burl="([^"]+)"/)?.[1]||'');
  if(!/^https:\/\/medlineplus\.gov\/[a-z0-9-]+\.html$/.test(url))continue;
  const content=Object.fromEntries([...match[2].matchAll(/<content\b[^>]*name="([^"]+)"[^>]*>([\s\S]*?)<\/content>/g)].map(m=>[m[1],m[2]]));
  const title=plainText(content.title),summary=plainText(content.FullSummary);
  if(!summary||!relevant(title+' '+summary,terms))continue;
  rows.push(...sourcePassages(content.FullSummary,{title:title+' · MedlinePlus, National Library of Medicine',url,date:'Retrieved '+now,sourceType:'patient education · MedlinePlus health-topic summary',retrievedAt:now,live:true}));
 }
 return rows.slice(0,70);
}
export function parseEuropePMC(data,terms,now=new Date().toISOString()){
 const rows=[];
 for(const p of data?.resultList?.result||[]){
  if(p.source!=='MED'||!/^\d+$/.test(p.id||'')||!p.abstractText||p.isRetracted==='Y'||p.pubTypeList?.pubType?.some(t=>/retract|preprint/i.test(t)))continue;
  const text=plainText(p.abstractText),title=plainText(p.title);if(!relevant(title+' '+text,terms))continue;
  rows.push(...sourcePassages(p.abstractText,{title:title+' · '+(p.journalInfo?.journal?.title||'Indexed publication'),url:'https://pubmed.ncbi.nlm.nih.gov/'+p.id+'/',date:(p.firstPublicationDate||p.pubYear||'Publication date unavailable')+'; retrieved '+now,sourceType:'indexed research abstract · not a clinical guideline',retrievedAt:now,live:true,abstractOnly:true,authors:plainText(p.authorString||''),license:p.license||'Publisher terms apply; not licensed here for training',publicationTypes:p.pubTypeList?.pubType||[],pmcid:/^PMC\d+$/.test(p.pmcid||'')?p.pmcid:null,openAccess:p.isOpenAccess==='Y'&&p.inEPMC==='Y'}));
 }
 return rows.slice(0,100);
}
async function readBounded(res,max=700000){
 if(!res.ok)throw new RetrievalFailure('http_error',res.status);const reader=res.body.getReader(),decoder=new TextDecoder();let size=0,text='';
 try{while(true){const r=await reader.read();if(r.done)break;size+=r.value.byteLength;if(size>max){await reader.cancel();throw Error('Source too large')}text+=decoder.decode(r.value,{stream:true})}}finally{reader.releaseLock()}
 return text+decoder.decode();
}
async function providerBudget(env,name,max){
 if(!env.DB)return true;const bucket=Math.floor(Date.now()/60000);
 const result=await env.DB.prepare(`INSERT INTO hb_model_limits (user_id,bucket,requests) VALUES (?,?,1) ON CONFLICT(user_id) DO UPDATE SET bucket=excluded.bucket,requests=CASE WHEN hb_model_limits.bucket=excluded.bucket THEN hb_model_limits.requests+1 ELSE 1 END WHERE hb_model_limits.bucket<>excluded.bucket OR hb_model_limits.requests<?`).bind('source:'+name,bucket,max).run();return !!result.meta?.changes;
}
const topicIndexes=new WeakMap();
export function medicalTopicIndex(assets){
 if(!assets)return new Map();
 let index=topicIndexes.get(assets);
 if(!index){
  const vocabulary=JSON.parse(assets['/topic-list.json']?.text||'[]');
  const feed=JSON.parse(assets['/medline-topics.json']?.text||'{}');
  index=topicIndex((feed.topics||[]).map(r=>({name:r.title,aliases:r.aliases||[]})),vocabulary);
  topicIndexes.set(assets,index);
 }
 return index;
}
function publicTerms(input,assets){
 if(input.role==='General reader'&&assets){
  const index=medicalTopicIndex(assets);
  const current=input.mode==='chat'?index.get((input.topic||'').toLowerCase()):'';
  const subject=publicQuestionTopic(input.question,index,current);
  if(subject!==null)return retrievalTerms(subject);
 }
 return retrievalTerms(input.question,{topic:input.topic,context:input.mode==='chat'});
}
async function collect(input,env,signal,fetcher,assets){
 const terms=publicTerms(input,assets);
 if(!terms)return {sources:[],providers:[],terms:''};
 const key=input.role+'|'+terms,existing=cache.get(key);if(existing&&Date.now()-existing.time<ttl)return {...existing.value,cached:true};
 // Single-flight and cache store public keyword queries, never raw personal input or identities.
 if(pending.has(key))return pending.get(key);
 const task=(async()=>{
  const now=new Date().toISOString(),providers=[];
  const medline=new URL('https://wsearch.nlm.nih.gov/ws/query');medline.search=new URLSearchParams({db:'healthTopics',term:terms,retmax:'4',rettype:'brief',tool:'HealthBrowse'}).toString();
  const epmc=new URL('https://www.ebi.ac.uk/europepmc/webservices/rest/search');
  const publicQuery=terms.split(' ').map(t=>'"'+t+'"').join(' AND ');
  const profile=input.role==='General reader'?' AND PUB_TYPE:Review':'';
  epmc.search=new URLSearchParams({query:'('+publicQuery+') AND SRC:MED AND HAS_ABSTRACT:Y NOT PUB_TYPE:"Retracted Publication"'+profile,resultType:'core',pageSize:'4',format:'json'}).toString();
  const request=async(name,url,parse)=>{try{
   if(!await providerBudget(env,name,name==='MedlinePlus'?70:90))throw new RetrievalFailure('rate_limit');
   const timeout=AbortSignal.timeout(9000),combined=signal?AbortSignal.any([signal,timeout]):timeout;
   // Workers rejects redirect:"error" before sending a request. Manual mode
   // plus readBounded's !ok check rejects redirects without following them.
   const res=await fetcher(url.href,{headers:{Accept:name==='MedlinePlus'?'application/xml':'application/json'},redirect:'manual',signal:combined});
   const text=await readBounded(res),sources=parse(text);providers.push({name,status:sources.length?'available':'no_matches'});return sources;
  }catch(error){providers.push(providerFailure(name,error));return []}};
  const tasks=[request('MedlinePlus',medline,text=>parseMedline(text,terms,now))];
  // All audiences can ask beyond patient topics; clinical and educational modes
  // prioritize literature. General can use research only with explicit source limits.
  tasks.push(request('Europe PMC',epmc,text=>parseEuropePMC(JSON.parse(text),terms,now)));
  const rows=await Promise.all(tasks),fulltext=[];
  // Only two eligible articles per request, sequentially. Never scrape publisher pages.
  const candidates=[...new Map(rows[1].filter(s=>s.openAccess&&s.pmcid).map(s=>[s.pmcid,s])).values()].slice(0,2);
  for(const source of candidates){try{
   if(!await providerBudget(env,'Europe PMC full text',60))throw new RetrievalFailure('rate_limit');
   const timeout=AbortSignal.timeout(6000),combined=signal?AbortSignal.any([signal,timeout]):timeout;
   const response=await fetcher('https://www.ebi.ac.uk/europepmc/webservices/rest/'+source.pmcid+'/fullTextXML',{headers:{Accept:'application/xml'},redirect:'manual',signal:combined});
   const article=parseFullText(await readBounded(response,1500000),source.pmcid);
   if(!article){providers.push({name:'Europe PMC full text',status:'license_or_content_unavailable'});continue;}
   for(const p of article.paragraphs)fulltext.push(...sourcePassages(p.text,{...source,heading:p.heading,url:'https://pmc.ncbi.nlm.nih.gov/articles/'+source.pmcid+'/',abstractOnly:false,license:article.license,attribution:(source.authors?source.authors+' · ':'')+article.license+' · Extracted passages; no changes to source wording',sourceType:'open-access research full text · not independently appraised'}));
   providers.push({name:'Europe PMC full text',status:article.paragraphs.length?'available':'no_matches'});
  }catch(error){providers.push(providerFailure('Europe PMC full text',error))}}
  const sources=input.role==='General reader'?[...rows[0],...fulltext,...rows[1]]:[...fulltext,...rows[1],...rows[0]];
  const value={sources,providers,terms,retrievedAt:now};
  if(sources.length){cache.set(key,{time:Date.now(),value});while(cache.size>40)cache.delete(cache.keys().next().value)}
  return value;
 })();pending.set(key,task);try{return await task}finally{pending.delete(key)}
}
const packetCache=new Map(), meshIndexes=new WeakMap();
const emptyPacket=gap=>({query_decomposition:[],retrieved_sources:[],evidence_gaps:[gap]});
function packetInputs(input,assets){
 const question=input.question||'';
 if([question,input.topic,input.searchQuery].filter(Boolean).some(value=>inspectQuery(value)!=='ok'))return null;
 const index=medicalTopicIndex(assets);
 const current=index.get((input.topic||'').toLowerCase());
 // Only catalogued public concepts leave the app when working from a personal narrative.
 const personal=[question,input.searchQuery,input.topic].filter(Boolean).some(value=>inspectInput(value)==='private');
 const matched=resolveSearch(question,index).choices.slice(0,3);
 const terms=personal?retrievalTerms(matched.join(' ')||(input.mode==='chat'?current||'':'')):publicTerms(input,assets);
 if(!terms)return null;
 const topics=matched.length?matched:current?[current]:[];
 let meshIndex=assets&&meshIndexes.get(assets);
 if(assets&&!meshIndex){
  meshIndex=new Map((JSON.parse(assets['/medline-topics.json']?.text||'{}').topics||[]).map(r=>[r.title,r.mesh||[]]));
  meshIndexes.set(assets,meshIndex);
 }
 const meshTerms=topics.flatMap(topic=>meshIndex?.get(topic)||[]).slice(0,6);
 return {terms,meshTerms,personal};
}
export async function retrieveLiteraturePacket(input,env={},signal,fetcher=fetch,assets){
 const args=packetInputs(input,assets);
 if(!args)return emptyPacket('This question needs a public biomedical topic before a literature search can run.');
 if(env.RETRIEVAL_LIVE==='off')return emptyPacket('Live literature retrieval is disabled in this environment.');
 const key=JSON.stringify([env.MODEL_PROVIDER||'',args.terms,args.meshTerms.map(m=>m.id||m.label)]);
 const cached=!args.personal&&packetCache.get(key);
 if(cached&&Date.now()-cached.time<30*60*1000)return cached.packet;
 const plan=await planLiterature({...args,env,signal,fetcher});
 if(!plan.queries.length)return emptyPacket('The search planner could not form an eligible public biomedical query.');
 const packet=await runLiteratureSearch({terms:args.terms,queries:plan.queries,assets,signal,fetcher,reserve:host=>providerBudget(env,host,90)});
 if(plan.planner==='deterministic')packet.evidence_gaps.push('Search used public keywords and indexed terms because the model planner was unavailable.');
 if(!args.personal&&['deepseek','groq'].includes(plan.planner)&&packet.retrieved_sources.length){
  packetCache.set(key,{packet,time:Date.now()});while(packetCache.size>30)packetCache.delete(packetCache.keys().next().value);
 }
 return packet;
}
function selectedPassages(packet){
 return packet.retrieved_sources.flatMap(source=>{
  const study=Array.isArray(source.study_design)?source.study_design:[source.study_design].filter(Boolean);
  return source.extracted_findings.flatMap(finding=>sourcePassages(finding.text,{
   title:source.title,url:source.full_text_url||source.url,date:source.publication_year?String(source.publication_year):'Publication year unavailable',
   sourceType:source.source_id.startsWith('PMID:')?'indexed publication · '+(study.join(', ')||'abstract'):'institutional reference',
   sourceIdentifier:source.source_id,evidenceTier:source.evidence_tier,heading:finding.section||finding.field,
   publicationTypes:study,abstractOnly:source.abstract_only===true,live:true,
   ...(source.license?{license:source.license,attribution:source.attribution}:{})
  },{verifiedText:true}));
 });
}
export async function retrieveEvidence(input,base,env={},signal,fetcher=fetch,assets){
 if(env.RETRIEVAL_LIVE==='off')return base;
 let live;
 if(env.MODEL_PROVIDER==='deepseek'){
  const packet=await retrieveLiteraturePacket(input,env,signal,fetcher,assets);
  live={sources:selectedPassages(packet),evidencePacket:packet,retrievedAt:new Date().toISOString(),providers:[{name:'Verified biomedical literature',status:packet.retrieved_sources.length?'available':packet.evidence_gaps.some(g=>/unavailable|could not be completed/.test(g))?'unavailable':'no_matches'}]};
 }else live=await collect(input,env,signal,fetcher,assets);
 const sources=[],seen=new Set();
 // Keep an unrelated active browser topic out of a new, explicit Buddy question.
 const q=String(input.question||''),followup=usesActiveTopic(q)||(input.role==='General reader'&&contextCareQuestion(q));
 const subjectWords=retrievalTerms(input.topic).split(' '),questionWords=new Set(retrievalTerms(q).split(' '));
 const newSubject=input.mode==='chat'&&!followup&&questionWords.size>0&&subjectWords.every(w=>!questionWords.has(w))&&!/^(?:symptoms?|treatment|causes?|diagnosis|tests?)\W*$/i.test(q);
 if(newSubject)base=null;
 // Live retrieval is not training data and never accepts client-supplied passages.
 for(const source of [...live.sources,...(base?.sources||[])]){const key=source.deck+'|'+source.url+'|'+source.text;if(seen.has(key))continue;seen.add(key);sources.push({...source,id:'S'+(sources.length+1)})}
 return {...(base||{topic:input.topic,role:input.role,style:readingProfile(input.role).style,domains:domains.slice(0,6).map((d,i)=>({id:i+1,title:d.title,question:faqQuestions[i],scope:d.scope}))}),sources,
  snapshot:live.retrievedAt||base?.snapshot,retrieval:{providers:live.providers,...(live.evidencePacket?{evidencePacket:live.evidencePacket}:{}),cached:!!live.cached,sourceCount:new Set(live.sources.map(s=>s.url)).size}};
}
export function clearRetrievalCache(){cache.clear();packetCache.clear();pending.clear()}
