import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Resolve hook only. See scripts/ts-alias.mjs for why this exists.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** TypeScript's extension list, in the order Node itself would try. */
const EXTENSIONS = ["", ".ts", ".tsx", ".mts", ".js", ".mjs", ".json"];

const SERVER_ONLY_STUB = pathToFileURL(
  path.join(ROOT, "scripts", "stubs", "server-only.mjs"),
).href;

export async function resolve(specifier, context, nextResolve) {
  if (specifier === "server-only") {
    return { url: SERVER_ONLY_STUB, shortCircuit: true, format: "module" };
  }

  // `@/` comes from tsconfig.json's `paths`.
  if (specifier.startsWith("@/")) {
    const found = firstFileWithExtension(path.join(ROOT, specifier.slice(2)));
    if (found) return nextResolve(pathToFileURL(found).href, context);
  }

  // Extensionless relative imports, e.g. `import sequelize from "../db"`. This is
  // how the Sequelize models refer to each other, and it is TypeScript's module
  // resolution rather than Node's: Node will not add `.ts` for us, so the models
  // are unloadable from a test without this branch.
  if (specifier.startsWith("./") || specifier.startsWith("../")) {
    if (context.parentURL?.startsWith("file:")) {
      const parentDir = path.dirname(fileURLToPath(context.parentURL));
      const found = firstFileWithExtension(path.resolve(parentDir, specifier));
      if (found) return nextResolve(pathToFileURL(found).href, context);
    }
  }

  return nextResolve(specifier, context);
}

/** First of `base`, `base.ts`, `base/index.ts`, … that exists on disk. */
function firstFileWithExtension(base) {
  for (const extension of EXTENSIONS) {
    const candidate = `${base}${extension}`;
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile())
      return candidate;
  }

  if (fs.existsSync(base) && fs.statSync(base).isDirectory()) {
    for (const extension of EXTENSIONS.slice(1)) {
      const candidate = path.join(base, `index${extension}`);
      if (fs.existsSync(candidate)) return candidate;
    }
  }

  return null;
}

/**
 * Serve `.json` imports as modules.
 *
 * Webpack - and therefore Next.js - resolves `import data from "./x.json"` with no
 * import attribute. Node's ESM loader requires `with { type: "json" }` and throws
 * ERR_IMPORT_ATTRIBUTE_MISSING without it. Adding the attribute to application
 * source to satisfy the test runner would mean changing working, bundled code for
 * the benefit of a runner, so the attribute is supplied here instead: the file is
 * read and returned as a default export.
 */
export async function load(url, context, nextLoad) {
  if (url.startsWith("file:") && url.endsWith(".json")) {
    const filePath = fileURLToPath(url);
    const source = `export default ${fs.readFileSync(filePath, "utf8")};\n`;
    return { format: "module", source, shortCircuit: true };
  }

  return nextLoad(url, context);
}
