/** Exact generated C++11 adapter; no general user-function/template admission. */
export function arduinoModuloAdapterSource(name: string): string {
  return `template<class A,class B>auto ${name}(A a,B b)->decltype(a%b){return a%b;}
double ${name}(double a,double b){return fmod(a,b);}`;
}

/** Mask only complete top-level canonical definitions, retaining source offsets. */
export function admittedArduinoModuloAdapters(source: string): {
  readonly source: string;
  readonly names: readonly string[];
} {
  const names: string[] = [];
  let masked = source;
  for (const match of source.matchAll(/\btemplate<class A,class B>auto (asaBlockModulo(?:_\d+)?)\(/g)) {
    const name = match[1]!;
    const start = match.index!;
    const canonical = arduinoModuloAdapterSource(name);
    if (!source.startsWith(canonical, start)) continue;
    // An extra declaration/overload must not silently replace an admitted body.
    if ([...source.matchAll(new RegExp(`\\b[A-Za-z_]\\w*\\s+${name}\\b`, 'g'))].length !== 2) continue;
    let depth = 0;
    let quoted = false;
    for (let index = 0; index < start; index++) {
      if (source[index] === '"' && (source.slice(0, index).match(/\\*$/)?.[0].length ?? 0) % 2 === 0) quoted = !quoted;
      if (!quoted) depth += source[index] === '{' ? 1 : source[index] === '}' ? -1 : 0;
    }
    if (depth !== 0 || quoted) continue;
    names.push(name);
    masked = masked.slice(0, start) + canonical.replace(/[^\n]/g, ' ') + masked.slice(start + canonical.length);
  }
  return { source: masked, names };
}
