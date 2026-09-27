// ─── TEST ENVIRONMENT ─────────────────────────────────────────────────────────
// Loaded with `--import` before any test module, so the modules under test see
// the environment they expect.
//
// `lib/env.ts` exists to fail loudly when a secret is missing, and it is right to:
// four different hardcoded fallback JWT secrets once meant that a missing env var
// left some routes signing tokens with a string published in this repository. So
// this file does not weaken that check. It supplies values, all of them obviously
// fake and all of them local to a test process.
//
// Nothing here reaches a network. `DATABASE_URL` points at a port nothing is
// listening on: importing a Sequelize model builds the instance but connects
// lazily, and no test in this suite issues a query. If one ever does, it fails
// against a closed port, which is the correct outcome — these are unit tests for
// pure logic, and a test that quietly needed a real database should be an
// integration test with its own setup.

process.env.DATABASE_URL ??= "postgres://unused:unused@127.0.0.1:1/unit_tests_never_connect";

/**
 * Throwaway values for the two secrets `lib/session.ts` requires. Both are
 * obviously fake and both exist only inside this process.
 */
process.env.JWT_SECRET ??= "test-only-jwt-secret-not-used-anywhere-else-0123456789";
process.env.DEVICE_PEPPER ??= "test-only-device-pepper";

process.env.WP_TO_APP_SECRET ??= "test-only-wp-secret";
