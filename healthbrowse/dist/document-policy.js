import {hasBuddySecrets} from './buddy-policy.js';
export const documentLimits={files:3,bytes:10*1024*1024,pages:80,characters:60000,totalCharacters:100000};
export const documentExtensions=['pdf','docx','pptx','csv','tsv','txt','md'];
export function documentHasIdentifiers(text){
 text=String(text).normalize('NFKC');
 return hasBuddySecrets(text)||/[\w.+-]+@[\w.-]+\.[a-z]{2,}|\b(?:patient name|patient id|medical record number|mrn|date of birth|dob|ssn|home address)\s*[:=#]\s*\S|\b\d{3}-\d{2}-\d{4}\b|\b(?:phone|mobile|telephone)\s*[:=]\s*\+?\d/i.test(text);
}
export function validateDocuments(files){
 if(!Array.isArray(files)||!files.length||files.length>documentLimits.files)throw Error('Attach one to three documents.');
 let total=0;const ids=new Set();
 return files.map((f,i)=>{
  if(!f||typeof f!=='object'||Object.keys(f).some(k=>!['id','pages','kind'].includes(k))||!/^doc-[a-f0-9]{16}$/.test(f.id)||ids.has(f.id)||!Array.isArray(f.pages)||!f.pages.length||f.pages.length>documentLimits.pages)throw Error('Invalid document format.');
  if(f.kind!==undefined&&!['page','slide','section'].includes(f.kind))throw Error('Invalid document location type.');
  ids.add(f.id);let length=0,last=0;
  const pages=f.pages.map(p=>{
   if(!p||Object.keys(p).some(k=>!['number','text'].includes(k))||!Number.isInteger(p.number)||p.number<1||p.number>documentLimits.pages||p.number<=last||typeof p.text!=='string'||!p.text.trim()||p.text.length>documentLimits.characters)throw Error('Invalid document page.');
   last=p.number;length+=p.text.length;total+=p.text.length;
   if(documentHasIdentifiers(p.text))throw Error('Remove names, contact details, record identifiers and credentials before using the document.');
   return {number:p.number,text:p.text.normalize('NFKC').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,' ').trim()};
  });
  if(length>documentLimits.characters||total>documentLimits.totalCharacters)throw Error('Documents exceed the text limit. Use a shorter extract.');
  return {id:f.id,title:'Document '+(i+1),pages,...(f.kind?{kind:f.kind}:{})};
 });
}
export const isDocumentReference=ref=>ref?.userProvided===true&&/^doc-[a-f0-9]{16}$/.test(ref.documentId||'')&&Number.isInteger(ref.page)&&ref.page>0&&ref.page<=documentLimits.pages;
