import { useRef, useState } from 'react';
import { api, type BotAction, type BotChallenge, type BotProof } from '../api';

const BATCH_SIZE = 128;
const MAX_COUNTER = 2_000_000;

function hasLeadingZeroBits(bytes: Uint8Array, difficulty: number): boolean {
  let remaining = difficulty;
  for (const byte of bytes) {
    if (remaining <= 0) return true;
    if (remaining >= 8) {
      if (byte !== 0) return false;
      remaining -= 8;
      continue;
    }
    return byte >> (8 - remaining) === 0;
  }
  return remaining <= 0;
}

async function solve(challenge: BotChallenge): Promise<number> {
  if (!globalThis.crypto?.subtle) throw new Error('secure browser crypto is unavailable');
  const encoder = new TextEncoder();
  for (let first = 0; first <= MAX_COUNTER; first += BATCH_SIZE) {
    const counters = Array.from(
      { length: Math.min(BATCH_SIZE, MAX_COUNTER - first + 1) },
      (_, index) => first + index,
    );
    const digests = await Promise.all(
      counters.map((counter) =>
        crypto.subtle.digest('SHA-256', encoder.encode(`${challenge.salt}:${counter}`)),
      ),
    );
    const match = digests.findIndex((digest) =>
      hasLeadingZeroBits(new Uint8Array(digest), challenge.difficulty),
    );
    if (match >= 0) return counters[match] as number;
    // Yield periodically so the form and assistive technology stay responsive.
    if (first % (BATCH_SIZE * 8) === 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
  }
  throw new Error('proof was not found');
}

export function BotCheck({
  action,
  disabled = false,
  onVerified,
}: {
  action: BotAction;
  disabled?: boolean;
  onVerified: (proof: BotProof | null) => void;
}): JSX.Element {
  const [status, setStatus] = useState<'idle' | 'working' | 'ready' | 'error'>('idle');
  const sequence = useRef(0);

  async function check(): Promise<void> {
    const current = ++sequence.current;
    setStatus('working');
    onVerified(null);
    const result = await api.botChallenge(action);
    if (current !== sequence.current) return;
    if (!result.ok) {
      setStatus('error');
      return;
    }
    try {
      const counter = await solve(result.data.challenge);
      if (current !== sequence.current) return;
      onVerified({ ...result.data.challenge, counter });
      setStatus('ready');
    } catch {
      if (current !== sequence.current) return;
      setStatus('error');
    }
  }

  function change(checked: boolean): void {
    if (!checked) {
      sequence.current += 1;
      onVerified(null);
      setStatus('idle');
      return;
    }
    void check();
  }

  return (
    <div className={`bot-check bot-check-${status}`}>
      <label>
        <input
          type="checkbox"
          checked={status === 'working' || status === 'ready'}
          disabled={disabled || status === 'working'}
          onChange={(event) => change(event.target.checked)}
        />
        <span>Я не робот</span>
      </label>
      <small aria-live="polite">
        {status === 'working'
          ? 'Проверяем браузер…'
          : status === 'ready'
            ? 'Проверка пройдена'
            : status === 'error'
              ? 'Не удалось проверить. Нажмите ещё раз.'
              : 'Проверка выполняется на сервере Assolab без VPN.'}
      </small>
    </div>
  );
}
