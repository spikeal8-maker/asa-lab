export interface PresentationPreferences {
  motion: 'system' | 'reduce';
  sidebar: 'expanded' | 'collapsed';
}
export interface PresentationSnapshot extends PresentationPreferences {
  revision: number;
}
export type PresentationWrite = PresentationPreferences & { revision: number; requestId: string };
export type PresentationResult =
  | { code: 'ok'; snapshot: PresentationSnapshot }
  | { code: 'conflict' | 'request_conflict' | 'not_found' };
export interface PresentationPreferencesPort {
  read(accountId: string): Promise<PresentationSnapshot | null>;
  write(accountId: string, input: PresentationWrite): Promise<PresentationResult>;
}
export function validPresentationWrite(value: unknown): value is PresentationWrite {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const data = value as Record<string, unknown>;
  return (
    Object.keys(data).length === 4 &&
    ['motion', 'sidebar', 'revision', 'requestId'].every((key) => Object.hasOwn(data, key)) &&
    (data['motion'] === 'system' || data['motion'] === 'reduce') &&
    (data['sidebar'] === 'expanded' || data['sidebar'] === 'collapsed') &&
    Number.isSafeInteger(data['revision']) &&
    Number(data['revision']) >= 0 &&
    Number(data['revision']) < Number.MAX_SAFE_INTEGER &&
    typeof data['requestId'] === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(data['requestId'])
  );
}
export class PresentationPreferencesUseCase {
  constructor(private readonly port: PresentationPreferencesPort) {}
  read(accountId: string) {
    return this.port.read(accountId);
  }
  write(
    accountId: string,
    input: unknown,
  ): Promise<PresentationResult | { code: 'validation_error' }> {
    return validPresentationWrite(input)
      ? this.port.write(accountId, input)
      : Promise.resolve({ code: 'validation_error' });
  }
}
