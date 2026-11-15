import { call, type ApiResult } from '../api-call';

export function aiScopeHeaders(seatId?: string): Record<string, string> {
  return seatId ? { 'x-asa-ai-seat': seatId } : {};
}

/** One adapter covers every history/mutation request. The server separately
 * verifies the selected Seat against the current authenticated identity. */
export function createAiScopeCall(seatId?: string) {
  return function scopedCall<T>(path: string, init?: RequestInit): Promise<ApiResult<T>> {
    return call<T>(path, {
      ...init,
      headers: {
        ...((init?.headers as Record<string, string> | undefined) ?? {}),
        ...aiScopeHeaders(seatId),
      },
    });
  };
}

export function aiAdmissionMessage(reason?: string | null): string {
  if (reason === 'ai_rating_required')
    return 'Рейтинг пока ниже порога, установленного преподавателем. Собственная история чата сохранена.';
  if (reason === 'ai_rating_unavailable')
    return 'Рейтинг ещё не рассчитан. Доступ к новым сообщениям пока закрыт.';
  if (
    reason === 'ai_seat_denied' ||
    reason === 'ai_teacher_permission_required' ||
    reason === 'ai_student_denied'
  )
    return 'Преподаватель пока не разрешил ИИ-чат для этого учебного места. Собственная история чата сохранена.';
  if (reason === 'ai_scope_inactive')
    return 'Этот класс или учебное место больше не активно. Войдите в действующий класс.';
  return 'ИИ пока выключен. Администратор должен подключить модель в разделе «Админ → ИИ».';
}
