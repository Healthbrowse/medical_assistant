// Operator policy only: a disabled checkpoint is not a provider health result.
// Match exact requested IDs; unrelated names, aliases and empty entries are inert.
export function isModelDisabled(env,model){
 const setting=env.MODEL_DISABLED_MODELS;
 return typeof setting==='string'&&typeof model==='string'&&!!model&&
  setting.split(',').some(entry=>entry.trim()===model);
}
