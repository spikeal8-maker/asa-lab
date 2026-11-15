import { HttpException } from '@nestjs/common';

export function publicationError(code: string, message: string, status: number): HttpException {
  return new HttpException({ error: { code, message } }, status);
}

/** One mapping for the new owner API and the remaining legacy mutation names. */
export function throwPublicationError(cause: unknown): never {
  const code = typeof cause === 'object' && cause !== null && 'code' in cause ? cause.code : null;
  switch (code) {
    case 'P5R01':
      throw publicationError('unauthorized', 'Войдите в аккаунт или класс заново.', 401);
    case 'P5R02':
      throw publicationError('own_work', 'Нельзя поставить лайк своей работе.', 403);
    case 'P5R03':
      throw publicationError('reactions_disabled', 'Реакции отключены администратором.', 403);
    case '22023':
      throw publicationError('validation_error', 'Проверьте данные запроса.', 400);
    case 'P5C03':
      throw publicationError(
        'acquisition_disabled',
        'Администратор платформы запретил получение публичных проектов.',
        403,
      );
    case 'P5C01':
      throw publicationError('copy_forbidden', 'Копирование этой публикации недоступно.', 403);
    case 'P5C02':
      throw publicationError(
        'publication_changed',
        'Публикация изменилась. Откройте её заново.',
        409,
      );
    case 'P5L01':
      throw publicationError(
        'learning_work_protected',
        'Оригинальную учебную работу нельзя публиковать.',
        403,
      );
    case 'P5P01':
      throw publicationError(
        'publication_forbidden',
        'Публикация этой работы запрещена действующими правилами доступа.',
        403,
      );
    case 'P5P02':
      throw publicationError(
        'preview_required',
        'Откройте и сохраните проект, чтобы обновить превью перед публикацией.',
        409,
      );
    case 'P5P03':
      throw publicationError('validation_error', 'Проверьте данные публикации.', 400);
    case 'P5P04':
      throw publicationError('not_available', 'Проект недоступен.', 404);
    default:
      throw cause;
  }
}
