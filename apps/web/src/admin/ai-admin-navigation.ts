import type { AiProvider } from './ai-model-config';

export type AiProviderChoice = AiProvider | 'ollama' | 'polza';
export type AiSection =
  | 'overview'
  | 'settings'
  | 'connections'
  | 'comfyui'
  | 'video'
  | 'transcription'
  | 'prompt'
  | 'internet';
export interface AiAdminNavigation {
  readonly section: AiSection;
  readonly provider: AiProviderChoice;
}

export const AI_ADMIN_SECTIONS: readonly { id: AiSection; label: string }[] = [
  { id: 'overview', label: 'Обзор' },
  { id: 'settings', label: 'Настройки' },
  { id: 'connections', label: 'Подключения' },
  { id: 'prompt', label: 'Системный промпт' },
  { id: 'internet', label: 'Интернет-поиск' },
  { id: 'comfyui', label: 'Изображения' },
  { id: 'video', label: 'Видео' },
  { id: 'transcription', label: 'Транскрибация' },
];

const PROVIDERS: readonly string[] = ['ollama', 'ollama-cloud', 'deepseek', 'openai', 'polza'];
const DEFAULT: AiAdminNavigation = { section: 'overview', provider: 'ollama' };
const preferenceKey = (principalId: string) => `asa-ai-admin-navigation:v1:${principalId}`;

function section(value: unknown): value is AiSection {
  return AI_ADMIN_SECTIONS.some((entry) => entry.id === value);
}
function provider(value: unknown): value is AiProviderChoice {
  return typeof value === 'string' && PROVIDERS.includes(value);
}

/** Only non-sensitive UI preferences are stored, separately for each administrator. */
export function readAiAdminNavigation(principalId: string): AiAdminNavigation {
  let saved: AiAdminNavigation = DEFAULT;
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(preferenceKey(principalId)) ?? 'null');
    if (raw && typeof raw === 'object' && 'section' in raw && 'provider' in raw) {
      saved = {
        section: section(raw.section) ? raw.section : DEFAULT.section,
        provider: provider(raw.provider) ? raw.provider : DEFAULT.provider,
      };
    }
  } catch {
    // Private browsing or invalid preferences must not block the administrative screen.
  }
  const [path, query = ''] = window.location.hash.replace(/^#/, '').split('?');
  if (path?.replace(/\/+$/, '') !== '/admin/ai') return saved;
  const params = new URLSearchParams(query);
  const explicitSection = params.get('section');
  const explicitProvider = params.get('provider');
  return {
    section: section(explicitSection) ? explicitSection : saved.section,
    provider: provider(explicitProvider) ? explicitProvider : saved.provider,
  };
}

export function rememberAiAdminNavigation(principalId: string, value: AiAdminNavigation): void {
  try {
    localStorage.setItem(preferenceKey(principalId), JSON.stringify(value));
  } catch {
    // The explicit URL remains usable when browser storage is unavailable.
  }
}

export function navigateAiAdmin(value: AiAdminNavigation): void {
  const [path, query = ''] = window.location.hash.replace(/^#/, '').split('?');
  if (path?.replace(/\/+$/, '') !== '/admin/ai') return;
  const params = new URLSearchParams(query);
  params.set('section', value.section);
  params.set('provider', value.provider);
  window.history.replaceState(
    window.history.state,
    '',
    `${window.location.pathname}${window.location.search}#/admin/ai?${params.toString()}`,
  );
}
