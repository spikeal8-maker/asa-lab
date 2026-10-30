/** Only this exact generated C++11 adapter is admitted, never arbitrary templates. */
export function arduinoModuloAdapterSource(name: string): string {
  return `template<class A,class B>auto ${name}(A a,B b)->decltype(a%b){return a%b;}
double ${name}(double a,double b){return fmod(a,b);}`;
}

/** Keep offsets unchanged; the normal parser still rejects every other definition. */
export function admittedArduinoModuloAdapters(source: string): {
  readonly source: string;
  readonly names: readonly string[];
} {
  const names: string[] = [];
  let masked = source;
  for (const match of source.matchAll(
    /\btemplate<class A,class B>auto (asaBlockModulo(?:_\d+)?)\(/g,
  )) {
    const name = match[1]!;
    const start = match.index!;
    const canonical = arduinoModuloAdapterSource(name);
    if (!source.startsWith(canonical, start)) continue;
    // Reject additional declarations, overloads and variable collisions.
    if ([...source.matchAll(new RegExp(`\\b[A-Za-z_]\\w*\\s+${name}\\b`, 'g'))].length !== 2)
      continue;
    let depth = 0;
    for (const character of source.slice(0, start))
      depth += character === '{' ? 1 : character === '}' ? -1 : 0;
    if (depth !== 0) continue;
    names.push(name);
    masked =
      masked.slice(0, start) +
      canonical.replace(/[^\n]/g, ' ') +
      masked.slice(start + canonical.length);
  }
  return { source: masked, names };
}
