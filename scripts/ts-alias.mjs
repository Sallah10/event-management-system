// ─── PATH ALIASES FOR `node --test` ────────────────────────────────────────────
// Next.js resolves the `@/` prefix from tsconfig.json's `paths`. Node does not
// read tsconfig.json, so `import { cleanText } from "@/lib/validate"` fails with
// ERR_MODULE_NOT_FOUND under the built-in test runner.
//
// This registers a resolve hook that maps the prefix onto the repository root and
// tries TypeScript's extensions, because Node's type stripping resolves a
// specifier to a real file and will not add `.ts` for us.
//
// It also stubs `server-only`.
//
// That package exists to make one build error: importing a server module from a
// client component. It works by resolving to a module that throws, under the
// `react-server` condition only. Under plain Node there is no such condition, so
// `import "server-only"` throws "This module cannot be imported from a Client
// Component module" - from a test, on Node, where the thing being guarded cannot
// happen. Stubbing it lets the scoring and timing logic be tested directly
// instead of being skipped for being untestable.

import { register } from "node:module";
import { pathToFileURL } from "node:url";

register("./ts-alias-hooks.mjs", import.meta.url);

export { pathToFileURL };
