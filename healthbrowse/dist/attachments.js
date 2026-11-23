import {documentLimits,validateDocuments,isDocumentReference} from './document-policy.js';
let files=[],version=0;
const emit=()=>{version++;document.dispatchEvent(new CustomEvent('healthbrowse-documents-changed'))};
export const getAttachments=()=>files.map(({id,kind,pages})=>({id,kind,pages:pages.map(p=>({...p}))}));
export const attachmentKey=()=>files.length?String(version):'';
export const clearAttachments=()=>{if(files.length){files=[];emit()}};
const el=(tag,text='',className='')=>Object.assign(document.createElement(tag),{textContent:text,className});
const button=(text,action,cls='')=>{const b=el('button',text,cls);b.type='button';b.onclick=action;return b};
function clip(){const s=document.createElementNS('http://www.w3.org/2000/svg','svg');s.setAttribute('viewBox','0 0 24 24');s.setAttribute('aria-hidden','true');const p=document.createElementNS(s.namespaceURI,'path');p.setAttribute('d','M21 11.5 12 20.5a6 6 0 0 1-8.5-8.5L13 2.5a4 4 0 0 1 5.7 5.7L9.2 17.7a2 2 0 0 1-2.8-2.8L15 6.3');s.append(p);return s}
export function setupAttachments(){
 const $=id=>document.getElementById(id),hosts=[],triggers=[];
 const dialog=el('dialog','','attachment-dialog');dialog.setAttribute('aria-labelledby','attachmentTitle');
 const head=el('header'),title=el('h2','Review document');title.id='attachmentTitle';const close=button('×',()=>dialog.close(),'attachment-close');close.setAttribute('aria-label','Close document review');head.append(title,close);
 const body=el('div','','attachment-body');dialog.append(head,body);document.body.append(dialog);
 let reading=false,generation=0;
 function render(){
  for(const host of hosts){host.replaceChildren();host.hidden=!files.length;
   for(const [i,f] of files.entries()){const chip=el('div','','attachment-chip');const review=button('Document '+(i+1)+' · '+f.name,()=>reviewFile(f,false));review.title='Review '+f.name;chip.append(review,button('×',()=>{files=files.filter(x=>x.id!==f.id);emit()},'attachment-remove'));chip.lastChild.setAttribute('aria-label','Remove '+f.name);host.append(chip)}
   host.append(el('small','Buddy will cite passages from these files.','attachment-note'));
  }
  for(const t of triggers)t.disabled=reading||files.length>=documentLimits.files;
 }
 function reviewFile(file,isNew){
  title.textContent=isNew?'Review before attaching':'Review attached document';body.replaceChildren();
  body.append(el('p',file.name,'attachment-name'),el('p','Use only documents you are authorized to share with the AI provider. Remove personal details, patient records and confidential material before attaching. Text is extracted on your device; when you ask a question, the reviewed text goes to HealthBrowse and selected passages go to its AI provider. HealthBrowse does not save files or document chats to your account or use them for training. The AI provider has its own retention terms.','attachment-note'));
  const pages=el('select');pages.setAttribute('aria-label','Document page or section');for(const p of file.pages)pages.append(new Option((file.kind==='page'?'Page ':file.kind==='slide'?'Slide ':'Section ')+p.number,String(p.number)));
  const label=el('label','Extracted text — check accuracy and remove identifying information');label.htmlFor='attachmentText';
  const area=el('textarea');area.id='attachmentText';area.spellcheck=false;area.maxLength=documentLimits.characters;
  const draft=file.pages.map(p=>({...p}));let active=0;area.value=draft[0].text;
  pages.onchange=()=>{draft[active].text=area.value;active=draft.findIndex(p=>p.number===Number(pages.value));area.value=draft[active].text};
  const status=el('p','','attachment-note');status.setAttribute('role','status');
  const use=button(isNew?'Attach document':'Save reviewed text',()=>{
   try{draft[active].text=area.value;const next={...file,pages:draft.filter(p=>p.text.trim())};const candidates=isNew?[...files,next]:files.map(f=>f.id===file.id?next:f);validateDocuments(candidates.map(({id,kind,pages})=>({id,kind,pages})));files=candidates;emit();dialog.close()}catch(error){status.textContent=error.message}
  },'attachment-primary');
  body.append(pages,label,area,status,use);if(!dialog.open)dialog.showModal();
 }
 async function choose(file){
  if(!file)return;const run=++generation;reading=true;render();title.textContent='Reading document';body.replaceChildren(el('p','Extracting text on your device…'));if(!dialog.open)dialog.showModal();
  try{const {extractDocument}=await import('./file-parser.js');const parsed=await extractDocument(file);if(run!==generation)return;const bytes=crypto.getRandomValues(new Uint8Array(8));const id='doc-'+Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');reviewFile({id,name:file.name.slice(0,180),...parsed},true)}
  catch{if(run===generation){title.textContent='Unable to read this file';body.replaceChildren(el('p','Use a readable, unlocked PDF (up to 80 pages), PPTX, DOCX, CSV, TSV, TXT or Markdown file under 10 MB and 60,000 characters. Scans and images need OCR first.'))}}
  finally{if(run===generation){reading=false;render()}}
 }
 const container=$('ask'),input=$('question');
 const fileInput=el('input');fileInput.type='file';fileInput.accept='.pdf,.docx,.pptx,.txt,.md,.csv,.tsv';fileInput.hidden=true;
 fileInput.addEventListener('change',()=>{void choose(fileInput.files?.[0]);fileInput.value=''});
 const trigger=button('',()=>fileInput.click(),'attachment-trigger');trigger.append(clip());trigger.title='Attach a PDF, PowerPoint, Word, text or tabular dataset';trigger.setAttribute('aria-label','Attach a document for Buddy');
 container.insertBefore(trigger,input);container.append(fileInput);triggers.push(trigger);
 const host=el('div','','attachment-list');host.hidden=true;host.setAttribute('aria-label','Attached documents');container.before(host);hosts.push(host);
 document.addEventListener('healthbrowse-documents-changed',render);
 document.addEventListener('healthbrowse-session-cleared',clearAttachments);
 $('newChat').addEventListener('click',clearAttachments);$('clearChat').addEventListener('click',clearAttachments);
 window.addEventListener('pagehide',()=>{generation++;files=[];body.replaceChildren()});
 dialog.addEventListener('close',()=>{generation++;reading=false;render();body.replaceChildren()});
 document.addEventListener('healthbrowse-document-source',event=>{const ref=event.detail;if(!isDocumentReference(ref))return;title.textContent=ref.title||'Document passage';body.replaceChildren(el('p','Excerpt from your document.','attachment-note'),el('blockquote',ref.quote||ref.text,'attachment-passage'));if(!dialog.open)dialog.showModal()});
 render();
}
