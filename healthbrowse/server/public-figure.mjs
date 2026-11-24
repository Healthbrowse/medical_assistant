import {inspectInput} from '../dist/clinical-engine.js';

// Only bibliographic metadata is cached. Browsers receive same-origin rasters and public credit links.
const images=new Map();
const waterDiagram={
 image:'https://d9-wret.s3.us-west-2.amazonaws.com/assets/palladium/production/s3fs-public/styles/full_width/public/media/images/WaterCycle_DiagramOnly.png?itok=QaSX-Z_B',
 visual:{src:'/api/browser/public-figure?id=usgs-water-cycle&asset=1',title:'The global water cycle',
   sourceUrl:'https://www.usgs.gov/media/images/water-cycle-diagram-diagram-only',license:'Public domain',
   licenseUrl:'https://www.usgs.gov/media/images/water-cycle-diagram-diagram-only',attribution:'H. Corson-Dosch and colleagues · U.S. Geological Survey, Water Science School',
   alt:'Illustration of water stored and exchanged among the air, land, ocean and human water systems.',
   caption:'The diagram follows water above and below the surface and shows where human activities change its movement.'}
};
const figureUserAgent='HealthBrowse/1.0 (https://github.com/Healthbrowse/medical_assistant; educational illustration lookup)';
const safeHeaders={'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};
const clean=s=>String(s||'').replace(/<[^>]*>/g,' ').replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/\s+/g,' ').trim();
function httpUrl(value,host,path){
 try{const u=new URL(value);return u.protocol==='https:'&&u.hostname===host&&!u.username&&!u.password&&!u.port&&u.pathname.startsWith(path)?u.href:'';}catch{return '';}
}
async function bytes(response,limit){
 if(!response.ok||Number(response.headers.get('Content-Length'))>limit)throw Error('Unavailable');
 const reader=response.body.getReader(),chunks=[];let size=0;
 try{while(true){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>limit){await reader.cancel();throw Error('Oversized')}chunks.push(value)}}finally{reader.releaseLock()}
 const out=new Uint8Array(size);let offset=0;for(const chunk of chunks){out.set(chunk,offset);offset+=chunk.length}return out;
}
async function metadata(host,params,fetcher,signal){
 const url=new URL('https://'+host+'/w/api.php');
 url.search=new URLSearchParams({action:'query',format:'json',formatversion:'2',...params});
 const response=await fetcher(url.href,{signal,redirect:'manual',headers:{Accept:'application/json','User-Agent':figureUserAgent}});
 return JSON.parse(new TextDecoder().decode(await bytes(response,300000))).query || {};
}
const commonsParams = {
 prop:'imageinfo',iiprop:'url|mime|size|extmetadata',iiurlwidth:'960',iiextmetadatalanguage:'en',
 iiextmetadatafilter:'LicenseShortName|LicenseUrl|Artist|Attribution|ImageDescription|Restrictions'
};
const articleParams = {prop:'pageimages|pageprops|images',piprop:'name',pilicense:'free',ppprop:'disambiguation',imlimit:'40'};
const positiveId = id => /^[1-9]\d{0,9}$/.test(String(id));
const standardize = value => String(value || '').normalize('NFKC').replace(/_/g,' ').trim().toLowerCase();
const plainTitle = title => clean(String(title || '').replace(/^File:/,'').replace(/\.[a-z0-9]+$/i,'').replace(/_/g,' '));
const titleWords = value => standardize(value).match(/[\p{L}\p{N}]+/gu) || [];
const irrelevant = /\b(?:logo|icon|flag of|coat of arms|portrait|ribbon|fundrais(?:er|ing)|awareness (?:day|month|symbol)|blue circle for diabetes|rally|marathon|poster|autopsy|necropsy|cadaver)\b/i;

function matchesTopic(filename,topic){
 const label=plainTitle(filename);
 const terms=titleWords(topic).filter(t=>!['the','of','and','in','a','an'].includes(t));
 const words=new Set(titleWords(label));
 return !irrelevant.test(label)&&terms.length>0&&terms.every(t=>words.has(t));
}
function publicTopic(term) {
 if(typeof term!=='string')return '';
 const topic=term.normalize('NFKC').trim().replace(/ +/g,' ');
 if(topic.length<2||topic.length>95||topic.split(' ').length>10||
    !/^[\p{L}][\p{L}\p{M}\d ()'’–-]*$/u.test(topic)||/\d{4,}/.test(topic)||
    /\b(?:I|my|our|me|mine|patient|client|employee|case id|record number|secret|password|confidential|proprietary|unpublished|how|why|what|who|when|where|please|called|named)\b/i.test(topic))return '';
 return inspectInput(topic)==='ok'?topic:'';
}

function creditLicense(meta, license) {
 const supplied = httpUrl(meta.LicenseUrl?.value,'creativecommons.org','/');
 const normalized = license.toLowerCase();
 if (normalized === 'public domain') return supplied && !supplied.includes('/publicdomain/') ? '' :
  (supplied || 'https://creativecommons.org/publicdomain/mark/1.0/');
 if (/^cc0(?: 1\.0)?$/.test(normalized)) {
  return supplied && !supplied.includes('/publicdomain/zero/') ? '' :
   (supplied || 'https://creativecommons.org/publicdomain/zero/1.0/');
 }
 const allowed = /^cc (by(?:-sa)?) (1\.0|2\.0|2\.5|3\.0|4\.0)$/.exec(normalized);
 if (!allowed || !supplied) return '';
 const expected = '/licenses/'+allowed[1]+'/'+allowed[2];
 const path = new URL(supplied).pathname;
 return path === expected || path.startsWith(expected+'/') ? supplied : '';
}

function commonsFigure(file,id,title) {
 const info=file?.imageinfo?.[0],meta=info?.extmetadata||{},license=clean(meta.LicenseShortName?.value);
 if(file?.ns!==6||!String(file.title).startsWith('File:')||irrelevant.test(plainTitle(file.title))||
    !info||clean(meta.Restrictions?.value))return null;
 const licenseUrl=creditLicense(meta,license);
 const thumbnail = httpUrl(info.thumburl,'thumb.wikimedia.org','/wikipedia/commons/thumb/') ||
  httpUrl(info.thumburl,'upload.wikimedia.org','/wikipedia/commons/');
 const image=thumbnail || httpUrl(info.url,'upload.wikimedia.org','/wikipedia/commons/');
 const sourceUrl=httpUrl(info.descriptionurl,'commons.wikimedia.org','/wiki/File:');
 const attribution=clean(meta.Attribution?.value||meta.Artist?.value);
 if(!image||!sourceUrl||!licenseUrl||!attribution||attribution.length>450||!(info.width>=480))return null;
 if(info.mime&&!['image/png','image/jpeg','image/webp','image/svg+xml'].includes(info.mime))return null;
 if(info.mime==='image/svg+xml'&&!thumbnail)return null;
 const description=clean(meta.ImageDescription?.value),filename=plainTitle(file.title);
 const caption=description&&description.length<240?description:filename;
 return {image,visual:{src:'/api/browser/public-figure?id='+id+'&asset=1',title:title||filename,sourceUrl,license,licenseUrl,attribution,alt:caption,caption}};
}
function remember(cache,key,data) {
 if(cache.size>=120&&!cache.has(key))cache.delete(cache.keys().next().value);
 cache.set(key,{until:Date.now()+(data?3600000:300000),data});
}
const topicResults=new Map();
async function resolveTopic(topic,fetcher,signal){
 const key=standardize(topic),saved=topicResults.get(key);
 if(saved?.until>Date.now())return saved.data;
 const query=await metadata('en.wikipedia.org',{...articleParams,titles:topic,redirects:'1'},fetcher,signal)
  .catch(error=>{if(signal.aborted)throw error;return {};});
 const page=query.pages?.[0];
 if(page?.pageprops?.disambiguation!==undefined)return [];
 let canonical=key;
 for(const redirect of query.redirects||[])if(standardize(redirect.from)===canonical)canonical=standardize(redirect.to);
 const exact=page?.ns===0&&positiveId(page.pageid)&&standardize(page.title)===canonical;
 const candidates=exact ? [...new Set([page.pageimage&&'File:'+page.pageimage,...(page.images||[])
   .filter(f=>f.ns===6&&/\.(?:png|jpe?g|svg|webp)$/i.test(f.title)&&matchesTopic(f.title,page.title)).map(f=>f.title)].filter(t=>t&&t.length<=280&&!irrelevant.test(plainTitle(t))))].slice(0,5) : [];
 let files=[];
 if(candidates.length){
  const result=await metadata('commons.wikimedia.org',{...commonsParams,titles:candidates.join('|')},fetcher,signal);
  files=candidates.map(name=>result.pages?.find(f=>standardize(f.title)===standardize(name))).filter(Boolean);
 }
 function select(pages){
  const found=[];
  for(const file of pages){
   if(!positiveId(file.pageid))continue;
   const id='commons-'+file.pageid,data=commonsFigure(file,id,plainTitle(file.title));
   if(data&&!found.some(v=>v.src===data.visual.src)){
    remember(images,id,data);found.push(data.visual);
    if(found.length===3)break;
   }
  }
  return found;
 }
 let visuals=select(files);
 if(!visuals.length){
  const search=await metadata('commons.wikimedia.org',{
   ...commonsParams,generator:'search',gsrnamespace:'6',gsrlimit:'5',gsrsearch:'intitle:"'+topic+'"'
  },fetcher,signal);
  visuals=select((search.pages||[]).filter(f=>matchesTopic(f.title,topic)).sort((a,b)=>a.index-b.index));
 }
 remember(topicResults,key,visuals.length?visuals:null);
 return visuals;
}

export async function publicTopicFigureResponse(request,topic,fetcher=fetch){
 const title=publicTopic(topic),headers={...safeHeaders,'Cache-Control':'private, no-store'};
 if(!title)return Response.json({visual:null,visuals:[]},{status:400,headers});
 try{
  const signal=AbortSignal.any([request.signal,AbortSignal.timeout(28000)]);
  const visuals=await resolveTopic(title,fetcher,signal)||[];
  return Response.json({visual:visuals[0]||null,visuals},{headers});
 }catch{return Response.json({visual:null,visuals:[]},{status:502,headers});}
}
async function resolve(id,fetcher,signal){
 if(id.startsWith('commons-')){
  const fileId=id.slice('commons-'.length);
  const result=await metadata('commons.wikimedia.org',{...commonsParams,pageids:fileId},fetcher,signal);
  const file=result.pages?.[0];
  return String(file?.pageid)===fileId?commonsFigure(file,id):null;
 }
 // Backwards-compatible: some general searches already carry an encyclopedia page ID.
 const result=await metadata('en.wikipedia.org',{...articleParams,pageids:id},fetcher,signal);
 const page=result.pages?.[0];
 if(!page||String(page.pageid)!==id||page.ns!==0||!page.pageimage||page.pageimage.length>250||page.pageprops?.disambiguation!==undefined)return null;
 const name='File:'+page.pageimage;
 const files=await metadata('commons.wikimedia.org',{...commonsParams,titles:name},fetcher,signal);
 const file=files.pages?.find(f=>standardize(f.title)===standardize(name));
 const fileId=positiveId(file?.pageid)?'commons-'+file.pageid:id;
 const data=commonsFigure(file,fileId,clean(page.title));
 if(data&&fileId!==id)remember(images,fileId,data);
 return data;
}
export async function publicFigureResponse(request,fetcher=fetch,assets={}){
 const params=new URL(request.url).searchParams,id=params.get('id'),asset=params.get('asset')==='1';
 const fail=status=>new Response(null,{status,headers:{...safeHeaders,'Cache-Control':'no-store'}});
 if(!['GET','HEAD'].includes(request.method))return fail(405);
 if(params.has('topic')&&!id&&!asset)return publicTopicFigureResponse(request,params.get('topic'),fetcher);
 if(id!=='usgs-water-cycle'&&!/^(?:commons-)?[1-9]\d{0,9}$/.test(id||''))return fail(400);
 try{
  let entry=images.get(id);
  if(!entry||entry.until<Date.now()){
   const data=id==='usgs-water-cycle'?waterDiagram:await resolve(id,fetcher,AbortSignal.any([request.signal,AbortSignal.timeout(22000)]));
   remember(images,id,data);entry=images.get(id);
  }
  if(!asset)return Response.json({visual:entry.data?.visual||null},{headers:{...safeHeaders,'Cache-Control':'public, max-age=1800'}});
  if(!entry.data)return fail(404);
  const bundled=id==='usgs-water-cycle' && assets['/usgs-water-cycle.jpg'];
  if(bundled?.type==='image/jpeg' && bundled.base64){
   const body=request.method==='HEAD'?null:Uint8Array.from(atob(bundled.text),c=>c.charCodeAt(0));
   return new Response(body,{headers:{...safeHeaders,'Content-Type':'image/jpeg','Cache-Control':'public, max-age=86400'}});
  }
  const source=await fetcher(entry.data.image,{headers:{'User-Agent':figureUserAgent},redirect:'manual',signal:AbortSignal.any([request.signal,AbortSignal.timeout(16000)])});
  const data=await bytes(source,4000000);
  let type='';
  if(data[0]===255&&data[1]===216&&data[2]===255)type='image/jpeg';
  else if(data[0]===137&&data[1]===80&&data[2]===78&&data[3]===71)type='image/png';
  else if(String.fromCharCode(...data.slice(0,4))==='RIFF'&&String.fromCharCode(...data.slice(8,12))==='WEBP')type='image/webp';
  if(!type)return fail(502);
  return new Response(request.method==='HEAD'?null:data,{headers:{...safeHeaders,'Content-Type':type,'Cache-Control':'public, max-age=1800'}});
 }catch{return fail(502)}
}
