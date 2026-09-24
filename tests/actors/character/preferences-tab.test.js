import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
	readRepo as read, readCss, repoFileExists, declarations, stripComments, specificity, beats,
} from "../../fakes/css.js";
import { fakeEl, fakeRoot } from "../../fakes/dom.js";
import {
	GM_ONLY_KEYS, PREFERENCE_GROUPS, PREFERENCE_KEYS, buildPreferenceGroups, formatRange, openPreferenceMenu, setPreference,
} from "../../../module/utils/sheet-preferences.js";
import { showsPreferencesTab, withPreferencesTab } from "../../../module/utils/preferences-tab.js";

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
		for (const key of [
			"intro", "openSettings", "searchLabel", "searchPlaceholder", "noMatches",
			...PREFERENCE_GROUPS.map(g => g.id),
		]) {
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

// ── The search bar ────────────────────────────────────────────────────────────────────────

// One filter over the whole tab, drawn open at the top of it. Six folds of rows and the one a
// reader came for is usually the one that makes the text bigger — so this is the search that must
// not have to be found before it can be used, and it is the only one on these sheets drawn open.
//
// The failures worth pinning are the quiet ones. A search that hides ROWS and leaves their group
// headings standing answers a one-row term with six titles over nothing. A term that matches
// nothing leaves the tab blank and reads as broken. A group the reader folded last week keeps the
// row they just typed the name of hidden. And the sheet re-renders on most of the settings on this
// very tab, so a term that does not survive one hands the whole list back mid-search.

describe("Preferences tab search", () => {
	const PREFS_JS  = read("module/utils/preferences-tab.js");
	const SEARCH_HBS = read("templates/actor/partials/tab-search-control.hbs");

	it("mounts the shared control rather than a box of its own", () => {
		expect(TAB_HBS).toContain('{{> "stonetop.tab-search-control" searchPinned=true');
		expect(TAB_HBS).toContain('(localize "stonetop.sheet.preferences.searchLabel")');
		expect(TAB_HBS).toContain('(localize "stonetop.sheet.preferences.searchPlaceholder")');
		// No second implementation: the filtering, the memory and the Escape handling all come
		// from wireTabSearch, and a hand-rolled input here would be a copy that drifts.
		expect(stripComments(TAB_HBS)).not.toMatch(/<input[^>]*type="search"/);
	});

	// The pinned shape has no toggle, because a button whose only job is to shut a box that
	// cannot shut is a dead control. `wireTabSearch` used to bail out when it could not find one.
	it("draws no toggle when pinned, and the filter wires without one", () => {
		expect(SEARCH_HBS).toContain("{{#if searchPinned}}");
		expect(SEARCH_HBS).toContain("stonetop-tab-search--pinned");
		const SEARCH_JS = read("module/utils/tab-search.js");
		expect(SEARCH_JS).toContain("if (!scope || !box || !input || (!toggle && !pinned)) return;");
	});

	// Named `searchPinned`, not `pinned`: the partial is reached from ~45 section headings, many
	// inside `{{#each}}` loops, and Handlebars merges a partial's hash into the caller's context —
	// so a bare `pinned` would also match a view-model field of that name.
	it("names the flag distinctly enough to survive the hash merge", () => {
		expect(stripComments(SEARCH_HBS)).not.toMatch(/\{\{#if pinned\}\}/);
	});

	// The term lives on the SHEET, like every other filter's: changing a setting from this tab
	// re-renders the sheet, so a term kept in the DOM would be gone on the next keystroke's worth
	// of settling.
	it("remembers the term across a re-render, in the sheet-level store", () => {
		expect(PREFS_JS).toContain("this._tabSearchTerms ??= {}");
		expect(PREFS_JS).toContain('key: "preferences"');
	});

	// The shared filter restores a remembered term with `notify: false`, so the group pass has to
	// be run by hand afterwards or a re-render comes back with every heading standing over rows
	// the filter has just hidden.
	it("runs the group pass again after wiring, for the restored term", () => {
		const body = PREFS_JS.slice(PREFS_JS.indexOf("_wirePreferenceSearch"));
		const wired = body.indexOf("wireTabSearch(panel, {");
		const again = body.indexOf("\n\t\t\tsyncGroups();");
		expect(wired).toBeGreaterThan(-1);
		expect(again).toBeGreaterThan(wired);
	});

	// A fold the reader set earlier must not hide the row they just typed the name of.
	//
	// It has to be `!important` and it has to OUT-SPECIFY, both: the rule it is beating is the
	// shared `.stonetop-section-folded { display: none !important }`, and an important declaration
	// beats any non-important one at any specificity. The first cut of this had neither, and did
	// nothing at all — the group's heading came back and the row stayed hidden under it.
	const FORCE_OPEN = ".stonetop .stonetop-preferences.is-searching\n"
		+ "\t.stonetop-preference-row.stonetop-section-folded:not(.stonetop-search-hidden)";

	it("forces a folded group open while a term is up, loudly enough to beat the fold", () => {
		const own = declarations(CSS, FORCE_OPEN);
		expect(own, "the force-open rule is gone or renamed").toBeTruthy();
		expect(own).toMatch(/display:\s*grid\s*!important/);
		expect(beats(specificity(FORCE_OPEN), specificity(".stonetop-section-folded"))).toBe(true);
		// Bare `!important` rules in this file reach sheets that render the class without the root.
		expect(FORCE_OPEN.startsWith(".stonetop ")).toBe(true);
	});

	// …and the weight added to beat the FOLD must not go on to beat the FILTER. Specificity is
	// read before source order, so without the `:not()` this rule outranks
	// `.stonetop-search-hidden` (important, but 0,1,0) and a folded group opens showing every row
	// it holds rather than the one that matched.
	it("still lets the filter hide the rows that did not match inside it", () => {
		expect(FORCE_OPEN).toContain(":not(.stonetop-search-hidden)");
		expect(beats(specificity(FORCE_OPEN), specificity(".stonetop-search-hidden"))).toBe(true);
	});

	// `.is-open` pulls the box up 8px so a heading's underline does not shift as it grows. There is
	// no heading over this one, so left in, the bar hangs into the intro above it.
	it("resets the heading-box lift the pinned bar has no heading to protect", () => {
		const pinned = declarations(CSS, ".stonetop-tab-search.stonetop-tab-search--pinned");
		expect(pinned, "the pinned skin is gone or renamed").toBeTruthy();
		expect(pinned).toMatch(/margin-top:\s*0/);
		// It ties with `.is-open` on specificity, so it can only win by sitting later in the file.
		expect(CSS.indexOf(".stonetop-tab-search.stonetop-tab-search--pinned"))
			.toBeGreaterThan(CSS.indexOf(".stonetop-tab-search.is-open {"));
	});

	// A field is as long as the longest thing anyone types into it, and these are words like
	// "contrast". Full width read as a heading band with a caret in it rather than as a control,
	// and promised a kind of input nobody was going to give it. The cap still has to yield on a
	// sheet narrower than the cap, which is the `min()` rather than a bare width.
	it("sizes the bar to what goes in it, and still fits a narrow sheet", () => {
		const pinned = declarations(CSS, ".stonetop-tab-search.stonetop-tab-search--pinned");
		expect(pinned).toMatch(/width:\s*min\(100%,\s*\d+(\.\d+)?em\)/);
		expect(pinned).not.toMatch(/width:\s*100%/);
	});

	// The intro and the bar are one block and the rule goes UNDER the pair. On the rule's first
	// home — the intro's own `border-bottom` — it cut the reader off from the box before they had
	// read the sentence explaining it, and left the box hanging over Accessibility as though it
	// were that group's. Whichever element carries it, it has to be exactly one of them: both, and
	// the preamble grows a second line through it.
	it("rules off the whole preamble, not the sentence above the bar", () => {
		const intro    = declarations(CSS, ".stonetop-preferences-intro");
		const controls = declarations(CSS, ".stonetop-preferences-controls");
		expect(controls, "the controls row is gone or renamed").toBeTruthy();
		expect(controls).toMatch(/border-bottom:\s*1px solid/);
		expect(intro).not.toMatch(/border-bottom:\s*1px solid/);
		// Order in the markup is what puts the bar inside that rule rather than below it.
		const body = stripComments(TAB_HBS);
		expect(body.indexOf("stonetop-preferences-intro"))
			.toBeLessThan(body.indexOf("stonetop-preferences-controls"));
	});
});

// The filter's actual behaviour, over the DOM stand-in: what a term leaves standing.
describe("Preferences tab search, filtering", () => {
	const GROUPS = [
		["Accessibility", ["Text Size", "Sheet Contrast", "Paper Texture"]],
		["Rolling and Chat", ["Ask Roll Mode Each Roll", "Show Roll Stat Chips"]],
	];

	/** One rendered tab: the pinned box (no toggle), the no-matches line, and the groups. */
	function buildTab(groups = GROUPS) {
		const root  = fakeRoot();
		const panel = fakeEl({ cls: ["stonetop-preferences"], parent: root });
		const box   = fakeEl({ cls: ["stonetop-tab-search", "stonetop-tab-search--pinned"], parent: panel });
		const input = fakeEl({ cls: ["stonetop-tab-search-input"], parent: box });
		const empty = fakeEl({ cls: ["stonetop-preferences-no-matches"], parent: panel });
		const built = groups.map(([name, labels]) => {
			const group = fakeEl({ cls: ["stonetop-preference-group"], parent: panel });
			const rows  = labels.map(label => {
				const row = fakeEl({ cls: ["stonetop-preference-row"], parent: group });
				row.textContent = label;
				return row;
			});
			return { name, group, rows };
		});
		return { root, panel, box, input, empty, groups: built };
	}

	const Host = withPreferencesTab(class {});
	const fire = (node, type, ev = {}) => { for (const fn of node.handlers[type] ?? []) fn(ev); };
	const type = (tab, term) => { tab.input.value = term; fire(tab.input, "input", {}); };

	const isHidden  = el => el.classes.includes("stonetop-search-hidden");
	const rowsShown = tab => tab.groups.flatMap(g => g.rows).filter(r => !isHidden(r)).map(r => r.textContent);
	const groupsShown = tab => tab.groups.filter(g => !isHidden(g.group)).map(g => g.name);

	it("leaves everything standing before a term is typed", () => {
		const tab = buildTab();
		new Host()._wirePreferences(tab.root);

		expect(rowsShown(tab)).toHaveLength(5);
		expect(groupsShown(tab)).toEqual(["Accessibility", "Rolling and Chat"]);
		expect(tab.empty.classes).not.toContain("is-visible");
	});

	it("keeps the matching rows and takes the emptied group with them", () => {
		const tab = buildTab();
		new Host()._wirePreferences(tab.root);
		type(tab, "roll");

		expect(rowsShown(tab)).toEqual(["Ask Roll Mode Each Roll", "Show Roll Stat Chips"]);
		// The heading of a group with nothing left in it is a title over nothing, and a fold
		// caret that folds air.
		expect(groupsShown(tab)).toEqual(["Rolling and Chat"]);
		expect(tab.panel.classes).toContain("is-searching");
		expect(tab.empty.classes).not.toContain("is-visible");
	});

	it("says so rather than going blank when nothing matches", () => {
		const tab = buildTab();
		new Host()._wirePreferences(tab.root);
		type(tab, "gorcoron");

		expect(rowsShown(tab)).toEqual([]);
		expect(groupsShown(tab)).toEqual([]);
		expect(tab.empty.classes).toContain("is-visible");
	});

	it("puts the whole tab back when the term goes", () => {
		const tab = buildTab();
		new Host()._wirePreferences(tab.root);
		type(tab, "gorcoron");
		type(tab, "");

		expect(rowsShown(tab)).toHaveLength(5);
		expect(groupsShown(tab)).toHaveLength(2);
		expect(tab.empty.classes).not.toContain("is-visible");
		expect(tab.panel.classes).not.toContain("is-searching");
	});

	// The one this tab needs more than any other: most of the rows on it re-render the sheet from
	// their own onChange, so changing a setting mid-search IS the re-render.
	it("comes back filtered — groups and all — on the next render", () => {
		const host = new Host();
		const first = buildTab();
		host._wirePreferences(first.root);
		type(first, "roll");

		const second = buildTab();
		host._wirePreferences(second.root);

		expect(second.input.value).toBe("roll");
		expect(rowsShown(second)).toEqual(["Ask Roll Mode Each Roll", "Show Roll Stat Chips"]);
		expect(groupsShown(second)).toEqual(["Rolling and Chat"]);
	});

	// Escape clears the term everywhere; a pinned box keeps the caret rather than shutting, so a
	// reader who over-typed can start again without going back for the field.
	it("clears on Escape without shutting a box that cannot shut", () => {
		const tab = buildTab();
		new Host()._wirePreferences(tab.root);
		type(tab, "roll");
		fire(tab.input, "keydown", { key: "Escape" });

		expect(tab.input.value).toBe("");
		expect(rowsShown(tab)).toHaveLength(5);
		expect(tab.input.focused).toBe(false);
		expect(tab.box.classes).toContain("stonetop-tab-search--pinned");
	});

	// A sheet without the tab is not an error, and neither is a tab whose every key failed to
	// register: the "nothing matches" line answers a search, not an empty registry.
	it("does not answer an empty tab with a line about searching", () => {
		const tab = buildTab([]);
		new Host()._wirePreferences(tab.root);
		type(tab, "roll");

		expect(tab.empty.classes).not.toContain("is-visible");
	});
});

// ── The keys the tab offers ───────────────────────────────────────────────────────────────

describe("Preferences tab contents", () => {
	it("offers only keys module/settings.js actually registers", () => {
		const missing = ALL_KEYS.filter(key => !REGISTRATIONS.has(key));
		expect(missing, `listed on the tab but never registered: ${missing.join(", ")}`).toEqual([]);
	});

	// The tab is per-PERSON but for `fightTab`, and the exception is listed BY NAME here rather
	// than allowed by shape. A world-scoped key is refused by Foundry on a player's client and
	// applied for the whole table on the GM's, so one that arrived on this tab unnoticed would be
	// a control that works for one person and lies to everyone else. Adding a second means coming
	// through this test, which is where the three things a world row owes are written down.
	const WORLD_KEYS = ["fightTab"];

	it("offers only client-scoped settings, bar the world rows named here", () => {
		const wrong = ALL_KEYS
			.filter(key => !WORLD_KEYS.includes(key))
			.filter(key => !/scope:\s*"client"/.test(REGISTRATIONS.get(key) ?? ""));
		expect(wrong, `not client-scoped, and not a declared world row: ${wrong.join(", ")}`).toEqual([]);
	});

	it("keeps each declared world row world-scoped, GM-only and announced", () => {
		const src = stripComments(read("module/utils/sheet-preferences.js"));
		for (const key of WORLD_KEYS) {
			expect(REGISTRATIONS.get(key), `${key} is not registered`).toMatch(/scope:\s*"world"/);
			// A player's client would refuse the write outright, so the row must not be drawn there.
			expect(GM_ONLY_KEYS.has(key), `${key} is world-scoped but offered to players`).toBe(true);
		}
		// And the row says whose setting it is, off the registration rather than a second list.
		expect(src).toContain("isWorld: isWorldScoped(key, cfg)");
		expect(stripComments(TAB_HBS)).toContain("{{#if isWorld}}");
		expect(EN.stonetop.sheet.preferences.worldScoped).toBeTruthy();
	});

	// The sentence is set in the BODY ink while every caption around it is grey, and the rule that
	// greys the captions ("THE SETTINGS CAPTION") sits ~1300 lines LATER in the file. This wins on
	// specificity, not order — a class added to that selector would take the ink back and the
	// sentence would sink into the captions it has to be read over.
	it("sets the world row's sentence in the body ink", () => {
		const captionSelector = ".stonetop-preferences .stonetop-preference-row .notes";
		const worldSelector   = `${captionSelector}.stonetop-preference-world`;

		const own = declarations(CSS, worldSelector);
		expect(own, "the world-row rule is gone, renamed, or no longer written at that specificity")
			.toBeTruthy();
		expect(own).toMatch(/color:\s*var\(--st-text-body\)/);
		// The caption rule this has to outrank names three surfaces at once, so it cannot simply
		// be moved after this one.
		expect(CSS).toMatch(/\.stonetop-preferences \.stonetop-preference-row \.notes,\n\.stonetop-hover-settings \.notes/);
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
function fakeGame(registrations, { menus = [], throwOnGet = null, isGM = true, canModify = isGM } = {}) {
	const registry = new Map();
	const values   = new Map();
	for (const [key, cfg] of Object.entries(registrations)) {
		registry.set(`${SYSTEM_ID}.${key}`, cfg);
		values.set(`${SYSTEM_ID}.${key}`, cfg.value === undefined ? cfg.default : cfg.value);
	}
	const menuMap = new Map(menus.map(m => [`${SYSTEM_ID}.${m.id}`, m]));
	return {
		i18n: { localize: k => (typeof k === "string" ? k.replace(/^i18n:/, "") : k) },
		// `can` defaults to the role, as Foundry does for a full gamemaster; the assistant case
		// (isGM, no SETTINGS_MODIFY) is what `canModify: false` sets up.
		user: { isGM, can: perm => (perm === "SETTINGS_MODIFY" ? canModify : isGM) },
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

// The Fight tab switch — the tab's one world row, and the only control on it that changes what
// anybody else at the table sees. Stonetop has no initiative (Book I p.417), so the Fight tab is
// what the system ships; this is how a table that would rather run an initiative module gets
// Foundry's Combat tracker back without hunting through Configure Settings.
describe("the Fight tab row", () => {
	const fightTab = (value = true) => ({
		fightTab: { name: "Fight tab", hint: "h", scope: "world", type: Boolean,
			default: true, requiresReload: true, value },
	});

	/** A `foundry.applications.settings.SettingsConfig` with just the prompt this path calls. */
	function fakeSettingsConfig() {
		const reloadConfirm = vi.fn(async () => {});
		globalThis.foundry = { applications: { settings: { SettingsConfig: { reloadConfirm } } } };
		return reloadConfirm;
	}

	let savedFoundry;
	beforeEach(() => { savedFoundry = globalThis.foundry; });
	afterEach(() => {
		if (savedFoundry === undefined) delete globalThis.foundry;
		else globalThis.foundry = savedFoundry;
	});

	it("draws for a GM, in a group of its own at the foot of the tab", () => {
		globalThis.game = fakeGame(fightTab());
		const groups = buildPreferenceGroups();
		const fights = groups.at(-1);
		expect(fights.id).toBe("fights");
		expect(fights.rows.map(r => r.key)).toEqual(["fightTab"]);
		expect(fights.rows[0].isCheck).toBe(true);
		expect(fights.rows[0].checked).toBe(true);
	});

	// The sentence under it is the whole reason a world row is allowed on a tab whose intro
	// promises nothing here leaves this browser.
	it("marks the row as the table's rather than the reader's", () => {
		globalThis.game = fakeGame(fightTab());
		expect(buildPreferenceGroups().at(-1).rows[0].isWorld).toBe(true);
	});

	it("leaves the everyday rows unmarked", () => {
		globalThis.game = fakeGame({
			reduceMotion: { name: "Motion", scope: "client", type: Boolean, default: false },
		});
		expect(buildPreferenceGroups().flatMap(g => g.rows).every(r => !r.isWorld)).toBe(true);
	});

	// The group holds this one key, so a player loses the heading with it rather than being left
	// looking at "Fights" over nothing.
	it("is absent for a player, heading and all", () => {
		globalThis.game = fakeGame(fightTab(), { isGM: false });
		expect(buildPreferenceGroups().find(g => g.id === "fights")).toBeUndefined();
	});

	// An assistant gamemaster is `isGM`, and SETTINGS_MODIFY is a role permission a world can take
	// off the assistant role. Gating on the role alone drew a live switch that threw on touch.
	it("is absent for a GM without SETTINGS_MODIFY, and refuses their write", async () => {
		globalThis.game = fakeGame(fightTab(), { isGM: true, canModify: false });
		expect(buildPreferenceGroups().find(g => g.id === "fights")).toBeUndefined();
		expect(await setPreference("fightTab", false)).toBe(false);
		expect(globalThis.game.settings.set).not.toHaveBeenCalled();
	});

	it("refuses a player's write as well as their row", async () => {
		globalThis.game = fakeGame(fightTab(), { isGM: false });
		expect(await setPreference("fightTab", false)).toBe(false);
		expect(globalThis.game.settings.set).not.toHaveBeenCalled();
	});

	// `requiresReload` is read by core's SettingsConfig form submit and NOWHERE else, so a write
	// from this tab would store the new value and leave every client — the GM's included — still
	// running the Fight tab it had just been switched off. `world: true` is what tells the other
	// clients to reload too.
	it("offers the table-wide reload after the write", async () => {
		const reloadConfirm = fakeSettingsConfig();
		globalThis.game = fakeGame(fightTab(true));

		expect(await setPreference("fightTab", false)).toBe(true);
		expect(globalThis.game._values.get(`${SYSTEM_ID}.fightTab`)).toBe(false);
		expect(reloadConfirm).toHaveBeenCalledWith({ world: true });
	});

	it("does not offer a reload when the value did not actually change", async () => {
		const reloadConfirm = fakeSettingsConfig();
		globalThis.game = fakeGame(fightTab(true));
		await setPreference("fightTab", true);
		expect(reloadConfirm).not.toHaveBeenCalled();
	});

	it("leaves the everyday rows alone: no reload prompt for a client setting", async () => {
		const reloadConfirm = fakeSettingsConfig();
		globalThis.game = fakeGame({
			reduceMotion: { name: "Motion", scope: "client", type: Boolean, default: false },
		});
		await setPreference("reduceMotion", true);
		expect(reloadConfirm).not.toHaveBeenCalled();
	});

	// The value is stored either way; a core that moved the class costs the GM a manual reload,
	// not a thrown write.
	it("still writes where core's prompt is not there to call", async () => {
		delete globalThis.foundry;
		globalThis.game = fakeGame(fightTab(true));
		expect(await setPreference("fightTab", false)).toBe(true);
		expect(globalThis.game._values.get(`${SYSTEM_ID}.fightTab`)).toBe(false);
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
	// `user.character` is an ACTOR, so these carry the `type` a real one has: the rule reads it to
	// tell an assignment that is a PLACE (a sheet the tab appears on) from one that is only a
	// speaking-as choice.
	const gm     = { id: "gm1",      isGM: true,  character: { id: "toolkit1", type: "gmToolkit" } };
	const player = { id: "player1",  isGM: false, character: { id: "char1", type: "character" } };
	const other  = { id: "player2",  isGM: false, character: { id: "char2", type: "character" } };

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
		const assistant = { id: "gm3", isGM: true, character: { id: "char1", type: "character" } };
		expect(showsPreferencesTab(character({ gm3: 3 }), assistant)).toBe(true);
		// Still one place per person: their PC is it, so the shared toolkit is not also offered.
		expect(showsPreferencesTab(toolkit, assistant)).toBe(false);
		// And their GM reach still buys them nothing on anyone else's sheet.
		expect(showsPreferencesTab({ id: "char2", type: "character", ownership: { player2: 3 }, isOwner: true }, assistant))
			.toBe(false);
	});

	// `user.character` is a GM's speaking-as choice as much as it is their character, and one left
	// on an NPC is ordinary — `_assignGmToolkitToGm` deliberately leaves an assignment it finds,
	// so it latches. Homed there, the tab went to a sheet that does not carry it AND came off the
	// toolkit, which left that GM no copy anywhere in the world.
	it("falls back to the toolkit for a GM whose assignment is an actor the tab never appears on", () => {
		const speaker = { id: "gm4", isGM: true, character: { id: "npc1", type: "npc" } };
		expect(showsPreferencesTab(toolkit, speaker)).toBe(true);
		// And that fallback is still not a claim on anyone's character sheet.
		expect(showsPreferencesTab(character({ player1: 3 }), speaker)).toBe(false);
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
