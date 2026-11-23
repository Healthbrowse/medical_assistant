import {assessSafety,hasUnsafeInstructions} from '../dist/safety-policy.js';
import {assessBuddySafety,hasUnsafeBuddyOutput} from '../dist/buddy-policy.js';

const nationalGuidanceHosts=new Set(['www.cdc.gov','www.cancer.gov','www.nhlbi.nih.gov','www.niddk.nih.gov','www.who.int','www.nice.org.uk','www.icmr.gov.in']);
const academicHost='www.hopkinsmedicine.org';
export const guidelineHosts=new Set([...nationalGuidanceHosts,'medlineplus.gov',academicHost]);
// Use the clinical Health Library on this host. Other catalog links point
// to fellowship or course listings and are ineligible as clinical evidence.
const academicReferences=[
 {topic:'Pituitary gland',title:'Pituitary Gland',url:'https://www.hopkinsmedicine.org/health/conditions-and-diseases/the-pituitary-gland'},
 {topic:'Dengue',title:'Dengue Fever',url:'https://www.hopkinsmedicine.org/health/conditions-and-diseases/dengue-fever'}
];
const stop=new Set('the with and for about health clinical guidance guideline guidelines from treatment symptoms prevention tests diagnosis effects studies review national institute information screening basics centers control disease prevention cdc nih nci'.split(' '));
const norm=text=>String(text||'').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
const words=text=>norm(text).split(' ').filter(w=>w.length>1&&!stop.has(w));
const guidelineTitle=/\b(?:clinical (?:practice )?guid(?:eline|ance)|practice guideline|guidelines? (?:for|on)|recommendations? (?:for|on)|consensus statement|rapid recommendation)\b/i;
const clinicalSection=/\b(?:results?|findings?|outcomes?|efficacy|risks?|contraindications?|diagnosis|diagnostic|treatment|recommendations?|management|prevention|symptoms?|overview|summary|testing|monitoring|evidence|population)\b/i;
const boilerplate=/\b(?:skip to|site navigation|sign up|last reviewed|related pages|email updates|cookie settings|privacy policy|on this page|was this page helpful|copyright|share this page)\b/i;
const boundedCache=new WeakMap();

function assetIndex(assets){
 if(!assets||typeof assets!=='object')return {topics:[],grounded:[]};
 if(boundedCache.has(assets))return boundedCache.get(assets);
 const parse=(file,property)=>{try{const value=JSON.parse(assets['/'+file+'.json']?.text||'null')?.[property];return Array.isArray(value)?value:[]}catch{return []}};
 const index={topics:parse('medline-topics','topics'),grounded:parse('grounded-sources','passages')};
 boundedCache.set(assets,index);
 return index;
}

function approvedURL(value){
 try{
  const url=new URL(value);
  if(url.protocol!=='https:'||url.username||url.password||url.port||url.search||url.pathname==='/'||!guidelineHosts.has(url.hostname))return null;
  if(url.hostname===academicHost&&!url.pathname.startsWith('/health/conditions-and-diseases/'))return null;
  if(/\.(?:pdf|pptx?|zip|jpe?g|png)$/i.test(url.pathname))return null;
  url.hash='';
  return url.href;
 }catch{return null}
}
function nationalGuideline(url,title){
 return nationalGuidanceHosts.has(new URL(url).hostname)&&guidelineTitle.test(title);
}
function mentions(text,label){
 const needle=norm(label);
 return needle.length>=3 && words(needle).length && (' '+norm(text)+' ').includes(' '+needle+' ');
}
function candidates(terms,assets){
 const {topics,grounded}=assetIndex(assets),selected=new Map(),query=new Set(words(terms));
 const relevance=title=>[...new Set(words(title))].filter(w=>query.has(w)).length;
 function add(record,score){
  const url=approvedURL(record.url);if(!url||!record.title)return;
  const entry={...record,url,national:nationalGuideline(url,record.title),score:score+relevance(record.title)};
  if(!selected.has(url)||selected.get(url).score<entry.score)selected.set(url,entry);
 }
 for(const row of [...grounded,...academicReferences]){
  if(mentions(terms,row.focus||row.topic))add(row,4);
 }
 for(const topic of topics){
  const labels=[topic.title,...(topic.aliases||[]),...(topic.mesh||[]).map(m=>m.label)].filter(x=>mentions(terms,x));
  if(!labels.length)continue;
  const specificity=Math.max(...labels.map(x=>words(x).length));
  add({...topic,topic:topic.title},2+specificity);
  for(const link of Object.values(topic.links||{}).flat()){
   if(!link?.url||(!relevance(link.title)&&!labels.some(x=>mentions(link.title,x))))continue;
   add({...link,topic:topic.title},2+specificity);
  }
 }
 return [...selected.values()].sort((a,b)=>Number(b.national)-Number(a.national)||b.score-a.score).slice(0,2);
}
function decode(text){
 const codes={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' ',ndash:'–',mdash:'—',ge:'≥',le:'≤',times:'×',plusmn:'±',percnt:'%'};
 return String(text).replace(/&(#(?:x[\da-f]+|\d+)|[a-z]+);/gi,(m,v)=>{
  if(v[0]!=='#')return codes[v.toLowerCase()]??m;
  const value=v[1].toLowerCase()==='x'?parseInt(v.slice(2),16):Number(v.slice(1));
  return value>0&&value<=0x10ffff?String.fromCodePoint(value):'';
 });
}
const plain=html=>decode(html.replace(/<[^>]+>/g,' ')).replace(/\s+/g,' ').replace(/\s+([.,;:)])/g,'$1').trim();
function attr(tag,name){
 const re=new RegExp('\\s'+name+'\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\'|([^\\s>]+))','i');
 const match=tag.match(re);
 return match?decode(match[1]??match[2]??match[3]):'';
}
function verifiedPage(html,record,terms){
 if(typeof html!=='string'||!html||html.length>1200000)return null;
 const head=html.match(/<head\b[^>]*>([\s\S]*?)<\/head>/i)?.[1]||'';
 const canonical=(head.match(/<link\b[^>]{0,1800}>/gi)||[]).find(tag=>attr(tag,'rel').toLowerCase().split(/\s+/).includes('canonical'));
 if(canonical){
  const canonicalURL=approvedURL(new URL(attr(canonical,'href'),record.url).href);
  if(!canonicalURL||canonicalURL.replace(/\/$/,'')!==record.url.replace(/\/$/,''))return null;
 }
 const clean=html.replace(/<(script|style|nav|aside|footer|form|template|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi,' ');
 const region=clean.match(/<(main|article)\b[^>]*>([\s\S]*?)<\/\1>/i)?.[2];
 if(!region)return null;
 const title=plain(region.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1]||head.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1]||'');
 const actualTitle=new Set(words(title)),expected=[...new Set(words(record.title))];
 const matching=expected.filter(w=>actualTitle.has(w)).length;
 if(!title||title.length>350||(!mentions(title,record.topic||record.focus)&&(!expected.length||matching < Math.ceil(expected.length*0.65)))||/page not found|access denied|page unavailable|just a moment/i.test(title))return null;
 const known=norm(record.topic||record.focus),termWords=new Set(words(terms)),findings=[];
 let section=title;
 for(const match of region.matchAll(/<(h[1-6]|p)\b[^>]*>([\s\S]*?)<\/\1>/gi)){
  const value=plain(match[2]);
  if(match[1].toLowerCase()!=='p'){section=value||title;continue}
  if(value.length<35||value.length>1100||boilerplate.test(value)||!/[.!?]$/.test(value)||assessSafety(value).action!=='allow'||hasUnsafeInstructions(value)||hasUnsafeBuddyOutput(value)||assessBuddySafety(match[2]).action!=='allow'||assessBuddySafety(value).action!=='allow')continue;
  if(!clinicalSection.test(section)&&!words(value).some(w=>termWords.has(w))&&!mentions(value,known))continue;
  const contentWords=words(section+' '+value);
  const score=contentWords.filter(w=>termWords.has(w)).length+(clinicalSection.test(section)?3:0);
  const field=/contraindicat/i.test(value+' '+section)?'contraindications':/class (?:i{1,3}|iv|[123])\b|level of evidence/i.test(value)?'recommendation_grade':'institutional_reference';
  if(!findings.some(x=>x.text===value))findings.push({section,field,text:value,score});
 }
 if(!findings.length)return null;
 const dateTag=(head.match(/<meta\b[^>]{0,1000}>/gi)||[]).find(tag=>/^(?:article:published_time|datepublished|dcterms\.issued)$/i.test(attr(tag,'property')||attr(tag,'itemprop')||attr(tag,'name')));
 const date=attr(dateTag||'','content').match(/^(\d{4})(?:-|$)/)?.[1];
 const guideline=nationalGuideline(record.url,title);
 const studyDesign=guideline?'Institutional clinical guidance':new URL(record.url).hostname===academicHost?'Academic medical center reference':'Institutional clinical reference';
 return {source_id:'URL: '+record.url,title,url:record.url,publication_year:date?Number(date):null,evidence_tier:guideline?1:2,
  study_design:[studyDesign],
  extracted_findings:findings.sort((a,b)=>b.score-a.score).slice(0,3).map(({score,...finding})=>finding)};
}

export async function guidelineEvidence({terms,assets,request}){
 const pages=candidates(terms,assets),sources=[],gaps=[],searches=[];
 for(const record of pages){
  searches.push(record.url);
  try{
   const source=verifiedPage(await request(record.url,'text/html'),record,terms);
   if(source)sources.push(source);
   else gaps.push('Relevant clinical text could not be verified on '+record.url);
  }catch{gaps.push('Could not verify '+record.url)}
 }
 return {sources,gaps,searches};
}
