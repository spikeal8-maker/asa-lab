import { useEffect, useState } from 'react';
import type { PublicUser } from '@asa-lab/web-api-client';
import { SchematicEditor } from './editor/SchematicEditor';
import {
  loadProductionLibrary,
  productionLibraryReady,
} from './editor/production-manifest-adapter';

export interface ElectronicsEditorProps {
  projectId: string;
  onBack: () => void;
  user: PublicUser;
}

let productionLibraryPromise: Promise<void> | null = null;

function ensureProductionLibrary(): Promise<void> {
  if (productionLibraryReady()) return Promise.resolve();
  productionLibraryPromise ??= loadProductionLibrary();
  return productionLibraryPromise;
}

export function ElectronicsEditor(props: ElectronicsEditorProps): JSX.Element {
  const [state, setState] = useState<'loading' | 'ready' | 'error'>(() =>
    productionLibraryReady() ? 'ready' : 'loading',
  );

  useEffect(() => {
    if (state === 'ready') return;
    let active = true;
    void ensureProductionLibrary().then(
      () => {
        if (active) setState('ready');
      },
      () => {
        productionLibraryPromise = null;
        if (active) setState('error');
      },
    );
    return () => {
      active = false;
    };
  }, [state]);

  if (state === 'loading') {
    return <main className="page-center">Загрузка библиотеки компонентов…</main>;
  }
  if (state === 'error') {
    return (
      <main className="page-center" role="alert">
        <section className="login-card">
          <h1>Электроника не загрузилась</h1>
          <p>Основной кабинет продолжает работать. Повторите загрузку редактора.</p>
          <button type="button" className="btn-primary" onClick={() => setState('loading')}>
            Повторить
          </button>
          <button type="button" className="btn-secondary" onClick={props.onBack}>
            К проектам
          </button>
        </section>
      </main>
    );
  }
  return <SchematicEditor {...props} />;
}
