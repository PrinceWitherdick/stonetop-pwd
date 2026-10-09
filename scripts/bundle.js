/**
 * The release bundle: every ES module the system loads, rolled into `dist/stonetop.js`.
 *
 * Why a release runs from one file. Foundry serves each file with `Cache-Control: no-cache`, so a
 * player's browser asks the server about every one of our ~530 modules on every load, and over
 * HTTP/1.1 it can ask only six at a time. Foundry's own low-priority scripts queue behind them, and
 * the whole boot waits on those. One file is one request.
 *
 * A checkout still runs the unbundled source: `system.json` names `stonetop.js`, and only
 * release.yml points the SHIPPED manifest at the bundle. Day-to-day development needs no build.
 *
 * Three settings here are load-bearing, and tests/build/bundle.test.js holds each one:
 *
 *   keepNames   Foundry builds AppV1 hook names (`renderStonetopLocationPageSheet`) and stored
 *               sheet ids (`flags.core.sheetClass`) out of class names, and bundling renames any
 *               top-level name two modules happen to share. keepNames restores the original `.name`.
 *   splitting   Off. Splitting still left 62 chunks to fetch before the system could start. Without
 *               it, a module reached only through `import()` is still evaluated lazily, on first use.
 *   warnings    Treated as errors, so anything esbuild is unsure about stops a release rather than
 *               shipping in it.
 *
 * The bundle also carries every template precompiled (precompiledTemplatesPlugin below), so a
 * release never fetches or compiles one at runtime; module/utils/templates.js registers them.
 */
import * as esbuild from "esbuild";
import Handlebars from "handlebars";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** The entry a checkout loads, as system.json names it. */
export const BUNDLE_ENTRY = "stonetop.js";

/** The file release.yml points the shipped manifest at. */
export const BUNDLE_OUTFILE = "dist/stonetop.js";

/** The checkout's empty stand-in, whose contents the bundle replaces with every template precompiled. */
export const PRECOMPILED_TEMPLATES_MODULE = "module/utils/precompiled-templates.js";

/**
 * Every templates/**\/*.hbs as a precompiled Handlebars spec, keyed by the path Foundry asks for
 * it by (`systems/<id>/templates/...`). Compiled with the one option core v14's `getTemplate`
 * compiles with, so a precompiled template renders exactly as a fetched one would there. v13's
 * compiles without `preventIndent`, so a template must never rely on it: a partial whose output
 * holds a `<pre>` is called with `{{~> }}` (tests/timeline/timeline-templates.test.js).
 * @returns {Record<string, string>} template path -> the spec's JavaScript source
 */
export function precompileTemplates() {
	const { id } = JSON.parse(fs.readFileSync(path.join(ROOT, "system.json"), "utf8"));
	const specs = {};
	const walk = (dir) => {
		for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
			const rel = `${dir}/${entry.name}`;
			if (entry.isDirectory()) walk(rel);
			else if (entry.name.endsWith(".hbs")) {
				const source = fs.readFileSync(path.join(ROOT, rel), "utf8");
				specs[`systems/${id}/${rel}`] = Handlebars.precompile(source, { preventIndent: true });
			}
		}
	};
	walk("templates");
	return specs;
}

/** Fills the precompiled-templates stand-in at bundle time. */
const precompiledTemplatesPlugin = {
	name: "stonetop-precompiled-templates",
	setup(build) {
		const stub = path.join(ROOT, PRECOMPILED_TEMPLATES_MODULE);
		build.onLoad({ filter: /[\\/]precompiled-templates\.js$/ }, async (args) => {
			if (path.resolve(args.path) !== stub) return undefined;
			const entries = Object.entries(precompileTemplates())
				.map(([key, spec]) => `\t${JSON.stringify(key)}: ${spec},`);
			// Minified on its own: Handlebars repeats the same helper-lookup boilerplate in every
			// block of every template, which comes to nearly four times the templates' own size.
			const { code } = await esbuild.transform(`export default {\n${entries.join("\n")}\n};\n`,
				{ minify: true, format: "esm", target: "esnext", charset: "utf8" });
			return { contents: code, loader: "js" };
		});
	},
};

export const BUNDLE_OPTIONS = Object.freeze({
	absWorkingDir: ROOT,
	entryPoints: [BUNDLE_ENTRY],
	outfile: BUNDLE_OUTFILE,
	bundle: true,
	splitting: false,
	format: "esm",
	platform: "browser",
	// Foundry v13+ runs in current Chromium and Electron, so nothing needs lowering, and nothing
	// lowered is nothing that can behave differently from the source.
	target: "esnext",
	keepNames: true,
	minify: false,
	charset: "utf8",
	// Linked, without the sources inlined: the zip ships module/ beside the bundle, so the map points
	// a browser at the real files rather than carrying a second copy of every one.
	sourcemap: "linked",
	sourcesContent: false,
	metafile: true,
	logLevel: "silent",
	plugins: [precompiledTemplatesPlugin],
});

/**
 * Build the bundle. `write: false` holds the output in memory, which is how the tests build it.
 * @param {{write?: boolean}} [options]
 */
export async function buildBundle({ write = true } = {}) {
	const result = await esbuild.build({ ...BUNDLE_OPTIONS, write });
	if (result.warnings.length) {
		const text = await esbuild.formatMessages(result.warnings, { kind: "warning" });
		throw new Error(`The bundle has ${result.warnings.length} warning(s), and a release treats each one as an error:\n${text.join("\n")}`);
	}
	return result;
}
