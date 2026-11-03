import type { AiToolId, AiWebSearchAdminConfig } from '@asa-lab/contracts';

interface Readiness {
  policyReady: boolean;
  nativeReady: boolean;
  nativeReason?: string | undefined;
  internet: Pick<
    AiWebSearchAdminConfig,
    'enabled' | 'configured' | 'weatherEnabled' | 'weatherConfigured' | 'pageReadConfigured'
  >;
  fileReady: boolean;
  readFilesEnabled: boolean;
  imageEnabled: boolean;
  imageReady: boolean;
  imageSchemaReady: boolean;
  imageReason?: string | null | undefined;
}

/** Configuration evidence only: a configured service is not a live health check. */
export function toolUnavailableReason(id: AiToolId, state: Readiness): string | null {
  if (!state.policyReady) return 'В базе не установлены настройки инструментов.';
  if (!state.nativeReady)
    return (
      state.nativeReason ??
      'Не подключена модель с поддержкой инструментов — проверьте «Подключения».'
    );
  if (id === 'edit_working_file' && !state.readFilesEnabled)
    return 'Редактирование требует включённого чтения рабочих файлов.';
  if (id.endsWith('_working_file'))
    return state.fileReady ? null : 'В базе не установлено хранение рабочих файлов.';
  if (id === 'generate_image') {
    if (!state.imageEnabled) return 'Генерация выключена — включите её во вкладке «Изображения».';
    if (!state.imageReady)
      return (
        state.imageReason ||
        'Не удалось проверить генератор — проверьте подключение во вкладке «Изображения».'
      );
    return state.imageSchemaReady ? null : 'В базе не установлен вызов генерации из чата.';
  }
  if (!state.internet.enabled)
    return 'Интернет-инструменты выключены — включите их во вкладке «Интернет-поиск».';
  if (id === 'weather') {
    if (!state.internet.weatherEnabled)
      return 'Прогноз погоды выключен — включите его во вкладке «Интернет-поиск».';
    return state.internet.weatherConfigured
      ? null
      : 'Не настроен сервис определения города для прогноза погоды.';
  }
  if (id === 'read_page')
    return state.internet.pageReadConfigured
      ? null
      : 'Чтение страниц отключено лимитом: разрешено 0 страниц.';
  return state.internet.configured
    ? null
    : 'Не задан адрес поискового сервиса SearXNG в конфигурации сервера.';
}
