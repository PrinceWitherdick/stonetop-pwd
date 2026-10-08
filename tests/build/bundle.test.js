import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { BUNDLE_ENTRY, BUNDLE_OPTIONS, BUNDLE_OUTFILE, PRECOMPILED_TEMPLATES_MODULE, ROOT, buildBundle, precompileTemplates } from "../../scripts/bundle.js";
import { RELMAP_WINDOW_CLASS } from "../../module/utils/window-restore.js";

/**
 * A release runs from one bundled file (scripts/bundle.js); a checkout runs the unbundled source.
 * Nothing else looks at the bundle before a player's browser loads it, so every property a release
 * depends on is asserted here, against a real build held in memory.
 */

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");

function listJs(dir) {
	return fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((entry) => {
		const rel = `${dir}/${entry.name}`;
		if (entry.isDirectory()) return listJs(rel);
		return entry.name.endsWith(".js") ? [rel] : [];
	});
}

/** A workflow file with its comment lines removed, so prose cannot satisfy an assertion. */
const codeLines = (text) => text.split("\n").filter((l) => !/^\s*(#|\/\/)/.test(l)).join("\n");

/** One named step of a workflow, up to the next step at the same indent, comments removed. */
function step(yml, name) {
	const from = yml.indexOf(`- name: ${name}`);
	expect(from, `no step named "${name}"`).toBeGreaterThan(-1);
	const next = yml.indexOf("\n      - ", from);
	return codeLines(yml.slice(from, next === -1 ? undefined : next));
}

let result;
let code;
let map;

beforeAll(async () => {
	result = await buildBundle({ write: false });
	const output = (rel) => result.outputFiles.find((f) => path.relative(ROOT, f.path).replace(/\\/g, "/") === rel);
	code = output(BUNDLE_OUTFILE).text;
	map = JSON.parse(output(`${BUNDLE_OUTFILE}.map`).text);
}, 60_000);

describe("the release bundle", () => {
	it("builds with no errors and no warnings", () => {
		// buildBundle throws on a warning, so reaching this line is most of the assertion.
		expect(result.errors).toEqual([]);
		expect(result.warnings).toEqual([]);
	});

	it("is one self-contained file, so the system starts on one request", () => {
		const js = Object.keys(result.metafile.outputs).filter((f) => f.endsWith(".js"));
		expect(js).toEqual([BUNDLE_OUTFILE]);
		// Nothing left to fetch: no static import, and no import() of a file outside the bundle.
		expect(result.metafile.outputs[BUNDLE_OUTFILE].imports).toEqual([]);
		expect(BUNDLE_OPTIONS.splitting).toBe(false);
	});

	it("keeps the class names Foundry keys hooks and stored sheet ids by", () => {
		expect(BUNDLE_OPTIONS.keepNames).toBe(true);

		const sources = [BUNDLE_ENTRY, ...listJs("module")].map(read).join("\n");
		const declared = new Set([...sources.matchAll(/\bclass ([A-Z]\w*)/g)].map((m) => m[1]));
		const registered = [...read(BUNDLE_ENTRY).matchAll(/registerSheet\(\s*(?:\w+,\s*)?SYSTEM_ID,\s*([A-Z]\w*)/g)]
			.map((m) => m[1])
			.filter((name) => declared.has(name));
		const names = [...new Set([...registered, RELMAP_WINDOW_CLASS])];
		expect(names.length).toBeGreaterThan(4);

		for (const name of names) {
			// Declared under its own name, or renamed by the bundler and handed its name back by keepNames.
			expect(code, name).toMatch(new RegExp(`\\bclass ${name}\\b|"${name}"\\)`));
		}
	});

	it("carries every template precompiled, so a release never fetches or compiles one", () => {
		const keys = Object.keys(precompileTemplates());
		expect(keys.length).toBeGreaterThan(150);
		const id = JSON.parse(read("system.json")).id;
		for (const key of keys) {
			expect(key.startsWith(`systems/${id}/templates/`), key).toBe(true);
			expect(code, key).toContain(JSON.stringify(key));
		}
		// A checkout keeps compiling live: only the bundle's copy of the stand-in is filled.
		expect(read(PRECOMPILED_TEMPLATES_MODULE)).toContain("export default null");
	});

	it("maps back to the module files a release ships beside it", () => {
		const dist = path.dirname(path.join(ROOT, BUNDLE_OUTFILE));
		expect(map.sources.length).toBeGreaterThan(400);
		for (const src of map.sources) {
			// Relative, so it resolves on any host rather than naming the build machine's disk.
			expect(src, src).not.toMatch(/^[a-z][a-z0-9+.-]*:/i);
			const file = path.resolve(dist, src);
			expect(path.relative(ROOT, file).startsWith(".."), src).toBe(false);
			expect(fs.existsSync(file), src).toBe(true);
		}
		expect(code.trimEnd().endsWith(`//# sourceMappingURL=${path.basename(BUNDLE_OUTFILE)}.map`)).toBe(true);
	});
});

describe("where a checkout and a release load the system from", () => {
	it("a checkout runs the unbundled source, with no build step", () => {
		// Failing after trying the bundle locally? Put system.json back before committing.
		expect(JSON.parse(read("system.json")).esmodules).toEqual([BUNDLE_ENTRY]);
	});

	it("npm run build is what writes the bundle", () => {
		expect(JSON.parse(read("package.json")).scripts.build).toBe("node scripts/build.js");
	});

	it("CI builds it, so a module the bundler cannot resolve fails the push rather than the release", () => {
		expect(codeLines(read(".github/workflows/ci.yml"))).toContain("npm run build");
	});

	it("release.yml builds it, points the shipped manifest at it, and ships it", () => {
		const yml = read(".github/workflows/release.yml");
		const build = yml.indexOf("- run: npm run build");
		expect(build).toBeGreaterThan(-1);
		expect(build).toBeLessThan(yml.indexOf("- name: Create zip"));

		expect(step(yml, "Patch manifest")).toContain(`m.esmodules = ['${BUNDLE_OUTFILE}']`);

		// dist/ is the code. stonetop.js and module/ still ship: the source map points at them, and the
		// Import Book Art macro falls back to importing three modules by path.
		const zip = step(yml, "Create zip");
		for (const part of [" dist/", " stonetop.js ", " module/"]) expect(zip).toContain(part);

		expect(step(yml, "Verify the checkout before it is zipped")).toContain("m.esmodules");
		expect(step(yml, "Verify the zip that will ship")).toContain("m.esmodules");
	});
});
