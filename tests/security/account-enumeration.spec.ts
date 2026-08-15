import { describe, expect, it } from 'vitest';
import {
  AccountLoginUseCase,
  hashPassword,
  type AccountDirectoryPort,
  type SessionV2StorePort,
} from '../../contexts/identity/dist/index.js';

/**
 * A sign-in attempt must cost the same whether or not the identifier belongs to
 * somebody. Otherwise anyone can ask the service who is registered simply by
 * watching how long the refusal takes — which for a platform used by children
 * is a disclosure, not a performance detail.
 */
const KNOWN = 'known@example.test';
const UNKNOWN = 'nobody@example.test';
const ROUNDS = 15;

function useCase(): AccountLoginUseCase {
  const passwordHash = hashPassword('the-real-password');
  const accounts = {
    async findByEmail(emailLower: string) {
      return emailLower === KNOWN
        ? { id: 'account-1', email: KNOWN, username: 'known', passwordHash }
        : null;
    },
    async findByUsername() {
      return null;
    },
    async personalWorkspace() {
      return { principalId: 'principal-1', workspaceId: 'workspace-1' };
    },
  } as unknown as AccountDirectoryPort;

  const sessions = {
    async create() {
      return undefined;
    },
  } as unknown as SessionV2StorePort;

  return new AccountLoginUseCase(accounts, sessions);
}

async function medianAttemptMs(identifier: string): Promise<number> {
  const login = useCase();
  const samples: number[] = [];
  for (let round = 0; round < ROUNDS; round += 1) {
    const started = process.hrtime.bigint();
    const result = await login.execute({ identifier, password: 'a-wrong-password' });
    samples.push(Number(process.hrtime.bigint() - started) / 1e6);
    expect(result.ok).toBe(false);
  }
  samples.sort((a, b) => a - b);
  return samples[Math.floor(samples.length / 2)] as number;
}

describe('account enumeration', () => {
  it('refuses an unknown identifier in the same time as a known one', async () => {
    // Warm both paths: the decoy hash is built on first use, and neither
    // measurement should carry that one-off cost.
    await medianAttemptMs(KNOWN);
    await medianAttemptMs(UNKNOWN);

    const known = await medianAttemptMs(KNOWN);
    const unknown = await medianAttemptMs(UNKNOWN);

    // Calibrate against the cost of a hash on this machine rather than a fixed
    // millisecond figure: absolute timings move with hardware and with load
    // from other test files, but the leak being guarded against is one whole
    // hash. Before the decoy path existed an unknown identifier skipped hashing
    // entirely, so the gap was the full cost and this ratio was about 1.
    const hashCost = Math.max(known, unknown);
    expect(Math.abs(known - unknown) / hashCost).toBeLessThan(0.5);
    // Both paths must actually hash; a near-zero timing means one of them
    // returned without doing the work.
    expect(Math.min(known, unknown)).toBeGreaterThan(5);
  }, 60_000);
});
