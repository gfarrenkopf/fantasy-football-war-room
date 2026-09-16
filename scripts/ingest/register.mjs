/** Registers the CLI's resolve hook. Used via `node --import ./scripts/ingest/register.mjs`. */
import { registerHooks } from "node:module";
import { resolve } from "./loader.mjs";

registerHooks({ resolve });
