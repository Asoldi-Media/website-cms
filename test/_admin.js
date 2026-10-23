/** Test admin login. The CMS has no built-in admin password, so HTTP tests set one through env. */
export const TEST_ADMIN_USERNAME = 'admin';
export const TEST_ADMIN_PASSWORD = 'test-admin-pass-2026';

process.env.CMS_ADMIN_USERNAME = TEST_ADMIN_USERNAME;
process.env.CMS_ADMIN_PASSWORD = TEST_ADMIN_PASSWORD;
