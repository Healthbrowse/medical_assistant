// The CLI and reviewer page use the same logging policy and unbiased action probabilities.
async function uniform(key){
  const buf=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(key));
  const view=new DataView(buf);
  return (view.getUint32(0)*65536+view.getUint16(4))/2**48;
}
export async function assignItem(item,seed){
  const n=await uniform(seed+':'+item.id);
  return {id:item.id,question:item.question,role:item.role,action:item.eligible[Math.floor(n*item.eligible.length)],p:1/item.eligible.length};
}
export async function reviewSession(casebook,seed){
  const ranked=await Promise.all(casebook.items.map(async item=>({item,order:await uniform('order:'+seed+':'+item.id)})));
  ranked.sort((a,b)=>a.order-b.order);
  const count={General:0,Clinicians:0};
  const items=[];
  for(const {item} of ranked){
    if(count[item.role]>=12)continue;
    items.push(await assignItem(item,seed));count[item.role]++;
  }
  return {study:casebook.study,seed,items};
}
