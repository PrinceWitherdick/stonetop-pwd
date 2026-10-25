// scripts/gen-template-bare-names.js
// Writes module/utils/template-bare-names.js: every name our templates use bare, which is the list
// the startup check (module/utils/foreign-helper-check.js) holds against the helpers other modules
// register.
//
// Run with: npm run gen:template-names
//
// Rerun after changing a template. tests/templates/foreign-helper-names.test.js fails when the
// templates and the generated list disagree.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { templateBareNames, renderBareNamesModule } from "./lib/template-bare-names.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, "module", "utils", "template-bare-names.js");

const names = templateBareNames(path.join(root, "templates"));
fs.writeFileSync(out, renderBareNamesModule(names), "utf8");
console.log(`Wrote ${path.relative(root, out)}: ${names.length} names.`);
