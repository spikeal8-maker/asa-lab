import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import type { Page } from '@playwright/test';

interface OriginalAgent {
  send?: (
    command: 'Emulation.setFocusEmulationEnabled',
    parameters: { enabled: false },
  ) => Promise<unknown>;
}
interface InProcessConnection {
  toImpl?: (page: Page) => { delegate?: { _mainFrameSession?: { _client?: OriginalAgent } } };
}

/** Restore real OS/tab visibility, not a simulated hidden state.
 * Pinned Playwright 1.55.1 crPage.js initializes its original CDP agent with
 * focus emulation enabled. That override forces visible/focused even in headed
 * Chromium. A parallel public newCDPSession cannot remove another agent's
 * override. The reviewed in-process boundary below sends only the disabling
 * command to that original agent; subsequent events come from real tab/window
 * operations. No getters, DOM events, browser dependencies, or product change.
 * Fail closed on framework upgrades/remote runners rather than fake coverage.
 */
export async function restoreNativeChromiumFocus(page: Page) {
  const fixtureRequire = createRequire(resolve(process.cwd(), 'package.json'));
  const manifest = fixtureRequire('@playwright/test/package.json') as { version?: unknown };
  if (
    manifest.version !== '1.55.1' ||
    page.context().browser()?.browserType().name() !== 'chromium'
  )
    throw Error('Native visibility helper requires reviewed Playwright 1.55.1 Chromium');
  const connection = (page as unknown as { _connection?: InProcessConnection })._connection;
  if (typeof connection?.toImpl !== 'function')
    throw Error('Native visibility helper requires the reviewed in-process Playwright connection');
  const agent = connection.toImpl(page)?.delegate?._mainFrameSession?._client;
  if (typeof agent?.send !== 'function')
    throw Error('Native visibility helper cannot identify the original Chromium main-frame agent');
  await agent.send('Emulation.setFocusEmulationEnabled', { enabled: false });
  return { playwrightVersion: manifest.version, originalAgentFocusEmulation: false };
}
