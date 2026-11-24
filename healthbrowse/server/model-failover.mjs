// Only failures from the external model call are eligible. Authentication,
// request limits, retrieval, citation checks and model refusals run separately.
async function retryableResponse(response) {
 const status = response.status;
 if ([401, 402, 404, 408, 429].includes(status) || status >= 500) return true;
 if (![400, 403, 422].includes(status)) return false;
 // The router also uses 400/422 for unsupported checkpoints. Require a
 // model/endpoint-specific diagnosis before treating this as an outage.
 const reader = response.body?.getReader();
 if (!reader) return false;
 let detail = '';
 const decoder = new TextDecoder();
 try {
  while (detail.length < 4096) {
   const {done, value} = await reader.read();
   if (done) break;
   detail += decoder.decode(value.subarray(0, 4096 - detail.length), {stream:true});
  }
 } finally {
  await reader.cancel().catch(() => {});
  reader.releaseLock();
 }
 if (/safety|moderation|content[_ -]?(?:policy|filter)|refusal/i.test(detail)) return false;
 return /model[_ -](?:not[_ -](?:found|supported|available)|unavailable|decommissioned)|(?:no|unsupported) (?:inference )?provider|model.{0,180}(?:is not supported|isn't supported|not available|does not exist|is not deployed|is not a chat model)/i.test(detail);
}

// run returns {response, value}. It reads successful bodies under the same
// abort signal, so a stalled response body also leaves time for the backup.
export async function withModelFallback(primary, backup, signal, primaryMs, run) {
 signal.throwIfAborted();
 const attempt = async (config, attemptSignal) => ({...await run(config, attemptSignal), config});
 if (!backup || !primary || primary === backup) return attempt(primary || backup, signal);
 const timer = AbortSignal.timeout(primaryMs);
 const primarySignal = AbortSignal.any([signal, timer]);
 try {
  const result = await attempt(primary, primarySignal);
  if (result.response.ok || !await retryableResponse(result.response)) return result;
  if (!result.response.bodyUsed) await result.response.body?.cancel();
 } catch (error) {
  signal.throwIfAborted();
  if (!timer.aborted && !(error instanceof TypeError) && error.name !== 'TimeoutError') throw error;
 }
 signal.throwIfAborted();
 return attempt(backup, signal);
}
