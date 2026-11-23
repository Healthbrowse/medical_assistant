// A packet belongs to one live question. Never persist it in chat history or browser storage.
export function evidencePacket(value){
 if(!value||!Array.isArray(value.query_decomposition)||!Array.isArray(value.retrieved_sources)||!Array.isArray(value.evidence_gaps))return null;
 const {query_decomposition,retrieved_sources,evidence_gaps}=value;
 return {query_decomposition,retrieved_sources,evidence_gaps};
}

export function createPacketReader(load){
 let value=null,pending=null;
 const controller=new AbortController();
 return {
  read(){
   if(controller.signal.aborted)return Promise.reject(new DOMException('Expired research question','AbortError'));
   if(value)return Promise.resolve(value);
   if(!pending)pending=Promise.resolve().then(()=>load(controller.signal)).then(result=>{
    controller.signal.throwIfAborted();
    value=evidencePacket(result);
    if(!value)throw new Error('The evidence packet is unavailable for this question.');
    return value;
   }).finally(()=>{pending=null});
   return pending;
  },
  dispose(){controller.abort();value=null;}
 };
}

export function packetDisclosure(reader){
 const details=document.createElement('details');
 details.className='source-directory literature-packet';
 const summary=document.createElement('summary');summary.textContent='Literature evidence (JSON)';
 const body=document.createElement('div');
 const status=document.createElement('p');status.className='meta';status.setAttribute('role','status');
 body.append(status);details.append(summary,body);
 let ready=false,loading=false;
 async function show(){
  if(ready||loading||!details.open)return;
  loading=true;status.textContent='Retrieving the evidence packet…';body.replaceChildren(status);
  try{
   const packet=await reader.read();
   if(!details.isConnected)return;
   const n=packet.retrieved_sources.length,g=packet.evidence_gaps.length;
   status.textContent=n+' verified source'+(n===1?'':'s')+' · '+g+' evidence gap'+(g===1?'':'s');
   const json=JSON.stringify(packet,null,2);
   const download=document.createElement('button');download.type='button';download.className='act';download.textContent='Download JSON';
   download.onclick=()=>{
    const url=URL.createObjectURL(new Blob([json+'\n'],{type:'application/json'}));
    const a=document.createElement('a');a.href=url;a.download='healthbrowse-literature-evidence.json';a.click();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
   };
   const preview=document.createElement('pre');preview.tabIndex=0;preview.setAttribute('aria-label','Literature evidence JSON');preview.textContent=json;
   body.append(download,preview);ready=true;
  }catch(error){
   if(error.name==='AbortError'||!details.isConnected)return;
   status.textContent=error.message||'The evidence packet could not be retrieved.';
   const retry=document.createElement('button');retry.type='button';retry.className='act';retry.textContent='Retry';retry.onclick=show;body.append(retry);
  }finally{loading=false}
 }
 details.addEventListener('toggle',show);
 return details;
}
