import type { AiGenerationPolicy } from '@asa-lab/contracts';

export function generationPolicyFixture(
  overrides: Partial<AiGenerationPolicy> = {},
): AiGenerationPolicy {
  return {
    schemaVersion: 1,
    configurationVersion: 3,
    systemPrompt: 'Отвечай кратко. Запрошенный код давай полностью.',
    defaultModel: 'deepseek-flash',
    allowedModels: ['deepseek-flash'],
    models: [
      {
        id: 'gpt-6-luna',
        provider: 'openai',
        label: 'GPT-6 Luna',
        ready: true,
        selectable: true,
        allowed: false,
      },
      {
        id: 'deepseek-flash',
        provider: 'deepseek',
        label: 'DeepSeek Flash',
        ready: true,
        selectable: true,
        allowed: true,
      },
      {
        id: 'gemma4:31b',
        provider: 'ollama-cloud',
        label: 'Gemma 4 31B · Ollama Cloud',
        ready: true,
        selectable: true,
        allowed: false,
      },
      {
        id: 'ollama-local',
        provider: 'ollama',
        label: 'Локальная Ollama · gemma4:12b',
        ready: false,
        selectable: true,
        allowed: false,
      },
    ],
    variables: [
      {
        name: 'tools',
        label: 'Инструменты',
        source: 'Фактические инструменты запроса и способ их выполнения',
        missingValue: 'Вызываемые инструменты не предоставлены',
      },
      {
        name: 'materials',
        label: 'Доступные материалы',
        source: 'Контекст диалога, вложения и результаты инструментов',
        missingValue: 'Только переданные сообщения',
      },
      {
        name: 'current_datetime',
        label: 'Дата и время',
        source: 'Серверное время в часовом поясе пользователя',
        missingValue: 'Время в UTC',
      },
      {
        name: 'current_date',
        label: 'Текущая дата',
        source: 'Серверная дата',
        missingValue: 'Дата в UTC',
      },
      {
        name: 'timezone',
        label: 'Часовой пояс',
        source: 'Собственный профиль Account',
        missingValue: 'UTC',
      },
      {
        name: 'display_name',
        label: 'Имя пользователя',
        source: 'Имя собственного Account или школьного профиля',
        missingValue: 'Не указано',
      },
      {
        name: 'gender',
        label: 'Пол пользователя',
        source: 'Поле пока отсутствует в профиле',
        missingValue: 'Не указано',
      },
      {
        name: 'location',
        label: 'Местоположение',
        source: 'Текущая геопозиция не предоставлена',
        missingValue: 'Не предоставлено',
      },
      {
        name: 'capabilities',
        label: 'Доступные возможности',
        source: 'Фактические возможности выбранного адаптера',
        missingValue: 'Только текст',
      },
    ],
    ...overrides,
  };
}
