import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readRepo as read, readCss, repoFileExists, declarations, stripComments } from "../../fakes/css.js";
import {
	GM_ONLY_KEYS, PREFERENCE_GROUPS, PREFERENCE_KEYS, buildPreferenceGroups, formatRange, openPreferenceMenu, setPreference,
} from "../../../module/utils/sheet-preferences.js";
import { showsPreferencesTab } from "../../../module/utils/preferences-tab.js";

// The character sheet's Preferences tab: this PLAYER's client settings, surfaced where they read
// their character. See module/utils/sheet-preferences.js and tab-preferences.hbs.
//
// Two halves, guarding two different kinds of failure.
//
// The WIRING half asserts on source text, the way the GM Toolkit's tab tests do, because every
// leg of adding a tab fails SILENTLY: an unregistered partial renders nothing, a nav entry with no
// panel is a button that blanks the sheet, a `data-tab` with no icon row paints a solid block
// where the glyph should be, and a tab left out of the padding rule renders flush against the
// frame. None of it throws and none of it fails a test that is not this one.
//
// The BEHAVIOUR half exercises the descriptor module, because the ways THIS feature goes wrong are
// quiet too: a key that stops being registered simply stops drawing its row, a world-scoped key
// added to the list would be refused on a player's client and applied for everyone on the GM's,
// and a Number setting written back as the string the DOM handed over survives the round trip and
// arrives at its `onChange` as one.

const CSS          = readCss();
const STONETOP_JS  = read("stonetop.js");
const SHEET_HBS    = read("templates/actor/character.hbs");
const TAB_HBS      = read("templates/actor/partials/tab-preferences.hbs");
const SETTINGS_JS  = read("module/settings.js");
const SHEET_JS     = read("module/actors/character/StonetopCharacterSheet.js");
const EN           = JSON.parse(read("languages/en.json"));

/** The options object of every `game.settings.register(SYSTEM_ID, "<key>", { … })`, by key. */
const REGISTRATIONS = (() => {
	const out = new Map();
	const re = /game\.settings\.register\(SYSTEM_ID,\s*"([A-Za-z0-9_]+)",\s*\{/g;
	for (const m of SETTINGS_JS.matchAll(re)) {
		const from = m.index + m[0].length;
		const end  = SETTINGS_JS.indexOf("\n\t});", from);
		out.set(m[1], SETTINGS_JS.slice(from, end === -1 ? undefined : end));
	}
	return out;
})();

const ALL_KEYS = PREFERENCE_GROUPS.flatMap(g => g.keys);

// ── Wiring ────────────────────────────────────────────────────────────────────────────────

describe("Preferences tab wiring", () => {
	it("registers the panel as a loadTemplates partial", () => {
		expect(STONETOP_JS).toContain(
			'"stonetop.tab-preferences":     "systems/stonetop-pwd/templates/actor/partials/tab-preferences.hbs"');
		expect(repoFileExists("templates/actor/partials/tab-preferences.hbs")).toBe(true);
	});

	it("has both a nav entry and a panel, and they name the same tab", () => {
		expect(SHEET_HBS).toContain('{{> "stonetop.tab-nav-item" tab="preferences"');
		expect(SHEET_HBS).toContain('{{> "stonetop.tab-preferences"}}');
		expect(TAB_HBS).toContain('data-tab="preferences"');
	});

	// BOTH halves take the same gate. A nav entry left ungated is a rail button that opens an
	// empty tab; a panel left ungated is the whole tab still on the sheet with no way to reach
	// it but a saved rail order — which is a state a GM's sheet can genuinely be in.
	it("gates the nav entry and the panel on the same flag", () => {
		expect(SHEET_HBS).toContain('{{#if stonetop.showPreferences}}{{> "stonetop.tab-preferences"}}{{/if}}');
		expect(SHEET_HBS).toMatch(
			/\{\{#if stonetop\.showPreferences\}\}\{\{> "stonetop\.tab-nav-item" tab="preferences"[^}]*\}\}\{\{\/if\}\}/);
		// And the flag is the shared rule, not a second answer written here.
		expect(SHEET_JS).toContain("context.stonetop.showPreferences = showsPreferencesTab(this.actor);");
	});

	// LAST in the template is what puts it at the foot of the modern rail and the right-hand end
	// of the classic strip — and, because _mergeTabOrder keeps an unplaced tab in its template
	// position relative to the tabs around it, at the foot of a rail a player has already dragged.
	it("is the last entry in the nav and the last panel in the body", () => {
		const navKeys = [...SHEET_HBS.matchAll(/tab-nav-item" tab="([\w-]+)"/g)].map(m => m[1]);
		expect(navKeys.at(-1)).toBe("preferences");

		const panels = [...SHEET_HBS.matchAll(/\{\{> "stonetop\.tab-([\w-]+)"\}\}/g)].map(m => m[1]);
		expect(panels.at(-1)).toBe("preferences");
	});

	it("gives the rail a glyph of its own, and ships the file", () => {
		const rule = /\.stonetop-tab-rail \.item\[data-tab="preferences"\]\s*\{\s*--st-tab-icon:\s*url\('([^']+)'\)/
			.exec(CSS);
		expect(rule, "no rail icon row for the preferences tab").not.toBeNull();
		expect(repoFileExists(rule[1].replace("/systems/stonetop-pwd/", ""))).toBe(true);
	});

	// A rail glyph is worn as a MASK tinted by background-color, so the file must carry alpha
	// ONLY where the glyph is. game-icons.net stores several of its drawings inverted — an opaque
	// square under a white glyph — and one of those used as a mask resolves to a solid slab.
	it("has the icon's backing square punched transparent", () => {
		const svg = read("assets/icons/tabs/settings-knobs.svg");
		expect(svg).toContain('<path d="M0 0h512v512H0z" fill="#ffffff" fill-opacity="0"/>');
	});

	it("takes the shared tab gutter in both layouts", () => {
		const modern = declarations(CSS,
			".pbta.sheet.actor.character :is(.tab.moves, .tab.equipment, .tab.arcana, .tab.details,\n" +
			"\t.tab.followers, .tab.stonetop-invocations, .tab.post-death, .tab.stonetop-special-moves,\n" +
			"\t.tab.preferences)");
		expect(modern, "preferences is not in the modern padding rule").not.toBeNull();
		expect(modern).toContain("padding");

		expect(CSS).toContain(".tab.stonetop-special-moves, .tab.preferences),");
	});

	it("names the tab in en.json", () => {
		expect(EN.stonetop.sheet.tabs.preferences).toBeTruthy();
		for (const key of ["intro", "openSettings", ...PREFERENCE_GROUPS.map(g => g.id)]) {
			expect(EN.stonetop.sheet.preferences[key], `missing sheet.preferences.${key}`).toBeTruthy();
		}
	});

	it("localizes every group title it declares", () => {
		const flat = {};
		(function walk(obj, prefix) {
			for (const [k, v] of Object.entries(obj)) {
				const key = prefix ? `${prefix}.${k}` : k;
				if (v && typeof v === "object" && !Array.isArray(v)) walk(v, key);
				else flat[key] = v;
			}
		})(EN, "");
		for (const group of PREFERENCE_GROUPS) {
			expect(flat[group.titleKey], `unlocalized group title ${group.titleKey}`).toBeTruthy();
		}
	});

	// A named input inside an actor sheet's form rides along into `_updateObject` as a stray
	// top-level key. Every control on this tab writes a client setting instead, so none of them
	// has any business in the form's submit data — and none of them needs a name, because only
	// radios group by it.
	it("gives no control on the tab a name attribute", () => {
		const body = stripComments(TAB_HBS);
		expect(body).not.toMatch(/<(input|select|textarea)[^>]*\sname=/);
	});

	// The wiring sits ABOVE activateListeners' isEditable guard, with the fold carets: nothing on
	// this tab is actor data, so a player reading a locked sheet still owns their own font size.
	it("wires the tab before the isEditable guard", () => {
		// Measured inside activateListeners, from its own indentation. `isEditable` is guarded on
		// in a dozen nested handlers elsewhere in this file, and the first one of those is nowhere
		// near the early return this is about.
		const body  = SHEET_JS.slice(SHEET_JS.indexOf("\t\tactivateListeners(html) {"));
		const wired = body.indexOf("\t\t\tthis._wirePreferences(html);");
		const guard = body.indexOf("\n\t\t\tif (!this.isEditable) return;");
		expect(wired).toBeGreaterThan(-1);
		expect(guard).toBeGreaterThan(-1);
		expect(wired).toBeLessThan(guard);
	});
});

// ── The keys the tab offers ───────────────────────────────────────────────────────────────

describe("Preferences tab contents", () => {
	it("offers only keys module/settings.js actually registers", () => {
		const missing = ALL_KEYS.filter(key => !REGISTRATIONS.has(key));
		expect(missing, `listed on the tab but never registered: ${missing.join(", ")}`).toEqual([]);
	});

	// The whole tab is per-PERSON. A world-scoped key here would be refused by Foundry on a
	// player's client (and silently applied for the whole table on the GM's), so the tab would
	// show a control that works for one person at the table and lies to everyone else.
	it("offers only client-scoped settings", () => {
		const wrong = ALL_KEYS.filter(key => !/scope:\s*"client"/.test(REGISTRATIONS.get(key) ?? ""));
		expect(wrong, `not client-scoped: ${wrong.join(", ")}`).toEqual([]);
	});

	it("lists no key twice, in a group or across them", () => {
		expect(ALL_KEYS.length).toBe(new Set(ALL_KEYS).size);
		expect(PREFERENCE_KEYS.size).toBe(ALL_KEYS.length);
	});

	it("names each group's keys as quoted literals, so the dead-key scan can see them", () => {
		// tests/utils/settings-registration.test.js proves every registered key is READ somewhere
		// by searching the source for the quoted key. A key this file assembled at runtime would
		// be invisible to that scan and its setting would fail the build as dead.
		const src = read("module/utils/sheet-preferences.js");
		for (const key of ALL_KEYS) expect(src).toContain(`"${key}"`);
	});
});

// ── Building and writing ──────────────────────────────────────────────────────────────────

const SYSTEM_ID = "stonetop-pwd";

/** A `game` with just the settings registry the module reads. */
function fakeGame(registrations, { menus = [], throwOnGet = null, isGM = true } = {}) {
	const registry = new Map();
	const values   = new Map();
	for (const [key, cfg] of Object.entries(registrations)) {
		registry.set(`${SYSTEM_ID}.${key}`, cfg);
		values.set(`${SYSTEM_ID}.${key}`, cfg.value === undefined ? cfg.default : cfg.value);
	}
	const menuMap = new Map(menus.map(m => [`${SYSTEM_ID}.${m.id}`, m]));
	return {
		i18n: { localize: k => (typeof k === "string" ? k.replace(/^i18n:/, "") : k) },
		user: { isGM },
		settings: {
			settings: registry,
			menus: menuMap,
			get: vi.fn((ns, key) => {
				if (throwOnGet === key) throw new Error("not readable yet");
				return values.get(`${ns}.${key}`);
			}),
			set: vi.fn(async (ns, key, value) => { values.set(`${ns}.${key}`, value); }),
		},
		_values: values,
	};
}

let savedGame;
beforeEach(() => { savedGame = globalThis.game; });
afterEach(() => {
	if (savedGame === undefined) delete globalThis.game;
	else globalThis.game = savedGame;
});

describe("buildPreferenceGroups", () => {
	it("returns nothing at all when the settings registry is not up yet", () => {
		globalThis.game = {};
		expect(buildPreferenceGroups()).toEqual([]);
	});

	it("shapes each row from its registration: choices, range, or checkbox", () => {
		globalThis.game = fakeGame({
			sheetFont: { name: "Font", hint: "h", type: String, default: "libre-caslon",
				choices: { "libre-caslon": "Libre Caslon", "signika": "Signika" }, value: "signika" },
			sheetFontScale: { name: "Size", type: Number, default: 1,
				range: { min: 0.9, max: 1.4, step: 0.05 }, value: 1.25 },
			editPencilRevealDelay: { name: "Delay", type: Number, default: 1,
				range: { min: 0, max: 3, step: 0.1 }, value: 1.5 },
			reduceMotion: { name: "Motion", type: Boolean, default: false, value: true },
		});
		const rows = new Map(buildPreferenceGroups().flatMap(g => g.rows).map(r => [r.key, r]));

		const font = rows.get("sheetFont");
		expect(font.isChoice).toBe(true);
		expect(font.choices.find(c => c.value === "signika").selected).toBe(true);
		expect(font.choices.find(c => c.value === "libre-caslon").selected).toBe(false);

		// Font size is a slider, not a dropdown: it is the one a reader adjusts by feel.
		const scale = rows.get("sheetFontScale");
		expect(scale.isRange).toBe(true);
		expect({ min: scale.min, max: scale.max, step: scale.step })
			.toEqual({ min: 0.9, max: 1.4, step: 0.05 });
		expect(scale.value).toBe(1.25);
		expect(scale.display).toBe("1.25");

		const delay = rows.get("editPencilRevealDelay");
		expect(delay.isRange).toBe(true);
		expect({ min: delay.min, max: delay.max, step: delay.step }).toEqual({ min: 0, max: 3, step: 0.1 });
		expect(delay.value).toBe(1.5);
		expect(delay.display).toBe("1.5");

		expect(rows.get("reduceMotion").isCheck).toBe(true);
		expect(rows.get("reduceMotion").checked).toBe(true);
	});

	// A choice list keys its options by their stored value, and those keys are strings even when
	// the setting's own type is not. Comparing a number to a string never matches, which shows as
	// a select that opens with nothing chosen.
	it("matches the chosen option across the string/number divide", () => {
		globalThis.game = fakeGame({
			sheetFontScale: { name: "Size", type: Number, default: 1,
				choices: { "1": "Normal", "1.25": "Larger" }, value: 1.25 },
		});
		const [row] = buildPreferenceGroups().flatMap(g => g.rows);
		expect(row.choices.filter(c => c.selected).map(c => c.value)).toEqual(["1.25"]);
	});

	it("drops a row whose key is not registered rather than the whole tab", () => {
		globalThis.game = fakeGame({ reduceMotion: { name: "Motion", type: Boolean, default: false } });
		const rows = buildPreferenceGroups().flatMap(g => g.rows);
		expect(rows.map(r => r.key)).toEqual(["reduceMotion"]);
	});

	it("falls back to the default when the value cannot be read", () => {
		globalThis.game = fakeGame(
			{ reduceMotion: { name: "Motion", type: Boolean, default: true } },
			{ throwOnGet: "reduceMotion" });
		const [row] = buildPreferenceGroups().flatMap(g => g.rows);
		expect(row.checked).toBe(true);
	});

	it("gives each group a fold id nothing else on the sheet would answer to", () => {
		globalThis.game = fakeGame(Object.fromEntries(
			ALL_KEYS.map(key => [key, { name: key, type: Boolean, default: false }])));
		const groups = buildPreferenceGroups();
		expect(groups.map(g => g.collapse)).toEqual(PREFERENCE_GROUPS.map(g => `preferences-${g.id}`));
	});

	it("keeps a group that has only a submenu, and drops one with nothing at all", () => {
		globalThis.game = fakeGame({}, { menus: [{ id: "hoverDescriptionSettings", label: "Configure" }] });
		const groups = buildPreferenceGroups();
		expect(groups.map(g => g.id)).toEqual(["hover"]);
		expect(groups[0].menu).toEqual({ id: "hoverDescriptionSettings", label: "Configure", hint: "" });
	});
});

// "Open Sheets in Edit Mode" picks which mode EVERY actor sheet opens in, which is a GM's habit:
// they open other people's sheets, the steading, monsters and NPCs all session. A player opens
// their own character, and the header wrench already flips it.
describe("the GM-only rows", () => {
	const allRegistered = () => Object.fromEntries(
		ALL_KEYS.map(key => [key, { name: key, type: Boolean, default: false }]));

	it("names only keys the tab actually offers", () => {
		for (const key of GM_ONLY_KEYS) expect(PREFERENCE_KEYS.has(key)).toBe(true);
	});

	it("draws them for a GM", () => {
		globalThis.game = fakeGame(allRegistered(), { isGM: true });
		const drawn = buildPreferenceGroups().flatMap(g => g.rows.map(r => r.key));
		expect(drawn).toEqual(ALL_KEYS);
	});

	it("leaves them out for a player, and leaves the rest of the group standing", () => {
		globalThis.game = fakeGame(allRegistered(), { isGM: false });
		const groups = buildPreferenceGroups();
		const drawn  = groups.flatMap(g => g.rows.map(r => r.key));

		expect(drawn).toEqual(ALL_KEYS.filter(key => !GM_ONLY_KEYS.has(key)));
		expect(drawn).not.toContain("openSheetsInEditMode");
		// Windows loses one of its two rows, not the heading over the other.
		expect(groups.find(g => g.id === "windows").rows.map(r => r.key)).toEqual(["restoreWindowsOnReload"]);
	});

	// The change handler takes its key from a `data-pref` attribute, so a hidden control that
	// was still WRITABLE would be one hand-edited attribute from being set anyway.
	it("refuses the write as well as the row", async () => {
		globalThis.game = fakeGame(
			{ openSheetsInEditMode: { name: "Edit mode", type: Boolean, default: false } },
			{ isGM: false });
		expect(await setPreference("openSheetsInEditMode", true)).toBe(false);
		expect(globalThis.game.settings.set).not.toHaveBeenCalled();

		globalThis.game = fakeGame(
			{ openSheetsInEditMode: { name: "Edit mode", type: Boolean, default: false } },
			{ isGM: true });
		expect(await setPreference("openSheetsInEditMode", true)).toBe(true);
	});
});

// Sheet Contrast and Paper Texture are SEPARATE SETTINGS, and this is the block that proves they
// stayed that way.
//
// They were not. The contrast palette took the grain off as part of repainting the page, from a
// later rule than the grain's own setting, so "Paper Texture" ticked under High Contrast was a
// switch that saved, reported success and changed nothing on screen. The answer here used to be
// to draw that row disabled with a sentence explaining the override, and it was the wrong answer:
// a reader who wants the parchment AND the darker greys was being told to pick one. The palette
// was uncoupled from the grain instead (2026-08-28, at the user's request), and everything below
// guards the uncoupling rather than the explanation that used to stand in for it.
describe("Sheet Contrast and Paper Texture, kept separate", () => {
	const withContrast = (contrast, texture = true) => fakeGame({
		sheetContrast: { name: "Contrast", type: String, default: "normal",
			choices: { normal: "Normal", high: "High" }, value: contrast },
		sheetTexture: { name: "Paper Texture", hint: "The grain.", type: Boolean,
			default: true, value: texture },
	});

	const textureRow = () => buildPreferenceGroups()
		.flatMap(g => g.rows).find(r => r.key === "sheetTexture");

	// The regression this exists for, stated the way a player would: turning contrast up must not
	// reach across and switch the paper off.
	it("leaves Paper Texture live and checked at High contrast", () => {
		globalThis.game = withContrast("high", true);
		const row = textureRow();
		expect(row.disabled, "the row is drawn dead by another row again").toBeFalsy();
		expect(row.disabledNote, "a row is explaining an override again").toBeFalsy();
		expect(row.isCheck).toBe(true);
		expect(row.checked, "the row stopped showing its own value").toBe(true);
		expect(row.hint).toBeTruthy();
	});

	it("leaves it alone at Normal contrast too", () => {
		globalThis.game = withContrast("normal", true);
		const row = textureRow();
		expect(row.disabled).toBeFalsy();
		expect(row.checked).toBe(true);
	});

	it("keeps the grain OFF at High contrast if that is what the reader stored", () => {
		globalThis.game = withContrast("high", false);
		expect(textureRow().checked).toBe(false);
	});

	it("still allows the write at either contrast", async () => {
		globalThis.game = withContrast("high");
		expect(await setPreference("sheetTexture", false)).toBe(true);
	});

	// The palette is tokens on the document root, so every open window repaints itself. The
	// re-render that used to ride along was there to redraw the disabled row, and with no row to
	// redraw it was rebuilding every open sheet to produce identical markup.
	it("does not rebuild every open sheet when contrast changes", () => {
		const body = REGISTRATIONS.get("sheetContrast");
		expect(body, "sheetContrast is not registered").toBeTruthy();
		expect(body).toContain("applySheetContrast(value)");
		expect(body, "contrast re-renders sheets for a row that is no longer drawn")
			.not.toContain("_rerenderActorSheets()");
	});

	// The machinery, gone rather than kept empty: a `disabled` attribute the context can never set
	// and a note it can never fill are a standing invitation to couple two settings again.
	it("keeps the disabling machinery out of the template", () => {
		const body = stripComments(TAB_HBS);
		expect(body, "a control can be drawn disabled again").not.toContain("{{#if disabled}}");
		expect(body, "a row can explain an override again").not.toContain("{{#if disabledNote}}");
		expect(body, "the hint is gone from the rows").toContain("{{#if hint}}<p class=\"notes\">");
	});

	it("keeps it out of the context builder and the strings", () => {
		expect(stripComments(read("module/utils/sheet-preferences.js")), "the suppression table is back")
			.not.toMatch(/SUPPRESSED_BY|disabledNote/);
		expect(EN.stonetop.sheet.preferences.suppressedByContrast,
			"the override sentence is back in the language file").toBeUndefined();
	});

	// The other half of the uncoupling, in the stylesheet: the contrast palette must not name the
	// grain tokens. Only the "Paper Texture" block is allowed to take the paper off.
	it("keeps the grain out of the contrast palette", () => {
		const palette = declarations(CSS, ":root.stonetop-high-contrast");
		expect(palette, "the high-contrast palette is gone or renamed").toBeTruthy();
		expect(palette, "the palette takes the grain off again")
			.not.toMatch(/--stonetop-bg-texture|--st-inverted-paper/);
		const flat = declarations(CSS, ":root.stonetop-no-texture");
		expect(flat, "the no-texture block is gone or renamed").toBeTruthy();
		expect(flat, "the grain switch stopped taking the grain off")
			.toMatch(/--stonetop-bg-texture:\s*none/);
	});
});

describe("setPreference", () => {
	it("refuses a key the tab does not offer", async () => {
		globalThis.game = fakeGame({ classicLayoutCharacter: { name: "World", type: Boolean, default: false } });
		expect(await setPreference("classicLayoutCharacter", true)).toBe(false);
		expect(globalThis.game.settings.set).not.toHaveBeenCalled();
	});

	it("refuses a listed key that is not registered on this client", async () => {
		globalThis.game = fakeGame({});
		expect(await setPreference("reduceMotion", true)).toBe(false);
		expect(globalThis.game.settings.set).not.toHaveBeenCalled();
	});

	// The DOM hands back strings for everything — a range's `.value` is "1.5", not 1.5 — and
	// Foundry stores what it is given, so an uncoerced write reaches `applyEditPencilRevealDelay`
	// as a string and every later read gets one where the code expects a number.
	it("coerces to the type the registration declares", async () => {
		globalThis.game = fakeGame({
			editPencilRevealDelay: { name: "Delay", type: Number, default: 1, range: { min: 0, max: 3, step: 0.1 } },
			reduceMotion:          { name: "Motion", type: Boolean, default: false },
			sheetFontScale:        { name: "Size", type: Number, default: 1,
				range: { min: 0.9, max: 1.4, step: 0.05 } },
			sheetFont:             { name: "Font", type: String, default: "libre-caslon" },
		});
		await setPreference("editPencilRevealDelay", "1.5");
		await setPreference("reduceMotion", "");
		await setPreference("sheetFontScale", "1.25");
		await setPreference("sheetFont", "signika");

		expect(globalThis.game._values.get(`${SYSTEM_ID}.editPencilRevealDelay`)).toBe(1.5);
		expect(globalThis.game._values.get(`${SYSTEM_ID}.reduceMotion`)).toBe(false);
		// The slider hands back "1.25"; stored uncoerced it would reach applySheetFontScale as a
		// string and land in --stonetop-font-scale as one.
		expect(globalThis.game._values.get(`${SYSTEM_ID}.sheetFontScale`)).toBe(1.25);
		expect(globalThis.game._values.get(`${SYSTEM_ID}.sheetFont`)).toBe("signika");
	});

	it("refuses a Number that is not one, rather than storing NaN", async () => {
		globalThis.game = fakeGame({ editPencilRevealDelay: { name: "Delay", type: Number, default: 1 } });
		expect(await setPreference("editPencilRevealDelay", "soon")).toBe(false);
		expect(globalThis.game.settings.set).not.toHaveBeenCalled();
	});
});

describe("openPreferenceMenu", () => {
	it("renders the registered submenu, and says so when there is none", () => {
		const render = vi.fn();
		class Menu { render(...args) { render(...args); } }
		globalThis.game = fakeGame({}, { menus: [{ id: "hoverDescriptionSettings", label: "Configure", type: Menu }] });

		expect(openPreferenceMenu("hoverDescriptionSettings")).toBe(true);
		expect(render).toHaveBeenCalledWith(true);
		expect(openPreferenceMenu("nothingRegisteredHere")).toBe(false);
	});
});

describe("formatRange", () => {
	it("shows as many decimals as the step implies", () => {
		expect(formatRange(1, 0.1)).toBe("1.0");
		expect(formatRange(1.5, 0.1)).toBe("1.5");
		expect(formatRange(2, 1)).toBe("2");
		expect(formatRange(0.25, 0.05)).toBe("0.25");
	});
});

// ── Who is offered the tab ────────────────────────────────────────────────────────────────
//
// The settings behind this tab are the READER's own, the same values wherever they are changed
// from, so a copy of it on a sheet that is not theirs is not extra reach — it is the same tab in
// somebody else's house, reading as though it belonged to the character on screen. One surface
// per person: your own character, or the GM Toolkit if you are the GM.
//
// The trap this is written around is `isOwner`, which short-circuits to true for ANY gamemaster
// (see module/utils/preferences-tab.js and the note in hooks/Ready.js). A rule built on it reads
// as "mine" and answers "yes" for every actor in the world on a GM's client, which is the exact
// state being fixed — so a GM here is always given `isOwner: true`, the way a real client would.
describe("who is offered the Preferences tab", () => {
	const gm     = { id: "gm1",      isGM: true,  character: { id: "toolkit1" } };
	const player = { id: "player1",  isGM: false, character: { id: "char1" } };
	const other  = { id: "player2",  isGM: false, character: { id: "char2" } };

	/** A character sheet's actor: owned by name unless told otherwise, and `isOwner` for a GM. */
	const character = (ownership = {}) => ({ id: "char1", type: "character", ownership, isOwner: true });
	const toolkit   = { id: "toolkit1", type: "gmToolkit", ownership: { default: 0 }, isOwner: true };

	it("offers a player their own character, by ownership entry or by assignment", () => {
		expect(showsPreferencesTab(character({ player1: 3 }), player)).toBe(true);
		// No entry, but it is the sheet this player was handed — a world that shares its PCs
		// through `ownership.default` never writes one.
		expect(showsPreferencesTab(character({ default: 3 }), player)).toBe(true);
	});

	it("keeps it off another player's character", () => {
		expect(showsPreferencesTab(character({ player1: 3 }), other)).toBe(false);
		// Editable by the whole table is not the same as theirs.
		expect(showsPreferencesTab(character({ default: 3 }), other)).toBe(false);
	});

	// The case that prompted the rule: a GM opens a player's character to fix a stat and finds
	// their own font size sitting on it. `isOwner` is true here, as it is on a real GM client.
	it("keeps it off every character sheet a GM opens", () => {
		expect(showsPreferencesTab(character({ player1: 3 }), gm)).toBe(false);
		expect(showsPreferencesTab(character({ gm1: 3 }), gm)).toBe(false);
	});

	// ...and gives them one of their own instead, so nobody is left without a copy.
	it("offers the GM Toolkit to a GM, and to a GM only", () => {
		expect(showsPreferencesTab(toolkit, gm)).toBe(true);
		expect(showsPreferencesTab(toolkit, player)).toBe(false);
	});

	// A GM who cleared their assignment, or whose mint has not landed yet: still a GM, still needs
	// somewhere, and the toolkit is where the assignment would have pointed anyway.
	it("offers the toolkit to a GM with no assigned character", () => {
		expect(showsPreferencesTab(toolkit, { id: "gm2", isGM: true, character: null })).toBe(true);
	});

	// The other half of `isGM`, and the reason the rule cannot be "no GM on any character sheet":
	// an ASSISTANT gamemaster who also plays. `_assignGmToolkitToGm` finds their PC already in
	// `user.character` and deliberately leaves it there, so the sheet they read their character on
	// is the sheet their own settings belong on — shutting them out sent them to the world's shared
	// toolkit to change their own text size.
	it("offers an assistant GM their own character, and only that", () => {
		const assistant = { id: "gm3", isGM: true, character: { id: "char1" } };
		expect(showsPreferencesTab(character({ gm3: 3 }), assistant)).toBe(true);
		// Still one place per person: their PC is it, so the shared toolkit is not also offered.
		expect(showsPreferencesTab(toolkit, assistant)).toBe(false);
		// And their GM reach still buys them nothing on anyone else's sheet.
		expect(showsPreferencesTab({ id: "char2", type: "character", ownership: { player2: 3 }, isOwner: true }, assistant))
			.toBe(false);
	});

	// Asked on every render of every sheet that carries the tab, including a client mid-boot.
	it("answers no rather than throwing when there is no actor or no reader", () => {
		expect(showsPreferencesTab(null, player)).toBe(false);
		expect(showsPreferencesTab(character({ player1: 3 }), null)).toBe(false);
		expect(showsPreferencesTab({ type: "character" }, player)).toBe(false);
	});

	// Core's constants are absent in this environment, and the OWNER level is 3 either way. A
	// helper that read `CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER` unguarded would throw here — and,
	// worse, on any client asking before core's globals are up.
	it("reads OWNER without core's constants present", () => {
		expect(globalThis.CONST?.DOCUMENT_OWNERSHIP_LEVELS).toBeUndefined();
		expect(showsPreferencesTab(character({ player1: 3 }), player)).toBe(true);
		// OBSERVER, on a character this player is not the one assigned to: below OWNER is a no.
		expect(showsPreferencesTab({ id: "char9", type: "character", ownership: { player1: 2 } }, player))
			.toBe(false);
	});
});
