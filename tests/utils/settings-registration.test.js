import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { WEATHER_FX_PARTS } from "../../module/seasons/weather-fx-parts.js";

// Structural guards on module/settings.js. Settings drift quietly: a hint keeps
// describing behaviour that moved, a key outlives the feature it gated, a new
// user-facing toggle ships with an unlocalized name. None of that fails at runtime —
// Foundry happily renders a raw i18n path as a label and happily stores a value nobody
// reads. So the checks live here.
//
// `moduleVersion` is why the dead-key check exists: it was registered, documented as
// "used to detect when migrations need to run", and never once read or written.

const ROOT = path.resolve(__dirname, "../..");
const SETTINGS_SRC = fs.readFileSync(path.join(ROOT, "module/settings.js"), "utf8");
const EN = JSON.parse(fs.readFileSync(path.join(ROOT, "languages/en.json"), "utf8"));

/** Flatten en.json to dotted paths so an i18n key can be looked up directly. */
const I18N = (() => {
	const flat = {};
	(function walk(obj, prefix) {
		for (const [k, v] of Object.entries(obj)) {
			const key = prefix ? `${prefix}.${k}` : k;
			if (v && typeof v === "object" && !Array.isArray(v)) walk(v, key);
			else flat[key] = v;
		}
	})(EN, "");
	return flat;
})();

/**
 * Every `game.settings.register(SYSTEM_ID, "<key>", { … })` block.
 *
 * Matched on the SYSTEM_ID identifier rather than the literal it resolves to: the namespace is
 * imported from system-id.js now, so the string "stonetop-pwd" no longer appears in this file.
 */
function registrations() {
	const out = [];
	const re = /game\.settings\.register\(SYSTEM_ID,\s*"([A-Za-z0-9_]+)",\s*\{/g;
	for (const m of SETTINGS_SRC.matchAll(re)) {
		// Slice to the end of the options object (the first line that closes it at
		// the register call's indentation).
		const from = m.index + m[0].length;
		const end = SETTINGS_SRC.indexOf("\n\t});", from);
		out.push({ key: m[1], body: SETTINGS_SRC.slice(from, end === -1 ? undefined : end) });
	}
	return out;
}

/** The keys generated from HOVER_DESCRIPTION_SETTING_KEYS (registered in a loop). */
function hoverKeys() {
	const block = /HOVER_DESCRIPTION_SETTING_KEYS = \[([\s\S]*?)\n\];/.exec(SETTINGS_SRC);
	expect(block, "HOVER_DESCRIPTION_SETTING_KEYS not found").not.toBeNull();
	return [...block[1].matchAll(/"([A-Za-z0-9_]+)"/g)].map(m => m[1]);
}

/** Repo files that could reference a setting key, excluding settings.js itself. */
function searchCorpus() {
	const out = [];
	const skip = new Set(["node_modules", ".git", "packs"]);
	(function walk(dir) {
		for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
			if (skip.has(entry.name)) continue;
			const full = path.join(dir, entry.name);
			if (entry.isDirectory()) walk(full);
			else if (/\.(js|hbs)$/.test(entry.name)) {
				const rel = path.relative(ROOT, full);
				if (rel.replace(/\\/g, "/") === "module/settings.js") continue;
				out.push(fs.readFileSync(full, "utf8"));
			}
		}
	})(ROOT);
	return out;
}

/** The settings menus' own templates, which localize copy that belongs to a menu, not a key. */
function settingsTemplates() {
	const dir = path.join(ROOT, "templates/settings");
	if (!fs.existsSync(dir)) return [];
	return fs.readdirSync(dir)
		.filter(name => name.endsWith(".hbs"))
		.map(name => fs.readFileSync(path.join(dir, name), "utf8"));
}

const REGISTRATIONS = registrations();
const HOVER_KEYS = hoverKeys();
// The per-effect weather switches, registered in a loop off their own table rather than one
// literal at a time, so the scan above cannot see them: the register call names `part.setting`.
// Imported rather than parsed back out of settings.js, since the table is a plain leaf module.
const WEATHER_FX_KEYS = WEATHER_FX_PARTS.map(part => part.setting);

describe("settings registration", () => {
	it("parses the registrations at all (guards the scan itself)", () => {
		expect(REGISTRATIONS.length).toBeGreaterThan(30);
		expect(HOVER_KEYS.length).toBeGreaterThan(10);
	});

	it("localizes every setting shown in the config menu", () => {
		// A `config: true` setting renders its name/hint straight into Foundry's settings
		// window; an unlocalized one shows the raw "stonetop.settings.x.name" path.
		const bad = [];
		for (const { key, body } of REGISTRATIONS) {
			if (!/config:\s*true/.test(body)) continue;
			for (const field of ["name", "hint"]) {
				const m = new RegExp(`${field}:\\s*"([^"]+)"`).exec(body);
				if (!m) { bad.push(`${key}.${field} is missing`); continue; }
				if (!m[1].startsWith("stonetop.settings.")) bad.push(`${key}.${field} is a bare string, not an i18n key`);
				else if (!(m[1] in I18N)) bad.push(`${key}.${field} -> ${m[1]} (no such key in en.json)`);
			}
		}
		expect(bad, `Config-visible settings with missing/unlocalized labels:\n  ${bad.join("\n  ")}`).toEqual([]);
	});

	it("localizes every hover-description toggle", () => {
		// These are config:false but rendered by the "On Hover Info" menu, which
		// localizes them by convention rather than from the registration.
		const bad = [];
		for (const key of HOVER_KEYS) {
			for (const field of ["name", "hint"]) {
				const i18nKey = `stonetop.settings.${key}.${field}`;
				if (!(i18nKey in I18N)) bad.push(i18nKey);
			}
		}
		expect(bad, `Hover toggles missing en.json entries:\n  ${bad.join("\n  ")}`).toEqual([]);
	});

	it("localizes every weather-effect switch", () => {
		// Same situation as the hover toggles: registered in a loop, so their names and hints are
		// built from the key and there is no literal in settings.js for the scan to find.
		const bad = [];
		for (const key of WEATHER_FX_KEYS) {
			for (const field of ["name", "hint"]) {
				const i18nKey = `stonetop.settings.${key}.${field}`;
				if (!(i18nKey in I18N)) bad.push(i18nKey);
			}
		}
		expect(bad, `Weather-effect switches missing en.json entries:\n  ${bad.join("\n  ")}`).toEqual([]);
	});

	it("has no orphaned stonetop.settings.* strings in en.json", () => {
		const declared = new Set();
		for (const m of SETTINGS_SRC.matchAll(/"(stonetop\.settings\.[A-Za-z0-9_.]+)"/g)) declared.add(m[1]);
		// A settings MENU renders its own template, and copy that belongs to the menu rather than
		// to any one key (a note above the rows, the labels on a tristate select) is localized
		// there and named nowhere else. Those are references too, and a scan that could not see
		// them would report every one as an orphan and push it into being a bare string.
		for (const src of settingsTemplates()) {
			for (const m of src.matchAll(/"(stonetop\.settings\.[A-Za-z0-9_.]+)"/g)) declared.add(m[1]);
		}
		for (const key of [...HOVER_KEYS, ...WEATHER_FX_KEYS]) {
			declared.add(`stonetop.settings.${key}.name`);
			declared.add(`stonetop.settings.${key}.hint`);
		}
		const orphans = Object.keys(I18N)
			.filter(k => k.startsWith("stonetop.settings.") && !declared.has(k));
		expect(orphans, `en.json strings no setting references:\n  ${orphans.join("\n  ")}`).toEqual([]);
	});

	it("has no registered setting that nothing reads", () => {
		// A setting only "behaves as described" if something consults it. Anything
		// deliberately kept for backward compatibility belongs in KEPT below, with the
		// reason, so the exemption is a decision rather than an oversight.
		//
		// Currently empty, and worth keeping that way. The one entry it held —
		// `peopleCropRebuildOffered` — was exempted on the grounds that a world still
		// holding the value needed it registered to read without throwing. Nothing read it,
		// so it is now simply unregistered (Foundry ignores a stored value whose key it does
		// not know); settings.js names the retired key in a comment so it is not reused.
		const KEPT = new Set([]);
		const corpus = searchCorpus();
		// settings.js's own exported accessors (getSheetSize, getCrewSectionsOpen,
		// …) name their key rather than going through getSetting, so the accessor region —
		// everything after registerSettings() closes — counts as a reference too.
		const accessorRegion = SETTINGS_SRC.slice(SETTINGS_SRC.indexOf("export const HOVER_DESCRIPTION_SETTING_KEYS"));
		expect(accessorRegion, "accessor region not found — did settings.js reorganize?").not.toBe("");
		const unused = [];
		for (const { key } of REGISTRATIONS) {
			if (KEPT.has(key)) continue;
			const referenced = corpus.some(src => src.includes(`"${key}"`)) || accessorRegion.includes(`"${key}"`);
			if (!referenced) unused.push(key);
		}
		expect(unused, `Registered settings nothing reads:\n  ${unused.join("\n  ")}`).toEqual([]);
	});
});

// Every settings SUBMENU is a Stonetop window, and our chrome — the header bar, the content
// background, the focus glow, `--stonetop-font-scale` — is scoped to the `stonetop` class on
// purpose. `FormApplication` contributes only `["form"]`, and nothing adds ours at runtime: the
// system's one `classList.add("stonetop")` is for actor sheets. So a menu that omits it opens in
// core's dark chrome while its OWN form rules still apply, which reads as half-styled rather than
// unstyled and is easy to ship without noticing. Read out of the source because there is no
// FormApplication here to instantiate.
describe("settings menu windows", () => {
	it("dresses every settings submenu as one of ours", () => {
		const start = SETTINGS_SRC.indexOf("function _createSettingsMenuApp(");
		expect(start, "_createSettingsMenuApp not found — did settings.js reorganize?").toBeGreaterThan(-1);
		const body = SETTINGS_SRC.slice(start, SETTINGS_SRC.indexOf("\n}", start));
		// The whole DECLARATION line, not a bracket scan: the value contains its own `[]` in the
		// spread default, and a scan that stopped at the first `]` read only as far as that.
		const classes = /^\s*classes:.*$/m.exec(body);
		expect(classes, "the shared settings-menu app declares no classes").not.toBeNull();
		expect(classes[0]).toContain('"stonetop"');
		// And core's own class survives: mergeObject REPLACES an array where it merges an object,
		// so listing the two names out rather than spreading would drop `form` silently.
		expect(classes[0]).toContain("base.classes");
	});

	// A settings window minted WITHOUT going through the shared factory would miss the class
	// again, which is the whole failure this guards.
	it("mints every settings window through that one factory", () => {
		const extended = [...SETTINGS_SRC.matchAll(/class\s+\w+\s+extends\s+FormApplication/g)];
		expect(extended.length, "a settings window sidesteps _createSettingsMenuApp").toBe(1);
	});
});

// The sheet-font maps. applySheetFont resolves ONE key and reads both of them with it, so a face
// present in one and missing from the other silently sets `--st-caps-nudge: undefined` — which
// does not throw, does not log, and surfaces only as uppercase pills sitting high on that one
// font. A near-miss of exactly that shape already shipped: the nudge was a single constant in the
// stylesheet, tuned against a face that is not the default, so it was wrong for everybody who had
// not changed the setting.
describe("sheet font maps", () => {
	/** Keys of an object literal declared as `const <name> = { … }` in settings.js. */
	function literalKeys(name) {
		const start = SETTINGS_SRC.indexOf(`const ${name} = {`);
		expect(start, `${name} not found in settings.js`).toBeGreaterThan(-1);
		const body = SETTINGS_SRC.slice(start, SETTINGS_SRC.indexOf("};", start));
		return [...body.matchAll(/^\s*"([^"]+)":/gm)].map(m => m[1]).sort();
	}

	it("gives every sheet font a caps nudge, and every nudge a font", () => {
		expect(literalKeys("_FONT_CAPS_NUDGE")).toEqual(literalKeys("_FONT_MAP"));
	});

	// The stylesheet's fallback is what a client paints with before applySheetFont runs, and what
	// it keeps for good if that never happens. It has to agree with the default face's entry, or
	// every capitalised pill shifts the moment the setting lands.
	it("matches the stylesheet fallback to the default font's nudge", () => {
		const dflt = SETTINGS_SRC.match(/const _DEFAULT_FONT = "([^"]+)"/)?.[1];
		expect(dflt, "_DEFAULT_FONT not found in settings.js").toBeTruthy();

		const nudgeStart = SETTINGS_SRC.indexOf("const _FONT_CAPS_NUDGE = {");
		const nudgeBody  = SETTINGS_SRC.slice(nudgeStart, SETTINGS_SRC.indexOf("};", nudgeStart));
		const nudge = nudgeBody.match(new RegExp(`"${dflt}":\\s*"([^"]+)"`))?.[1];
		expect(nudge, `no _FONT_CAPS_NUDGE entry for the default font "${dflt}"`).toBeTruthy();

		const css = fs.readFileSync(path.join(ROOT, "styles/stonetop.css"), "utf8");
		const fallback = css.match(/--st-caps-nudge:\s*([^;]+);/)?.[1]?.trim();
		expect(fallback, "--st-caps-nudge is not declared in stonetop.css").toBeTruthy();
		expect(fallback).toBe(nudge);
	});
});
