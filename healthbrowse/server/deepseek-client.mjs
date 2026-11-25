function matchesSchema(value,schema){
 if(schema.type==='string')return typeof value==='string'&&(!schema.enum||schema.enum.includes(value));
 if(schema.type==='integer')return Number.isSafeInteger(value)&&(!schema.enum||schema.enum.includes(value));
 if(schema.type==='array')return Array.isArray(value)&&value.every(item=>matchesSchema(item,schema.items));
 if(schema.type!=='object'||!value||typeof value!=='object'||Array.isArray(value))return false;
 return schema.required.every(key=>Object.hasOwn(value,key))&&
  Object.keys(value).every(key=>Object.hasOwn(schema.properties,key)&&matchesSchema(value[key],schema.properties[key]));
}
// Some inference hosts omit the owner or append the routing provider.
export function matchesDeepSeekModel(reported,requested){
 if(reported===undefined||reported===null)return true;
 if(typeof reported!=='string'||typeof requested!=='string')return false;
 const name=reported.split(':')[0].toLowerCase(),expected=requested.toLowerCase();
 if(expected.startsWith('@cf/'))return name===expected||name===expected.slice(4)||name===expected.split('/').pop();
 // The HF router can pass through OpenRouter's published ID for the same V3.2 weights.
 return name===expected||name===expected.split('/').pop()||
  (expected==='deepseek-ai/deepseek-v3.2'&&name==='deepseek/deepseek-v3.2');
}
// These codes describe the provider reply without exposing its body or the question.
export class CompletionError extends Error {
 constructor(code){super(code);this.code=code;}
}
function invalidOutput(){throw new CompletionError('provider_output_invalid');}
function refused(){throw new CompletionError('provider_refusal');}
function validateFinal(value,schema){
 if(!matchesSchema(value,schema) ||
    /<\s*\/?\s*(?:think|thinking|reasoning|analysis)\b/i.test(JSON.stringify(value)))invalidOutput();
 return value;
}
// Read only final output. A refusal, filter or unexpected model is terminal.
export function readDeepSeekResult(data,model,schema){
 const choice=data?.choices?.[0],message=choice?.message;
 const native=model.startsWith('@cf/') && data && !Object.hasOwn(data,'choices') && Object.hasOwn(data,'response');
 const finish=native?data.finish_reason:choice?.finish_reason;
 if(message?.refusal || finish==='content_filter' || data?.refusal)refused();
 if(!matchesDeepSeekModel(data?.model,model))throw new CompletionError('provider_model_mismatch');
 if(finish==='length')throw new CompletionError('provider_output_truncated');
 if(finish && finish!=='stop')throw new CompletionError('provider_output_unexpected');
 let content=native?data.response:message?.content;
 if(native && content && typeof content==='object'){
  if(content.refusal)refused();
  return validateFinal(content,schema);
 }
 if(typeof content!=='string')invalidOutput();
 content=content.trim();
 if(/^<think>/i.test(content)){
  const end=content.toLowerCase().indexOf('</think>');
  if(end<0)invalidOutput();
  content=content.slice(end+8).trim();
 }
 content=content.replace(/^`{3}(?:json)?\s*/i,'').replace(/\s*`{3}$/,'');
 // Plain prose may itself be a refusal. Retry only a recognizable format failure.
 if(content && !content.startsWith('{') && !content.startsWith('['))throw new CompletionError('provider_output_unexpected');
 let result;
 try{result=JSON.parse(content);}catch{invalidOutput();}
 if(result?.refusal)refused();
 return validateFinal(result,schema);
}
export function deepseekPayload(model,messages,maxTokens,schema){
 // The inference providers support standard chat completions. Communicate the
 // required shape in the prompt so an optional schema-decoding extension is
 // not a prerequisite. The server still validates citations and the review.
 const [instructions,...rest]=messages;
 const content=instructions.content+'\nReturn only a final JSON object matching this schema:\n'+JSON.stringify(schema);
 return {model,messages:[{...instructions,content},...rest],temperature:0.2,max_tokens:maxTokens,stream:false};
}
