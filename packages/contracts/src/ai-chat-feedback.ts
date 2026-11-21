import { AI_TOOL_IDS, type AiToolId } from './ai-tools.js';

/** Public chat feedback never includes provider diagnostics or connection details. */
export const AI_TEXT_UNAVAILABLE = 'Извините, текстовая модель сейчас недоступна.';
export const AI_IMAGE_UNAVAILABLE = 'Извините, генератор изображений сейчас недоступен.';
export const AI_SEARCH_UNAVAILABLE = 'Извините, интернет-поиск сейчас недоступен.';

export function aiPublicErrorMessage(code: string, fallback = AI_TEXT_UNAVAILABLE): string {
  if (/^ai_image_(?!input_invalid|not_found|denied|cancelled|conflict)/.test(code))
    return AI_IMAGE_UNAVAILABLE;
  if (/^ai_(web_search|search|weather)_/.test(code)) return AI_SEARCH_UNAVAILABLE;
  if (
    /^ai_(provider|ollama|model|response|stream|key|encryption|budget|paid|native_tools|tool_call|usage)_/.test(
      code,
    ) ||
    ['ai_disabled', 'ai_paid_limit', 'ai_rate_limit', 'ai_platform_quota_exhausted'].includes(code)
  )
    return AI_TEXT_UNAVAILABLE;
  return fallback;
}

export const AI_CHAT_TOOLS = AI_TOOL_IDS;
export type AiChatTool = AiToolId;
export interface AiToolActivity {
  readonly tool: AiChatTool;
  readonly state: 'running' | 'complete';
  readonly fileRead?: { readonly name: string; readonly version: number };
}
export function isAiToolActivity(value: unknown): value is AiToolActivity {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  if (
    !AI_CHAT_TOOLS.includes(v['tool'] as AiChatTool) ||
    (v['state'] !== 'running' && v['state'] !== 'complete')
  )
    return false;
  if (!Object.hasOwn(v, 'fileRead')) return Object.keys(v).length === 2;
  if (
    Object.keys(v).length !== 3 ||
    v['tool'] !== 'read_working_file' ||
    v['state'] !== 'complete' ||
    !v['fileRead'] ||
    typeof v['fileRead'] !== 'object'
  )
    return false;
  const { name, version } = v['fileRead'] as Record<string, unknown>;
  return (
    Object.keys(v['fileRead']).length === 2 &&
    typeof name === 'string' &&
    /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,95}$/.test(name) &&
    !name.includes('..') &&
    typeof version === 'number' &&
    Number.isSafeInteger(version) &&
    version > 0
  );
}
export const AI_TOOL_ACTIVITY_LABELS: Readonly<Record<AiChatTool, string>> = {
  web_search: 'Ищу информацию…',
  image_search: 'Ищу изображения…',
  weather: 'Проверяю погоду…',
  read_page: 'Читаю выбранные страницы…',
  generate_image: 'Подготавливаю изображение…',
  create_working_file: 'Создаю файл…',
  read_working_file: 'Читаю рабочий файл…',
  edit_working_file: 'Обновляю файл…',
};
