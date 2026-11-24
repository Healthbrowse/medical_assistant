// Only public topic names and the reading role go to the same-origin catalog worker.
let worker, active, last, nextId = 0;
export function loadBuddySnapshot(topic, role) {
  const key = JSON.stringify([topic,role]);
  if (last?.key === key) return Promise.resolve(last.report);
  if (active?.key === key) return active.promise;
  active?.finish(null);
  try {
    worker ??= new Worker('/buddy-deck-worker.js', {type:'module'});
  } catch {
    return Promise.resolve(null);
  }
  const id = ++nextId;
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  const timer = setTimeout(() => finish(null), 4000);
  function finish(report) {
    if (active?.id !== id) return;
    clearTimeout(timer);
    active = null;
    if (report?.decks?.length === 6) last = {key,report};
    resolve(report);
  }
  active = {id,key,promise,finish};
  worker.onmessage = ({data}) => { if (data.id === id) finish(data.report); };
  worker.onerror = () => { worker.terminate(); worker = null; finish(null); };
  worker.postMessage({id,topic,role});
  return promise;
}
