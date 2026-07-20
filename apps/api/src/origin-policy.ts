export interface MutationOriginInput {
  readonly origin: string | undefined;
  readonly requestHost: string | undefined;
  readonly requestProtocol: string;
  readonly allowedWebOrigin: string;
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
 * Browser mutation policy for the Teacher Portal.
 *
 * Browser requests carrying Origin are accepted only from the canonical Vite
 * origin or from the API's own same-origin built SPA. We deliberately do not
 * trust an arbitrary localhost/127.0.0.1 port: another local project (notably
 * the owner's service on 5173) must not become a trusted origin accidentally.
 *
 * Origin-less non-browser clients remain supported for server-side tests and
 * administrative tooling. A browser that explicitly reports cross-site via
 * Sec-Fetch-Site is rejected even if Origin is absent.
 */
export function isAllowedMutationOrigin(input: MutationOriginInput): boolean {
  if (input.secFetchSite?.toLowerCase() === 'cross-site') {
    return false;
  }
  if (input.origin === undefined) {
    return true;
  }

  const requestOrigin = normalizeOrigin(input.origin);
  const webOrigin = normalizeOrigin(input.allowedWebOrigin);
  if (requestOrigin === null || webOrigin === null) {
    return false;
  }

  const sameOrigin = input.requestHost
    ? normalizeOrigin(`${input.requestProtocol}://${input.requestHost}`)
    : null;

  return requestOrigin === webOrigin || (sameOrigin !== null && requestOrigin === sameOrigin);
}
