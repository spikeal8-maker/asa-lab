import type {
  ArduinoProgramAction,
  ArduinoWriteAction,
  CompiledInstruction,
} from './arduino-program-runtime.js';

export type StableOwnedLoop =
  | { readonly kind: 'literal-writes'; readonly writes: readonly ArduinoWriteAction[] }
  | { readonly kind: 'millis' };

export function stableOwnedLoop(
  instructions: readonly CompiledInstruction[],
  readsMillis: boolean,
  readsMicros: boolean,
  literalFor: (
    instruction: CompiledInstruction,
  ) => { readonly name: string; readonly actions: readonly ArduinoProgramAction[] } | undefined,
): StableOwnedLoop | undefined {
  const writes: ArduinoWriteAction[] = [];
  for (const instruction of instructions) {
    const literal = literalFor(instruction);
    const action = literal?.actions[0];
    if (
      literal?.name !== 'digitalWrite' ||
      literal.actions.length !== 1 ||
      action?.kind !== 'write'
    )
      break;
    writes.push(action);
  }
  if (writes.length > 0 && writes.length === instructions.length)
    return { kind: 'literal-writes', writes };
  if (
    readsMillis &&
    !readsMicros &&
    instructions.every((instruction) => {
      if (instruction.kind !== 'simple') return true;
      const prepared = instruction.prepared;
      return (
        prepared &&
        !prepared.member &&
        (prepared.declaration ||
          prepared.assignment ||
          prepared.increment ||
          (prepared.call && ['pinMode', 'digitalWrite', 'analogWrite'].includes(prepared.call[1]!)))
      );
    })
  )
    return { kind: 'millis' };
  return undefined;
}

export function sameRuntimeEntries<Key, Value>(
  current: ReadonlyMap<Key, Value>,
  snapshot: ReadonlyMap<Key, Value>,
): boolean {
  if (current.size !== snapshot.size) return false;
  for (const [key, value] of current)
    if (!snapshot.has(key) || !Object.is(snapshot.get(key), value)) return false;
  return true;
}
