import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { api, type BotAction, type BotChallenge, type BotProof } from '../api';
import { sha256Bytes } from './sha256';

const BATCH_SIZE = 128;
const MAX_COUNTER = 2_000_000;
const REQUIRED_DISTANCE = 150;
const REQUIRED_TURNS = 3;
const REQUIRED_EVENTS = 8;

interface MotionSample {
  distance: number;
  turns: number;
  events: number;
  lastX: number | null;
  lastY: number | null;
  lastAngle: number | null;
}

function emptyMotion(): MotionSample {
  return {
    distance: 0,
    turns: 0,
    events: 0,
    lastX: null,
    lastY: null,
    lastAngle: null,
  };
}

function angleDifference(left: number, right: number): number {
  const difference = Math.abs(left - right) % (Math.PI * 2);
  return difference > Math.PI ? Math.PI * 2 - difference : difference;
}

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
  const encoder = new TextEncoder();
  const subtle = globalThis.crypto?.subtle;
  for (let first = 0; first <= MAX_COUNTER; first += BATCH_SIZE) {
    const counters = Array.from(
      { length: Math.min(BATCH_SIZE, MAX_COUNTER - first + 1) },
      (_, index) => first + index,
    );
    const inputs = counters.map((counter) => encoder.encode(`${challenge.salt}:${counter}`));
    const digests = subtle
      ? await Promise.all(inputs.map((input) => subtle.digest('SHA-256', input)))
      : inputs.map((input) => sha256Bytes(input));
    const match = digests.findIndex((digest) =>
      hasLeadingZeroBits(
        digest instanceof Uint8Array ? digest : new Uint8Array(digest),
        challenge.difficulty,
      ),
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
  const [status, setStatus] = useState<'idle' | 'collecting' | 'working' | 'ready' | 'error'>(
    'idle',
  );
  const [progress, setProgress] = useState(0);
  const sequence = useRef(0);
  const activation = useRef<'mouse' | 'pen' | 'touch' | 'keyboard'>('mouse');
  const motion = useRef<MotionSample>(emptyMotion());
  const verificationStarted = useRef(false);

  const reset = useCallback((): void => {
    sequence.current += 1;
    verificationStarted.current = false;
    motion.current = emptyMotion();
    setProgress(0);
    setStatus('idle');
    onVerified(null);
  }, [onVerified]);

  const check = useCallback(async (): Promise<void> => {
    const current = ++sequence.current;
    verificationStarted.current = true;
    setStatus('working');
    setProgress(1);
    onVerified(null);
    const result = await api.botChallenge(action);
    if (current !== sequence.current) return;
    if (!result.ok) {
      setStatus('error');
      setTimeout(() => {
        if (current === sequence.current) reset();
      }, 900);
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
      setTimeout(() => {
        if (current === sequence.current) reset();
      }, 900);
    }
  }, [action, onVerified, reset]);

  useEffect(() => {
    if (status !== 'collecting') return undefined;

    const track = (event: PointerEvent): void => {
      // Script-created DOM events do not count. Exact points never leave this
      // component and are discarded as soon as the short check completes.
      if (!event.isTrusted || verificationStarted.current) return;
      const sample = motion.current;
      if (sample.lastX === null || sample.lastY === null) {
        sample.lastX = event.clientX;
        sample.lastY = event.clientY;
        return;
      }

      const dx = event.clientX - sample.lastX;
      const dy = event.clientY - sample.lastY;
      const step = Math.hypot(dx, dy);
      sample.lastX = event.clientX;
      sample.lastY = event.clientY;
      if (step < 2) return;

      const angle = Math.atan2(dy, dx);
      if (sample.lastAngle !== null && angleDifference(angle, sample.lastAngle) > 0.5) {
        sample.turns += 1;
      }
      sample.lastAngle = angle;
      sample.events += 1;
      // One synthetic-looking teleport cannot fill the ring by itself.
      sample.distance += Math.min(step, 28);

      const nextProgress = Math.min(
        0.98,
        Math.min(sample.distance / REQUIRED_DISTANCE, 1) * 0.5 +
          Math.min(sample.turns / REQUIRED_TURNS, 1) * 0.35 +
          Math.min(sample.events / REQUIRED_EVENTS, 1) * 0.15,
      );
      setProgress(nextProgress);

      if (
        sample.distance >= REQUIRED_DISTANCE &&
        sample.turns >= REQUIRED_TURNS &&
        sample.events >= REQUIRED_EVENTS
      ) {
        setProgress(1);
        void check();
      }
    };

    window.addEventListener('pointermove', track, { passive: true });
    return () => window.removeEventListener('pointermove', track);
  }, [check, status]);

  function change(checked: boolean): void {
    if (!checked) {
      reset();
      return;
    }
    if (activation.current === 'keyboard' || activation.current === 'touch') {
      void check();
      return;
    }
    verificationStarted.current = false;
    motion.current = emptyMotion();
    setProgress(0);
    setStatus('collecting');
    onVerified(null);
  }

  return (
    <div
      className={`bot-check bot-check-${status}`}
      data-status={status}
      aria-busy={status === 'collecting' || status === 'working'}
    >
      <label>
        <input
          type="checkbox"
          checked={status === 'ready'}
          disabled={disabled || status === 'collecting' || status === 'working'}
          onPointerDown={(event) => {
            activation.current =
              event.pointerType === 'touch'
                ? 'touch'
                : event.pointerType === 'pen'
                  ? 'pen'
                  : 'mouse';
          }}
          onKeyDown={(event) => {
            if (event.key === ' ' || event.key === 'Enter') activation.current = 'keyboard';
          }}
          onChange={(event) => change(event.target.checked)}
        />
        <span>Я не робот</span>
        <span
          className="bot-check-progress"
          style={{ '--bot-check-progress': `${Math.round(progress * 360)}deg` } as CSSProperties}
          aria-hidden="true"
        />
      </label>
    </div>
  );
}
