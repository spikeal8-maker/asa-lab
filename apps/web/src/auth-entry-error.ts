interface EntryFailure {
  readonly status: number;
  readonly error: { readonly code: string };
}

/** Transport, origin and bot-check failures must never look like a bad password. */
export function authEntryErrorMessage(
  failure: EntryFailure,
  kind: 'personal' | 'organization' = 'personal',
): string {
  if (failure.status === 0) {
    return failure.error.code === 'auth_timeout'
      ? 'Сервер отвечает слишком долго. Попробуйте войти ещё раз.'
      : 'Не удалось связаться с сервером. Проверьте соединение и попробуйте ещё раз.';
  }
  if (failure.error.code === 'bot_check_required') {
    return 'Проверка «Я не робот» недействительна. Пройдите её ещё раз и повторите вход.';
  }
  if (failure.error.code === 'origin_forbidden') {
    return 'Вход по этому адресу не настроен. Откройте основной адрес ASA Lab или сообщите администратору.';
  }
  if (failure.status === 429) {
    return 'Слишком много попыток входа. Подождите несколько минут и попробуйте снова.';
  }
  if (failure.status === 400 || failure.status === 401) {
    return kind === 'organization'
      ? 'Неверный код организации, email или пароль.'
      : 'Неверные данные для входа.';
  }
  if (failure.status >= 500) {
    return 'Сервис входа временно недоступен. Попробуйте позже.';
  }
  return 'Вход отклонён. Обновите страницу и попробуйте ещё раз.';
}
