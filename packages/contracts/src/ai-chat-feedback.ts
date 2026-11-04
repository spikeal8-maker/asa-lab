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

export const AI_CHAT_TOOLS = [
  'web_search',
  'image_search',
  'weather',
  'read_page',
  'generate_image',
  'create_working_file',
  'read_working_file',
  'edit_working_file',
] as const;
export type AiChatTool = (typeof AI_CHAT_TOOLS)[number];
export interface AiToolActivity {
  readonly tool: AiChatTool;
  readonly state: 'running' | 'complete';
}
export function isAiToolActivity(value: unknown): value is AiToolActivity {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    Object.keys(v).length === 2 &&
    AI_CHAT_TOOLS.includes(v['tool'] as AiChatTool) &&
    (v['state'] === 'running' || v['state'] === 'complete')
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
