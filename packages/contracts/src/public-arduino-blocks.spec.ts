import { expect, it } from 'vitest';
import { publicArduinoBlocks } from './public-arduino-blocks';
const code = {
  blocks: {
    languageVersion: 0,
    blocks: [
      {
        type: 'asa_loop',
        x: 20,
        y: 20,
        inputs: {
          DO: {
            block: {
              type: 'asa_builtin_led',
              inputs: { LEVEL: { shadow: { type: 'asa_level', fields: { LEVEL: 'HIGH' } } } },
            },
          },
        },
      },
    ],
  },
};
it('projects actual program connections and strips editor/plugin metadata', () => {
  const input = structuredClone(code) as typeof code & { password?: string; extraState?: object };
  input.password = 'secret';
  input.extraState = { url: 'private' };
  const clean = publicArduinoBlocks(JSON.stringify(input));
  expect(JSON.parse(clean!)).toEqual(code);
  expect(publicArduinoBlocks(clean)).toBe(clean);
});
it.each([
  '',
  '{}',
  'not-json',
  'x'.repeat(65537),
  JSON.stringify({ blocks: { blocks: [{ type: 'remote_extension' }] } }),
  JSON.stringify({ blocks: { blocks: Array.from({ length: 513 }, () => ({ type: 'asa_loop' })) } }),
])('rejects malformed or excessive graph', (value) =>
  expect(publicArduinoBlocks(value)).toBeNull(),
);
it('bounds nesting without stack overflow', () => {
  let block: object = { type: 'asa_wait' };
  for (let i = 0; i < 70; i++) block = { type: 'asa_wait', next: { block } };
  expect(publicArduinoBlocks(JSON.stringify({ blocks: { blocks: [block] } }))).toBeNull();
});
it('preserves variable identities without carrying arbitrary field object metadata', () => {
  const value = publicArduinoBlocks(
    JSON.stringify({
      blocks: {
        blocks: [
          { type: 'asa_loop', fields: { VAR: { id: 'v', name: 'counter', password: 'secret' } } },
        ],
      },
      variables: [{ id: 'v', name: 'counter', type: '' }],
      extraState: { url: 'private' },
    }),
  );
  expect(value).toContain('counter');
  expect(value).not.toMatch(/password|secret|extraState|private/);
});

it('does not transport unclassified block fields', () => {
  const projected = publicArduinoBlocks(
    JSON.stringify({
      blocks: { blocks: [{ type: 'asa_loop', fields: { PASSWORD: 'private', token: 'secret' } }] },
    }),
  );
  expect(projected).not.toMatch(/PASSWORD|private|token|secret/);
});
