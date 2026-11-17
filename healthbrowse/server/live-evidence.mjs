import {retrievalTerms,usesActiveTopic} from '../dist/query-understanding.js';
import {domains} from '../dist/disease-framework.js';
import {faqQuestions} from '../dist/faq-spec.js';
import {readingProfile} from '../dist/reading-profiles.js';
import {assessBuddySafety,hasUnsafeBuddyOutput} from '../dist/buddy-policy.js';
import {assessSafety} from '../dist/safety-policy.js';
const cache=new Map(),pending=new Map(),ttl=12*60*60*1000;
const decode=text=>String(text||'').replace(/&#(x[\da-f]+|\d+);/gi,(_,n)=>{const c=n[0].toLowerCase()==='x'?parseInt(n.slice(1),16):Number(n);return c>0&&c<=0x10ffff?String.fromCodePoint(c):''}).replace(/&(lt|gt|quot|apos|amp|nbsp);/g,(_,n)=>({lt:'<',gt:'>',quot:'"',apos:"'",amp:'&',nbsp:' '}[n]));
export const plainText=text=>decode(decode(text)).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,' ').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,' ').replace(/<\/?(?:p|div|h[1-6]|li|abstracttext|title)\b[^>]*>/gi,'\n').replace(/<[^>]*>/g,' ').split('\n').map(s=>s.replace(/\s+/g,' ').trim()).filter(Boolean).join('\n');
const signals=[/\b(?:epidemiolog\w*|incidence|prevalence|risk|population|prevent\w*|more common|most common)\b/i,/\b(?:function\w*|mechanism\w*|caus\w*|etiolog\w*|pathogen\w*|hormone\w*|produce\w*|regulat\w*|genetic\w*|cell\w*|physiolog\w*|metabol\w*)\b/i,/\b(?:symptoms?|signs?|pain|headaches?|vision|fatigue|fever|presentation|manifestation\w*)\b/i,/\b(?:diagnos\w*|tests?|assay\w*|screen\w*|biops\w*|imaging|examination)\b/i,/\b(?:treat\w*|therap\w*|management|medicines?|medications?|surgery|rehabilitation)\b/i,/\b(?:prognos\w*|outcomes?|complication\w*|follow.up|survival|mortality|natural history|progress\w*|monitor\w*)\b/i];
const safe=text=>text.length>=35&&!hasUnsafeBuddyOutput(text)&&assessBuddySafety(text).action==='allow'&&assessSafety(text).action==='allow';
const stem=s=>s.length>4?s.replace(/ies$/,'y').replace(/s$/,''):s;
function relevant(text,terms){const present=new Set((text.toLowerCase().match(/[a-z][a-z-]*/g)||[]).map(stem)),wanted=terms.split(' ').map(stem);return wanted.length&&wanted.filter(t=>present.has(t)).length>=Math.max(1,Math.ceil(wanted.length*.6));}
export function sourcePassages(text,meta){
 const rows=[];
 for(const p of plainText(text).split('\n')){
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
  rows.push(...sourcePassages(summary,{title:title+' · MedlinePlus, National Library of Medicine',url,date:'Retrieved '+now,sourceType:'patient education · MedlinePlus health-topic summary',retrievedAt:now,live:true}));
 }
 return rows.slice(0,70);
}
export function parseEuropePMC(data,terms,now=new Date().toISOString()){
 const rows=[];
 for(const p of data?.resultList?.result||[]){
  if(p.source!=='MED'||!/^\d+$/.test(p.id||'')||!p.abstractText||p.isRetracted==='Y'||p.pubTypeList?.pubType?.some(t=>/retract|preprint/i.test(t)))continue;
  const text=plainText(p.abstractText),title=plainText(p.title);if(!relevant(title+' '+text,terms))continue;
  rows.push(...sourcePassages(text,{title:title+' · '+(p.journalInfo?.journal?.title||'Indexed publication'),url:'https://pubmed.ncbi.nlm.nih.gov/'+p.id+'/',date:(p.firstPublicationDate||p.pubYear||'Publication date unavailable')+'; retrieved '+now,sourceType:'indexed research abstract · not a clinical guideline',retrievedAt:now,live:true,abstractOnly:true,license:p.license||'Publisher terms apply; not licensed here for training',publicationTypes:p.pubTypeList?.pubType||[]}));
 }
 return rows.slice(0,100);
}
async function readBounded(res){
 if(!res.ok)throw Error('Source unavailable');const reader=res.body.getReader(),decoder=new TextDecoder();let size=0,text='';
 try{while(true){const r=await reader.read();if(r.done)break;size+=r.value.byteLength;if(size>700000){await reader.cancel();throw Error('Source too large')}text+=decoder.decode(r.value,{stream:true})}}finally{reader.releaseLock()}
 return text+decoder.decode();
}
async function providerBudget(env,name,max){
 if(!env.DB)return true;const bucket=Math.floor(Date.now()/60000);
 const result=await env.DB.prepare(`INSERT INTO hb_model_limits (user_id,bucket,requests) VALUES (?,?,1) ON CONFLICT(user_id) DO UPDATE SET bucket=excluded.bucket,requests=CASE WHEN hb_model_limits.bucket=excluded.bucket THEN hb_model_limits.requests+1 ELSE 1 END WHERE hb_model_limits.bucket<>excluded.bucket OR hb_model_limits.requests<?`).bind('source:'+name,bucket,max).run();return !!result.meta?.changes;
}
async function collect(input,env,signal,fetcher){
 const terms=retrievalTerms(input.question,{topic:input.topic,context:input.mode==='chat'});
 if(!terms)return {sources:[],providers:[],terms:''};
 const key=input.role+'|'+terms,existing=cache.get(key);if(existing&&Date.now()-existing.time<ttl)return {...existing.value,cached:true};
 // Single-flight and cache store public keyword queries, never raw personal input or identities.
 if(pending.has(key))return pending.get(key);
 const task=(async()=>{
  const now=new Date().toISOString(),providers=[];
  const medline=new URL('https://wsearch.nlm.nih.gov/ws/query');medline.search=new URLSearchParams({db:'healthTopics',term:terms,retmax:'4',rettype:'brief',tool:'HealthBrowse'}).toString();
  const epmc=new URL('https://www.ebi.ac.uk/europepmc/webservices/rest/search');
  const publicQuery=terms.split(' ').map(t=>'"'+t+'"').join(' AND ');
  const profile=input.role==='General reader'||input.role==='Medical student'?' AND PUB_TYPE:Review':'';
  epmc.search=new URLSearchParams({query:'('+publicQuery+') AND SRC:MED AND HAS_ABSTRACT:Y NOT PUB_TYPE:"Retracted Publication"'+profile,resultType:'core',pageSize:'4',format:'json'}).toString();
  const request=async(name,url,parse)=>{try{
   if(!await providerBudget(env,name,name==='MedlinePlus'?70:90))throw Error('Retrieval budget');
   const timeout=AbortSignal.timeout(9000),combined=signal?AbortSignal.any([signal,timeout]):timeout;
   const res=await fetcher(url.href,{headers:{Accept:name==='MedlinePlus'?'application/xml':'application/json'},redirect:'error',signal:combined});
   const text=await readBounded(res),sources=parse(text);providers.push({name,status:sources.length?'available':'no_matches'});return sources;
  }catch{providers.push({name,status:'unavailable'});return []}};
  const tasks=[request('MedlinePlus',medline,text=>parseMedline(text,terms,now))];
  // All audiences can ask beyond patient topics; clinical and educational modes
  // prioritize literature. General can use research only with explicit source limits.
  tasks.push(request('Europe PMC',epmc,text=>parseEuropePMC(JSON.parse(text),terms,now)));
  const rows=await Promise.all(tasks),sources=input.role==='General reader'?rows.flat():[...rows[1],...rows[0]];
  const value={sources,providers,terms,retrievedAt:now};
  if(sources.length){cache.set(key,{time:Date.now(),value});while(cache.size>40)cache.delete(cache.keys().next().value)}
  return value;
 })();pending.set(key,task);try{return await task}finally{pending.delete(key)}
}
export async function retrieveEvidence(input,base,env={},signal,fetcher=fetch){
 if(env.RETRIEVAL_LIVE==='off')return base;
 const live=await collect(input,env,signal,fetcher),sources=[],seen=new Set();
 // Keep an unrelated active browser topic out of a new, explicit Buddy question.
 const q=String(input.question||''),followup=usesActiveTopic(q);
 const subjectWords=retrievalTerms(input.topic).split(' '),questionWords=new Set(retrievalTerms(q).split(' '));
 const newSubject=input.mode==='chat'&&!followup&&questionWords.size>0&&subjectWords.every(w=>!questionWords.has(w))&&!/^(?:symptoms?|treatment|causes?|diagnosis|tests?)\W*$/i.test(q);
 if(newSubject)base=null;
 // Live retrieval is not training data and never accepts client-supplied passages.
 for(const source of [...live.sources,...(base?.sources||[])]){const key=source.deck+'|'+source.url+'|'+source.text;if(seen.has(key))continue;seen.add(key);sources.push({...source,id:'S'+(sources.length+1)})}
 return {...(base||{topic:input.topic,role:input.role,style:readingProfile(input.role).style,domains:domains.slice(0,6).map((d,i)=>({id:i+1,title:d.title,question:faqQuestions[i],scope:d.scope}))}),sources,
  snapshot:live.retrievedAt||base?.snapshot,retrieval:{providers:live.providers,cached:!!live.cached,sourceCount:new Set(live.sources.map(s=>s.url)).size}};
}
export function clearRetrievalCache(){cache.clear();pending.clear()}
