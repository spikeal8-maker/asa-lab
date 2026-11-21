import { expect, it } from 'vitest';
import { validBudgetInput } from './ai-token-budgets';
const input = (limit: unknown) => ({
  configurationVersion: 0,
  requestId: '11111111-1111-4111-8111-111111111111',
  models: [{ model: 'ollama-local', globalLimit: limit, userLimit: null }],
});
it.each([null, '0', '1', '9007199254740991'])('accepts exact budget cap %s', (value) =>
  expect(validBudgetInput(input(value)).models[0]?.globalLimit).toBe(value),
);
it.each([0, -1, '-1', '1.1', '01', '9007199254740992', '1e3', undefined, {}, ''])(
  'rejects ambiguous or unsafe cap %s',
  (value) => expect(() => validBudgetInput(input(value))).toThrow(),
);
it('rejects duplicate models, unsafe revision and arbitrary model syntax', () => {
  const raw = input('1');
  expect(() => validBudgetInput({ ...raw, models: [...raw.models, ...raw.models] })).toThrow();
  expect(() => validBudgetInput({ ...raw, configurationVersion: 1.5 })).toThrow();
  expect(() =>
    validBudgetInput({
      ...raw,
      models: [{ ...raw.models[0], model: 'https://example.org/model' }],
    }),
  ).toThrow();
});
