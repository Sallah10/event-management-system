// Stand-in for the `server-only` package under `node --test`.
//
// The real package throws on import unless the `react-server` export condition
// is active, which is how it turns "a client component imported a secret" into a
// build error. Under the test runner there is no client, so the guard has nothing
// to guard and only prevents the logic being tested.
//
// This module is only reachable through the resolve hook in
// scripts/ts-alias-hooks.mjs. Nothing in the application imports this path.
export {};
