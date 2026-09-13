/* Thin wrapper so pdf.worker.min.mjs's own use of Promise.withResolvers
   (Chrome 119+) doesn't throw inside this Worker's own separate global
   scope — a polyfill applied on the main thread (see cards.js) does NOT
   carry over into a Worker, which has its own independent globals.
   Kanvaz points GlobalWorkerOptions.workerSrc at THIS file instead of
   the vendored pdf.worker.min.mjs directly. */
if (typeof Promise.withResolvers !== 'function') {
  Promise.withResolvers = function () {
    var resolve, reject;
    var promise = new Promise(function (res, rej) { resolve = res; reject = rej; });
    return { promise: promise, resolve: resolve, reject: reject };
  };
}
import('./pdf.worker.min.mjs');
