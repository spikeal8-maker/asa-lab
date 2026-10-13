/** Request headers are reports, never proof of a physical device. */
export function clientEnvironment(raw: string | undefined) {
  const value = (raw ?? '').slice(0, 2048);
  const candidates = [
    ['Edge', /(?:Edg|EdgiOS|EdgA)\/(\d{1,4})/],
    ['Opera', /(?:OPR|OPiOS)\/(\d{1,4})/],
    ['Firefox', /(?:Firefox|FxiOS)\/(\d{1,4})/],
    ['Chrome', /(?:Chrome|CriOS)\/(\d{1,4})/],
    ['Safari', /Version\/(\d{1,4}).*Safari\//],
  ] as const;
  const match = candidates
    .map(([family, pattern]) => ({ family, match: pattern.exec(value) }))
    .find((entry) => entry.match);
  const browser = match?.family ?? 'unknown';
  const major = match?.match?.[1] ? Number(match.match[1]) : null;
  const os = /Android/.test(value)
    ? 'Android'
    : /iPhone|iPad|iPod/.test(value)
      ? 'iOS'
      : /Windows/.test(value)
        ? 'Windows'
        : /Macintosh/.test(value)
          ? 'macOS'
          : /Linux/.test(value)
            ? 'Linux'
            : 'unknown';
  const device =
    /iPad|Tablet/.test(value) || (os === 'Android' && !/Mobile/.test(value))
      ? 'tablet'
      : /Mobile|iPhone|iPod/.test(value)
        ? 'mobile'
        : os !== 'unknown'
          ? 'desktop'
          : 'unknown';
  return { browser, major, os, device, provenance: 'request_reported' as const };
}

export function environmentSummary(raw: string | undefined): string | null {
  const value = clientEnvironment(raw);
  return value.browser === 'unknown' && value.os === 'unknown'
    ? null
    : `${value.browser}${value.major === null ? '' : ` ${value.major}`} · ${value.os} · ${value.device}`;
}
