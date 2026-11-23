import {assessBuddySafety, hasUnsafeBuddyOutput} from '../dist/buddy-policy.js';
import {assessSafety} from '../dist/safety-policy.js';
import {guidelineEvidence, guidelineHosts} from './literature-guidelines.mjs';

import {plainText} from './retrieval-text.mjs';
import {parseFullText} from './pmc-fulltext.mjs';

const epmc='https://www.ebi.ac.uk/europepmc/webservices/rest/';
const pmidPattern=/^[1-9]\d{0,8}$/;
const doiPattern=/^10\.\d{4,9}\/[a-z0-9./_();:-]{2,180}$/i;
const markupControl=/<\s*\/?(?:think|thinking|reasoning|analysis|system|assistant|developer)\b|<\|(?:im_start|start_header_id)\|>/i;
const allowedHosts=new Set(['www.ebi.ac.uk','pubmed.ncbi.nlm.nih.gov','pmc.ncbi.nlm.nih.gov',...guidelineHosts]);
const priorityTypes='(PUB_TYPE:"Practice Guideline" OR PUB_TYPE:"Guideline" OR PUB_TYPE:"Systematic Review" OR PUB_TYPE:"Meta-Analysis" OR PUB_TYPE:"Randomized Controlled Trial" OR JOURNAL:"Cochrane Database of Systematic Reviews")';
const clean=value=>plainText(String(value||'')).replace(/\s+/g,' ').trim();
const safeText=value=>!markupControl.test(value)&&!hasUnsafeBuddyOutput(value)&&assessBuddySafety(value).action==='allow'&&assessSafety(value).action==='allow';
const tokens=value=>(clean(value).toLowerCase().match(/[a-z][a-z0-9-]*/g)||[]).map(t=>t.replace(/(?:ies|s)$/,''));
const genericWords=new Set(tokens('what how who when where for the was are were and with from did does about their that this published publication study systematic reviews randomized studies trials clinical assessment patients population comparator intervention evidence outcome endpoints treatment results guidance guidelines recommendation effects reported methods conclusion research adults relative risk confidence estimate safety contraindications sample size primary secondary'));
function topicMatch(text,phrases){
 const words=new Set(tokens(text));
 return phrases.some(p=>{
  const focus=[...new Set(tokens(p).filter(t=>t.length>1&&!genericWords.has(t)))];
  return focus.length&&focus.filter(t=>words.has(t)).length>=Math.max(1,Math.ceil(focus.length/2));
 });
}

function publicPhrase(value){
 if(typeof value!=='string'||value.length>220||!safeText(value)||!/^[\p{L}\p{N}][\p{L}\p{N} ,‘’'()-]*$/u.test(value))return '';
 return value.replace(/[(),]/g,' ').replace(/\s+/g,' ').trim();
}
function genericQuery(phrase){
 return phrase.split(' ').slice(0,16).map(token=>'"'+token+'"').join(' AND ');
}
function initialQueries(phrases){
 const evidenceFilter='SRC:MED AND HAS_ABSTRACT:Y NOT PUB_TYPE:"Retracted Publication"';
 // Run a broad search as well as the design-prioritized search; an indexed
 // mechanism or an observational result can answer a different clinical intent.
 const searches=[genericQuery(phrases[0])+' AND '+priorityTypes, ...phrases.map(genericQuery)];
 return [...new Set(searches)].slice(0,4).map(query=>'('+query+') AND '+evidenceFilter);
}
function makeRequest(fetcher,signal,reserve){
 const deadline=AbortSignal.timeout(12000);
 const combined=signal?AbortSignal.any([signal,deadline]):deadline;
 let count=0;
 return async (address,accept='application/json',onIssue,maxBytes=1_250_000)=>{
  const url=new URL(address);
  if(url.protocol!=='https:'||!allowedHosts.has(url.hostname)||url.port||url.username||url.password||url.hash)throw Error('Unknown evidence URL');
  if(combined.aborted||++count>19)throw Error('Retrieval budget reached');
  if(reserve&&!(await reserve(url.hostname)))throw Error('Provider quota reached');
  onIssue?.();
  const response=await fetcher(url.href,{method:'GET',headers:{Accept:accept},credentials:'omit',redirect:'manual',signal:combined});
  if(!response.ok||!response.body){await response.body?.cancel();throw Error('Source unavailable');}
  const reader=response.body.getReader(),decoder=new TextDecoder();let size=0,text='';
  try{
   while(true){
    const {value,done}=await reader.read();if(done)break;
    size+=value.byteLength;if(size>maxBytes){await reader.cancel();throw Error('Response too large');}
    text+=decoder.decode(value,{stream:true});
   }
  }finally{reader.releaseLock()}
  return text+decoder.decode();
 };
}

const guideline=/guideline|recommendation statement|clinical guidance|consensus statement/i;
const secondary=/systematic review|meta[- ]analysis|cochrane/i;
const trial=/randomi[sz]ed|controlled clinical trial|pivotal trial|phase [1234iv]+ trial/i;
function typesOf(p){return Array.isArray(p.pubTypeList?.pubType)?p.pubTypeList.pubType.map(clean).filter(Boolean):[]}
function sourceRank(p){
 const type=typesOf(p).join(' '),descriptor=[p.title,type,p.journalInfo?.journal?.title].join(' ');
 if(guideline.test(type))return 5;
 if(secondary.test(descriptor))return 4;
 if(trial.test(type))return 3;
 if(/cohort|observational|prospective/i.test(descriptor))return 2;
 return 1;
}

const fieldRules=[
 ['contraindications',/contraindicat|should not be (?:used|administered)|avoid use/i],
 ['guideline_grade',/class (?:I{1,3}|IV|[1-4])\b|level of evidence|(?:strong|conditional|weak) recommendation|(?:high|moderate|low)[- ]certainty/i],
 ['endpoint',/primary (?:outcome|endpoint|end point)|secondary (?:outcome|endpoint|end point)|prespecified outcome/i],
 ['sample_size',/\bn\s*=\s*\d|\b\d[\d,]*\s+(?:(?:eligible|adult|pediatric|randomi[sz]ed|consecutive) )?(?:participants|patients|subjects|adults|children|individuals|trials|studies)\b|(?:enroll(?:ed|ment)|recruit(?:ed|ment)|includ(?:ed|ing)|randomi[sz]ed)\s+(?:a total of )?\d/i],
 ['population',/participants|patients (?:with|aged|receiving)|adults (?:with|aged)|children (?:with|aged)|inclusion criteria|eligible (?:patients|participants)/i],
 ['effect_estimate',/confidence interval|\bCI\b|\bHR\s*[=:]|\bRR\s*[=:]|\bOR\s*[=:]|odds ratio|hazard ratio|risk ratio|\bp\s*[=<]|\d(?:\.\d+)?\s*%/i],
 ['limitation',/limitation|uncertain|inconclusive|did not differ|no significant|conflict(?:ing)?|heterogene/i],
 ['recommendation',/recommend(?:s|ed|ation)|should (?:be|receive)/i]
];
function extractFindings(raw,record){
 if(typeof raw!=='string'||raw.length>90000||!safeText(raw)||!safeText(clean(raw)))return [];
 const sections=raw.replace(/<(h[1-6])[^>]*>([\s\S]*?)<\/\1>/gi,'\n@@$2@@\n')
  .replace(/<AbstractText\b[^>]*Label=["']([^"']+)["'][^>]*>/gi,'\n@@$1@@\n')
  .replace(/\b(BACKGROUND|OBJECTIVES?|METHODS?|RESULTS?|CONCLUSIONS?|DISCUSSION|LIMITATIONS|RECOMMENDATIONS)\s*:\s*/g,'\n@@$1@@\n');
 const findings=[],seen=new Set();let section='Abstract';
 for(const part of sections.split(/(@@[^@<>]{2,65}@@)/)){
  if(part.startsWith('@@')){section=clean(part.slice(2,-2));continue;}
  for(const sentence of plainText(part).split(/\n+|(?<=[.!?])\s+(?=[A-Z(])/)){
   const text=sentence.trim();if(text.length<25||text.length>850||seen.has(text)||!safeText(text))continue;
   const fields=fieldRules.filter(([,re])=>re.test(text)).map(([f])=>f);
   if(/results?|findings|outcomes?/i.test(section))fields.push('results');
   if(/conclusions?|discussion/i.test(section))fields.push('conclusion');
   if(/mechanism|physiology|pathophysiology/i.test(section))fields.push('mechanism');
   if(/objective|background|introduction/i.test(section))continue;
   if(!fields.length)continue;
   seen.add(text);
   findings.push({field:fields[0],tags:[...new Set(fields)],text,section});
  }
 }
 // A protocol or discussion without results is never a proxy for an outcome.
 if(!findings.some(f=>f.tags.some(t=>['results','effect_estimate','limitation','conclusion','guideline_grade','contraindications','recommendation','mechanism'].includes(t))))return [];
 // Do not label a putative recommendation in an ordinary study as a guideline.
 if(!guideline.test(typesOf(record).join(' ')))for(const f of findings)if(f.field==='recommendation')f.field='author_conclusion';
 const selected=findings.slice(0,8);
 // Keep a reported outcome if uncommonly long methods sections fill the limit.
 const outcome=findings.find(f=>f.tags.includes('results')||f.tags.includes('effect_estimate'));
 if(outcome&&!selected.includes(outcome))selected[selected.length-1]=outcome;
 return selected;
}
function usable(record){
 const types=typesOf(record);
 return record.source==='MED'&&pmidPattern.test(record.id)&&record.title&&safeText(record.title)
  && typeof record.abstractText==='string'&&record.abstractText.length<=90000&&safeText(record.abstractText)&&safeText(clean(record.abstractText))
  && ![record.isRetracted,record.isPreprint].includes('Y')&&!/\b(?:retract\w*|preprint|editorial|letter|published erratum|comment|advertisement|news)\b/i.test(types.join(' '))
  && !/^(?:retract\w*|withdrawn|correction|protocol for)\b|\b(?:trial|study) protocol\b/i.test(clean(record.title));
}
function htmlAttr(tag,key){
 return tag.match(new RegExp('\\b'+key+'\\s*=\\s*["\']([^"\']+)["\']','i'))?.[1]?.trim()||'';
}
function matchesLandingPage(html,source,url,id=String(source.id)){
 const tags=html.match(/<(?:meta|link)\b[^>]{1,1800}>/gi)||[];
 let identity=false,pageTitle='';
 for(const tag of tags){
  const key=(htmlAttr(tag,'name')||htmlAttr(tag,'property')).toLowerCase(),val=htmlAttr(tag,'content');
  if(['citation_pmid','citation_pmcid','ncbi_uidlist'].includes(key)&&val===id)identity=true;
  if(key==='citation_title'||key==='og:title')pageTitle=clean(val);
  if(htmlAttr(tag,'rel').toLowerCase()==='canonical'&&htmlAttr(tag,'href')===url)identity=true;
 }
 const title=pageTitle||clean(html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1]);
 return identity&&matchesTitle(title,source.title);
}
function matchesTitle(actual,expected){
 const words=new Set(tokens(actual)),terms=tokens(expected);
 return terms.length>0&&terms.filter(t=>words.has(t)).length>=Math.ceil(terms.length*.8);
}

function fullTextEligible(row){
 return row.isOpenAccess==='Y'&&row.inEPMC==='Y'&&/^PMC[1-9]\d{0,9}$/.test(row.pmcid||'');
}
async function licensedFindings(row,phrases,request){
 const xmlUrl=epmc+row.pmcid+'/fullTextXML';
 const xml=await request(xmlUrl,'application/xml',undefined,1_500_000);
 const article=parseFullText(xml,row.pmcid,{bodyOnly:true,expectedPmid:String(row.id)});
 if(!article||!matchesTitle(article.title,row.title))return null;
 const section=/method|participant|population|design|outcome|result|finding|limitation|conclusion|contraindication|recommend|safety|mechanism|physiology|discussion/i;
 const clinical=article.paragraphs.filter(p=>p.heading.length<=65&&section.test(p.heading)&&!p.heading.includes('@')&&safeText(p.heading)&&safeText(p.text));
 // Prefer paragraphs that actually mention the requested concepts and keep
 // the source's order within each group. Never cut a numeric result mid-sentence.
 const relevant=[],other=[];
 for(const p of clinical)(topicMatch(p.text,phrases)?relevant:other).push(p);
 const excerpts=[];let length=0;
 for(const p of [...relevant,...other]){
  const passage='@@'+p.heading+'@@\n'+p.text;
  if(length+passage.length>60_000)break;
  excerpts.push(passage);length+=passage.length;
 }
 const findings=extractFindings(excerpts.join('\n'),row);
 if(!findings.length)return null;
 // XML and the PubMed record are already verified. Prefer a reader-friendly
 // PMC page as the citation when its identity can also be confirmed.
 const fullUrl='https://pmc.ncbi.nlm.nih.gov/articles/'+row.pmcid+'/';
 let verifiedUrl=null;
 try{
  if(matchesLandingPage(await request(fullUrl,'text/html'),row,fullUrl,row.pmcid))verifiedUrl=fullUrl;
 }catch{}
 const authors=clean(row.authorString||'').slice(0,600);
 const credit=authors&&safeText(authors)?authors:'';
 return {abstract_only:false,pmcid:row.pmcid,license:article.license,authors:credit,
  attribution:[credit,clean(row.title),article.license,'Extracted passages'].filter(Boolean).join(' · '),
  ...(verifiedUrl?{full_text_url:verifiedUrl,url:verifiedUrl}:{}),full_text_xml_url:xmlUrl,
  extracted_findings:findings};
}

function pointers(source){
 const raw=clean(source.abstractText),items=[];
 for(const m of raw.matchAll(/(?:\bPMID\s*:?\s*|pubmed\.ncbi\.nlm\.nih\.gov\/)([1-9]\d{0,8})\b/gi)){
  if(m[1]!==source.id)items.push({id:m[1]});
 }
 for(const m of raw.matchAll(/\b10\.\d{4,9}\/[a-z0-9./_();:-]+/gi)){
  const doi=m[0].replace(/[.,;:)]+$/,'').toLowerCase();
  if(doiPattern.test(doi)&&doi!==source.doi?.toLowerCase())items.push({doi});
 }
 return items;
}
function rankReferences(list,phrases){
 return list.filter(ref=>safeText(String(ref.title||''))&&topicMatch(ref.title,phrases)&&
   (pmidPattern.test(ref.id)&&ref.source==='MED'||doiPattern.test(ref.doi)))
  .sort((a,b)=>priority(b)-priority(a));
 function priority(ref){return Number(trial.test(ref.title))*3+Number(guideline.test(ref.title))*2+Number(/conflict|contradict|update/i.test(ref.title))}
}
function uniqueRows(rows){
 const seen=new Set();
 return rows.filter(row=>{if(seen.has(row.id))return false;seen.add(row.id);return true;});
}
const interestChecks=[
 [/\b(?:sample size|how many|enrollment|number of participants)\b/i,'sample_size','sample size'],
 [/\b(?:endpoints?|primary outcomes?)\b/i,'endpoint','specified endpoints'],
 [/contraindicat/i,'contraindications','contraindications'],
 [/level of evidence|recommendation (?:level|grade|class)/i,'guideline_grade','recommendation class or level of evidence'],
 [/study population|age group|inclusion criteria/i,'population','study population']
];
export async function runLiteratureSearch({terms,queries=[],signal,fetcher=fetch,reserve,assets={},fallbackSources=[]}={}){
 const topic=publicPhrase(terms),packet={query_decomposition:[],retrieved_sources:[],evidence_gaps:[]};
 if(!topic)return {...packet,evidence_gaps:['No eligible public biomedical search terms were supplied.']};
 const phrases=[...new Set([topic,...(Array.isArray(queries)?queries:[]).map(publicPhrase).filter(Boolean)])].slice(0,3);
 const request=makeRequest(fetcher,signal,reserve),trace=packet.query_decomposition,gaps=new Set();
 const query=async expression=>{
  const u=new URL('search',epmc);u.search=new URLSearchParams({query:expression,resultType:'core',pageSize:'4',format:'json'});
  try{
   const data=JSON.parse(await request(u.href,'application/json',()=>trace.push(expression)));if(!Array.isArray(data.resultList?.result))throw Error();
   return data.resultList.result.filter(usable);
  }catch{gaps.add('An indexed-literature query could not be completed.');return [];}
 };
 const institutionalAttempts=[];
 const directRequest=(address,accept)=>request(address,accept,()=>institutionalAttempts.push(address));
 const directTask=guidelineEvidence({terms:topic,assets,request:directRequest,fallbackSources}).catch(()=>({sources:[],gaps:['Direct institutional guidance could not be verified.'],searches:[]}));
 const matches=await Promise.all(initialQueries(phrases).map(query));
 const initial=uniqueRows(matches.flat()).filter(row=>topicMatch(row.title+' '+clean(row.abstractText),phrases)).sort((a,b)=>sourceRank(b)-sourceRank(a));
 const candidates=initial.slice(0,4);
 const hops=new Map();
 for(const source of candidates){
  for(const ref of pointers(source))if(!hops.has(ref.id||ref.doi))hops.set(ref.id||ref.doi,{...ref,parent:source});
 }
 const referenceParents=candidates.filter(p=>sourceRank(p)>=4||/pivotal|conflict|previous (?:trial|study)|updated guideline/i.test(clean(p.abstractText))).filter(p=>!pointers(p).length).slice(0,2);
 await Promise.all(referenceParents.map(async parent=>{
  const u=new URL('MED/'+parent.id+'/references',epmc);u.search='page=1&pageSize=25&format=json';
  try{
   const data=JSON.parse(await request(u.href,'application/json',()=>trace.push('Reference list for PMID: '+parent.id)));
   const refs=Array.isArray(data.referenceList?.reference)?data.referenceList.reference:[];
   const relevant=rankReferences(refs,phrases).filter(r=>String(r.id)!==parent.id).slice(0,1);
   for(const r of relevant){
    const ref=r.source==='MED'&&pmidPattern.test(r.id)?{id:String(r.id)}:{doi:r.doi.toLowerCase()};
    if(!hops.has(ref.id||ref.doi))hops.set(ref.id||ref.doi,{...ref,parent});
   }
   if(refs.length&&!relevant.length)gaps.add('No identifiable on-topic primary study or guideline was located in the inspected references of PMID: '+parent.id+'.');
   if(!refs.length)gaps.add('No indexed reference list was available for PMID: '+parent.id+'.');
  }catch{gaps.add('The reference list for PMID: '+parent.id+' could not be verified.');}
 }));
 const verifiedParents=new Map();
 const boundedHops=[...hops.values()].slice(0,2);
 if(hops.size>boundedHops.length)gaps.add('Further cited publications remain outside this bounded search.');
 const linked=await Promise.all(boundedHops.map(async ref=>{
  const expression=(ref.id?'EXT_ID:'+ref.id:'DOI:"'+ref.doi+'"')+' AND SRC:MED';
  const rows=await query(expression);
  const record=rows.find(row=>(ref.id?row.id===ref.id:row.doi?.toLowerCase()===ref.doi)&&topicMatch(row.title+' '+clean(row.abstractText),phrases));
  if(record){verifiedParents.set(record.id,ref.parent.id);return record;}
  gaps.add('A cited publication in PMID: '+ref.parent.id+' could not be independently matched to an on-topic indexed record.');return null;
 }));
 // Spend the remaining URL checks on identified primary reports first.
 const selected=uniqueRows([...linked.filter(Boolean),...candidates]).slice(0,5);
 const fullTextIds=new Set(selected.filter(fullTextEligible).slice(0,2).map(row=>row.id));
 const records=await Promise.all(selected.map(async row=>{
  const url='https://pubmed.ncbi.nlm.nih.gov/'+row.id+'/';
  const abstractFindings=extractFindings(row.abstractText,row),tryBody=fullTextIds.has(row.id);
  if(!tryBody&&!abstractFindings.length){gaps.add('PMID: '+row.id+' supplied no qualifying outcome or clinical finding in its available abstract.');return null;}
  try{
   const html=await request(url,'text/html');if(!matchesLandingPage(html,row,url))throw Error();
  }catch{gaps.add('The landing page and publication identity for PMID: '+row.id+' could not be verified.');return null;}
  let body=null;
  if(tryBody){
   try{body=await licensedFindings(row,phrases,request)}catch{}
   if(!body)gaps.add('No eligible licensed body passage could be verified for PMID: '+row.id+'.');
  }
  if(!body&&!abstractFindings.length){gaps.add('PMID: '+row.id+' supplied no qualifying outcome or clinical finding in its available abstract.');return null;}
  return {source_id:'PMID: '+row.id,title:clean(row.title),url,publication_year:/^(?:19|20)\d\d$/.test(row.pubYear)?Number(row.pubYear):null,
   evidence_tier:1,study_design:typesOf(row).filter(t=>/review|meta-analysis|trial|observational|cohort|case report|case-control|comparative study|guideline|consensus|validation study/i.test(t)),
   publication_types:typesOf(row),publisher:clean(row.journalInfo?.journal?.title)||'PubMed',
   ...(body||{abstract_only:true,extracted_findings:abstractFindings}),
   ...(verifiedParents.has(row.id)?{cited_by:'PMID: '+verifiedParents.get(row.id)}:{})};
 }));
 const institutional=await directTask;
 trace.push(...institutionalAttempts);
 for(const gap of institutional.gaps)gaps.add(gap);
 const combined=[...records.filter(Boolean),...institutional.sources];
 packet.retrieved_sources=combined.sort((a,b)=>a.evidence_tier-b.evidence_tier);
 if(!combined.length)gaps.add('No sufficiently relevant source and supporting clinical passage could be verified in this search.');
 const tags=new Set(combined.flatMap(s=>s.extracted_findings.flatMap(f=>f.tags||[f.field])));
 for(const [pattern,tag,label] of interestChecks)if(pattern.test(topic)&&!tags.has(tag)&&!(tag==='guideline_grade'&&tags.has('recommendation_grade')))gaps.add('The retrieved passages do not establish '+label+'.');
 packet.evidence_gaps=[...gaps];return packet;
}
