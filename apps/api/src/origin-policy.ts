export interface MutationOriginInput {
  readonly origin: string | undefined;
  readonly requestHost: string | undefined;
  readonly requestProtocol: string;
  readonly allowedWebOrigin: string;
  readonly secFetchSite?: string | undefined;
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
