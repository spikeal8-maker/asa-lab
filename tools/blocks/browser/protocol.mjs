/* global window */
import process from 'node:process';

export const runtimeUrl = process.env.BLOCKS_RUNTIME_URL ?? 'http://127.0.0.1:4613';
export const parentPort = Number.parseInt(process.env.BLOCKS_PARENT_PORT ?? '4612', 10);
export const parentOrigin = `http://127.0.0.1:${parentPort}`;
export const alternateParentOrigin = `http://localhost:${parentPort}`;
export const projectId = '11111111-1111-4111-8111-111111111111';
export const sessionNonce = 'fixture-session-nonce-c';
export const runtimeToken = 'fixture-runtime-token-c';

export const binding = {
  protocolVersion: 1,
  projectId,
  sessionNonce,
};
export const initMessage = {
  ...binding,
  messageType: 'ASA_BLOCKS_INIT',
  mode: 'editor',
  versionId: null,
  apiOrigin: parentOrigin,
  runtimeToken,
  draftRevision: 0,
  hasProjectJson: false,
  assets: [],
  recoveryNamespace: 'fixture-c',
};
export async function sendFromParent(page, message) {
  await page.evaluate((payload) => window.sendToRuntime(payload), message);
}
