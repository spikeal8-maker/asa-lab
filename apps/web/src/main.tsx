import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { loadProductionLibrary } from './electronics/production-manifest-adapter';
import './styles.css';
import './accessibility.css';

const container = document.getElementById('root');
if (!container) {
  throw new Error('root element missing');
}
const root = createRoot(container);
root.render(<div className="page-center">Загрузка библиотеки компонентов…</div>);

void loadProductionLibrary()
  .then(() => {
    root.render(
      <React.StrictMode>
        <App />
      </React.StrictMode>,
    );
  })
  .catch(() => {
    root.render(
      <main className="page-center" role="alert">
        Не удалось загрузить production-библиотеку Electronics. Обновите страницу.
      </main>,
    );
  });
