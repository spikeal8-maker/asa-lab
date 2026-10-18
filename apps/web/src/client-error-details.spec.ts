import { describe, expect, it } from 'vitest';
import {
  clientException,
  validClientException,
  exceptionMatchesCode,
} from './client-error-details';

const origin = 'https://asa.invalid';
const frame = { script: '/assets/ArduinoCodePanel-1234abcd.js', line: 4, column: 20 };
describe('safe browser exception coordinates', () => {
  it('keeps a same-origin generated Worker filename with a dot and safe fallback coordinates', () => {
    const workerFrame = { script: '/assets/simulation.worker-1234abcd.js', line: 1, column: 20 };
    const result = clientException(null, 'window', origin, workerFrame);
    expect(result.frames).toEqual([workerFrame]);
    expect(validClientException(result)).toBe(true);
  });
  it('keeps Chrome and Firefox generated frames, drops messages, names, foreign URLs and query/fragment', () => {
    const error = {
      name: 'TypeError',
      message: 'PRIVATE student code',
      stack: [
        'TypeError: PRIVATE student code',
        `    at secretFunction (${origin}${frame.script}:4:20)`,
        `privateName@${origin}/assets/index-5678efab.js:2:8`,
        `    at https://foreign.invalid/assets/index-5678efab.js:2:3`,
        `    at ${origin}/assets/index-5678efab.js?token=PRIVATE:2:3`,
        `    at ${origin}/assets/index-5678efab.js#PRIVATE:2:3`,
        `    at ${origin}/api/private.js:3:4`,
        `    at ${origin}${frame.script}:4:20`,
      ].join('\n'),
    };
    const result = clientException(error, 'window', origin);
    expect(result).toEqual({
      kind: 'TypeError',
      capture: 'window',
      handling: 'unhandled',
      frames: [frame, { script: '/assets/index-5678efab.js', line: 2, column: 8 }],
    });
    expect(JSON.stringify(result)).not.toMatch(
      /PRIVATE|secretFunction|privateName|token|message|stack/,
    );
    expect(validClientException(result)).toBe(true);
  });
  it('caps frames and does not serialize thrown strings, custom names or hostile getters', () => {
    const error = {
      name: 'PRIVATE',
      stack: Array.from({ length: 40 }, (_, i) => `at ${origin}${frame.script}:${i + 1}:1`).join(
        '\n',
      ),
    };
    expect(clientException(error, 'rejection', origin).frames).toHaveLength(5);
    expect(clientException(error, 'rejection', origin).kind).toBe('unknown');
    expect(clientException('PRIVATE', 'rejection', origin).frames).toEqual([]);
    expect(
      clientException(
        {
          get name() {
            throw new Error('PRIVATE');
          },
        },
        'window',
        origin,
        frame,
      ),
    ).toMatchObject({ kind: 'unknown', frames: [frame] });
  });
  it('distinguishes a caught boundary fallback from an unhandled failure without claiming recovery', () => {
    const result = clientException(new RangeError('PRIVATE'), 'editor_boundary', origin);
    expect(result).toMatchObject({
      kind: 'RangeError',
      capture: 'editor_boundary',
      handling: 'boundary_fallback',
    });
    expect(exceptionMatchesCode(result, 'render_failed')).toBe(true);
    expect(exceptionMatchesCode(result, 'editor_recovered')).toBe(false);
  });
  it.each([
    { message: 'PRIVATE' },
    { kind: 'PRIVATE' },
    { handling: 'recovered' },
    { frames: [{ ...frame, message: 'PRIVATE' }] },
    { frames: [{ ...frame, script: `${frame.script}?token=x` }] },
    { frames: [{ ...frame, line: 0 }] },
    { frames: [{ ...frame, column: 10_000_001 }] },
    { frames: Array(6).fill(frame) },
    { frames: [null] },
    { capture: 'PRIVATE' },
  ])('rejects the same unsafe nested fields at outbox and intake: %j', (extra) => {
    const value = {
      kind: 'TypeError',
      capture: 'window',
      handling: 'unhandled',
      frames: [frame],
      ...extra,
    };
    expect(validClientException(value)).toBe(false);
  });
});
