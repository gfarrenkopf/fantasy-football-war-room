import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // All env access goes through src/lib/config.ts, or scripts/ingest/env.mts, scripts/ai/env.mts
  // and scripts/db/migrate.mts for the CLIs — config.ts imports "server-only" and can't be loaded by a node script.
  {
    ignores: ["src/lib/config.ts", "scripts/ingest/env.mts", "scripts/ai/env.mts", "scripts/db/migrate.mts"],
    rules: {
      "no-restricted-properties": [
        "error",
        {
          object: "process",
          property: "env",
          message: "Import { config } from \"@/lib/config\" instead of reading process.env directly.",
        },
      ],
    },
  },
  // All persistence goes through the stores in src/lib/storage (see getStores()).
  {
    ignores: ["src/lib/storage/**"],
    rules: {
      "no-restricted-globals": [
        "error",
        { name: "localStorage", message: "Use getStores() from \"@/lib/storage\" instead." },
        { name: "sessionStorage", message: "Use getStores() from \"@/lib/storage\" instead." },
      ],
      "no-restricted-syntax": [
        "error",
        {
          selector: "MemberExpression[property.name=/^(localStorage|sessionStorage)$/]",
          message: "Use getStores() from \"@/lib/storage\" instead.",
        },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Frozen single-file prototype, kept for reference only.
    "prototype/**",
  ]),
]);

export default eslintConfig;
