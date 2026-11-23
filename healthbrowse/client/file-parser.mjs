import {getDocument,GlobalWorkerOptions} from 'pdfjs-dist/build/pdf.mjs';
import {datasetProfile} from './dataset-profile.mjs';
import {extractSlides} from './presentation-text.mjs';
import {unzipSync,strFromU8} from 'fflate';
import {documentLimits,documentExtensions} from '../dist/document-policy.js';
GlobalWorkerOptions.workerSrc='/pdf-worker.js';
export async function extractDocument(file){
 const extension=file.name.split('.').pop().toLowerCase();
 if(!documentExtensions.includes(extension))throw Error('Use a text PDF, DOCX, PPTX, CSV, TSV, TXT or Markdown file. Images and scanned PDFs need OCR first.');
 if(!file.size||file.size>documentLimits.bytes)throw Error('Choose a file smaller than 10 MB.');
 const bytes=new Uint8Array(await file.arrayBuffer());let pages=[];
 if(extension==='pdf'){
  if(new TextDecoder().decode(bytes.slice(0,5))!=='%PDF-')throw Error('This file is not a valid PDF.');
  const task=getDocument({data:bytes,isEvalSupported:false,useSystemFonts:false,disableFontFace:true,stopAtErrors:true});
  task.onPassword=()=>{void task.destroy();};
  try{
   const doc=await task.promise;if(doc.numPages>documentLimits.pages)throw Error('Use a PDF with at most 80 pages.');
   let size=0,blank=0;
   for(let number=1;number<=doc.numPages;number++){
    const page=await doc.getPage(number),content=await page.getTextContent();
    const text=content.items.map(x=>typeof x.str==='string'?x.str+(x.hasEOL?'\n':' '):'').join('').trim();page.cleanup();
    if(!text){blank++;continue}size+=text.length;if(size>documentLimits.characters)throw Error('This PDF has too much text. Upload a shorter extract.');
    pages.push({number,text});
   }
   if(blank)throw Error('Some PDF pages have no readable text. Run OCR or remove blank/image-only pages before attaching.');
  }catch(error){if(/password|PasswordException|destroyed/i.test(error.message||error.name))throw Error('Password-protected PDFs are not supported. Upload an unlocked copy.');throw error}finally{await task.destroy().catch(()=>{})}
 }else if(extension==='csv'||extension==='tsv'){
  pages=datasetProfile(bytes,extension==='csv'?',':'\t');
 }else if(extension==='pptx'){
  pages=extractSlides(bytes);
 }else if(extension==='docx'){
  if(bytes[0]!==80||bytes[1]!==75)throw Error('This file is not a valid DOCX document.');
  let tooLarge=false;
  const data=unzipSync(bytes,{filter:f=>{if(f.name!=='word/document.xml')return false;if(f.originalSize>2_000_000||f.size>documentLimits.bytes){tooLarge=true;return false}return true}});
  if(tooLarge||!data['word/document.xml']||data['word/document.xml'].length>2_000_000)throw Error('The DOCX document is missing readable text or is too large.');
  const xml=new DOMParser().parseFromString(strFromU8(data['word/document.xml']),'application/xml');
  if(xml.querySelector('parsererror'))throw Error('The DOCX text could not be read.');
  const text=[...xml.getElementsByTagNameNS('*','p')].map(p=>[...p.getElementsByTagNameNS('*','t')].map(t=>t.textContent).join('')).filter(Boolean).join('\n\n');
  pages=[{number:1,text}];
 }else{
  const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes).trim();
  if(/\x00/.test(text))throw Error('This is not a readable UTF-8 text document.');pages=[{number:1,text}];
 }
 if(!pages.length||pages.reduce((length,page)=>length+page.text.trim().length,0)<20)throw Error('No usable text was found. Images and scans require OCR.');
 if(pages.reduce((n,p)=>n+p.text.length,0)>documentLimits.characters)throw Error('Use a document with at most 60,000 characters.');
 return {pages,kind:extension==='pdf'?'page':extension==='pptx'?'slide':'section'};
}
