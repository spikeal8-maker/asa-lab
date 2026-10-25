import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { AppErrorBoundary } from './AppErrorBoundary';
import { installClientDiagnostics } from './client-diagnostics';
import './styles.css';
import './accessibility.css';
import './pages/PublicEntryHeroV2.css';
import { isMaxLaunchLocation, loadMaxBridgeForLaunch, type MaxBridgeLoadResult } from './max-auth';

const container = document.getElementById('root');
installClientDiagnostics();
if (!container) {
  throw new Error('root element missing');
}

// Normal routes mount immediately without requesting external MAX scripts.
// The genuine MAX launch waits for the Bridge before App reads signed initData.
function mountApp(maxBridgeLoadResult: MaxBridgeLoadResult): void {
  createRoot(container!).render(
    <React.StrictMode>
      <AppErrorBoundary>
        <App maxBridgeLoadResult={maxBridgeLoadResult} />
      </AppErrorBoundary>
    </React.StrictMode>,
  );
}

// The Electronics catalog remains lazy-loaded within its own module.
if (isMaxLaunchLocation()) {
  void loadMaxBridgeForLaunch().then(mountApp, () => mountApp('failed'));
} else {
  mountApp('not-required');
}
