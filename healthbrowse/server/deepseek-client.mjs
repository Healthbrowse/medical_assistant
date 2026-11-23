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
 // The HF router can pass through OpenRouter's published ID for the same V3.2 weights.
 return name===expected||name===expected.split('/').pop()||
  (expected==='deepseek-ai/deepseek-v3.2'&&name==='deepseek/deepseek-v3.2');
}
// Some R1 hosts return a completed thought envelope before the final object;
// others return a separate reasoning field. Only final JSON enters the product.
export function readDeepSeekResult(data,model,schema){
 const choice=data?.choices?.[0];
 if(!choice || (choice.finish_reason && choice.finish_reason!=='stop') || typeof choice.message?.content!=='string')throw new Error('Incomplete final response');
 if(!matchesDeepSeekModel(data.model,model))throw new Error('Unexpected response model');
 let content=choice.message.content.trim();
 if(/^<think>/i.test(content)){
  const end=content.toLowerCase().indexOf('</think>');
  if(end<0)throw new Error('Missing final response');
  content=content.slice(end+8).trim();
 }
 content=content.replace(/^\x60\x60\x60(?:json)?\s*/i,'').replace(/\s*\x60\x60\x60$/,'');
 const result=JSON.parse(content);
 if(!matchesSchema(result,schema) ||
    /<\s*\/?\s*(?:think|thinking|reasoning|analysis)\b/i.test(JSON.stringify(result)))throw new Error('Invalid final response');
 return result;
}
export function deepseekPayload(model,messages,maxTokens,schema){
 // The inference providers support standard chat completions. Communicate the
 // required shape in the prompt so an optional schema-decoding extension is
 // not a prerequisite. The server still validates citations and the review.
 const [instructions,...rest]=messages;
 const content=instructions.content+'\nReturn only a final JSON object matching this schema:\n'+JSON.stringify(schema);
 return {model,messages:[{...instructions,content},...rest],temperature:0.2,max_tokens:maxTokens,stream:false};
}
