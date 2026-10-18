import { call, type ApiResult } from '../api-call';
import type { GameKey } from './game-catalog';

export type GameAccessReason =
  | 'allowed'
  | 'access_unavailable'
  | 'policy_revoked'
  | 'class_disabled'
  | 'seat_disabled'
  | 'rating_below_threshold'
  | 'rating_unavailable'
  | 'unsupported_game';
export interface GameAdmission {
  granted: boolean;
  reason: GameAccessReason;
  threshold: number | null;
}
export interface ClassroomGamesPolicy {
  mode: 'allow' | 'deny' | 'rating_threshold';
  threshold: number | null;
  state: 'active' | 'revoked';
  version: number;
  override?: 'inherit' | 'allow' | 'deny';
  admission?: GameAdmission;
}

const reasons: readonly GameAccessReason[] = [
  'allowed',
  'access_unavailable',
  'policy_revoked',
  'class_disabled',
  'seat_disabled',
  'rating_below_threshold',
  'rating_unavailable',
  'unsupported_game',
];
function isAdmission(value: unknown): value is GameAdmission {
  if (value === null || typeof value !== 'object') return false;
  const data = value as Record<string, unknown>;
  return (
    typeof data['granted'] === 'boolean' &&
    reasons.includes(data['reason'] as GameAccessReason) &&
    (data['threshold'] === null ||
      (typeof data['threshold'] === 'number' &&
        Number.isFinite(data['threshold']) &&
        data['threshold'] >= 0 &&
        data['threshold'] <= 100)) &&
    (data['granted'] === true ? data['reason'] === 'allowed' : data['reason'] !== 'allowed')
  );
}

export function gameAccessMessage(admission: GameAdmission): string {
  switch (admission.reason) {
    case 'allowed':
      return 'Игры разрешены.';
    case 'class_disabled':
      return 'Учитель отключил игры для класса.';
    case 'seat_disabled':
      return 'Учитель отключил для вас игры.';
    case 'policy_revoked':
      return 'Учитель приостановил доступ к играм.';
    case 'rating_below_threshold':
      return `Игры откроются при рейтинге класса от ${admission.threshold ?? 0}.`;
    case 'rating_unavailable':
      return 'Рейтинг класса пока недоступен. Обратитесь к учителю.';
    case 'unsupported_game':
      return 'Эта игра недоступна в ученическом режиме.';
    case 'access_unavailable':
      return 'Доступ к играм сейчас недоступен. Вернитесь в обучение или войдите в класс заново.';
  }
}

function checkedPolicy(
  result: ApiResult<unknown>,
  individual: boolean,
): ApiResult<ClassroomGamesPolicy> {
  if (!result.ok) return result;
  const value = result.data;
  if (value === null || typeof value !== 'object') return unavailablePolicy();
  const data = value as Record<string, unknown>;
  const mode = data['mode'];
  const threshold = data['threshold'];
  if (
    (mode !== 'allow' && mode !== 'deny' && mode !== 'rating_threshold') ||
    (data['state'] !== 'active' && data['state'] !== 'revoked') ||
    typeof data['version'] !== 'number' ||
    !Number.isSafeInteger(data['version']) ||
    data['version'] < 0 ||
    (mode === 'rating_threshold'
      ? typeof threshold !== 'number' ||
        !Number.isFinite(threshold) ||
        threshold < 0 ||
        threshold > 100
      : threshold !== null) ||
    (individual &&
      (!['inherit', 'allow', 'deny'].includes(String(data['override'])) ||
        !isAdmission(data['admission'])))
  )
    return unavailablePolicy();
  return { ...result, data: value as ClassroomGamesPolicy };
}
function unavailablePolicy(): ApiResult<ClassroomGamesPolicy> {
  return {
    ok: false,
    status: 503,
    error: {
      code: 'policy_unavailable',
      message: 'Не удалось проверить настройки доступа к играм.',
    },
  };
}

const policyPath = (classroomId: string, seatId?: string) =>
  `/api/games/classrooms/${encodeURIComponent(classroomId)}/${seatId ? `seats/${encodeURIComponent(seatId)}` : 'policy'}`;

export const gameAccessApi = {
  async read(game: GameKey): Promise<ApiResult<GameAdmission>> {
    const result = await call<unknown>(`/api/games/access?game=${encodeURIComponent(game)}`, {
      cache: 'no-store',
    });
    if (!result.ok) return result;
    if (!isAdmission(result.data))
      return {
        ok: false,
        status: 503,
        error: {
          code: 'admission_unavailable',
          message: 'Не удалось проверить доступ к играм. Повторите проверку.',
        },
      };
    return { ...result, data: result.data };
  },
  async readPolicy(classroomId: string, seatId?: string): Promise<ApiResult<ClassroomGamesPolicy>> {
    return checkedPolicy(
      await call<unknown>(policyPath(classroomId, seatId), { cache: 'no-store' }),
      seatId !== undefined,
    );
  },
  async saveClass(
    classroomId: string,
    input: {
      mode: ClassroomGamesPolicy['mode'];
      threshold: number | null;
      expectedVersion: number;
    },
  ): Promise<ApiResult<ClassroomGamesPolicy>> {
    return checkedPolicy(
      await call<unknown>(policyPath(classroomId), { method: 'PUT', body: JSON.stringify(input) }),
      false,
    );
  },
  async saveSeat(
    classroomId: string,
    seatId: string,
    input: { override: NonNullable<ClassroomGamesPolicy['override']>; expectedVersion: number },
  ): Promise<ApiResult<ClassroomGamesPolicy>> {
    return checkedPolicy(
      await call<unknown>(policyPath(classroomId, seatId), {
        method: 'PUT',
        body: JSON.stringify(input),
      }),
      true,
    );
  },
};
