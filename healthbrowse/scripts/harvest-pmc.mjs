// Offline research ingestion only. Run outside the request/response Worker.
import {parseArgs} from 'node:util';
import {readFile,writeFile,appendFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {XMLParser} from 'fast-xml-parser';
import {parseFullText} from '../server/pmc-fulltext.mjs';
export const PMC_OAI='https://pmc.ncbi.nlm.nih.gov/api/oai/v1/mh/';
export function harvestURL({from,until,token}){
 const url=new URL(PMC_OAI);url.search=new URLSearchParams(token?{verb:'ListRecords',resumptionToken:token}:{verb:'ListRecords',metadataPrefix:'pmc',set:'pmc-open',from,...(until?{until}:{})}).toString();return url;
}
export function harvestRecords(xml){
 if(xml.length>16_000_000||/<!ENTITY/i.test(xml))throw Error('Unsupported XML response');
 const parser=new XMLParser({ignoreAttributes:false,processEntities:false,parseTagValue:false}),root=parser.parse(xml)['OAI-PMH'];
 if(root?.error&&root.error['@_code']!=='noRecordsMatch')throw Error('OAI error: '+root.error['@_code']);
 const section=root?.ListRecords||{},list=section.record?Array.isArray(section.record)?section.record:[section.record]:[];
 const rawRecords=[...xml.matchAll(/<record(?:\s[^>]*)?>[\s\S]*?<\/record>/g)].map(m=>m[0]),records=[];
 for(const record of list){
  const id=String(record.header?.identifier||'').match(/^oai:pubmedcentral.nih.gov:(\d+)$/)?.[1];if(!id)continue;
  if(record.header['@_status']==='deleted'){records.push({pmcid:'PMC'+id,status:'deleted',datestamp:record.header.datestamp});continue}
  // Extract the original ordered article XML so inline text is not reordered.
  const raw=rawRecords.find(r=>r.includes('<identifier>oai:pubmedcentral.nih.gov:'+id+'</identifier>'));
  const articleXML=raw?.match(/<article(?:\s[^>]*)?>[\s\S]*?<\/article>/)?.[0];
  const article=articleXML?parseFullText(articleXML,'PMC'+id):null;
  if(article)records.push({...article,status:'review_required',source:PMC_OAI,datestamp:record.header.datestamp,retrievedAt:new Date().toISOString()});
 }
 const t=section.resumptionToken;return {records,token:typeof t==='string'?t:t?.['#text']||null};
}
async function main(){
 const {values:v}=parseArgs({options:{from:{type:'string'},until:{type:'string'},output:{type:'string'},'max-pages':{type:'string',default:'5'},resume:{type:'boolean',default:false}}});
 if(!v.output||!v.from){console.info('Usage: node scripts/harvest-pmc.mjs --from YYYY-MM-DD --until YYYY-MM-DD --output /path/corpus.jsonl [--max-pages 5] [--resume]');return}
 if(!/^\d{4}-\d{2}-\d{2}$/.test(v.from)||(v.until&&!/^\d{4}-\d{2}-\d{2}$/.test(v.until)))throw Error('Use ISO dates.');
 const max=Number(v['max-pages']);if(!Number.isInteger(max)||max<1||max>1000)throw Error('max-pages must be 1–1000.');
 const statePath=v.output+'.state.json';let token=null;
 if(v.resume){const state=JSON.parse(await readFile(statePath,'utf8'));if(state.from!==v.from||state.until!==(v.until||null))throw Error('Resume dates do not match.');if(state.complete){console.info('Harvest already complete.');return}token=state.token;}
 else await writeFile(v.output,'',{flag:'wx'});
 for(let page=0;page<max;page++){
  const eastern=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',weekday:'short',hour:'numeric',hourCycle:'h23'}).formatToParts(new Date());
  const day=eastern.find(p=>p.type==='weekday')?.value,hour=Number(eastern.find(p=>p.type==='hour')?.value);
  if(max>100&&!['Sat','Sun'].includes(day)&&hour>=5&&hour<21)throw Error('More than 100 requests must run outside PMC peak hours: weekdays 05:00–21:00 US Eastern.');
  const response=await fetch(harvestURL({from:v.from,until:v.until,token}),{headers:{Accept:'application/xml','Accept-Encoding':'gzip, deflate'},redirect:'error',signal:AbortSignal.timeout(45000)});
  if(!response.ok)throw Error('PMC returned '+response.status+'. Resume later; no automatic retry loop.');
  const reader=response.body.getReader(),decoder=new TextDecoder();let text='',size=0;
  try{while(true){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>16_000_000){await reader.cancel();throw Error('Response too large.')}text+=decoder.decode(value,{stream:true})}}finally{reader.releaseLock()}
  const result=harvestRecords(text+decoder.decode());
  if(result.records.length)await appendFile(v.output,result.records.map(r=>JSON.stringify(r)).join('\n')+'\n');
  token=result.token;await writeFile(statePath,JSON.stringify({from:v.from,until:v.until||null,token,complete:!token}));
  console.info(JSON.stringify({page:page+1,retained:result.records.length,complete:!token}));if(!token)break;
  await new Promise(resolve=>setTimeout(resolve,400));
 }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(()=>{console.error('Harvest stopped. Check arguments, source availability and checkpoint before resuming.');process.exitCode=1});
