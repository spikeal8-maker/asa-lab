import type pg from 'pg';
import type {
  AiTokenBudgetAdmin,
  AiTokenBudgetUpdate,
  AiTokenBudgetsOwn,
} from '@asa-lab/contracts';
import { AiPolicyError } from './ai-generation-policy.js';
import { getAiModelCatalog } from './ai-model-catalog.js';
import { reloadOllamaCloudCatalog } from './ai-ollama-cloud.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const cap = (value: unknown): value is string | null =>
  value === null ||
  (typeof value === 'string' &&
    /^(0|[1-9][0-9]{0,15})$/.test(value) &&
    BigInt(value) <= 9007199254740991n);
export function validBudgetInput(raw: unknown): AiTokenBudgetUpdate {
  const v = raw as AiTokenBudgetUpdate | null;
  if (
    !v ||
    !Number.isSafeInteger(v.configurationVersion) ||
    v.configurationVersion < 0 ||
    typeof v.requestId !== 'string' ||
    !UUID.test(v.requestId) ||
    !Array.isArray(v.models) ||
    v.models.length > 2400 ||
    new Set(v.models.map((m) => m?.model)).size !== v.models.length ||
    !v.models.every(
      (m) =>
        m &&
        typeof m.model === 'string' &&
        !m.model.includes('://') &&
        /^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,199}$/.test(m.model) &&
        cap(m.globalLimit) &&
        cap(m.userLimit),
    )
  ) {
    throw new AiPolicyError(
      'ai_budget_invalid',
      400,
      'Проверьте целые лимиты токенов: пустое поле — без лимита, 0 — запрет новых ответов.',
    );
  }
  return v;
}
export class AiTokenBudgetStore {
  constructor(private readonly pool: pg.Pool) {}
  async admin(actor: string): Promise<AiTokenBudgetAdmin> {
    await reloadOllamaCloudCatalog(this.pool);
    const row = await this.pool.query<{ value: AiTokenBudgetAdmin }>(
      'SELECT ai_token_budgets_admin($1,$2::jsonb) AS value',
      [
        actor,
        JSON.stringify([
          'ollama-local',
          ...getAiModelCatalog()
            .models.filter((m) => m.adapterCompatible)
            .map((m) => m.id),
        ]),
      ],
    );
    if (!row.rows[0]?.value)
      throw new AiPolicyError('ai_budget_unavailable', 503, 'Бюджеты токенов недоступны.');
    return row.rows[0].value;
  }
  async own(owner: string): Promise<AiTokenBudgetsOwn> {
    const row = await this.pool.query<{ value: AiTokenBudgetsOwn }>(
      'SELECT ai_token_budgets_own($1) AS value',
      [owner],
    );
    if (!row.rows[0]?.value)
      throw new AiPolicyError('ai_budget_unavailable', 503, 'Остаток токенов недоступен.');
    return row.rows[0].value;
  }
  async save(actor: string, raw: unknown): Promise<AiTokenBudgetAdmin> {
    const value = validBudgetInput(raw);
    const { requestId, ...payload } = value;
    try {
      await this.pool.query('SELECT ai_token_budgets_set($1,$2::jsonb,$3::uuid)', [
        actor,
        JSON.stringify(payload),
        requestId,
      ]);
    } catch (problem) {
      const code = (problem as { code?: string }).code;
      if (code === '40001')
        throw new AiPolicyError(
          'ai_budget_changed',
          409,
          'Лимиты изменились. Загрузите актуальную версию; черновик остаётся в форме.',
        );
      if (code === '22023' || code === '22P02')
        throw new AiPolicyError(
          'ai_budget_invalid',
          400,
          'Лимиты или запрос сохранения недействительны.',
        );
      throw problem;
    }
    return this.admin(actor);
  }
}
