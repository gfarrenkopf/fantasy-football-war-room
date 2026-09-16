import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
    // Database tests run on in-memory Postgres (PGlite), which is CPU-bound: with several such files in
    // parallel on a small CI runner, a slow one can pass the 5s default without anything being wrong.
    testTimeout: 20_000,
  },
});
