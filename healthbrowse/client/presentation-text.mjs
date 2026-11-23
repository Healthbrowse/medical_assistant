import {unzipSync,strFromU8} from 'fflate';
import {XMLParser,XMLValidator} from 'fast-xml-parser';
import {documentLimits} from '../dist/document-policy.js';

const presentation = 'ppt/presentation.xml';
const rels = 'ppt/_rels/presentation.xml.rels';
const slideFile = /^ppt\/slides\/[A-Za-z0-9_-]+\.xml$/;
const parser = new XMLParser({preserveOrder:true,ignoreAttributes:false,trimValues:false,parseTagValue:false});
const elementTag = node => Object.keys(node)[0];
const tagName = node => elementTag(node).split(':').pop();
const children = node => node[elementTag(node)];
const child = (nodes,name) => nodes.find(node => tagName(node) === name);

function parsePart(data,path){
  if(!data[path])throw Error('Missing presentation part.');
  const xml=strFromU8(data[path]);
  if(/<!DOCTYPE|<!ENTITY/i.test(xml)||XMLValidator.validate(xml)!==true)throw Error('Invalid presentation XML.');
  return parser.parse(xml);
}

function slideText(tree){
  const lines=[];
  let line='';
  // Read drawing text runs in shape/table order. Speaker notes and linked
  // resources are separate package parts and are never opened.
  function visit(nodes,depth=0){
    if(depth>100)throw Error('Slide is too complex.');
    for(const node of nodes){
      const name=tagName(node),value=children(node);
      if(name==='t')line+=value.map(run=>run['#text']??'').join('');
      else if(name==='br')line+='\n';
      else if(Array.isArray(value)){
        visit(value,depth+1);
        if(name==='p'){if(line.trim())lines.push(line.trim());line='';}
      }
    }
  }
  visit(tree);
  return lines.join('\n');
}

export function extractSlides(bytes){
  if(bytes.length>documentLimits.bytes)throw Error('Presentation is too large.');
  let expanded=0,parts=0;
  const seen=new Set();
  const data=unzipSync(bytes,{filter:entry=>{
    if(++parts>4000)throw Error('Too many presentation parts.');
    if(entry.name!==presentation&&entry.name!==rels&&!slideFile.test(entry.name))return false;
    expanded+=entry.originalSize;
    if(seen.has(entry.name)||entry.originalSize>2000000||expanded>10000000)throw Error('Invalid or oversized presentation.');
    seen.add(entry.name);return true;
  }});
  const root=child(parsePart(data,presentation),'presentation');
  const list=root&&child(children(root),'sldIdLst');
  const slides=list&&children(list).filter(node=>tagName(node)==='sldId');
  if(!slides?.length||slides.length>documentLimits.pages)throw Error('Use a presentation with 1–80 slides.');
  const relationships=child(parsePart(data,rels),'Relationships');
  if(!relationships)throw Error('Missing presentation relationships.');
  const targets=new Map();
  for(const rel of children(relationships)){
    const attrs=rel[':@']||{};
    if(tagName(rel)!=='Relationship'||!attrs['@_Type']?.endsWith('/slide')||attrs['@_TargetMode']==='External')continue;
    const target=attrs['@_Target']||'';
    const path=target.startsWith('/')?target.slice(1):'ppt/'+target;
    if(slideFile.test(path))targets.set(attrs['@_Id'],path);
  }
  let characters=0;
  const pages=[];
  slides.forEach((slide,index)=>{
    const attrs=slide[':@']||{};
    const ref=Object.keys(attrs).find(name=>name.startsWith('@_')&&name.endsWith(':id'));
    const part=child(parsePart(data,targets.get(attrs[ref])),'sld');
    const content=part&&child(children(part),'cSld');
    const shapes=content&&child(children(content),'spTree');
    if(!shapes)throw Error('Invalid slide layout.');
    const text=slideText(children(shapes));
    characters+=text.length;
    if(characters>documentLimits.characters)throw Error('Presentation contains too much text.');
    if(text)pages.push({number:index+1,text});
  });
  return pages;
}
