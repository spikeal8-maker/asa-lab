import { EmailConfirmationPage, takeEmailProof } from './pages/EmailConfirmationPage';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { AppErrorBoundary } from './AppErrorBoundary';
import { installClientDiagnostics } from './client-diagnostics';
import './styles.css';
import './accessibility.css';
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
createRoot(container).render(
  <React.StrictMode>
    <AppErrorBoundary>
      {emailConfirmation ? <EmailConfirmationPage token={emailProof} /> : <App />}
    </AppErrorBoundary>
  </React.StrictMode>,
);
