import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { AppErrorBoundary } from '../../../apps/web/src/AppErrorBoundary';
import {
  installClientDiagnostics,
  beginDiagnosticContext,
} from '../../../apps/web/src/client-diagnostics';
installClientDiagnostics();
beginDiagnosticContext('electronics');
const worker = new Worker(new URL('./probe.worker.ts', import.meta.url), { type: 'module' });
worker.onmessage = (event) => {
  Object.assign(window, { workerReady: event.data === 42 });
  worker.terminate();
};
worker.postMessage('probe');
function fail() {
  throw new TypeError('PRIVATE-STUDENT-SENTINEL');
}
Object.assign(window, {
  triggerError(mode: string) {
    if (mode === 'window') setTimeout(fail, 0);
    else if (mode === 'rejection') void Promise.resolve().then(fail);
    else
      createRoot(document.getElementById('root')!).render(
        createElement(AppErrorBoundary, null, createElement(fail)),
      );
  },
});
