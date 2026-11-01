const FIELD_NAMES = new Set(
  'A ADDRESS ANGLE B B_PIN COLUMN CONDITION COUNT DIRECTION DISPLAY DO DURATION ECHO ELSE ENDING FREQUENCY FROM FROM_HIGH FROM_LOW G G_PIN INDEX LEVEL MAX MIN NAME PIN R ROW R_PIN SIZE STEP TEXT TIME TO TO_HIGH TO_LOW TRIG UNIT VALUE VAR NUM'.split(
    ' ',
  ),
);

/** Bounded public code projection. Editor metadata, plugin state and comments are not transported. */
export function publicArduinoBlocks(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > 65536 || !raw.trim()) return null;
  let count = 0;
  const record = (v: unknown): Record<string, unknown> => {
    if (!v || typeof v !== 'object' || Array.isArray(v)) throw Error();
    return v as Record<string, unknown>;
  };
  const text = (v: unknown, max = 4096): string => {
    if (typeof v !== 'string' || v.length > max || v.includes(String.fromCharCode(0)))
      throw Error();
    return v;
  };
  const block = (v: unknown, depth: number): Record<string, unknown> => {
    if (++count > 512 || depth > 64) throw Error();
    const b = record(v),
      type = text(b.type, 80);
    if (!/^(asa_[a-z0-9_]+|math_number|text|logic_boolean|data_variable)$/.test(type))
      throw Error();
    const out: Record<string, unknown> = { type };
    if (b.id !== undefined) out.id = text(b.id, 256);
    for (const key of ['x', 'y'])
      if (b[key] !== undefined) {
        if (typeof b[key] !== 'number' || !Number.isFinite(b[key]) || Math.abs(b[key]) > 100000)
          throw Error();
        out[key] = b[key];
      }
    for (const key of ['enabled', 'disabled', 'collapsed', 'inline'])
      if (b[key] !== undefined) {
        if (typeof b[key] !== 'boolean') throw Error();
        out[key] = b[key];
      }
    if (b.fields !== undefined) {
      const fields = record(b.fields),
        clean: Record<string, unknown> = Object.create(null);
      if (Object.keys(fields).length > 64) throw Error();
      for (const [key, value] of Object.entries(fields)) {
        if (!FIELD_NAMES.has(key)) continue;
        if (typeof value === 'string') clean[key] = text(value);
        else if (
          (typeof value === 'number' && Number.isFinite(value)) ||
          typeof value === 'boolean'
        )
          clean[key] = value;
        else {
          const f = record(value),
            item: Record<string, string> = {};
          for (const k of ['id', 'name', 'variableType'])
            if (f[k] !== undefined) item[k] = text(f[k], 256);
          if (!Object.keys(item).length) throw Error();
          clean[key] = item;
        }
      }
      out.fields = clean;
    }
    const connection = (v: unknown): Record<string, unknown> => {
      const c = record(v),
        result: Record<string, unknown> = {};
      for (const key of ['block', 'shadow'])
        if (c[key] !== undefined) result[key] = block(c[key], depth + 1);
      if (!Object.keys(result).length) throw Error();
      return result;
    };
    if (b.inputs !== undefined) {
      const inputs = record(b.inputs),
        clean: Record<string, unknown> = Object.create(null);
      if (Object.keys(inputs).length > 64) throw Error();
      for (const [key, value] of Object.entries(inputs)) {
        if (!/^[A-Za-z0-9_]{1,80}$/.test(key)) throw Error();
        clean[key] = connection(value);
      }
      out.inputs = clean;
    }
    if (b.next !== undefined) out.next = connection(b.next);
    return out;
  };
  try {
    const root = record(JSON.parse(raw)),
      blocks = record(root.blocks);
    if (!Array.isArray(blocks.blocks) || !blocks.blocks.length) return null;
    const result: Record<string, unknown> = {
      blocks: { languageVersion: 0, blocks: blocks.blocks.map((b) => block(b, 0)) },
    };
    if (root.variables !== undefined) {
      if (!Array.isArray(root.variables) || root.variables.length > 128) throw Error();
      result.variables = root.variables.map((v) => {
        const variable = record(v);
        return {
          id: text(variable.id, 256),
          name: text(variable.name, 256),
          type: text(variable.type ?? '', 80),
        };
      });
    }
    const value = JSON.stringify(result);
    return value.length <= 65536 ? value : null;
  } catch {
    return null;
  }
}
