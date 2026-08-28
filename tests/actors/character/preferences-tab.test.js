import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readRepo as read, readCss, repoFileExists, declarations } from "../../fakes/css.js";
import {
	GM_ONLY_KEYS, PREFERENCE_GROUPS, PREFERENCE_KEYS, buildPreferenceGroups, formatRange, openPreferenceMenu, setPreference,
} from "../../../module/utils/sheet-preferences.js";

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
		const body = TAB_HBS.replace(/\{\{!--[\s\S]*?--\}\}/g, "");
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
			sheetFontScale: { name: "Size", hint: "h", type: String, default: "1",
				choices: { "1": "Normal", "1.25": "Larger" }, value: "1.25" },
			editPencilRevealDelay: { name: "Delay", type: Number, default: 1,
				range: { min: 0, max: 3, step: 0.1 }, value: 1.5 },
			reduceMotion: { name: "Motion", type: Boolean, default: false, value: true },
		});
		const rows = new Map(buildPreferenceGroups().flatMap(g => g.rows).map(r => [r.key, r]));

		const scale = rows.get("sheetFontScale");
		expect(scale.isChoice).toBe(true);
		expect(scale.choices.find(c => c.value === "1.25").selected).toBe(true);
		expect(scale.choices.find(c => c.value === "1").selected).toBe(false);

		const delay = rows.get("editPencilRevealDelay");
		expect(delay.isRange).toBe(true);
		expect({ min: delay.min, max: delay.max, step: delay.step }).toEqual({ min: 0, max: 3, step: 0.1 });
		expect(delay.value).toBe(1.5);
		expect(delay.display).toBe("1.5");

		expect(rows.get("reduceMotion").isCheck).toBe(true);
		expect(rows.get("reduceMotion").checked).toBe(true);
	});

	// `sheetFontScale` stores its scale as a STRING so its choice keys can be numbers. Comparing
	// a number to a string never matches, which shows as a select that opens with nothing chosen.
	it("matches the chosen option across the string/number divide", () => {
		globalThis.game = fakeGame({
			sheetFontScale: { name: "Size", type: String, default: "1",
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
			sheetFontScale:        { name: "Size", type: String, default: "1" },
		});
		await setPreference("editPencilRevealDelay", "1.5");
		await setPreference("reduceMotion", "");
		await setPreference("sheetFontScale", 1.25);

		expect(globalThis.game._values.get(`${SYSTEM_ID}.editPencilRevealDelay`)).toBe(1.5);
		expect(globalThis.game._values.get(`${SYSTEM_ID}.reduceMotion`)).toBe(false);
		expect(globalThis.game._values.get(`${SYSTEM_ID}.sheetFontScale`)).toBe("1.25");
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
