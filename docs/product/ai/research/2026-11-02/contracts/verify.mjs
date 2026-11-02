import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const schema = JSON.parse(readFileSync(new URL('./tool-runtime.schema.json', import.meta.url)));
const examples = JSON.parse(readFileSync(new URL('./examples.json', import.meta.url)));
const transitions = JSON.parse(readFileSync(new URL('./state-transitions.json', import.meta.url)));
const ajv = new Ajv2020({ strict: true, allErrors: true });
addFormats(ajv);
const validate = ajv.compile(schema);

for (const [group, expected] of [
  ['valid', true],
  ['invalid', false],
]) {
  for (const [index, example] of examples[group].entries()) {
    assert.equal(
      validate(example),
      expected,
      `${group}[${index}]: ${JSON.stringify(validate.errors)}`,
    );
  }
}

const requiredTools = [
  'web_search',
  'image_search',
  'read_page',
  'weather',
  'generate_image',
  'create_working_file',
  'read_working_file',
  'edit_working_file',
];
for (const name of requiredTools) {
  assert.ok(examples.valid.some((item) => item.kind === 'call' && item.name === name), name);
  assert.ok(
    examples.valid.some(
      (item) => item.kind === 'result' && item.name === name && ['succeeded', 'partial'].includes(item.state),
    ),
    name,
  );
}

for (const example of transitions.examples) {
  const machine = transitions[example.machine];
  const accepted = example.states.every((state, index, states) =>
    index === 0 ? Object.hasOwn(machine, state) : machine[states[index - 1]]?.includes(state),
  );
  assert.equal(accepted, example.valid, example.name);
}

const operationStates = new Set(Object.keys(transitions.operation));
const toolStates = new Set(Object.keys(transitions.tool));
for (const branch of schema.$defs.event.oneOf) {
  const type = branch.properties.type.const;
  if (type === 'operation.state.changed' || type === 'tool.state.changed') {
    const expected = type === 'operation.state.changed' ? operationStates : toolStates;
    assert.deepEqual(new Set(branch.properties.data.properties.state.enum), expected, type);
  }
}

console.log(`Documentation schema: ${examples.valid.length} valid and ${examples.invalid.length} invalid examples PASS.`);
console.log('Coverage: eight tools have call/result examples. This is not runtime, provider, authorization or browser evidence.');
console.log(`Documented state transitions: ${transitions.examples.length} positive/negative traces PASS.`);
