import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { AppErrorBoundary } from './AppErrorBoundary';
import './styles.css';
import './accessibility.css';

const container = document.getElementById('root');
if (!container) {
  throw new Error('root element missing');
}

// The application renders immediately. The Electronics component catalog is
// nearly a megabyte and belongs to one subject module, so it is loaded with
// that module's chunk rather than gating the first screen for everybody.
createRoot(container).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </React.StrictMode>,
);
