import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AppErrorBoundary } from '../AppErrorBoundary';
import { loadProductionLibrary } from '../electronics/production-manifest-adapter';
import { RoboticsLab } from './RoboticsLab';
import '../styles.css';
import '../accessibility.css';
import '../electronics/workbench.css';
import '../electronics/workbench-mobile-properties.css';
import './robotics.css';

const container = document.getElementById('root');
if (!container) throw new Error('Robotics root element is missing.');
const root = createRoot(container);

root.render(
  <main className="robotics-loading" role="status">
    <div className="robotics-loading-mark" aria-hidden="true">
      A
    </div>
    <h1>ASA Lab · Робототехника</h1>
    <p>Загружаем компоненты электроники…</p>
  </main>,
);

void loadProductionLibrary().then(
  () => {
    root.render(
      <StrictMode>
        <AppErrorBoundary>
          <RoboticsLab />
        </AppErrorBoundary>
      </StrictMode>,
    );
  },
  () => {
    root.render(
      <main className="robotics-loading" role="alert">
        <h1>Не удалось загрузить компоненты</h1>
        <p>Для робота нужен общий каталог электроники ASA Lab.</p>
        <button type="button" onClick={() => window.location.reload()}>
          Повторить загрузку
        </button>
      </main>,
    );
  },
);
