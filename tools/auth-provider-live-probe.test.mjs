import assert from 'node:assert/strict';
import test from 'node:test';
import {
  probe,
  safeBotSummary,
  safeErrorCode,
  safeWebhookSummary,
} from './auth-provider-live-probe.mjs';

test('no credentials means no external requests and no invented readiness', async () => {
  const result = await probe({ maxToken: '', telegramToken: '', caFile: '' });
  assert.equal(result.exitCode, 2);
  assert.deepEqual(result.report.max, {
    configured: false,
    identity: 'not_checked',
    webhook: 'not_checked',
  });
  assert.equal(result.report.telegram.configured, false);
  assert.equal(result.report.mode, 'read_only');
});

test('only safe network error codes appear in reports', () => {
  assert.equal(safeErrorCode({ code: 'EAI_AGAIN' }), 'EAI_AGAIN');
  assert.equal(safeErrorCode(new Error('authorization:secret-value')), 'NETWORK_ERROR');
  assert.equal(safeErrorCode({ code: 'secret=DO_NOT_PRINT' }), 'NETWORK_ERROR');
});

test('a bot is verified only for a valid subject, username and bot marker', () => {
  assert.deepEqual(safeBotSummary({ user_id: 1001, username: 'asa_test_max_bot', is_bot: true }), {
    verified: true,
    botId: '1001',
    botUsername: 'asa_test_max_bot',
  });
  assert.equal(
    safeBotSummary({ user_id: 1001, username: 'asa_test_max_bot', is_bot: false }).verified,
    false,
  );
  assert.equal(
    safeBotSummary({ user_id: -1, username: 'asa_test_max_bot', is_bot: true }).verified,
    false,
  );
  assert.equal(
    safeBotSummary({ user_id: 1001, username: 'bad name secret', is_bot: true }).verified,
    false,
  );
});

test('webhook diagnostics strip secret tokens and query strings', () => {
  const raw = {
    url: 'https://qa-tunnel.example/api/bot/DO_NOT_LOG_THIS_TOKEN?token=DO_NOT_LOG_THIS_TOKEN',
    pending_update_count: 2,
  };
  const summary = safeWebhookSummary('telegram', raw);
  assert.equal(summary.configured, true);
  assert.equal(summary.webhookHost, 'qa-tunnel.example');
  assert.equal(summary.pendingUpdates, 2);
  assert.doesNotMatch(JSON.stringify(summary), /DO_NOT_LOG_THIS_TOKEN/);
});

test('MAX summary reports count and never publishes update payloads', () => {
  const value = { subscriptions: [{ url: 'https://qa.example/SECRET', secret: 'SECRET' }] };
  const summary = safeWebhookSummary('max', value);
  assert.deepEqual(summary, { configured: true, subscriptionCount: 1 });
  assert.doesNotMatch(JSON.stringify(summary), /SECRET/);
});
