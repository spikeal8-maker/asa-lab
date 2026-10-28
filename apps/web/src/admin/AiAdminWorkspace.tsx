import { useCallback, useEffect, useRef, useState } from 'react';
import { AiAdminPage } from './AdminAiPage';
import { AdminOllamaPage } from './AdminOllamaPage';
import { AdminComfyUiPage } from './AdminComfyUiPage';
import { AdminAiWebSearch } from './AdminAiWebSearch';
import { AdminAiGenerationPolicy } from './AdminAiGenerationPolicy';
import { AdminAiTokenBudgets } from './AdminAiTokenBudgets';
import { AdminAiUsageOverview } from './AdminAiUsageOverview';
import type { AiAdminConfig } from './ai-model-config';
import {
  AI_ADMIN_SECTIONS as SECTIONS,
  navigateAiAdmin,
  readAiAdminNavigation,
  rememberAiAdminNavigation,
  type AiAdminNavigation,
  type AiProviderChoice as ProviderChoice,
} from './ai-admin-navigation';
import { call } from './admin-api';
import './ai-ollama.css';
import './ai-admin.css';
import './ai-settings.css';

interface LocalState {
  enabled: boolean;
  model: string;
}

const PROVIDERS: ReadonlyArray<{ id: ProviderChoice; label: string; hint: string }> = [
  { id: 'ollama', label: 'Ollama', hint: 'Локально · без ключа' },
  { id: 'ollama-cloud', label: 'Ollama Cloud', hint: 'ollama.com · API-ключ' },
  { id: 'deepseek', label: 'DeepSeek', hint: 'Облачный API' },
  { id: 'openai', label: 'OpenAI', hint: 'Облачный API' },
];

export function AiAdminWorkspace({
  principalId,
  onAccessDenied,
}: {
  readonly principalId: string;
  readonly onAccessDenied: () => void;
}) {
  return (
    <AiAdminWorkspaceSession
      key={principalId}
      principalId={principalId}
      onAccessDenied={onAccessDenied}
    />
  );
}

function AiAdminWorkspaceSession({
  principalId,
  onAccessDenied,
}: {
  readonly principalId: string;
  readonly onAccessDenied: () => void;
}) {
  const [navigation, setNavigation] = useState(() => readAiAdminNavigation(principalId));
  const { section, provider } = navigation;
  const tabs = useRef<HTMLElement>(null);
  const [cloud, setCloud] = useState<AiAdminConfig | null>(null);
  const [local, setLocal] = useState<LocalState | null>(null);
  const [statusRevision, setStatusRevision] = useState(0);
  const refreshStatus = useCallback(() => setStatusRevision((v) => v + 1), []);

  function navigate(value: AiAdminNavigation) {
    setNavigation(value);
    rememberAiAdminNavigation(principalId, value);
    navigateAiAdmin(value);
  }

  useEffect(() => {
    const restore = () => setNavigation(readAiAdminNavigation(principalId));
    window.addEventListener('hashchange', restore);
    window.addEventListener('popstate', restore);
    return () => {
      window.removeEventListener('hashchange', restore);
      window.removeEventListener('popstate', restore);
    };
  }, [principalId]);

  useEffect(() => rememberAiAdminNavigation(principalId, navigation), [principalId, navigation]);

  useEffect(() => {
    const nav = tabs.current;
    if (!nav) return;
    const revealSelected = () => {
      const selected = nav.querySelector<HTMLElement>('[aria-selected="true"]');
      if (!selected) return;
      const container = nav.getBoundingClientRect();
      const button = selected.getBoundingClientRect();
      // Scroll this one navigation row, leaving the page's vertical position alone.
      if (button.left < container.left + 4) {
        nav.scrollLeft -= container.left + 4 - button.left;
      } else if (button.right > container.right - 4) {
        nav.scrollLeft += button.right - container.right + 4;
      }
    };
    revealSelected();
    const observer =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(revealSelected);
    observer?.observe(nav);
    window.addEventListener('resize', revealSelected);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', revealSelected);
    };
  }, [section]);

  useEffect(() => {
    if (section !== 'connections') return;
    let mounted = true;
    void Promise.all([
      call<AiAdminConfig>('/api/admin/v1/ai'),
      call<LocalState>('/api/admin/v1/ai/ollama'),
    ]).then(([cloudResponse, localResponse]) => {
      if (!mounted) return;
      if (!cloudResponse.ok && (cloudResponse.status === 401 || cloudResponse.status === 403)) {
        onAccessDenied();
      }
      if (!localResponse.ok && (localResponse.status === 401 || localResponse.status === 403)) {
        onAccessDenied();
      }
      setCloud(cloudResponse.ok ? cloudResponse.data : null);
      setLocal(localResponse.ok ? localResponse.data : null);
    });
    return () => {
      mounted = false;
    };
  }, [onAccessDenied, statusRevision, section]);

  function providerStatus(value: ProviderChoice): string {
    if (value === 'ollama')
      return local === null ? 'Проверяем' : local.enabled ? 'Включена' : 'Выключена';
    if (!cloud) return 'Проверяем';
    const slot = cloud.providerConfigurations.find((entry) => entry.provider === value);
    if (!slot?.apiKeyConfigured) return 'Нет ключа';
    return slot.enabled ? 'Включён' : 'Ключ сохранён';
  }

  return (
    <div className="asa-ai-admin-workspace">
      <nav ref={tabs} className="asa-ai-admin-tabs" role="tablist" aria-label="Разделы ИИ">
        {SECTIONS.map((item, index) => (
          <button
            key={item.id}
            id={'ai-tab-' + item.id}
            type="button"
            role="tab"
            tabIndex={section === item.id ? 0 : -1}
            aria-selected={section === item.id}
            aria-controls={'ai-panel-' + item.id}
            className={section === item.id ? 'active' : ''}
            onClick={() => navigate({ ...navigation, section: item.id })}
            onKeyDown={(event) => {
              const next =
                event.key === 'ArrowRight'
                  ? (index + 1) % SECTIONS.length
                  : event.key === 'ArrowLeft'
                    ? (index + SECTIONS.length - 1) % SECTIONS.length
                    : event.key === 'Home'
                      ? 0
                      : event.key === 'End'
                        ? SECTIONS.length - 1
                        : null;
              if (next === null) return;
              event.preventDefault();
              const id = SECTIONS[next]!.id;
              navigate({ ...navigation, section: id });
              document.getElementById('ai-tab-' + id)?.focus();
            }}
          >
            {item.label}
          </button>
        ))}
      </nav>
      {section === 'overview' ? (
        <div id="ai-panel-overview" role="tabpanel" aria-labelledby="ai-tab-overview">
          <AdminAiUsageOverview onAccessDenied={onAccessDenied} />
        </div>
      ) : section === 'connections' ? (
        <section
          id="ai-panel-connections"
          role="tabpanel"
          aria-labelledby="ai-tab-connections"
          className="asa-ai-connections"
        >
          <div className="asa-ai-connections-heading">
            <h2>Подключения и API-ключи</h2>
            <span>Выберите провайдера</span>
          </div>
          <div className="asa-ai-provider-cards" role="group" aria-label="Доступные ИИ-провайдеры">
            {PROVIDERS.map((option) => (
              <button
                key={option.id}
                type="button"
                className={'asa-ai-provider-card' + (provider === option.id ? ' selected' : '')}
                aria-pressed={provider === option.id}
                onClick={() => navigate({ ...navigation, provider: option.id })}
              >
                <span className="asa-ai-provider-card-top">
                  <strong>{option.label}</strong>
                  {provider === option.id ? <span aria-hidden="true">✓</span> : null}
                </span>
                <span className="asa-ai-provider-hint">{option.hint}</span>
                <span className="asa-ai-provider-card-status">
                  <span
                    className={
                      'asa-ai-status-dot ' +
                      (providerStatus(option.id) === 'Включена' ||
                      providerStatus(option.id) === 'Включён'
                        ? 'online'
                        : '')
                    }
                    aria-hidden="true"
                  />
                  {providerStatus(option.id)}
                </span>
              </button>
            ))}
          </div>
          {provider === 'ollama' ? (
            <AdminOllamaPage onAccessDenied={onAccessDenied} onUpdated={refreshStatus} />
          ) : (
            <AiAdminPage
              key={provider}
              onAccessDenied={onAccessDenied}
              providerChoice={provider}
              onUpdated={refreshStatus}
            />
          )}
        </section>
      ) : section === 'prompt' || section === 'settings' ? (
        <div
          id={'ai-panel-' + section}
          role="tabpanel"
          aria-labelledby={'ai-tab-' + section}
          className={section === 'settings' ? 'asa-ai-settings' : undefined}
        >
          <AdminAiGenerationPolicy section={section} onAccessDenied={onAccessDenied} />
          {section === 'settings' ? <AdminAiTokenBudgets onAccessDenied={onAccessDenied} /> : null}
        </div>
      ) : section === 'internet' ? (
        <div id="ai-panel-internet" role="tabpanel" aria-labelledby="ai-tab-internet">
          <AdminAiWebSearch onAccessDenied={onAccessDenied} />
        </div>
      ) : (
        <div id="ai-panel-comfyui" role="tabpanel" aria-labelledby="ai-tab-comfyui">
          <AdminComfyUiPage onAccessDenied={onAccessDenied} />
        </div>
      )}
    </div>
  );
}
