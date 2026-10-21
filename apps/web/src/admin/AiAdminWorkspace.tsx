import { useState } from 'react';
import { AiAdminPage } from './AdminAiPage';
import { AdminOllamaPage } from './AdminOllamaPage';
import './ai-ollama.css';

type AiSection = 'keys' | 'ollama' | 'comfyui';
const TABS: ReadonlyArray<{ id: AiSection; label: string }> = [
  { id: 'keys', label: 'Ключи' },
  { id: 'ollama', label: 'Ollama' },
  { id: 'comfyui', label: 'ComfyUI' },
];

export function AiAdminWorkspace({ onAccessDenied }: { readonly onAccessDenied: () => void }) {
  const [current, setCurrent] = useState<AiSection>('keys');
  return (
    <div className="asa-ai-admin-workspace">
      <nav className="asa-ai-admin-tabs" role="tablist" aria-label="Настройки ИИ">
        {TABS.map(({ id, label }) => (
          <button
            key={id}
            id={'ai-tab-' + id}
            type="button"
            role="tab"
            className={current === id ? 'active' : ''}
            aria-selected={current === id}
            aria-controls={'ai-panel-' + id}
            onClick={() => setCurrent(id)}
          >
            {label}
          </button>
        ))}
      </nav>
      <div id={'ai-panel-' + current} role="tabpanel" aria-labelledby={'ai-tab-' + current}>
        {current === 'keys' ? <AiAdminPage onAccessDenied={onAccessDenied} /> : null}
        {current === 'ollama' ? <AdminOllamaPage onAccessDenied={onAccessDenied} /> : null}
        {current === 'comfyui' ? (
          <section className="asa-ai-ollama" aria-labelledby="ai-comfy-title">
            <h2 id="ai-comfy-title">ComfyUI — генерация изображений</h2>
            <p>
              Отдельный подраздел для следующего этапа. Подключение ComfyUI и управление GPU пока не
              реализованы в ASA Lab. Эта вкладка не включает генерацию автоматически.
            </p>
          </section>
        ) : null}
      </div>
    </div>
  );
}
