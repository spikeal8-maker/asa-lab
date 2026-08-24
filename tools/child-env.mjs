// Child-process environment builders for the dev orchestrator.
// The API child receives ONLY the runtime-role URL: admin, migration and test
// connection material is stripped even when present in the parent environment
// or .env.local. The web child gets no DB credentials at all.

const MIGRATION_STRIP = [
  'MIGRATION_DATABASE_URL',
  'MIGRATION_EXPECT_DATABASE',
  'MIGRATION_CONFIRM',
];
const API_STRIP = [
  'DATABASE_URL',
  'TEST_DATABASE_URL',
  'APP_TEST_DATABASE_URL',
  ...MIGRATION_STRIP,
];
const WEB_STRIP = [
  'DATABASE_URL',
  'TEST_DATABASE_URL',
  'APP_TEST_DATABASE_URL',
  'APP_DATABASE_URL',
  ...MIGRATION_STRIP,
];

export function apiChildEnv(base, apiPort) {
  const env = { ...base };
  for (const key of API_STRIP) {
    delete env[key];
  }
  env.API_PORT = String(apiPort);
  env.API_HOST = '127.0.0.1';
  return env;
}

export function webChildEnv(base) {
  const env = { ...base };
  for (const key of WEB_STRIP) {
    delete env[key];
  }
  return env;
}
