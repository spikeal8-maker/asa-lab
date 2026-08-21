export interface MutationOriginInput {
  readonly origin: string | undefined;
  readonly requestHost: string | undefined;
  readonly requestProtocol: string;
  readonly allowedWebOrigin: string;
  readonly additionalAllowedOrigins?: readonly string[];
  readonly secFetchSite?: string | undefined;
}

const FORBIDDEN_PORTS = new Set([3000, 3100, 5173]);

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
  const source = rawPort?.trim() || '4610';
  const port = Number.parseInt(source, 10);
  if (
    !Number.isInteger(port) ||
    String(port) !== source ||
    port < 1024 ||
    port > 65535 ||
    FORBIDDEN_PORTS.has(port)
  ) {
    throw new Error(`ASA_WEB_PORT is invalid or forbidden: ${source}`);
  }

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

/**
 * Browser mutation policy for the Teacher Portal.
 *
 * Browser requests carrying Origin are accepted only from the canonical Vite
 * origin or from the API's own same-origin built SPA. We deliberately do not
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
  const allowedOrigins = [input.allowedWebOrigin, ...(input.additionalAllowedOrigins ?? [])]
    .map(normalizeOrigin)
    .filter((origin): origin is string => origin !== null);
  if (requestOrigin === null || allowedOrigins.length === 0) {
    return false;
  }

  const sameOrigin = input.requestHost
    ? normalizeOrigin(`${input.requestProtocol}://${input.requestHost}`)
    : null;

  return (
    allowedOrigins.includes(requestOrigin) || (sameOrigin !== null && requestOrigin === sameOrigin)
  );
}
