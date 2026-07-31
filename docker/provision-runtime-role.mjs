import pg from 'pg';

const databaseUrl = process.env.DATABASE_URL;
const appPassword = process.env.ASA_APP_DB_PASSWORD;

if (!databaseUrl || !appPassword) {
  console.error('DATABASE_URL and ASA_APP_DB_PASSWORD are required');
  process.exit(78);
}

const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();
try {
  const escapedPassword = appPassword.replaceAll("'", "''");
  await client.query(`ALTER ROLE asalab_app WITH LOGIN PASSWORD '${escapedPassword}'`);
  await client.query('REVOKE UPDATE ON TABLE public.projects FROM asalab_app');
  await client.query('GRANT UPDATE (title) ON TABLE public.projects TO asalab_app');
  console.log('runtime database role provisioned');
} finally {
  await client.end();
}
