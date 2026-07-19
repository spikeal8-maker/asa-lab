import pg from 'pg';
export { seedTeacher, type SeededTeacher } from '../tests/portal/helpers';

/** E2E runs against the local development database (admin DATABASE_URL): the
 * browser flow exercises the real dev stack, not the isolated test DB. */
export function devAdminPool(): pg.Pool {
  const url = process.env['DATABASE_URL'];
  if (!url) {
    throw new Error('DATABASE_URL (admin) is required for the E2E seed');
  }
  return new pg.Pool({ connectionString: url, max: 2 });
}
