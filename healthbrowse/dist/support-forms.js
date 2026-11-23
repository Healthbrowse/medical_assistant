// Shared by the dedicated Feedback and Contact us pages.
export function setupSupportForms({request,isSignedIn}){
 const $=id=>document.getElementById(id),attempts={};
 for(const kind of ['feedback','contact']){
  const form=$(kind+'Form');if(!form)continue;
  const message=$(kind+'Message'),status=$(kind+'Status'),submit=form.querySelector('button[type=submit]');
  const counter=$(kind+'Count');
  if(counter){const count=()=>counter.textContent=message.value.length+' / 2,000';message.addEventListener('input',count);count();}
  form.onsubmit=async event=>{
   event.preventDefault();if(!form.reportValidity()||!isSignedIn())return;
   const data=kind==='feedback'?{message:message.value.trim(),category:$('feedbackCategory')?.value||'general'}:{name:$('contactName').value.trim(),email:$('contactEmail').value.trim(),message:message.value.trim()};
   if(!data.message){message.setCustomValidity('Please enter a message.');message.reportValidity();message.oninput=()=>message.setCustomValidity('');return;}
   const signature=JSON.stringify(data);
   if(attempts[kind]?.signature!==signature)attempts[kind]={signature,id:crypto.randomUUID()};
   submit.disabled=true;form.setAttribute('aria-busy','true');status.textContent='Submitting…';status.classList.remove('is-error');
   try{
    const result=await request('/api/'+kind,{method:'POST',body:{...data,requestId:attempts[kind].id}});
    if(kind==='feedback')status.textContent='Thank you. Your feedback has been saved for review. Reference: '+(result.requestId||result.feedback.id);
    else status.textContent=(result.status==='sent'?'Your message was saved and sent to the team.':result.status==='received'?'Your message was saved in our support inbox. Email forwarding is '+(result.delivery==='pending'?'pending.':'not connected yet.'):'Delivery is pending. Retry the same message to check its status.')+(result.requestId?' Reference: '+result.requestId:'');
    if(kind==='feedback'||result.status==='sent'||result.status==='received'){
     message.value='';attempts[kind]=null;message.dispatchEvent(new Event('input'));
    }
   }catch(error){status.textContent=error.message||'Your message could not be submitted. Please try again.';status.classList.add('is-error');}
   finally{form.removeAttribute('aria-busy');submit.disabled=!isSignedIn();}
  };
 }
}
