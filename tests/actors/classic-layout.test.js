import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect, afterEach } from "vitest";
import { isClassicLayout, layoutClasses } from "../../module/settings.js";

// The CLASSIC / MODERN sheet-layout toggle: a resolved master (the world's `worldSheetLayout`,
// overridable per person by `sheetLayout`) plus one child per sheet (`classicLayoutCharacter` /
// `-Steading` / `-Npc`), ANDed. Modern everywhere by default, so nothing moves for a user who
// never opens the settings window.
//
// This file guards the parts that fail SILENTLY — the ones that render fine and go wrong
// later, or go wrong somewhere the failure does not point back here. The per-sheet placement
// is covered by stat-block-placement.test.js and steading-section-placement.test.js.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const read = rel => fs.readFileSync(path.resolve(HERE, "../..", rel), "utf8");

const SETTINGS_JS = read("module/settings.js");
const SCROLL_FROST_JS = read("module/utils/scroll-frost.js");
const CSS = read("styles/stonetop.css");
const NPC_HBS = read("templates/actor/npc.hbs");
const QUICK_FACTS_HBS = read("templates/actor/partials/npc-quick-facts.hbs");
const NAV_ITEM_HBS = read("templates/actor/partials/tab-nav-item.hbs");

const SHEET_JS = {
	character: read("module/actors/character/StonetopCharacterSheet.js"),
	steading:  read("module/actors/steading/StonetopSteadingSheet.js"),
	npc:       read("module/actors/npc/StonetopNpcSheet.js"),
};

const stripComments = src => src.replace(/\{\{!--[\s\S]*?--\}\}/g, "").replace(/\/\*[\s\S]*?\*\//g, "");

describe("isClassicLayout", () => {
	const original = globalThis.game;
	// Spread the existing global rather than replacing it: tests/setup.js puts `i18n` there,
	// and other suites in the same worker read it.
	const withSettings = store => {
		globalThis.game = { ...original, settings: { get: (_ns, key) => store[key] } };
	};
	afterEach(() => { globalThis.game = original; });

	/** The children ticked (their default), so only the master is under test. */
	const children = { classicLayoutCharacter: true, classicLayoutSteading: true, classicLayoutNpc: true };

	it("is modern for every sheet while the world is modern and nobody has overridden it", () => {
		withSettings({ worldSheetLayout: "modern", sheetLayout: "world", ...children });
		for (const sheet of ["character", "steading", "npc"]) expect(isClassicLayout(sheet), sheet).toBe(false);
	});

	it("is classic for every sheet when the world is classic and the children are untouched", () => {
		withSettings({ worldSheetLayout: "classic", sheetLayout: "world", ...children });
		for (const sheet of ["character", "steading", "npc"]) expect(isClassicLayout(sheet), sheet).toBe(true);
	});

	// The whole point of splitting the world's answer from the personal one: a browser that
	// opens both an upgraded world and a fresh one has to be able to show each its own layout,
	// and one person has to be able to disagree with the table either way.
	it("lets a personal override win over the world in both directions", () => {
		withSettings({ worldSheetLayout: "modern", sheetLayout: "classic", ...children });
		expect(isClassicLayout("character")).toBe(true);
		withSettings({ worldSheetLayout: "classic", sheetLayout: "modern", ...children });
		expect(isClassicLayout("character")).toBe(false);
	});

	// A value under the personal key that names no layout must defer rather than pin one:
	// that is what keeps a leftover boolean from a build that stored one here (client settings
	// are shared by every world on a browser) from silently overriding the world's answer.
	it("follows the world when the personal override says something it does not recognize", () => {
		for (const mine of ["world", true, false, "", undefined]) {
			withSettings({ worldSheetLayout: "classic", sheetLayout: mine, ...children });
			expect(isClassicLayout("character"), String(mine)).toBe(true);
			withSettings({ worldSheetLayout: "modern", sheetLayout: mine, ...children });
			expect(isClassicLayout("character"), String(mine)).toBe(false);
		}
	});

	// The point of the per-sheet children: a mixed configuration has to work.
	it("lets one sheet opt back out while the others stay classic", () => {
		withSettings({ worldSheetLayout: "classic", sheetLayout: "world", ...children, classicLayoutCharacter: false });
		expect(isClassicLayout("character")).toBe(false);
		expect(isClassicLayout("steading")).toBe(true);
		expect(isClassicLayout("npc")).toBe(true);
	});

	// The monster sheet has no toggle; nothing else should be able to invent one.
	it("answers false for an unknown sheet", () => {
		withSettings({ worldSheetLayout: "classic", sheetLayout: "world", classicLayoutMonster: true });
		expect(isClassicLayout("monster")).toBe(false);
		expect(isClassicLayout(undefined)).toBe(false);
	});

	// A sheet class is constructible in a unit test, and modern is what ships.
	it("answers false when settings are not registered", () => {
		globalThis.game = {};
		expect(isClassicLayout("character")).toBe(false);
		expect(layoutClasses("character")).toEqual([]);
	});

	// The shape that actually happens in Foundry, and the reason `?? false` is not enough:
	// ClientSettings#get THROWS on a key it has no registration for. layoutClasses is called
	// from every sheet's static defaultOptions getter, i.e. at construction — so a sheet built
	// before registerSettings() finished (a module erroring in its own init hook) would take
	// every actor sheet in the world down on open rather than quietly rendering modern.
	it("answers false when settings exist but the keys are not registered yet", () => {
		globalThis.game = { ...original, settings: { get: (_ns, key) => {
			throw new Error(`"stonetop-pwd.${key}" is not a registered game setting`);
		} } };
		for (const sheet of ["character", "steading", "npc"]) {
			expect(() => isClassicLayout(sheet), sheet).not.toThrow();
			expect(isClassicLayout(sheet), sheet).toBe(false);
		}
		expect(layoutClasses("character")).toEqual([]);
	});

	// ...and only the CHILD missing must not take the sheet down either.
	it("answers false when the master reads but its child does not", () => {
		globalThis.game = { ...original, settings: { get: (_ns, key) => {
			if (key === "sheetLayout") return "classic";
			throw new Error(`"stonetop-pwd.${key}" is not a registered game setting`);
		} } };
		expect(isClassicLayout("character")).toBe(false);
	});

	// The world key is the newer of the two, so a client left mid-upgrade can be holding the
	// personal one and not it. Deferring to a key that isn't there must still render modern
	// rather than take every actor sheet down on open.
	it("answers false when the personal key reads but the world's does not", () => {
		globalThis.game = { ...original, settings: { get: (_ns, key) => {
			if (key === "sheetLayout") return "world";
			throw new Error(`"stonetop-pwd.${key}" is not a registered game setting`);
		} } };
		expect(() => isClassicLayout("character")).not.toThrow();
		expect(isClassicLayout("character")).toBe(false);
	});

	it("emits the frame marker only in classic", () => {
		withSettings({ worldSheetLayout: "classic", sheetLayout: "world", classicLayoutSteading: true });
		expect(layoutClasses("steading")).toEqual(["stonetop-layout-classic"]);
		withSettings({ worldSheetLayout: "modern", sheetLayout: "world", classicLayoutSteading: true });
		expect(layoutClasses("steading")).toEqual([]);
	});
});

describe("settings registration", () => {
	const body = key => SETTINGS_JS.slice(SETTINGS_JS.indexOf(`"${key}", {`)).split("\n\t});")[0];

	it("registers both masters and one child per tabbed sheet, and no monster child", () => {
		// The namespace argument is the SYSTEM_ID constant, not the literal it resolves to, so
		// this matches on the key alone. Which namespace they register under is settings-registration's
		// business, and it is asserted there against the running game rather than against source text.
		for (const key of ["worldSheetLayout", "sheetLayout", "classicLayoutCharacter", "classicLayoutSteading", "classicLayoutNpc"])
			expect(SETTINGS_JS, key).toContain(`game.settings.register(SYSTEM_ID, "${key}"`);
		// The monster sheet has no tabs and took no part in the redesign.
		expect(SETTINGS_JS).not.toContain("classicLayoutMonster");
	});

	// The world's answer is what a fresh world gets, so it has to be MODERN; anything else and
	// a brand-new world would open on the old sheets. The personal override defaults to
	// following it, and the children default TRUE, so one flip of the world brings the whole
	// old layout back and nothing moves for anyone who leaves the settings alone.
	it("defaults the world to modern, the personal override to following it, the children on", () => {
		expect(body("worldSheetLayout")).toMatch(/default: "modern"/);
		expect(body("sheetLayout")).toMatch(/default: "world"/);
		for (const key of ["classicLayoutCharacter", "classicLayoutSteading", "classicLayoutNpc"])
			expect(body(key), key).toMatch(/default: true/);
	});

	// The two are deliberately different scopes: a client setting is keyed only by
	// namespace.key in browser localStorage, so it is SHARED by every world on the browser.
	// The per-world answer has to live in a world setting or "fresh worlds are modern,
	// upgraded worlds are classic" cannot both be true on a GM's machine.
	it("scopes the world's answer to the world and the override to the client", () => {
		expect(body("worldSheetLayout")).toMatch(/scope: "world"/);
		expect(body("sheetLayout")).toMatch(/scope: "client"/);
	});

	// Without an onChange the switch does nothing until every open sheet is closed and
	// reopened. The world one carries it for a second reason: Foundry fires a world setting's
	// onChange on every connected client, which is what repaints the players' sheets when the
	// GM presses the chat card's button.
	it("re-renders open sheets on every one of the five", () => {
		for (const key of ["worldSheetLayout", "sheetLayout", "classicLayoutCharacter", "classicLayoutSteading", "classicLayoutNpc"])
			expect(body(key), key).toContain("_rerenderActorSheets()");
	});

	// The keys must appear as double-quoted LITERALS, not assembled from the argument: the
	// settings suite proves each registered key is read by searching the source for the quoted
	// key, so a template literal makes all three children look dead and fails the build.
	it("spells the child keys out rather than building them at runtime", () => {
		expect(SETTINGS_JS).not.toMatch(/classicLayout\$\{/);
		expect(SETTINGS_JS).toContain('character: "classicLayoutCharacter"');
	});
});

describe("frame marker", () => {
	// defaultOptions is read at construction, which covers the first paint with no flash.
	// `_render` is the load-bearing half: `_replaceHTML` only swaps `.window-content` and never
	// rebuilds the frame's class list, so without it a live flip leaves the previous mode's
	// class on the frame forever — classic markup under modern CSS, or the reverse.
	it("is both seeded in defaultOptions and re-stamped on every render", () => {
		for (const [sheet, src] of Object.entries(SHEET_JS)) {
			expect(src, `${sheet} defaultOptions`).toContain(`...layoutClasses("${sheet}")`);
			expect(src, `${sheet} _render`).toContain(`stampLayoutClass(this, "${sheet}")`);
		}
	});

	// Both halves come from settings.js, so the marker string itself is written down once.
	// A sheet spelling it out inline would drift from `isClassicLayout` the moment either moved.
	it("is spelled out only in settings.js, never inline in a sheet", () => {
		for (const [sheet, src] of Object.entries(SHEET_JS)) {
			expect(stripComments(src), `${sheet}`).not.toContain('classList.toggle("stonetop-layout-classic"');
		}
		expect(SETTINGS_JS).toContain('classList.toggle("stonetop-layout-classic", isClassicLayout(sheet))');
	});

	// `.stonetop-layout-classic` lands on the SAME element as `.pbta.sheet.actor.character` and
	// friends (the window frame), so descending from it into one of those matches nothing at
	// all — silently, no error, the rule just never applies. Descending into an element INSIDE
	// the frame (`.stonetop-layout-classic .stonetop-sheet-layout`) is correct and common,
	// which is why this looks for the frame IDENTITY specifically.
	it("never descends from the marker into a sheet's own frame classes", () => {
		expect(stripComments(CSS)).not.toMatch(/\.stonetop-layout-classic\s+[^,{]*\.sheet\.actor/);
	});

	// `stonetop-classic` already means the Foundry Classic THEME elsewhere in the stylesheet.
	it("does not reuse the Foundry Classic theme's class name", () => {
		expect(CSS).not.toContain(".stonetop-classic.pbta");
		expect(CSS).not.toContain(".stonetop-classic.stonetop.sheet");
	});
});

describe("things that break silently", () => {
	// mountTabRail IS the classic cleanup path: it sweeps stale rails off the frame BEFORE it
	// bails out on finding none in the form, and toggles `stonetop-has-tab-rail` off. Guarding
	// the call strands a fully live rail on the frame — `_replaceHTML` never touches it, and its
	// anchors keep the Tabs controller's bindings, so it goes on switching tabs beside the
	// classic nav.
	it("never guards mountTabRail behind the layout setting", () => {
		for (const [sheet, src] of Object.entries(SHEET_JS)) {
			const call = src.indexOf("mountTabRail(this, html)");
			expect(call, `${sheet} calls mountTabRail`).toBeGreaterThan(-1);
			expect(stripComments(src.slice(call - 160, call)), sheet).not.toMatch(/isClassicLayout|classicLayout/);
		}
	});

	// The tab-change watcher binds ONCE per window frame and is never rebound, so a selector
	// chosen from the setting at bind time would freeze at the first render's layout and stop
	// matching after a flip — leaving the frost band stuck on the outgoing tab's scroll state.
	// Both layouts' navs carry `sheet-tabs`; only modern adds `stonetop-tab-rail`.
	it("watches tab changes with a selector that matches both layouts", () => {
		expect(SCROLL_FROST_JS).toContain('closest?.("nav.sheet-tabs")');
		expect(stripComments(SCROLL_FROST_JS)).not.toContain('closest?.("nav.stonetop-tab-rail")');
		expect(stripComments(SCROLL_FROST_JS)).not.toMatch(/isClassicLayout/);
	});

	// The steading's classic sidebar needs the collapse handler and the hover panel that were
	// retired with the sidebar. Without them it renders, and the handle and the one-line move
	// rows do nothing at all.
	it("keeps the steading's classic sidebar handlers alive", () => {
		expect(SHEET_JS.steading).toContain('html.find(".stonetop-sidebar-toggle")');
		expect(SHEET_JS.steading).toContain("setSidebarCollapsed(this.actor?.id, collapsed)");
		expect(SHEET_JS.steading).toContain("context.stonetop.sidebarCollapsed = getSidebarCollapsed(this.actor?.id)");
		expect(SHEET_JS.steading).toContain('html[0].querySelector(".steading-move-row")');
	});

	// `this._movePanel` is a document.body singleton. activateListeners clears it per render,
	// but a sheet that is closed rather than re-rendered never reaches that and orphans it.
	it("drops the steading's body-level hover panel on close", () => {
		const close = SHEET_JS.steading.slice(SHEET_JS.steading.indexOf("async close(options)"));
		expect(close.slice(0, close.indexOf("super.close"))).toContain("this._movePanel?.remove()");
	});

	// Both NPC mounts carry five named inputs; a double render collapses each duplicate name
	// into an array and the next submit writes garbage into all five.
	it("mounts the NPC quick facts exactly once per layout", () => {
		expect(NPC_HBS).toContain('{{#if stonetop.classicLayout}}{{> "stonetop.npc-quick-facts"}}{{/if}}');
		expect(NPC_HBS).toContain('{{#unless stonetop.classicLayout}}{{> "stonetop.npc-quick-facts"}}{{/unless}}');
		expect(NPC_HBS.match(/stonetop\.npc-quick-facts/g)).toHaveLength(2);
		// The block itself must live only in the partial, or the guards protect nothing.
		expect(NPC_HBS).not.toContain("stonetop-npc-stat-block");
		expect(QUICK_FACTS_HBS).toContain("stonetop-npc-stat-block");
	});

	it("mounts the NPC nav exactly once per layout", () => {
		expect(NPC_HBS.match(/stonetop\.npc-tab-nav/g)).toHaveLength(2);
		expect(stripComments(NPC_HBS)).not.toContain("<nav");
	});

	// "No impressions or motivations yet" is an empty-state for a tab that CAN be empty, and
	// only the classic one still can: in modern the quick-facts block heads Details and its
	// Instinct row is unconditional, so the notice would print directly under visible content
	// on every freshly recruited follower.
	it("keeps the NPC Details empty-state on the layout where the tab can be empty", () => {
		expect(NPC_HBS).toContain("{{#if stonetop.detailsEmpty}}");
		const line = SHEET_JS.npc.split("\n").find(l => l.includes("st.detailsEmpty ="));
		expect(line, "detailsEmpty is assigned").toBeDefined();
		expect(line).toContain("st.classicLayout");
		// The premise the flag rests on: the quick-facts Instinct row has no {{#if}} around it.
		expect(QUICK_FACTS_HBS).toMatch(/<section class="stonetop-npc-field stonetop-npc-instinct">/);
	});

	// The classic anchor is the one that carries a visible label; the rail's is icon-only.
	it("gives the shared nav item a text label in classic and the rail item in modern", () => {
		expect(NAV_ITEM_HBS).toContain("stonetop-tab-label");
		expect(NAV_ITEM_HBS).toContain('{{> "stonetop.tab-rail-item"');
	});
});

describe("classic CSS restorations", () => {
	// Six declarations were REMOVED outright by the redesign, each with a comment explaining
	// why it was no longer needed — all six correct about modern and wrong about classic. A
	// selector-level diff hides the first one entirely: it is a bare declaration inside a rule
	// that survived.
	it("restores every rule the redesign deleted", () => {
		const css = stripComments(CSS);
		// The strip's per-tab size container and the label clamp that rides on it.
		expect(css, "container-type on the strip's items").toMatch(/container-type: inline-size/);
		expect(css, ".stonetop-tab-label clamp").toContain(".stonetop-tab-label");
		// The character strip's flex pin against core's `.app .flexcol > * { flex: 1 }`.
		expect(css, "character nav flex pin")
			.toContain(".stonetop-layout-classic.pbta.sheet.actor.character .sheet-main > .sheet-tabs:not(.stonetop-tab-rail)");
		// The NPC strip's own box (this frame carries no `pbta` class).
		expect(css, "NPC strip").toContain(".stonetop-npc-tabs.sheet-tabs.tabs");
		// The NPC quick-facts flex pin, needed again once it is a .flexcol child.
		expect(css, "NPC quick-facts flex pin")
			.toContain(".stonetop-layout-classic.stonetop.sheet.actor.npc .stonetop-npc-stat-block");
		// The steading stat band's padding and divider, restored by POSITION.
		expect(css, "classic stat band").toContain(".steading-sheet-wrapper > .steading-stats-bar");
		// The Seasons Change glyphs, black on the classic layout's near-black hover panel.
		expect(css, "season glyph invert").toContain(".stonetop-basic-move-panel .stonetop-season-row-icon");
	});

	// The hover panel is document.body.appendChild'ed, so no frame class reaches it. This is
	// the one deliberate exception to the compound-the-marker rule, and gating it by layout
	// instead of by host would silently never apply.
	it("gates the hover-panel glyph rule by host, not by layout", () => {
		const rule = CSS.slice(CSS.indexOf(".stonetop-basic-move-panel .stonetop-season-row-icon"));
		expect(rule.slice(0, rule.indexOf("}"))).toContain("filter: invert(1)");
	});

	// The classic strip's skin self-gates on `:not(.stonetop-tab-rail)` — a sheet in the modern
	// layout emits that class and a classic one does not — so it needs no layout prefix. Losing
	// the exclusion would repaint the rail's buttons with the pill skin.
	it("keeps the rail exclusion on the shared strip skin", () => {
		expect(CSS).toContain(".pbta.sheet .sheet-tabs:not(.stonetop-tab-rail) {");
		expect(CSS).toContain(".stonetop-npc-sheet .sheet-tabs:not(.stonetop-tab-rail) .item");
	});
});
