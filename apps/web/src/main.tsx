import { EmailConfirmationPage, takeEmailProof } from './pages/EmailConfirmationPage';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { AppErrorBoundary } from './AppErrorBoundary';
import { installClientDiagnostics } from './client-diagnostics';
import { isMaxLaunchLocation } from './max-auth';
import './styles.css';
import './accessibility.css';
import './components/system-tabs.css';
import './pages/PublicEntryHeroV2.css';

const emailConfirmation = window.location.pathname === '/confirm-email';
const emailProof = emailConfirmation ? takeEmailProof() : '';
const container = document.getElementById('root');
installClientDiagnostics();
if (!container) {
  throw new Error('root element missing');
}

// The application renders immediately. The Electronics component catalog is
// nearly a megabyte and belongs to one subject module, so it is loaded with
// that module's chunk rather than gating the first screen for everybody.
const root = createRoot(container);
const render = () =>
  root.render(
    <React.StrictMode>
      <AppErrorBoundary>
        {emailConfirmation ? <EmailConfirmationPage token={emailProof} /> : <App />}
      </AppErrorBoundary>
    </React.StrictMode>,
  );

// App captures signed MAX launch data on its first render. Only that route
// waits for the Bridge's bounded preparation; all other routes render now.
if (!isMaxLaunchLocation()) render();
else {
  const controller = new AbortController();
  const finish = () => {
    if (controller.signal.aborted) return;
    clearTimeout(deadline);
    controller.abort();
    render();
  };
  const deadline = setTimeout(finish, 5_000);
  void import('./max-bridge')
    .then(({ prepareMaxLaunch }) => prepareMaxLaunch(controller.signal))
    .then(finish, finish);
}
