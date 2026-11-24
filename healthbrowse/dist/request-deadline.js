// Some model bindings resolve after their caller has already stopped waiting.
export function abortable(promise, signal) {
  return new Promise((resolve,reject) => {
    const abort = () => reject(signal.reason || new DOMException('Aborted','AbortError'));
    signal.addEventListener('abort',abort,{once:true});
    if (signal.aborted) abort();
    Promise.resolve(promise).then(resolve,reject).finally(() => signal.removeEventListener('abort',abort));
  });
}
