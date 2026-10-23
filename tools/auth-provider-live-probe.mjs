#!/usr/bin/env node
/**
 * Read-only MAX / Telegram Bot API diagnostic for a disposable ASA Lab test bot.
 * No webhook creation, token publication, user-message reads or session writes.
 *
 * Required environment for live checks:
 *   ASA_TEST_MAX_BOT_TOKEN, ASA_TEST_TELEGRAM_BOT_TOKEN
 *   ASA_TEST_MAX_CA_FILE: path to the official Russian Trusted Root CA PEM
 */
import { readFileSync } from 'node:fs';
import { createHash, X509Certificate } from 'node:crypto';
import https from 'node:https';
import tls from 'node:tls';
import { fileURLToPath } from 'node:url';

const MAX_HOST = 'platform-api2.max.ru';
const TELEGRAM_HOST = 'api.telegram.org';
const REQUEST_TIMEOUT_MS = 12000;
const EXPECTED_ROOT_FINGERPRINT =
  'D26D2D0231B7C39F92CC738512BA54103519E4405D68B5BD703E9788CA8ECF31';

export function safeErrorCode(reason) {
  const code = typeof reason?.code === 'string' ? reason.code : 'NETWORK_ERROR';
  return /^[A-Z][A-Z0-9_]{0,45}$/.test(code) ? code : 'NETWORK_ERROR';
}

export function safeBotSummary(value) {
  if (!value || typeof value !== 'object') return { verified: false };
  const id = value.user_id ?? value.id;
  const username = value.username;
  const safeUsername =
    typeof username === 'string' && /^[a-zA-Z0-9_]{3,64}$/.test(username) ? username : null;
  const safeId =
    (typeof id === 'number' && Number.isSafeInteger(id) && id > 0) ||
    (typeof id === 'string' && /^[0-9]{1,24}$/.test(id))
      ? String(id)
      : null;
  return {
    verified: value.is_bot === true && !!safeId && !!safeUsername,
    botId: safeId,
    botUsername: safeUsername,
  };
}

export function safeWebhookSummary(provider, value) {
  const entries = provider === 'max' ? value?.subscriptions : null;
  if (provider === 'max') {
    return {
      configured: Array.isArray(entries) && entries.length > 0,
      subscriptionCount: Array.isArray(entries) ? entries.length : null,
    };
  }
  const raw = typeof value?.url === 'string' ? value.url : '';
  let host = null;
  try {
    const u = new URL(raw);
    if (u.protocol === 'https:') host = u.hostname;
  } catch {
    /* deliberately do not expose webhook URL */
  }
  return {
    configured: !!raw,
    webhookHost: host,
    pendingUpdates: Number.isSafeInteger(value?.pending_update_count)
      ? value.pending_update_count
      : null,
  };
}

export function requireCa(pemPath) {
  if (!pemPath) throw Object.assign(new Error('CA required'), { code: 'MAX_CA_MISSING' });
  const pem = readFileSync(pemPath, 'utf8');
  const cert = new X509Certificate(pem);
  const sha256 = createHash('sha256').update(cert.raw).digest('hex').toUpperCase();
  if (sha256 !== EXPECTED_ROOT_FINGERPRINT) {
    throw Object.assign(new Error('Unexpected certificate'), { code: 'MAX_CA_MISMATCH' });
  }
  return pem;
}

async function getMaxAddresses() {
  const url = new URL('https://dns.google/resolve');
  url.searchParams.set('name', MAX_HOST);
  url.searchParams.set('type', 'A');
  const response = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  if (!response.ok) throw Object.assign(new Error('DoH HTTP failure'), { code: 'DOH_UNAVAILABLE' });
  const payload = await response.json();
  if (payload?.Status !== 0 || !Array.isArray(payload.Answer)) {
    throw Object.assign(new Error('Invalid DoH record'), { code: 'MAX_DNS_UNAVAILABLE' });
  }
  const addresses = [
    ...new Set(
      payload.Answer.filter(
        (entry) =>
          entry.type === 1 &&
          typeof entry.data === 'string' &&
          /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/.test(entry.data) &&
          entry.data.split('.').every((part) => Number(part) <= 255),
      ).map((entry) => entry.data),
    ),
  ];
  if (addresses.length === 0)
    throw Object.assign(new Error('No A record'), { code: 'MAX_DNS_UNAVAILABLE' });
  return addresses.slice(0, 6);
}

function getJson(hostname, path, token, ca, address) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname,
      servername: hostname,
      port: 443,
      path,
      method: 'GET',
      headers: hostname === MAX_HOST ? { authorization: token } : { accept: 'application/json' },
      timeout: REQUEST_TIMEOUT_MS,
      ...(ca ? { ca: [...tls.rootCertificates, ca] } : {}),
      ...(address
        ? {
            family: 4,
            lookup: (_hostname, _options, callback) => callback(null, address, 4),
          }
        : {}),
    };
    const request = https.request(options, (response) => {
      let data = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        data += chunk;
        if (data.length > 128000)
          request.destroy(Object.assign(new Error('Too large'), { code: 'BODY_TOO_LARGE' }));
      });
      response.on('end', () => {
        let body;
        try {
          body = JSON.parse(data);
        } catch {
          body = null;
        }
        resolve({ httpStatus: response.statusCode, body });
      });
    });
    request.on('timeout', () =>
      request.destroy(Object.assign(new Error('Timeout'), { code: 'PROBE_TIMEOUT' })),
    );
    request.on('error', reject);
    request.end();
  });
}

async function maxMethod(path, token, ca, addresses) {
  let last = null;
  for (const address of addresses) {
    try {
      return await getJson(MAX_HOST, path, token, ca, address);
    } catch (error) {
      last = error;
    }
  }
  throw last ?? Object.assign(new Error('MAX unavailable'), { code: 'MAX_UNAVAILABLE' });
}

export async function probe({ maxToken, telegramToken, caFile }) {
  const report = {
    schema: 'asa-lab-test-bot-readonly-v1',
    checkedAt: new Date().toISOString(),
    machine: 'D2-R2',
    mode: 'read_only',
    max: { configured: Boolean(maxToken), identity: 'not_checked', webhook: 'not_checked' },
    telegram: {
      configured: Boolean(telegramToken),
      identity: 'not_checked',
      webhook: 'not_checked',
    },
  };

  if (maxToken) {
    try {
      if (/\r|\n/.test(maxToken))
        throw Object.assign(new Error('Bad token'), { code: 'TOKEN_FORMAT_INVALID' });
      const ca = requireCa(caFile);
      const addresses = await getMaxAddresses();
      const identity = await maxMethod('/me', maxToken, ca, addresses);
      report.max.identity = {
        httpStatus: identity.httpStatus,
        ...safeBotSummary(identity.body),
      };
      if (report.max.identity.verified) {
        const subscription = await maxMethod('/subscriptions', maxToken, ca, addresses);
        report.max.webhook = {
          httpStatus: subscription.httpStatus,
          ...safeWebhookSummary('max', subscription.body),
        };
      }
    } catch (error) {
      report.max.identity = { status: 'transport_error', code: safeErrorCode(error) };
    }
  }
  if (telegramToken) {
    try {
      if (!/^[0-9]{1,20}:[A-Za-z0-9_-]{20,200}$/.test(telegramToken)) {
        throw Object.assign(new Error('Bad token'), { code: 'TOKEN_FORMAT_INVALID' });
      }
      const identity = await getJson(TELEGRAM_HOST, `/bot${telegramToken}/getMe`, '', null, null);
      report.telegram.identity = {
        httpStatus: identity.httpStatus,
        ...safeBotSummary(identity.body?.result),
      };
      if (report.telegram.identity.verified) {
        const webhook = await getJson(
          TELEGRAM_HOST,
          `/bot${telegramToken}/getWebhookInfo`,
          '',
          null,
          null,
        );
        report.telegram.webhook = {
          httpStatus: webhook.httpStatus,
          ...safeWebhookSummary('telegram', webhook.body?.result),
        };
      }
    } catch (error) {
      report.telegram.identity = { status: 'transport_error', code: safeErrorCode(error) };
    }
  }
  const bothVerified =
    report.max.identity?.verified === true && report.telegram.identity?.verified === true;
  return { report, exitCode: bothVerified ? 0 : 2 };
}

async function main() {
  // Secrets are environment-only; do not print raw responses, paths, exceptions or tokens.
  const { report, exitCode } = await probe({
    maxToken: process.env.ASA_TEST_MAX_BOT_TOKEN?.trim(),
    telegramToken: process.env.ASA_TEST_TELEGRAM_BOT_TOKEN?.trim(),
    caFile: process.env.ASA_TEST_MAX_CA_FILE,
  });
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = exitCode;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main();
