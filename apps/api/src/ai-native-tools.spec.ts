import { describe, expect, it } from 'vitest';
import { addNativeUsage, nativeTools, parseNativeToolCalls } from './ai-native-tools';

describe('native image tool admission', () => {
  const offered = nativeTools({ imageSizes: [768], search: false, weather: false });
  const call = (arguments_: unknown) => [
    { function: { name: 'generate_image', arguments: arguments_ } },
  ];

  it('accepts a complete scene prompt but leaves the user selected size authoritative', () => {
    const parsed = parseNativeToolCalls(
      call({
        prompt: 'A sunlit forest beside a small village',
        size: 1024,
        model: 'flux2-klein-4b-v1',
      }),
      offered,
    );
    expect(parsed[0]?.arguments.prompt).toContain('forest');
    expect(offered[0]?.function.parameters.properties).toMatchObject({ size: { enum: [768] } });
  });

  it('rejects invented model, malformed size, extra keys and multiple calls', () => {
    for (const bad of [
      { prompt: 'Forest', size: 2048, model: 'flux2-klein-4b-v1' },
      { prompt: 'Forest', size: '512', model: 'flux2-klein-4b-v1' },
      { prompt: 'Forest', size: 768, model: 'other' },
      { prompt: 'Forest', size: 768, model: 'flux2-klein-4b-v1', url: 'https://example.invalid' },
    ])
      expect(() => parseNativeToolCalls(call(bad), offered)).toThrow('AI_TOOL_CALL_INVALID');
    expect(() =>
      parseNativeToolCalls(
        [
          ...call({ prompt: 'Forest', size: 768, model: 'flux2-klein-4b-v1' }),
          ...call({ prompt: 'Village', size: 768, model: 'flux2-klein-4b-v1' }),
        ],
        offered,
      ),
    ).toThrow('AI_TOOL_CALL_INVALID');
  });
});

describe('native internet argument boundary', () => {
  const offered = nativeTools({ search: true, weather: true });
  it('accepts one structured tool call and rejects extra keys, omitted values and unavailable names', () => {
    for (const [name, key, value] of [
      ['web_search', 'query', 'Казань новости'],
      ['image_search', 'query', 'Казань фото'],
      ['weather', 'city', 'Казань'],
    ]) {
      expect(
        parseNativeToolCalls([{ function: { name, arguments: { [key]: value } } }], offered)[0]
          ?.name,
      ).toBe(name);
      expect(() =>
        parseNativeToolCalls(
          [{ function: { name, arguments: { [key]: value, url: 'http://localhost' } } }],
          offered,
        ),
      ).toThrow('AI_TOOL_CALL_INVALID');
    }
    expect(() =>
      parseNativeToolCalls([{ function: { name: 'weather', arguments: { city: '' } } }], offered),
    ).toThrow('AI_TOOL_CALL_INVALID');
    expect(() =>
      parseNativeToolCalls([{ function: { name: 'web_search', arguments: { query: 'x' } } }], []),
    ).toThrow('AI_TOOL_CALL_INVALID');
  });

  it('sums all model rounds and keeps missing provider counts unknown', () => {
    expect(
      addNativeUsage(
        { inputTokens: 10, outputTokens: 2, actualModel: 'a' },
        { inputTokens: 20, outputTokens: 5, actualModel: 'b' },
      ),
    ).toEqual({ inputTokens: 30, outputTokens: 7, actualModel: 'b' });
    expect(
      addNativeUsage({ inputTokens: 10, outputTokens: 2, actualModel: 'a' }, undefined),
    ).toEqual({ inputTokens: null, outputTokens: null, actualModel: 'a' });
  });
});

it('advertises only the configured FP8 recipe and rejects an unoffered v1 graph request', () => {
  const recipe = 'flux2-klein-4b-fp8-izo-v1' as const;
  const offered = nativeTools({
    imageSizes: [1024],
    imageRecipe: recipe,
    search: false,
    weather: false,
  });
  const call = (model: string) => [
    {
      function: { name: 'generate_image', arguments: { prompt: 'A blue tree', size: 1024, model } },
    },
  ];
  expect(parseNativeToolCalls(call(recipe), offered)[0]?.arguments.model).toBe(recipe);
  expect(() => parseNativeToolCalls(call('flux2-klein-4b-v1'), offered)).toThrow();
});

it('admits only a closed unique HTML target when the binding capability is offered', () => {
  const args = {
    prompt: 'Лес',
    size: 768,
    model: 'flux2-klein-4b-v1',
    target: { name: 'index.html', expectedVersion: 1, placeholder: 'ASA_GENERATED_IMAGE_PENDING' },
  };
  const call = (a: unknown) => [{ function: { name: 'generate_image', arguments: a } }];
  const old = nativeTools({ search: false, weather: false, imageSizes: [768] });
  const offered = nativeTools({
    search: false,
    weather: false,
    imageSizes: [768],
    imageFileTarget: true,
  });
  expect(() => parseNativeToolCalls(call(args), old)).toThrow();
  expect(parseNativeToolCalls(call(args), offered)[0]?.arguments.target).toEqual(args.target);
  for (const target of [
    { ...args.target, name: '../x.html' },
    { ...args.target, expectedVersion: 100 },
    { ...args.target, placeholder: 'other' },
    { ...args.target, url: 'https://example.com' },
  ])
    expect(() => parseNativeToolCalls(call({ ...args, target }), offered)).toThrow();
});
