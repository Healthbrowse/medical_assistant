import {XMLParser} from 'fast-xml-parser';
const parser=new XMLParser({ignoreAttributes:false,attributeNamePrefix:'@_',removeNSPrefix:true,processEntities:false,parseTagValue:false,trimValues:false,preserveOrder:true});
const list=x=>x===undefined?[]:Array.isArray(x)?x:[x];
export function xmlText(value){
 if(typeof value==='string')return value;
 if(!value||typeof value!=='object')return '';
 return (Array.isArray(value)?value:Object.entries(value).filter(([k])=>k!==':@'&&!k.startsWith('@_')).map(([,v])=>v)).map(xmlText).join('').replace(/\s+/g,' ');
}
export function reusableLicense(value){
 const t=String(value||'').toLowerCase();
 if(/noncommercial|no.?derivatives|by-nc|by-nd|by-sa/.test(t))return false;
 return /creativecommons\.org\/(?:licenses\/by\/|publicdomain\/zero\/)|\bcc[ -]?by(?:[ -]4\.0|[ -]3\.0|[ -]2\.0)?\b|\bcc0\b/.test(t);
}
function find(nodes,name){for(const n of list(nodes)){if(n[name])return n;for(const [k,v] of Object.entries(n))if(k!==':@'&&Array.isArray(v)){const found=find(v,name);if(found)return found}}return null}
export function parseFullText(xml,expectedPmcid,{bodyOnly=false,expectedPmid}={}){
 if(typeof xml!=='string'||xml.length>1_500_000||/<!ENTITY/i.test(xml))return null;
 let tree;try{tree=parser.parse(xml)}catch{return null}
 const article=find(tree,'article');if(!article||/retract|preprint/i.test(article[':@']?.['@_article-type']||''))return null;
 const meta=find(article.article,'article-meta')?.['article-meta'];if(!meta)return null;
 const pmcid=meta.find(x=>x['article-id']&&['pmc','pmcid'].includes(x[':@']?.['@_pub-id-type']));
 const id=xmlText(pmcid?.['article-id']).trim().replace(/^PMC/,'');if(!/^\d+$/.test(id)||'PMC'+id!==expectedPmcid)return null;
 const pmid=meta.find(x=>x['article-id']&&x[':@']?.['@_pub-id-type']==='pmid');
 if(expectedPmid&&pmid&&xmlText(pmid['article-id']).trim()!==expectedPmid)return null;
 const permissions=find(meta,'permissions')?.permissions||[];
 const license=permissions.find(l=>l.license&&(reusableLicense(l[':@']?.['@_href']||'')||reusableLicense(xmlText(l.license))));
 if(!license)return null;
 const paragraphs=[];
 function walk(nodes,heading=''){
  const title=list(nodes).find(n=>n.title),label=title?xmlText(title.title).trim():heading;
  for(const n of list(nodes))for(const [key,value] of Object.entries(n)){
   if(['ref-list','table-wrap','fig','supplementary-material','ack','permissions','title',':@'].includes(key))continue;
   if(key==='p'){const text=xmlText(value).trim();if(text.length>=35&&text.length<=8000)paragraphs.push({heading:label,text})}
   else if(Array.isArray(value))walk(value,label);
  }
 }
 if(!bodyOnly)walk(find(meta,'abstract')?.abstract,'Abstract');
 walk(find(article.article,'body')?.body);
 return {pmcid:expectedPmcid,title:xmlText(find(meta,'article-title')?.['article-title']).trim(),license:license[':@']?.['@_href']||xmlText(license.license).trim(),paragraphs:paragraphs.slice(0,150)};
}
