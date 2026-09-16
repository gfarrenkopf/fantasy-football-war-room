/**
 * Node resolve hook for the ingestion CLI.
 *
 * Node runs TypeScript directly, but it resolves neither the `@/*` path alias from
 * tsconfig.json nor the extensionless relative imports that TypeScript allows. Next and
 * Vitest both handle those, so rather than make `src/lib/data/pipeline/**` import
 * differently from the rest of the codebase, the CLI teaches Node the same two rules.
 *
 * It also declares the resolved files as ES modules, which Node would otherwise have to
 * discover by parsing them twice (the package has no "type": "module", and adding one
 * would change how Next treats the whole project).
 *
 * Plain .mjs on purpose: hooks are registered before type stripping is available.
 */
import { existsSync, statSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join, resolve as resolvePath } from "node:path";

const SRC = resolvePath(dirname(fileURLToPath(import.meta.url)), "..", "..", "src");
const EXTENSIONS = [".ts", ".tsx", ".mts", ".js", ".mjs"];

const isFile = (path) => existsSync(path) && statSync(path).isFile();

/**
 * TypeScript's ESM convention is to import the *output* name — `./env.mjs` for a file
 * called `env.mts` — so map those back to source before looking anything up.
 */
const TS_EQUIVALENTS = { ".mjs": ".mts", ".cjs": ".cts", ".js": ".ts", ".jsx": ".tsx" };

/** Adds an extension, or an /index file, when the bare path isn't already a file. */
function withExtension(path) {
  if (isFile(path)) return path;

  for (const [output, source] of Object.entries(TS_EQUIVALENTS)) {
    if (path.endsWith(output)) {
      const candidate = path.slice(0, -output.length) + source;
      if (isFile(candidate)) return candidate;
    }
  }

  for (const ext of EXTENSIONS) {
    if (isFile(path + ext)) return path + ext;
  }
  for (const ext of EXTENSIONS) {
    const indexFile = join(path, `index${ext}`);
    if (isFile(indexFile)) return indexFile;
  }
  return null;
}

/**
 * TypeScript sources must be handed back as "module-typescript" so Node strips types;
 * declaring them plain "module" would feed raw TS to the JS parser. Naming the format at
 * all saves Node from parsing each file twice to guess it (the package has no
 * "type": "module", and adding one would change how Next treats the whole project).
 */
const formatOf = (path) => (/\.(ts|mts|tsx)$/.test(path) ? "module-typescript" : "module");

const found = (path) => ({ url: pathToFileURL(path).href, format: formatOf(path), shortCircuit: true });

export function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) {
    const resolved = withExtension(join(SRC, specifier.slice(2)));
    if (resolved) return found(resolved);
  }

  if (specifier.startsWith(".") && context.parentURL?.startsWith("file:")) {
    const parentDir = dirname(fileURLToPath(context.parentURL));
    const resolved = withExtension(resolvePath(parentDir, specifier));
    if (resolved) return found(resolved);
  }

  return nextResolve(specifier, context);
}
