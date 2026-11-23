import {generalGuides} from './general-guides.mjs';
import {screenGeneralQuery, classifyResponseMode} from '../dist/response-mode.js';
import {topicIndex} from '../dist/discovery.js';

const headers = {'Cache-Control':'private, no-store', 'X-Content-Type-Options':'nosniff', 'Referrer-Policy':'no-referrer'};
const reply = (data,status=200) => Response.json(data,{status,headers});
const stopWords = new Set('a an and are as at be by can could describe did do does explain find for from give how i in into is it its me more of on or please research should show tell the their there these this those to was were what when where which who why will with would you your'.split(' '));
const termsFor = text => [...new Set((text.toLowerCase().match(/[\p{L}\p{N}]+/gu)||[]).filter(t => !stopWords.has(t) && t.length>1))].slice(0,12);
const privateStory = /[\r\n@<>]|https?:\/\/|\b(?:confidential|proprietary|unpublished|employee id|account no|client id|api key|secret key|incident no|internal[- ]only|patient|ticket #|our company|our client|my client|our records|my employer)\b|\b[A-Z]+-\d{3,}\b|\b\d{6,}\b/i;
const unsafeDetail = /\b(?:weaponiz\w*|exploit payload|privilege escalation exploit|stealth malware|build a weapon|make explosives?|illicit drug synthesis)\b/i;
const followup = /^(?:tell me more|explain (?:it|that|further)|continue|more details?|what (?:are|about) (?:the |its )?(?:limitations|sources|steps|evidence)|how (?:does (?:it|that) work|can i verify (?:it|that))|give (?:me )?an example)\b/i;
const empty = (status,answer,topic='') => ({status,mode:'general',topic,answer,blocks:[],articles:[]});

async function readJson(body,maxBytes) {
  const reader=body?.getReader();
  if(!reader)throw Error('Missing response');
  const decoder=new TextDecoder();
  let total=0, text='';
  try {
    while(true){
      const {done,value}=await reader.read();
      if(done) break;
      total+=value.byteLength;
      if(total>maxBytes){await reader.cancel();throw Error('Oversized response')}
      text+=decoder.decode(value,{stream:true});
    }
    return JSON.parse(text+decoder.decode());
  } finally {reader.releaseLock()}
}

function clean(text) {
  return String(text||'').replace(/<[^>]*>/g,' ').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'").replace(/\s+/g,' ').trim();
}
const stem = s => s.length>4?s.replace(/(?:ing|es|s)$/,''):s;
function matchScore(terms,title,passage) {
  const titleWords=new Set(termsFor(title).map(stem));
  const all=new Set(clean(title+' '+passage).toLowerCase().split(/[^\p{L}\p{N}]+/u).map(stem));
  const found=terms.filter(t=>all.has(stem(t))).length;
  return found>=Math.ceil(terms.length*0.75) ? found + terms.filter(t=>titleWords.has(stem(t))).length*2 : 0;
}
function sentence(text,maxWords=45) {
  return (clean(text).match(/[^.!?]+[.!?](?:\s|$)|[^.!?]+$/g)||[]).map(s=>s.trim()).find(s=>s.length>=28 && s.split(/\s+/).length<=maxWords) || '';
}
const scholarlyPublisher = /Cambridge University Press|Oxford University Press|Royal Society|National Academy of Sciences|American Association for the Advancement of Science|American Physical Society|Institute of Electrical and Electronics Engineers|Association for Computing Machinery|Springer|Elsevier|Wiley|SAGE Publications|Taylor [&] Francis|American Chemical Society|Public Library of Science/i;
const withheld = /^(?:correction|corrigendum|erratum|retraction|withdrawn|retracted|expression of concern)\b/i;
const wikiLicense = 'https://creativecommons.org/licenses/by-sa/4.0/';
async function lookup(fetcher,href,signal) {
  const response=await fetcher(href,{headers:{Accept:'application/json'},redirect:'manual',signal});
  if(!response.ok)throw Error('Source unavailable');
  return readJson(response.body,600000);
}
async function govuk(terms,fetcher,signal) {
  const url=new URL('https://www.gov.uk/api/search.json');
  url.search=new URLSearchParams({q:terms.join(' '),count:'8',fields:'title,link,description,first_published_at'}).toString();
  const data=await lookup(fetcher,url.href,signal);
  return (data.results||[]).filter(r=>typeof r.link==='string' && /^\/[\w-]/.test(r.link)).map(r=>{
    const title=clean(r.title),passage=sentence(r.description);
    return {title,url:new URL(r.link,'https://www.gov.uk').href,publisher:'GOV.UK',date:r.first_published_at?.slice(0,10)||null,takeaway:passage,passage,rank:3};
  });
}
async function research(terms,fetcher,signal) {
  const url=new URL('https://api.crossref.org/works');
  url.search=new URLSearchParams({'query.bibliographic':terms.join(' '),rows:'10',filter:'type:journal-article',
    select:'DOI,title,publisher,container-title,published,abstract,update-to'}).toString();
  const data=await lookup(fetcher,url.href,signal);
  return (data.message?.items||[]).filter(r=>scholarlyPublisher.test(r.publisher) && /^10\.\d{4,9}\/[\w.()/:;-]+$/i.test(r.DOI) && !withheld.test(clean(r.title?.[0])) && !r['update-to']?.length).map(r=>{
    const title=clean(r.title?.[0]),parts=r.published?.['date-parts']?.[0]||[];
    const excerpt=sentence(r.abstract,22);
    return {title,url:'https://doi.org/'+r.DOI,publisher:clean(r['container-title']?.[0]||r.publisher),
      date:parts.length?parts.map((v,i)=>i?String(v).padStart(2,'0'):v).join('-'):null,
      takeaway:excerpt || 'The publisher’s record identifies the study and links to its methods and findings.',passage:excerpt,rank:2};
  });
}
async function encyclopedia(terms,fetcher,signal) {
  const url=new URL('https://en.wikipedia.org/w/api.php');
  url.search=new URLSearchParams({action:'query',format:'json',formatversion:'2',generator:'search',gsrsearch:terms.join(' '),gsrnamespace:'0',gsrlimit:'3',
    prop:'extracts|pageprops',exintro:'1',explaintext:'1',exlimit:'3',exchars:'700',ppprop:'disambiguation'}).toString();
  const data=await lookup(fetcher,url.href,signal);
  return (data.query?.pages||[]).filter(r=>!(r.pageprops && Object.hasOwn(r.pageprops,'disambiguation'))&&Number.isInteger(r.pageid)&&r.pageid>0)
    .map(r=>{const passage=sentence(r.extract);return {title:clean(r.title),url:'https://en.wikipedia.org/?curid='+r.pageid,
      publisher:'Wikipedia contributors · CC BY-SA 4.0',license:wikiLicense,date:null,takeaway:passage,passage,pageId:r.pageid,rank:1}});
}
function summarize(terms,groups) {
  const candidates=groups.flat().map(row=>({...row,score:matchScore(terms,row.title,row.passage)}))
    .filter(r=>r.score && r.title && r.takeaway && r.title.length<400 && screenGeneralQuery(r.title+' '+r.takeaway).status==='ok')
    .sort((a,b)=>b.score-a.score || b.rank-a.rank);
  const unique=new Map();
  for(const row of candidates)if(!unique.has(row.url))unique.set(row.url,row);
  const chosen=[...unique.values()].slice(0,5);
  const illustrationPageId=candidates.find(r=>r.pageId)?.pageId;
  const articles=chosen.map(({rank,passage,score,pageId,...article},i)=>({...article,id:'G'+(i+1),...(passage?{quote:passage}:{})}));
  const blocks=[];
  for(const [i,row] of chosen.entries()){
    if(row.passage && !blocks.some(b=>b.text===row.passage))blocks.push({text:row.passage,sourceIds:[articles[i].id]});
    if(blocks.length===2)break;
  }
  const answer=blocks.map(b=>b.text).join('\n\n');
  return {status:blocks.length?'answered':'insufficient',mode:'general',topic:terms.join(' '),...(illustrationPageId?{illustrationPageId}:{}),answer:answer||'I could not find a passage that answers this question in the available public sources.',blocks,articles};
}

const indexes=new WeakMap();
function medicalIndex(assets) {
  if(!assets)return undefined;
  if(!indexes.has(assets)){
    const titles=JSON.parse(assets['/topic-list.json']?.text||'[]');
    const taxonomy=JSON.parse(assets['/taxonomy.json']?.text||'{}');
    indexes.set(assets,topicIndex(taxonomy.entities||[],titles));
  }
  return indexes.get(assets);
}
export async function generalBrowser(request, assets, fetcher=fetch){
  if(request.method!=='POST')return reply({error:'Use POST.'},405);
  if(request.headers.get('origin') && request.headers.get('origin')!==new URL(request.url).origin)return reply({error:'Cross-origin request declined.'},403);
  if(!request.headers.get('content-type')?.startsWith('application/json'))return reply({error:'Use JSON.'},415);
  let input;
  try{input=await readJson(request.body,9000)}catch{return reply({error:'Invalid or oversized JSON.'},400)}
  if(!input || typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(key=>!['topic','question'].includes(key)) ||
      typeof input.question!=='string' || !input.question.trim() || input.question.length>1600 ||
      (input.topic!==undefined && (typeof input.topic!=='string'||input.topic.length>180)))return reply({error:'Submit a question, with an optional public topic.'},400);
  const question=input.question.trim(),topic=(input.topic||'').trim();
  for(const text of [question,topic]){
    const check=screenGeneralQuery(text);
    if(check.status!=='ok')return reply({...empty('blocked',check.safety.text),code:check.status},422);
    if(unsafeDetail.test(text))return reply(empty('blocked','I can help with safe educational research.'),422);
  }
  if(classifyResponseMode(question,{index:medicalIndex(assets),topic,previousMode:'general'})==='medical')return reply({...empty('blocked','Use medical search for a healthcare or life-sciences question.'),code:'medical'},422);
  const guide=generalGuides.find(g=>g.pattern.test(question)) || (topic && followup.test(question) && generalGuides.find(g=>g.pattern.test(topic)));
  // Time-sensitive and narrowly scoped legal questions need dedicated sources.
  const outOfGuide = /\b(?:current price|company compliant|latest|newest|penalt(?:y|ies)|deadlines?|exemptions?|retention period|record retention|criminal|fines?)\b/i.test(question)
    || /\bsection\s+(?!302\b|404\b)\d+\b/i.test(question);
  if(guide && !outOfGuide){
    const blocks=guide.blocks(question);
    return reply({status:'answered',mode:'general',topic:guide.topic,answer:blocks.map(b=>b.text).join('\n\n'),blocks,articles:guide.articles});
  }
  const lookupQuery=topic&&followup.test(question)?topic:question;
  if(privateStory.test(question+' '+topic) || /\b(?:my|our|confidential|employee number|account number|client account)\b/i.test(lookupQuery) || lookupQuery.length>250 || lookupQuery.split(/\s+/).length>36)
    return reply(empty('insufficient','Search for the public subject or standard. To inspect a private report, open Buddy and attach the document there.'));
  const terms=termsFor(lookupQuery);
  if(!terms.length)return reply(empty('insufficient','Which public topic or process would you like to explore?'));
  const deadline=AbortSignal.timeout(5500),signal=request.signal?AbortSignal.any([request.signal,deadline]):deadline;
  const results=await Promise.allSettled([govuk(terms,fetcher,signal),research(terms,fetcher,signal),encyclopedia(terms,fetcher,signal)]);
  return reply(summarize(terms,results.flatMap(r=>r.status==='fulfilled'?[r.value]:[])));
}
