import { HttpException } from '@nestjs/common';
import type { ProjectTransactionGuard } from '@asa-lab/projects';
import {
  evaluateGamesAccess,
  isOfflineGame,
  type GamesAdmission,
  type GamesPolicySnapshot,
} from './games-access.js';

export function rejectGameAdmission(admission: GamesAdmission): never {
  const reasons: Record<GamesAdmission['reason'], string> = {
    allowed: 'Игры доступны.',
    access_unavailable:
      'Доступ к играм сейчас недоступен. Вернитесь в обучение или войдите в класс заново.',
    policy_revoked: 'Учитель приостановил доступ к играм.',
    class_disabled: 'Учитель отключил игры для класса.',
    seat_disabled: 'Учитель отключил для вас игры.',
    rating_below_threshold: `Игры откроются при рейтинге класса от ${admission.threshold ?? 0}.`,
    rating_unavailable: 'Рейтинг класса пока недоступен. Обратитесь к учителю.',
    unsupported_game: 'Эта игра недоступна в ученическом режиме.',
  };
  throw new HttpException(
    {
      error: {
        code: 'games_access_denied',
        message: reasons[admission.reason],
        reason: admission.reason,
        threshold: admission.threshold,
      },
    },
    403,
  );
}

/** The Project repository invokes this inside each protected transaction. It
 * adds the current selected Seat policy to, never replaces, existing Project ACL.
 * Account-only work retains its independent Account principal and permissions.
 */
export const gamesProjectGuard: ProjectTransactionGuard = async (client, input) => {
  const session = input.actor.studentSession;
  if (!session) return;
  let moduleKey = input.moduleKey;
  if (input.projectId) {
    const result = await client.query<{ module_key: string }>(
      `SELECT p.module_key FROM public.projects p WHERE p.tenant_id=$1 AND p.id=$2
       AND EXISTS (SELECT 1 FROM public.project_context_for_principal($3,$2) context WHERE context.tenant_id=p.tenant_id)`,
      [input.tenantId, input.projectId, input.actor.principalId],
    );
    if (!result.rows[0]) {
      throw new HttpException(
        { error: { code: 'project_not_found', message: 'Проект не найден.' } },
        404,
      );
    }
    moduleKey = result.rows[0].module_key;
  }
  if (input.operation === 'list' && moduleKey === undefined) moduleKey = 'chess';
  if (!isOfflineGame(moduleKey)) return;
  const deny = (admission: GamesAdmission): { excludeGames: true } => {
    if (input.operation === 'list' && input.moduleKey === undefined) return { excludeGames: true };
    return rejectGameAdmission(admission);
  };
  if (input.tenantId !== session.tenantId) return deny(evaluateGamesAccess(moduleKey, null));
  const result = await client.query<{ data: GamesPolicySnapshot | null }>(
    'SELECT public.classroom_games_admission_lock($1,$2,$3,$4,$5) AS data',
    [
      input.actor.principalId,
      session.tenantId,
      session.classroomId,
      session.seatId,
      session.tokenHash,
    ],
  );
  const admission = evaluateGamesAccess(moduleKey, result.rows[0]?.data ?? null);
  if (!admission.granted) return deny(admission);
  return undefined;
};
