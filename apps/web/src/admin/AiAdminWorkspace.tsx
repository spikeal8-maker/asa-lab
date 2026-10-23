import { useState } from 'react';
import { AiAdminPage } from './AdminAiPage';
import { AdminOllamaPage } from './AdminOllamaPage';
import { AdminComfyUiPage } from './AdminComfyUiPage';
import './ai-ollama.css';

type AiSection = 'ollama' | 'comfyui' | 'cloud';
const TABS: ReadonlyArray<{ id: AiSection; label: string }> = [
  { id: 'ollama', label: 'Ollama' },
  { id: 'comfyui', label: 'ComfyUI' },
  { id: 'cloud', label: 'Облачные API' },
];

export function AiAdminWorkspace({ onAccessDenied }: { readonly onAccessDenied: () => void }) {
  const [current, setCurrent] = useState<AiSection>('ollama');
  return (
    <div className="asa-ai-admin-workspace">
      <nav className="asa-ai-admin-tabs" role="tablist" aria-label="Провайдеры ИИ">
        {TABS.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            role="tab"
            id={'ai-tab-' + id}
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
        {current === 'ollama' ? <AdminOllamaPage onAccessDenied={onAccessDenied} /> : null}
        {current === 'comfyui' ? <AdminComfyUiPage onAccessDenied={onAccessDenied} /> : null}
        {current === 'cloud' ? <AiAdminPage onAccessDenied={onAccessDenied} /> : null}
      </div>
    </div>
  );
}
