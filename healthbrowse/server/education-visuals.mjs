import {heartIntent,heartFigures} from '../dist/heart-visual.js';
import {curatedBrowserVisuals} from '../dist/browser-curated-images.js';
import {publicTopicFigureResponse} from './public-figure.mjs';
import {retrievalTerms} from '../dist/query-understanding.js';
import {definitionSubject} from '../dist/answer-relevance.js';
const revision='b0058a743bdd2cc08196abaaa7d5469970c0d80c';
const raw='https://raw.githubusercontent.com/openstax/osbooks-anatomy-physiology/'+revision+'/';
const mitochondria={
 id:'nhgri-mitochondria',src:'/api/education-image?id=nhgri-mitochondria',title:'Inside a mitochondrion',
 imageUrl:'https://www.genome.gov/sites/default/files/media/images/2021-11/mitochondria_0.jpg',
 sourceUrl:'https://www.genome.gov/genetics-glossary/Mitochondria',
 alt:'Diagram of a mitochondrion with the outer membrane, inner membrane and cristae labeled.',
 caption:'The inner membrane folds into structures called cristae.',attribution:'National Human Genome Research Institute',
 license:'NHGRI image policy',licenseUrl:'https://www.genome.gov/about-nhgri/Policies-Guidance/Copyright'
};
const cache=new WeakMap();
function catalog(assets){
 if(cache.has(assets))return cache.get(assets);
 let data;try{data=JSON.parse(assets['/education-figures.json']?.text||'{}')}catch{return []}
 const rows=data.revision===revision&&data.license==='CC BY 4.0'?(data.figures||[]).filter(f=>f.license==='CC BY 4.0'&&/^media\/[A-Za-z0-9_.-]+\.(?:jpg|jpeg|png)$/.test(f.asset)&&/^m\d+-[A-Za-z0-9_-]+$/.test(f.id)&&f.sourceUrl.startsWith('https://github.com/openstax/osbooks-anatomy-physiology/blob/'+revision+'/modules/')&&f.title&&f.alt):[];
 cache.set(assets,rows);return rows;
}
const tokens=s=>(String(s).toLowerCase().match(/[a-z]{3,}/g)||[]).map(w=>w.length>4?w.replace(/ies$/,'y').replace(/s$/,''):w);
export function educationalVisual(assets,input){
 if(input.attachments?.length||input.mode!=='search')return null;
 const terms= tokens(retrievalTerms(input.question,{topic:input.topic}));if(!terms.length)return null;
 if(/^mitochondri(?:a|on)$/i.test(String(input.topic).trim())&&!/\b(disease|disorder|deficien\w*|treat\w*)\b/i.test(input.question))return mitochondria;
 const intent=heartIntent(input.question);
 if(intent==='flow')return null; // The client draws only the passages cited in the final answer.
 const rows=catalog(assets);
 // This figure explicitly shows the bilirubin pathway within red-cell recycling.
 const bilirubin=terms.includes('bilirubin')?rows.find(f=>f.asset==='media/1905_Erythrocyte_Life_Cycle.jpg'):null;
 const pathology=/\b(tumou?r|cancer|disease|disorder|abnormal|defect|failure|injury|fracture)\w*\b/i;
 const ranked=rows.filter(f=>!pathology.test(f.title)||pathology.test(input.question+' '+input.topic)).map(f=>{
  const label=new Set(tokens(f.title+' '+f.alt+' '+f.caption)),title=new Set(tokens(f.title));
  const hits=terms.filter(t=>label.has(t)).length,titleHits=terms.filter(t=>title.has(t)).length;
  if(definitionSubject(input.question,input.topic)&&!titleHits)return {f,score:0};
  const score=hits>=Math.ceil(terms.length*.7)?hits*3+titleHits*5+titleHits/Math.max(1,title.size):0;
  return {f,score};
 }).filter(r=>r.score>0).sort((a,b)=>b.score-a.score);
 // Prefer overview anatomy for broad organ questions, not an unrelated specialty image.
 const overview=terms.includes('pituitary')&&!pathology.test(input.question)&&!terms.some(t=>['anterior','posterior','hormone'].includes(t))?rows.find(f=>f.id==='m46699-fig-ch18_03_01'):
  terms.length===1&&terms[0]==='heart'?rows.find(f=>f.id==='m46676-fig-ch20_01_08'):null;
 const f=Object.hasOwn(heartFigures,intent)?rows.find(row=>row.id===heartFigures[intent]):bilirubin||overview||ranked[0]?.f;if(!f)return null;
 const bundled=assets['/'+f.id+'.jpg'];
 const attribution=bundled?.base64 && bundled.type==='image/jpeg'
  ? 'OpenStax, Anatomy and Physiology 2e. CC BY 4.0. Source snapshot 11 March 2026. JPEG optimized for display.'
  : f.attribution;
 return {id:f.id,src:'/api/education-image?id='+encodeURIComponent(f.id),title:bilirubin&&input.role!=='Medical professional'?'How red blood cells are recycled':f.title,alt:f.alt,caption:f.caption,sourceUrl:f.sourceUrl,attribution,license:f.license,licenseUrl:'https://creativecommons.org/licenses/by/4.0/',context:intent==='chambers'?'Find the two upper chambers (atria) and the two lower chambers (ventricles).':intent==='valves'?'Find the tricuspid, pulmonary, mitral and aortic valves.':bilirubin?'Bilirubin is part of the red blood cell recycling pathway shown here.':'Educational illustration from the cited textbook. It does not diagnose an individual.'};
}
// Prefer a verified catalog illustration before looking up a reusable public figure.
export function medicalFigureResponse(request,assets,fetcher=fetch){
 if(request.method!=='GET')return new Response(null,{status:405,headers:{Allow:'GET'}});
 const params=new URL(request.url).searchParams;
 const topic=(params.get('topic')||'').trim(),intent=params.get('intent');
 if(intent!==null){
  if(topic.toLowerCase()!=='heart'||!Object.hasOwn(heartFigures,intent))return Response.json({visual:null},{status:400});
  const visual=educationalVisual(assets,{topic,question:'Show the '+intent+' of the heart',mode:'search'});
  return Response.json({visual,visuals:visual?[visual]:[]},{headers:{'Cache-Control':'private, no-store'}});
 }
 if(!topic||topic.length>120||/[<>\x00-\x1f]/.test(topic))return Response.json({visual:null},{status:400});
 const visuals=curatedBrowserVisuals(topic);
 if(!visuals.length){
  const textbook=educationalVisual(assets,{topic,question:'What is '+topic+'?',mode:'search'});
  if(textbook)visuals.push(textbook);
 }
 return visuals.length?Response.json({visual:visuals[0],visuals},{headers:{'Cache-Control':'private, no-store'}}):publicTopicFigureResponse(request,topic,fetcher);
}
export async function educationImage(request,assets){
 const id=new URL(request.url).searchParams.get('id'),f=id===mitochondria.id?mitochondria:catalog(assets).find(f=>f.id===id);
 const fail=status=>new Response('Illustration unavailable.',{status,headers:{'Cache-Control':'no-store'}});
 if(!['GET','HEAD'].includes(request.method))return fail(405);if(!f)return fail(404);
 const imageHeaders=type=>({'Content-Type':type,'X-Content-Type-Options':'nosniff','Cache-Control':'public, max-age=86400','Referrer-Policy':'no-referrer'});
 const bundled=assets['/'+f.id+'.jpg'];
 if(bundled?.base64 && bundled.type==='image/jpeg'){
  const body=request.method==='HEAD'?null:Uint8Array.from(atob(bundled.text),c=>c.charCodeAt(0));
  return new Response(body,{headers:imageHeaders('image/jpeg')});
 }
 try{
  const response=await fetch(f===mitochondria?mitochondria.imageUrl:raw+f.asset,{redirect:'manual',signal:AbortSignal.timeout(12000)});
  if(!response.ok||Number(response.headers.get('Content-Length'))>2000000)return fail(502);
  const reader=response.body.getReader(),chunks=[];let size=0;
  while(true){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>2000000){await reader.cancel();return fail(502)}chunks.push(value)}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  const png=bytes[0]===137&&bytes[1]===80&&bytes[2]===78&&bytes[3]===71,jpg=bytes[0]===255&&bytes[1]===216&&bytes[2]===255;
  if(!png&&!jpg)return fail(502);
  return new Response(request.method==='HEAD'?null:bytes,{headers:imageHeaders(png?'image/png':'image/jpeg')});
 }catch{return fail(502)}
}
