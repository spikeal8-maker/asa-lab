export interface MutationOriginInput {
  readonly origin: string | undefined;
  readonly allowedWebOrigin: string;
  readonly allowedLocalApiOrigin: string;
  readonly additionalAllowedOrigins?: readonly string[];
  readonly allowedOriginPatterns?: readonly string[];
  readonly requestHost?: string | undefined;
  readonly secFetchSite?: string | undefined;
}

const FORBIDDEN_PORTS = new Set([3000, 3100, 5173]);

function resolveLocalPort(rawPort: string | undefined, fallback: string, name: string): number {
  const source = rawPort?.trim() || fallback;
  const port = Number.parseInt(source, 10);
  if (
    !Number.isInteger(port) ||
    String(port) !== source ||
    port < 1024 ||
    port > 65535 ||
    FORBIDDEN_PORTS.has(port)
  ) {
    throw new Error(`${name} is invalid or forbidden: ${source}`);
  }
  return port;
}

function normalizeOrigin(value: string): string | null {
  try {
    const parsed = new URL(value);
    if (
      (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') ||
      parsed.username !== '' ||
      parsed.password !== '' ||
      parsed.pathname !== '/' ||
      parsed.search !== '' ||
      parsed.hash !== ''
    ) {
      return null;
    }
    return parsed.origin;
  } catch {
    return null;
  }
}

/** Resolve the only browser origin trusted by the local API. */
export function resolveCanonicalWebOrigin(
  rawPort: string | undefined,
  explicitOrigin?: string | undefined,
): string {
  const port = resolveLocalPort(rawPort, '4610', 'ASA_WEB_PORT');

  const expected = `http://127.0.0.1:${port}`;
  if (explicitOrigin !== undefined && explicitOrigin.trim() !== '') {
    const normalized = normalizeOrigin(explicitOrigin.trim());
    if (normalized !== expected) {
      throw new Error(
        `ASA_WEB_ORIGIN must exactly match the canonical Web origin ${expected}; got ${explicitOrigin}`,
      );
    }
  }
  return expected;
}

/** The built SPA served directly by the API has one configured loopback origin. */
export function resolveLocalApiOrigin(rawPort: string | undefined): string {
  return `http://127.0.0.1:${resolveLocalPort(rawPort, '4611', 'API_PORT')}`;
}

/**
 * Public HTTPS origins are explicit production configuration, never inferred
 * from Host/X-Forwarded-* headers.  That keeps a proxy or Host-header mistake
 * from silently becoming a trusted CSRF origin.
 */
export function resolveAdditionalWebOrigins(raw: string | undefined): readonly string[] {
  if (raw === undefined || raw.trim() === '') return [];

  const values = raw
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value !== '');
  if (values.length > 8) {
    throw new Error('ASA_PUBLIC_WEB_ORIGINS accepts at most 8 comma-separated origins');
  }

  const origins = values.map((value) => {
    const normalized = normalizeOrigin(value);
    if (normalized === null || !normalized.startsWith('https://')) {
      throw new Error(`ASA_PUBLIC_WEB_ORIGINS requires HTTPS origins without paths: ${value}`);
    }
    const parsed = new URL(normalized);
    if (
      parsed.hostname === 'localhost' ||
      parsed.hostname === '127.0.0.1' ||
      parsed.hostname === '::1'
    ) {
      throw new Error(`ASA_PUBLIC_WEB_ORIGINS must not contain a loopback origin: ${value}`);
    }
    return normalized;
  });

  return [...new Set(origins)];
}

/** Explicitly delegated HTTPS DNS zones; never a bare wildcard, IP or arbitrary port. */
export function resolveWebOriginPatterns(raw: string | undefined): readonly string[] {
  const values =
    raw
      ?.split(',')
      .map((value) => value.trim())
      .filter(Boolean) ?? [];
  if (values.length > 8) throw new Error('ASA_PUBLIC_WEB_ORIGIN_PATTERNS accepts at most 8 zones');
  for (const value of values) {
    if (!/^https:\/\/\*\.(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(value)) {
      throw new Error(
        'ASA_PUBLIC_WEB_ORIGIN_PATTERNS requires HTTPS DNS zones: https://*.example.org',
      );
    }
  }
  return [...new Set(values)];
}

export function matchesWebOriginPattern(origin: string, patterns: readonly string[]): boolean {
  const normalized = normalizeOrigin(origin);
  if (!normalized) return false;
  const parsed = new URL(normalized);
  if (parsed.protocol !== 'https:' || parsed.port !== '') return false;
  // Revalidate even programmatically supplied patterns; suffix includes the DNS label boundary.
  return resolveWebOriginPatterns(patterns.join(',')).some((pattern) => {
    const suffix = pattern.slice('https://*'.length);
    const prefix = parsed.hostname.slice(0, -suffix.length);
    return (
      parsed.hostname.endsWith(suffix) &&
      prefix.split('.').every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))
    );
  });
}

/** The isolated Compose browser runner enters through Web's service name. */
export function resolveIsolatedTestWebOrigin(
  raw: string | undefined,
  nodeEnv: string | undefined,
  databaseUrl: string | undefined,
): string | null {
  if (raw === undefined) return null;
  if (raw !== 'http://web:8080' || nodeEnv !== 'test') {
    throw new Error('ASA_ISOLATED_TEST_WEB_ORIGIN is allowed only for the isolated test stack');
  }
  try {
    const database = new URL(databaseUrl ?? '');
    if (
      !['postgres:', 'postgresql:'].includes(database.protocol) ||
      database.hostname !== 'postgres' ||
      database.pathname !== '/asalab_test'
    ) {
      throw new Error('not the isolated test database');
    }
  } catch {
    throw new Error('ASA_ISOLATED_TEST_WEB_ORIGIN requires the isolated test database');
  }
  return raw;
}

/**
 * Browser mutation policy for the Teacher Portal.
 *
 * Browser requests carrying Origin are accepted only from explicitly configured
 * Web entries: the canonical local origin, local built SPA endpoint, public HTTPS
 * origins, or the guarded isolated CI Web service origin. We deliberately do not
 * trust an arbitrary localhost/127.0.0.1 port: another local project (notably
 * the owner's service on 5173) must not become a trusted origin accidentally.
 *
 * The policy is fail-closed: a state-changing request without Origin is
 * rejected as well, so automated and internal callers must send the allowed
 * Origin explicitly. A browser reporting cross-site via Sec-Fetch-Site is
 * rejected regardless of Origin.
 */
export function isAllowedMutationOrigin(input: MutationOriginInput): boolean {
  if (input.secFetchSite?.toLowerCase() === 'cross-site') {
    return false;
  }
  if (input.origin === undefined) {
    return false;
  }

  const requestOrigin = normalizeOrigin(input.origin);
  const allowedOrigins = [
    input.allowedWebOrigin,
    input.allowedLocalApiOrigin,
    ...(input.additionalAllowedOrigins ?? []),
  ]
    .map(normalizeOrigin)
    .filter((origin): origin is string => origin !== null);
  if (requestOrigin === null || allowedOrigins.length === 0) {
    return false;
  }

  if (allowedOrigins.includes(requestOrigin)) return true;
  // A delegated sibling must not submit browser mutations to a different host.
  // Use the actual Host preserved by the ingress, never X-Forwarded-Host.
  return (
    input.requestHost?.toLowerCase() === new URL(requestOrigin).host &&
    matchesWebOriginPattern(requestOrigin, input.allowedOriginPatterns ?? [])
  );
}
