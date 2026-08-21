import { expect, type ConsoleMessage, type Page, type Request } from '@playwright/test';

export interface BrowserFailureCounts {
  readonly consoleErrors: number;
  readonly pageErrors: number;
  readonly failedRequests: number;
  readonly httpServerErrors: number;
  readonly allowedAnonymousSessionProbes: number;
  readonly allowedAdminAccessProbes: number;
}

export interface BrowserFailureCollector {
  readonly counts: BrowserFailureCounts;
  assertEmpty(): void;
}

export interface BrowserFailureOptions {
  /**
   * The application intentionally probes /api/auth/me once before login. The
   * anonymous 401 is expected, but Chromium reports it as a console error.
   */
  readonly allowAnonymousSessionProbe?: boolean;
  /** A signed-in non-admin is expected to receive one 403 from /api/admin/v1/me. */
  readonly allowAdminAccessProbe?: boolean;
}

const anonymousSessionConsoleText =
  'Failed to load resource: the server responded with a status of 401 (Unauthorized)';
const forbiddenConsoleText =
  'Failed to load resource: the server responded with a status of 403 (Forbidden)';

function consoleFailure(message: ConsoleMessage): string {
  const location = message.location();
  const source = location.url
    ? ` ${location.url}:${location.lineNumber}:${location.columnNumber}`
    : '';
  return `${message.text()}${source}`;
}

function requestFailure(request: Request): string {
  return `${request.method()} ${request.url()} ${request.failure()?.errorText ?? 'unknown error'}`;
}

function serverResponseFailure(status: number, method: string, url: string): string {
  return `${status} ${method} ${url}`;
}

/**
 * A request the browser cancelled is not a request that failed. Switching
 * workspace reloads the application, and whatever it had in flight — the
 * profile, the classroom list — is aborted mid-answer. Reporting that as a
 * browser failure made the spec fail depending on how fast the machine was.
 */
function isCancelledByNavigation(request: Request): boolean {
  return request.failure()?.errorText === 'net::ERR_ABORTED';
}

function isAnonymousSessionProbe(message: ConsoleMessage): boolean {
  if (message.text() !== anonymousSessionConsoleText) return false;
  try {
    return new URL(message.location().url).pathname === '/api/auth/me';
  } catch {
    return false;
  }
}

function isAdminAccessProbe(message: ConsoleMessage): boolean {
  if (message.text() !== forbiddenConsoleText) return false;
  try {
    return new URL(message.location().url).pathname === '/api/admin/v1/me';
  } catch {
    return false;
  }
}

export function collectBrowserFailures(
  page: Page,
  options: BrowserFailureOptions = {},
): BrowserFailureCollector {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const failedRequests: string[] = [];
  const httpServerErrors: string[] = [];
  let allowedAnonymousSessionProbes = 0;
  let allowedAdminAccessProbes = 0;

  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    if (
      options.allowAnonymousSessionProbe &&
      allowedAnonymousSessionProbes === 0 &&
      isAnonymousSessionProbe(message)
    ) {
      allowedAnonymousSessionProbes += 1;
      return;
    }
    if (options.allowAdminAccessProbe && isAdminAccessProbe(message)) {
      allowedAdminAccessProbes += 1;
      return;
    }
    consoleErrors.push(consoleFailure(message));
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('requestfailed', (request) => {
    if (isCancelledByNavigation(request)) return;
    failedRequests.push(requestFailure(request));
  });
  page.on('response', (response) => {
    if (response.status() >= 500) {
      httpServerErrors.push(
        serverResponseFailure(response.status(), response.request().method(), response.url()),
      );
    }
  });

  return {
    get counts() {
      return {
        consoleErrors: consoleErrors.length,
        pageErrors: pageErrors.length,
        failedRequests: failedRequests.length,
        httpServerErrors: httpServerErrors.length,
        allowedAnonymousSessionProbes,
        allowedAdminAccessProbes,
      };
    },
    assertEmpty() {
      expect(consoleErrors, 'browser console errors').toEqual([]);
      expect(pageErrors, 'uncaught browser page errors').toEqual([]);
      expect(failedRequests, 'unexpected failed browser requests').toEqual([]);
      expect(httpServerErrors, 'unexpected HTTP 5xx responses').toEqual([]);
    },
  };
}
