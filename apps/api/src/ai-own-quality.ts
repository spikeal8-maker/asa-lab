import type pg from 'pg';
import type {
  AiOwnQualityGrant,
  AiOwnQualityGrantUpdate,
  AiOwnQualityOperation,
  AiOwnQualityPage,
} from '@asa-lab/contracts';

export const AI_OWN_QUALITY_SERVICE = 'AI_OWN_QUALITY_SERVICE';
export const OWN_QUALITY_PERMISSION = 'administration.ai.quality.own.read' as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export class AiOwnQualityError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
/** Conservative documented masking, not a claim to detect every possible secret. Authorization precedes it. */
export function maskOwnQualityText(text: string): { text: string; masked: boolean } {
  let result = text;
  result = result.replace(
    /\b(?:sk-|ghp_|github_pat_|xox[baprs]-)[A-Za-z0-9_-]{8,}/gi,
    '[ключ скрыт]',
  );
  result = result.replace(/\bBearer\s+[A-Za-z0-9._~+/-]{8,}={0,2}/gi, 'Bearer [ключ скрыт]');
  result = result.replace(
    /((?:api[_-]?key|access[_-]?token|password|secret)\s*[=:]\s*["']?)[^\s"'`,;]{4,}/gi,
    '$1[секрет скрыт]',
  );
  result = result.replace(
    /[A-Z0-9._%+-]{1,64}@(?:[A-Z0-9-]{1,63}\.)+[A-Z]{2,63}/gi,
    '[email скрыт]',
  );
  result = result.replace(/(?<![\w])\+?\d(?:[\s().-]*\d){9,14}(?![\w])/g, '[телефон скрыт]');
  return { text: result, masked: result !== text };
}
export class AiOwnQualityService {
  constructor(private readonly pool: pg.Pool) {}
  private async value<T>(sql: string, args: unknown[]): Promise<T> {
    try {
      return (await this.pool.query<{ value: T }>(sql, args)).rows[0]!.value;
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === '42501')
        throw new AiOwnQualityError(
          'ai_quality_denied',
          403,
          'Просмотр доступен только с отдельным правом анализа собственных личных диалогов.',
        );
      if (code === '40001')
        throw new AiOwnQualityError(
          'ai_quality_changed',
          409,
          'Разрешение изменилось. Обновите данные.',
        );
      if (code === '22023')
        throw new AiOwnQualityError(
          'ai_quality_invalid',
          400,
          'Запрос сохранения изменён или некорректен.',
        );
      throw new AiOwnQualityError(
        'ai_quality_unavailable',
        503,
        'Журнал качества сейчас недоступен.',
      );
    }
  }
  grant(actor: string) {
    return this.value<AiOwnQualityGrant>('SELECT ai_own_quality_status($1) AS value', [actor]);
  }
  save(actor: string, input: unknown) {
    if (!input || typeof input !== 'object' || Array.isArray(input))
      throw new AiOwnQualityError('ai_quality_invalid', 400, 'Нужны параметры разрешения.');
    const v = input as AiOwnQualityGrantUpdate;
    if (
      Object.keys(v).some((k) => !['enabled', 'expectedRevision', 'requestId'].includes(k)) ||
      typeof v.enabled !== 'boolean' ||
      !Number.isSafeInteger(v.expectedRevision) ||
      v.expectedRevision < 0 ||
      typeof v.requestId !== 'string' ||
      !UUID.test(v.requestId)
    )
      throw new AiOwnQualityError('ai_quality_invalid', 400, 'Проверьте параметры разрешения.');
    return this.value<AiOwnQualityGrant>('SELECT ai_own_quality_set($1,$2,$3,$4::uuid) AS value', [
      actor,
      v.enabled,
      v.expectedRevision,
      v.requestId,
    ]);
  }
  private async rows(actor: string, request: string | null) {
    return this.value<AiOwnQualityOperation[]>('SELECT ai_own_quality_rows($1,$2::uuid) AS value', [
      actor,
      request,
    ]);
  }
  private projection(row: AiOwnQualityOperation, preview: boolean): AiOwnQualityOperation {
    const q = row.question === null ? null : maskOwnQualityText(row.question);
    const a = row.answer === null ? null : maskOwnQualityText(row.answer);
    let question = q?.text ?? null,
      answer = a?.text ?? null;
    let truncated = false;
    if (preview) {
      truncated = [...(question ?? '')].length > 240 || [...(answer ?? '')].length > 240;
      question = question === null ? null : [...question].slice(0, 240).join('');
      answer = answer === null ? null : [...answer].slice(0, 240).join('');
    }
    const value = { ...row, question, answer, masked: !!q?.masked || !!a?.masked, truncated };
    // Includes JSON escaping, not merely string length. No content endpoint exceeds 256 KiB.
    while (Buffer.byteLength(JSON.stringify(value), 'utf8') > 256 * 1024) {
      value.truncated = true;
      if ((value.answer?.length ?? 0) > 100)
        value.answer = [...value.answer!]
          .slice(0, Math.floor([...value.answer!].length / 2))
          .join('');
      else
        throw new AiOwnQualityError(
          'ai_quality_unavailable',
          503,
          'Содержимое превышает допустимый размер.',
        );
    }
    return value;
  }
  async list(actor: string): Promise<AiOwnQualityPage> {
    const rows = await this.rows(actor, null);
    if (!Array.isArray(rows) || rows.length > 10)
      throw new AiOwnQualityError('ai_quality_unavailable', 503, 'Несовместимый журнал качества.');
    return {
      schemaVersion: 1,
      scope: 'own_personal',
      limit: 10,
      maskingPolicy: 'quality-mask-v1',
      items: rows.map((r) => this.projection(r, true)),
    };
  }
  async detail(actor: string, request: string): Promise<AiOwnQualityOperation> {
    if (!UUID.test(request))
      throw new AiOwnQualityError('ai_quality_missing', 404, 'Операция недоступна.');
    const rows = await this.rows(actor, request.toLowerCase());
    if (rows.length !== 1)
      throw new AiOwnQualityError(
        'ai_quality_missing',
        404,
        'Операция больше не входит в последние 10 разрешённых.',
      );
    return this.projection(rows[0]!, false);
  }
}
