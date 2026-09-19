/* global window, document, location, localStorage, sessionStorage, setTimeout */
import console from 'node:console';
import { createProtocolFixture } from './fixture.mjs';
import {
  runtimeUrl,
  parentOrigin,
  alternateParentOrigin,
  runtimeToken,
  binding,
  initMessage,
  sendFromParent,
} from './protocol.mjs';
import {
  runtimeFrame,
  waitForRuntimeState,
  rejectionCount,
  runtimeState,
  expectRejectionIncrement,
} from './assertions.mjs';

export async function verifyHostProtocol() {
  const fixture = await createProtocolFixture();
  const { context, pageErrors } = fixture;

  try {
    const page = await context.newPage();
    await page.goto(`${parentOrigin}/parent`, { waitUntil: 'domcontentloaded' });
    const frame = await runtimeFrame(page);
    await waitForRuntimeState(frame, 'awaiting-init');

    const editorChildren = await frame
      .locator('#scratch-editor-root')
      .evaluate((node) => node.childElementCount);
    if (editorChildren !== 0)
      throw new Error(`editor mounted before valid INIT: ${editorChildren}`);
    await page.waitForFunction(() => {
      const attacker = document.getElementById('attacker-frame');
      return attacker?.contentDocument?.readyState === 'complete';
    });
    const beforeWrongSource = await rejectionCount(frame);
    await page.evaluate((payload) => window.sendFromAttacker(payload), initMessage);
    await expectRejectionIncrement(frame, beforeWrongSource, 'wrong-source INIT');
    if ((await runtimeState(frame)) !== 'awaiting-init') {
      throw new Error('wrong-source INIT changed runtime state');
    }

    const beforeWrongProtocol = await rejectionCount(frame);
    await sendFromParent(page, { ...initMessage, protocolVersion: 2 });
    await expectRejectionIncrement(frame, beforeWrongProtocol, 'wrong protocol version');

    await sendFromParent(page, initMessage);
    await waitForRuntimeState(frame, 'init-accepted');

    const receivedAfterInit = await page.evaluate(() => window.__blocksMessages);
    if (
      !receivedAfterInit.some(
        (message) =>
          message?.messageType === 'ASA_BLOCKS_STATUS' && message?.status === 'init-accepted',
      )
    ) {
      throw new Error('parent did not receive bound init-accepted status');
    }

    const persistenceLeak = await frame.locator('html').evaluate(
      (_node, token) => ({
        url: location.href.includes(token),
        html: document.documentElement.outerHTML.includes(token),
        local: Object.values(localStorage).some((value) => value.includes(token)),
        session: Object.values(sessionStorage).some((value) => value.includes(token)),
      }),
      runtimeToken,
    );
    if (Object.values(persistenceLeak).some(Boolean))
      throw new Error('runtime token leaked to browser persistence/DOM/URL');

    const beforeWrongProject = await rejectionCount(frame);
    await sendFromParent(page, {
      ...binding,
      projectId: '22222222-2222-4222-8222-222222222222',
      messageType: 'ASA_BLOCKS_TOKEN_UPDATE',
      runtimeToken: 'ignored-wrong-project-token',
    });
    await expectRejectionIncrement(frame, beforeWrongProject, 'wrong project after INIT');
    if ((await runtimeState(frame)) !== 'init-accepted') {
      throw new Error('wrong project after INIT changed runtime state');
    }

    const beforeWrongNonce = await rejectionCount(frame);
    await sendFromParent(page, {
      ...binding,
      sessionNonce: 'wrong-nonce',
      messageType: 'ASA_BLOCKS_TOKEN_UPDATE',
      runtimeToken: 'ignored-token',
    });
    await expectRejectionIncrement(frame, beforeWrongNonce, 'wrong nonce');
    if ((await runtimeState(frame)) !== 'init-accepted') {
      throw new Error('wrong nonce changed runtime state');
    }

    await sendFromParent(page, {
      ...binding,
      messageType: 'ASA_BLOCKS_TOKEN_UPDATE',
      runtimeToken: 'rotated.runtime.token',
    });
    await sendFromParent(page, {
      ...binding,
      messageType: 'ASA_BLOCKS_FLUSH_REQUEST',
      requestId: 'flush-c-1',
    });
    await page.waitForFunction(() =>
      window.__blocksMessages.some(
        (message) =>
          message?.messageType === 'ASA_BLOCKS_FLUSH_RESULT' && message?.requestId === 'flush-c-1',
      ),
    );
    const flushResult = await page.evaluate(() =>
      window.__blocksMessages.find((message) => message?.messageType === 'ASA_BLOCKS_FLUSH_RESULT'),
    );
    if (
      flushResult?.ok !== true ||
      flushResult?.reason !== null ||
      !Number.isSafeInteger(flushResult?.revision) ||
      flushResult.revision < 1 ||
      !Number.isSafeInteger(flushResult?.snapshotGeneration) ||
      flushResult.snapshotGeneration < 0
    ) {
      throw new Error(`unexpected flush result: ${JSON.stringify(flushResult)}`);
    }

    await frame.locator('body').evaluate(() => {
      setTimeout(() => {
        throw new Error('protocol-fixture-fatal');
      }, 0);
    });
    await page.waitForFunction(() => document.body.dataset.parentState === 'fatal');
    if (page.isClosed()) throw new Error('parent page closed after child fatal');

    await sendFromParent(page, {
      ...binding,
      messageType: 'ASA_BLOCKS_STOP',
    });
    await waitForRuntimeState(frame, 'stopped');
    await page.waitForFunction(() =>
      window.__blocksMessages.some(
        (message) => message?.messageType === 'ASA_BLOCKS_STATUS' && message?.status === 'stopped',
      ),
    );

    const beforePostStopToken = await rejectionCount(frame);
    await sendFromParent(page, {
      ...binding,
      messageType: 'ASA_BLOCKS_TOKEN_UPDATE',
      runtimeToken: 'must-not-be-accepted-after-stop',
    });
    await expectRejectionIncrement(frame, beforePostStopToken, 'token update after STOP');

    const beforePostStopFlush = await rejectionCount(frame);
    await sendFromParent(page, {
      ...binding,
      messageType: 'ASA_BLOCKS_FLUSH_REQUEST',
      requestId: 'flush-after-stop',
    });
    await expectRejectionIncrement(frame, beforePostStopFlush, 'flush after STOP');
    const postStopFlushResult = await page.evaluate(() =>
      window.__blocksMessages.find(
        (message) =>
          message?.messageType === 'ASA_BLOCKS_FLUSH_RESULT' &&
          message?.requestId === 'flush-after-stop',
      ),
    );
    if (postStopFlushResult) throw new Error('flush after STOP retained runtime authority');

    const beforePostStopInit = await rejectionCount(frame);
    await sendFromParent(page, initMessage);
    await expectRejectionIncrement(frame, beforePostStopInit, 'INIT after STOP');
    if ((await runtimeState(frame)) !== 'stopped') {
      throw new Error('message after STOP changed runtime state');
    }

    const wrongOriginPage = await context.newPage();
    await wrongOriginPage.goto(`${alternateParentOrigin}/parent`, {
      waitUntil: 'domcontentloaded',
    });
    const wrongOriginFrame = await runtimeFrame(wrongOriginPage);
    await waitForRuntimeState(wrongOriginFrame, 'awaiting-init');
    const beforeWrongOrigin = await rejectionCount(wrongOriginFrame);
    await sendFromParent(wrongOriginPage, initMessage);
    await expectRejectionIncrement(wrongOriginFrame, beforeWrongOrigin, 'wrong-origin INIT');
    if ((await runtimeState(wrongOriginFrame)) !== 'awaiting-init') {
      throw new Error('wrong-origin INIT changed runtime state');
    }

    if (pageErrors.length > 0)
      throw new Error(`unexpected browser errors:\n${pageErrors.join('\n')}`);

    console.log('blocks host protocol browser smoke: PASS');
    console.log(`runtime=${runtimeUrl}`);
    console.log(`parent=${parentOrigin}`);
    console.log(`rejections=${await rejectionCount(frame)}`);
  } finally {
    await fixture.close();
  }
}
