/**
 * Writes the iOS app's design tokens from the web's (APE-370).
 *
 *   npm run ios:tokens
 *
 * Reads src/app/globals.css and DESIGN.md, writes mobile/ios/DraftRoom/Design/Tokens.swift. Run it
 * after changing a web token and commit the result; src/lib/design/iosTokens.test.ts fails in CI
 * when the committed file is stale.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { generateSwiftTokens } from "@/lib/design/iosTokens";

const root = (path: string) => fileURLToPath(new URL(`../${path}`, import.meta.url));
const out = "mobile/ios/DraftRoom/Design/Tokens.swift";

const swift = generateSwiftTokens(
  readFileSync(root("src/app/globals.css"), "utf8"),
  readFileSync(root("DESIGN.md"), "utf8"),
);
writeFileSync(root(out), swift);
console.log(`Wrote ${out}`);
