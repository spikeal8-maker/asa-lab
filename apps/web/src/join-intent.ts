import type { ClassroomPreview } from './api';

/**
 * The class a visitor resolved before they were asked to identify themselves.
 *
 * It survives the sign-in round trip and a page refresh, so nobody is promised
 * "после входа присоединитесь" and then quietly dropped into the project hub.
 * It lives in sessionStorage: the intent belongs to this tab and this visit,
 * not to the device.
 *
 * What is stored is the server's opaque token plus the two strings shown on
 * screen — never a classroom identifier. The token is the only thing that
 * names the class, and only the server can read it.
 */
const KEY = 'asa.join-intent';

export interface JoinIntent {
  readonly joinIntentToken: string;
  readonly title: string;
  readonly educatorDisplayName: string;
}

export function rememberJoinIntent(preview: ClassroomPreview): void {
  try {
    window.sessionStorage.setItem(
      KEY,
      JSON.stringify({
        joinIntentToken: preview.joinIntentToken,
        title: preview.title,
        educatorDisplayName: preview.educatorDisplayName,
      }),
    );
  } catch {
    // Private modes can refuse storage; the flow still works, it just forgets.
  }
}

export function readJoinIntent(): JoinIntent | null {
  try {
    const raw = window.sessionStorage.getItem(KEY);
    if (raw === null) return null;
    const parsed = JSON.parse(raw) as Partial<JoinIntent>;
    if (
      typeof parsed.joinIntentToken === 'string' &&
      typeof parsed.title === 'string' &&
      typeof parsed.educatorDisplayName === 'string'
    ) {
      return {
        joinIntentToken: parsed.joinIntentToken,
        title: parsed.title,
        educatorDisplayName: parsed.educatorDisplayName,
      };
    }
    return null;
  } catch {
    return null;
  }
}

export function forgetJoinIntent(): void {
  try {
    window.sessionStorage.removeItem(KEY);
  } catch {
    // Nothing to clean up if storage is unavailable.
  }
}
