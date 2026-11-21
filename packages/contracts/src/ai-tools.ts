/** Stable platform tool identities. Availability and grants are always resolved by the server. */
export const AI_TOOL_IDS = [
  'weather',
  'web_search',
  'image_search',
  'generate_image',
  'read_page',
  'create_working_file',
  'read_working_file',
  'edit_working_file',
] as const;
export type AiToolId = (typeof AI_TOOL_IDS)[number];
export const AI_TOOL_DEPENDENCIES: Readonly<Record<AiToolId, readonly AiToolId[]>> = {
  weather: [],
  web_search: [],
  image_search: [],
  generate_image: [],
  read_page: [],
  create_working_file: [],
  read_working_file: [],
  edit_working_file: ['read_working_file'],
};
export const AI_TOOL_LABELS: Readonly<Record<AiToolId, string>> = {
  weather: 'Погода',
  web_search: 'Интернет-поиск',
  image_search: 'Поиск изображений',
  generate_image: 'Генерация изображений',
  read_page: 'Чтение страниц',
  create_working_file: 'Создание файлов',
  read_working_file: 'Чтение рабочих файлов',
  edit_working_file: 'Редактирование файлов',
};
