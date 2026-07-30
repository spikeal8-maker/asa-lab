export {
  seedLegacyTeacherIdentity,
  seedTeacher,
  testAdminPool as e2eAdminPool,
  type SeededTeacher,
} from '../tests/portal/helpers';
// The browser E2E seeds ONLY the isolated *_test database (TEST_DATABASE_URL);
// the development database is never touched by Playwright runs.
