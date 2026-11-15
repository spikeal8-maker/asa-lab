/** Sanitized upstream failures shared by JSON, SSE and connection tests.
 * Never inspect or forward provider bodies, headers, URLs or exception messages.
 * HTTP authentication failures belong to the provider, not the ASA session.
 */
export type AiProviderFailureCode =
  | 'ai_provider_invalid_request'
  | 'ai_provider_authentication_failed'
  | 'ai_provider_access_denied'
  | 'ai_provider_insufficient_balance'
  | 'ai_provider_model_unavailable'
  | 'ai_provider_invalid_parameters'
  | 'ai_provider_rate_limit'
  | 'ai_provider_error'
  | 'ai_provider_unavailable'
  | 'ai_provider_timeout';

export interface AiProviderFailure {
  readonly code: AiProviderFailureCode;
  readonly status: number;
  readonly message: string;
}

export function classifyProviderHttpFailure(status: number): AiProviderFailure {
  switch (status) {
    case 400:
      return {
        code: 'ai_provider_invalid_request',
        status: 502,
        message: 'Провайдер отклонил формат запроса. Обратитесь к администратору.',
      };
    case 401:
      return {
        code: 'ai_provider_authentication_failed',
        status: 502,
        message: 'Провайдер не принял API-ключ. Проверьте или замените сохранённый ключ.',
      };
    case 402:
      return {
        code: 'ai_provider_insufficient_balance',
        status: 502,
        message: 'На счёте провайдера недостаточно средств.',
      };
    case 403:
      return {
        code: 'ai_provider_access_denied',
        status: 502,
        message: 'Провайдер запретил доступ. Проверьте разрешения учётной записи провайдера.',
      };
    case 404:
      return {
        code: 'ai_provider_model_unavailable',
        status: 502,
        message: 'Модель или адрес API недоступны у провайдера. Проверьте настройки модели.',
      };
    case 422:
      return {
        code: 'ai_provider_invalid_parameters',
        status: 502,
        message: 'Провайдер отклонил параметры запроса. Проверьте выбранную модель.',
      };
    case 429:
      return {
        code: 'ai_provider_rate_limit',
        status: 429,
        message: 'Провайдер ограничил число запросов. Повторите попытку позже.',
      };
    default:
      return {
        code: 'ai_provider_error',
        status: 503,
        message: 'Ошибка или перегрузка провайдера. Повторите попытку позже.',
      };
  }
}

export function classifyProviderTransportFailure(timedOut: boolean): AiProviderFailure {
  return timedOut
    ? {
        code: 'ai_provider_timeout',
        status: 504,
        message:
          'Истекло время ожидания ответа провайдера. Проверьте сохранённый результат перед повтором.',
      }
    : {
        code: 'ai_provider_unavailable',
        status: 503,
        message: 'Не удалось установить соединение с провайдером.',
      };
}
