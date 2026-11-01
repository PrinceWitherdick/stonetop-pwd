import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { SYSTEM_ID } from "../../module/system-id.js";

// The GM's world switches for the relationship map and the timeline (module/settings.js), and what
// a flip repaints (module/hooks/feature-switches.js). The two windows are stand-ins: what is under
// test is which open apps are closed and which repainted, not the windows themselves.

vi.mock("../../module/dialogs/RelationshipMapWindow.js", () => ({ RelationshipMapWindow: class RelationshipMapWindow {} }));
vi.mock("../../module/dialogs/TimelineWindow.js", () => ({ TimelineWindow: class TimelineWindow {} }));
vi.mock("../../module/timeline/timeline-store.js", () => ({ findTimelineJournal: () => ({ id: "tl" }) }));

const { RelationshipMapWindow } = await import("../../module/dialogs/RelationshipMapWindow.js");
const { TimelineWindow } = await import("../../module/dialogs/TimelineWindow.js");
const { hideTimelineJournalRow, onFeatureSwitched, syncOpenMapButton } = await import("../../module/hooks/feature-switches.js");
const { isRelationshipMapShown, isTimelineShown, isTimelineTabShown, getTimelineReach, timelineReachOf, migrateTimelineReach } = await import("../../module/settings.js");

const values = new Map();
const journalApp = { collection: { documentName: "JournalEntry", get: () => null } };

function row(entryId) {
	return { dataset: { entryId }, removed: false, remove() { this.removed = true; } };
}

/** A directory that answers a row selector by the id in it, as the browser would. */
function directory(rows) {
	return { querySelector: sel => rows.find(r => sel.includes(`"${r.dataset.entryId}"`)) ?? null };
}

beforeEach(() => {
	values.clear();
	globalThis.game = { settings: { get: (scope, key) => values.get(`${scope}.${key}`) } };
	globalThis.Actor = class Actor {};
});

afterEach(() => {
	delete globalThis.game;
	delete globalThis.Actor;
	delete globalThis.ui;
});

describe("the switch getters", () => {
	it("read on when nothing is stored, so an unregistered key changes nothing", () => {
		expect(isRelationshipMapShown()).toBe(true);
		expect(isTimelineShown()).toBe(true);
	});

	it("read off when the GM has stored off", () => {
		values.set(`${SYSTEM_ID}.showRelationshipMap`, false);
		values.set(`${SYSTEM_ID}.showTimeline`, false);
		expect(isRelationshipMapShown()).toBe(false);
		expect(isTimelineShown()).toBe(false);
	});
});

describe("a player's own Timeline tab switch", () => {
	it("draws the tab when nothing is stored", () => {
		expect(isTimelineTabShown("character")).toBe(true);
		expect(isTimelineTabShown("steading")).toBe(true);
	});

	it("hides the tab when this player turned it off, and leaves the timeline itself on", () => {
		values.set(`${SYSTEM_ID}.timelineTabShown`, false);
		expect(isTimelineTabShown("character")).toBe(false);
		expect(isTimelineTabShown("steading")).toBe(false);
		expect(isTimelineShown()).toBe(true);
	});

	it("hides the tab when the GM turned the timeline off, whatever the player's switch says", () => {
		values.set(`${SYSTEM_ID}.showTimeline`, false);
		values.set(`${SYSTEM_ID}.timelineTabShown`, true);
		expect(isTimelineTabShown("character")).toBe(false);
		expect(isTimelineTabShown("steading")).toBe(false);
	});

	it("keeps the steading's tab when the GM leaves the timeline on the steading sheet only", () => {
		values.set(`${SYSTEM_ID}.showTimeline`, "steading");
		expect(isTimelineTabShown("character")).toBe(false);
		expect(isTimelineTabShown("steading")).toBe(true);
		expect(isTimelineShown()).toBe(true);
	});

	it("is a per-browser setting offered on the Preferences tab, read by both sheets", () => {
		const read = rel => readFileSync(new URL(`../../${rel}`, import.meta.url), "utf8");
		const reg = /register\(SYSTEM_ID, "timelineTabShown", \{([\s\S]*?)\}\);/.exec(read("module/settings.js"))?.[1] ?? "";
		expect(reg).toContain('scope: "client"');
		expect(reg).toContain("_rerenderActorSheets");
		expect(read("module/utils/sheet-preferences.js")).toContain('"timelineTabShown"');
		expect(read("module/actors/character/StonetopCharacterSheet.js")).toContain('context.stonetop.timelineShown = isTimelineTabShown("character");');
		expect(read("module/actors/steading/StonetopSteadingSheet.js")).toContain('context.stonetop.timelineShown = isTimelineTabShown("steading");');
		const gm = /register\(SYSTEM_ID, "showTimeline", \{([\s\S]*?)\}\);/.exec(read("module/settings.js"))?.[1] ?? "";
		expect(gm).toContain('scope: "world"');
		expect(gm).toContain("type: String");
		expect(gm).toContain('default: "all"');
		const en = JSON.parse(read("languages/en.json"));
		expect(en.stonetop.settings.timelineTabShown.name).toBeTruthy();
		expect(en.stonetop.settings.timelineTabShown.hint).toBeTruthy();
		for (const choice of ["all", "steading", "off"]) expect(en.stonetop.settings.showTimeline[choice]).toBeTruthy();
	});
});

describe("the GM's Timeline switch, from on/off to three places", () => {
	it("reads the old stored Boolean, and the strings Foundry casts it to, as everywhere and off", () => {
		expect(timelineReachOf(true)).toBe("all");
		expect(timelineReachOf("true")).toBe("all");
		expect(timelineReachOf(false)).toBe("off");
		expect(timelineReachOf("false")).toBe("off");
	});

	it("keeps the three choices, and reads anything else unknown as the default", () => {
		for (const reach of ["all", "steading", "off"]) expect(timelineReachOf(reach)).toBe(reach);
		expect(timelineReachOf(undefined)).toBe("all");
		expect(timelineReachOf("nonsense")).toBe("all");
		expect(getTimelineReach()).toBe("all");
	});

	function worldWith(stored) {
		const docs = stored === undefined ? [] : [{ key: `${SYSTEM_ID}.showTimeline`, value: stored }];
		const set = vi.fn(async () => {});
		const gm = { id: "gm", isGM: true, active: true };
		globalThis.game = { user: gm, users: { activeGM: gm }, settings: { storage: new Map([["world", docs]]), set } };
		return set;
	}

	it("rewrites an old stored off as off, and an old on as everywhere", async () => {
		let set = worldWith("false");
		expect(await migrateTimelineReach()).toBe("off");
		expect(set).toHaveBeenCalledWith(SYSTEM_ID, "showTimeline", "off");
		set = worldWith("true");
		expect(await migrateTimelineReach()).toBe("all");
		expect(set).toHaveBeenCalledWith(SYSTEM_ID, "showTimeline", "all");
	});

	it("leaves a world alone that stored nothing, or a choice already", async () => {
		for (const stored of [undefined, "steading", "off", "all"]) {
			const set = worldWith(stored);
			expect(await migrateTimelineReach()).toBe(null);
			expect(set).not.toHaveBeenCalled();
		}
	});

	it("is the primary GM's to write, not a player's or a second GM's", async () => {
		const set = worldWith("false");
		globalThis.game.user = { id: "player", isGM: false };
		expect(await migrateTimelineReach()).toBe(null);
		globalThis.game.user = { id: "gm2", isGM: true };
		expect(await migrateTimelineReach()).toBe(null);
		expect(set).not.toHaveBeenCalled();
	});

	it("runs on ready", () => {
		const ready = readFileSync(new URL("../../module/hooks/Ready.js", import.meta.url), "utf8");
		expect(ready).toContain("await migrateTimelineReach()");
	});
});

describe("the Journal sidebar", () => {
	it("keeps the Timeline journal's row while the timeline is on", () => {
		const rows = [row("tl"), row("other")];
		hideTimelineJournalRow(journalApp, directory(rows));
		expect(rows.map(r => r.removed)).toEqual([false, false]);
	});

	it("removes only the Timeline journal's row while it is off", () => {
		values.set(`${SYSTEM_ID}.showTimeline`, false);
		const rows = [row("tl"), row("other")];
		hideTimelineJournalRow(journalApp, directory(rows));
		expect(rows.map(r => r.removed)).toEqual([true, false]);
	});

	it("takes a standing map button away while the map is off", () => {
		values.set(`${SYSTEM_ID}.showRelationshipMap`, false);
		const bar = { removed: false, remove() { this.removed = true; } };
		const button = { closest: sel => (sel === ".stonetop-relmap-directory-actions" ? bar : null) };
		syncOpenMapButton(journalApp, { querySelector: sel => (sel === "[data-relmap-open-map]" ? button : null) }, () => {});
		expect(bar.removed).toBe(true);
	});
});

describe("a flip", () => {
	function openApps() {
		const relmap = Object.assign(new RelationshipMapWindow(), { id: "relmap", close: vi.fn(), render: vi.fn() });
		// A sheet's tab panel: a SUBCLASS of the window, which its sheet closes, not this.
		const panel = Object.assign(new (class RelationshipMapPanel extends RelationshipMapWindow {})(), { id: "panel", close: vi.fn(), render: vi.fn() });
		const timeline = Object.assign(new TimelineWindow(), { id: "timeline", close: vi.fn(), render: vi.fn() });
		const sheet = { id: "sheet", rendered: true, document: Object.assign(new globalThis.Actor(), { type: "steading" }), close: vi.fn(), render: vi.fn() };
		// A sheet with neither tab: nothing on it changes, so it is not repainted.
		const monster = { id: "monster", rendered: true, document: Object.assign(new globalThis.Actor(), { type: "monster" }), close: vi.fn(), render: vi.fn() };
		const journal = { render: vi.fn() };
		globalThis.ui = { windows: { 1: relmap, 2: panel, 3: timeline, 4: sheet, 5: monster }, journal };
		return { relmap, panel, timeline, sheet, monster, journal };
	}

	it("going off closes that feature's own window only, and repaints sheets and the sidebar", () => {
		const { relmap, panel, timeline, sheet, monster, journal } = openApps();
		onFeatureSwitched("relationshipMap", false);
		expect(relmap.close).toHaveBeenCalled();
		expect(panel.close).not.toHaveBeenCalled();
		expect(timeline.close).not.toHaveBeenCalled();
		expect(sheet.render).toHaveBeenCalledWith(false);
		expect(monster.render).not.toHaveBeenCalled();
		expect(journal.render).toHaveBeenCalled();
	});

	it("going off closes a window on the Timeline journal or one of its pages, and nothing else's", () => {
		const { timeline } = openApps();
		const entry = { id: "e", rendered: true, document: { documentName: "JournalEntry", id: "tl" }, close: vi.fn(), render: vi.fn() };
		const page = { id: "p", rendered: true, document: { documentName: "JournalEntryPage", type: "timeline" }, close: vi.fn(), render: vi.fn() };
		const other = { id: "o", rendered: true, document: { documentName: "JournalEntry", id: "lore" }, close: vi.fn(), render: vi.fn() };
		Object.assign(globalThis.ui.windows, { 6: entry, 7: page, 8: other });
		onFeatureSwitched("timeline", false);
		expect(timeline.close).toHaveBeenCalled();
		expect(entry.close).toHaveBeenCalled();
		expect(page.close).toHaveBeenCalled();
		expect(other.close).not.toHaveBeenCalled();
	});

	it("going on repaints a window on the Timeline journal, which was showing the off notice", () => {
		openApps();
		const entry = { id: "e", rendered: true, document: { documentName: "JournalEntry", id: "tl" }, close: vi.fn(), render: vi.fn() };
		globalThis.ui.windows[6] = entry;
		onFeatureSwitched("timeline", true);
		expect(entry.close).not.toHaveBeenCalled();
		expect(entry.render).toHaveBeenCalledWith(false);
	});

	it("leaves the Timeline journal open on a relationship-map flip", () => {
		openApps();
		const entry = { id: "e", rendered: true, document: { documentName: "JournalEntry", id: "tl" }, close: vi.fn(), render: vi.fn() };
		globalThis.ui.windows[6] = entry;
		onFeatureSwitched("relationshipMap", false);
		expect(entry.close).not.toHaveBeenCalled();
	});

	it("going on closes nothing", () => {
		const { relmap, timeline, sheet } = openApps();
		onFeatureSwitched("timeline", true);
		expect(relmap.close).not.toHaveBeenCalled();
		expect(timeline.close).not.toHaveBeenCalled();
		expect(sheet.render).toHaveBeenCalledWith(false);
	});
});

describe("a tab panel whose tab has gone", () => {
	it("is closed, and the sheet lets go of it, when the repaint leaves no mount", async () => {
		const { mountedPanelSlot } = await import("../../module/utils/mounted-panel-slot.js");
		const slot = mountedPanelSlot({ field: "_panel", tab: "timeline", mountSel: "[data-x]", build: () => null });
		const panel = { close: vi.fn() };
		const sheet = { _panel: panel };
		slot.sync(sheet, { querySelector: () => null });
		expect(panel.close).toHaveBeenCalled();
		expect(sheet._panel).toBeNull();
	});
});

describe("the tabs", () => {
	const steading = readFileSync("templates/actor/steading.hbs", "utf8");
	const character = readFileSync("templates/actor/character.hbs", "utf8");

	it("draw the map's tab and panel on the steading only while the map is on", () => {
		expect(steading).toMatch(/\{\{#if stonetop\.relmapShown\}\}\{\{#unless stonetop\.classicLayout\}\}\{\{> "stonetop\.tab-nav-item" tab="relmap"/);
		expect(steading).toContain('{{#if stonetop.relmapShown}}{{#unless stonetop.classicLayout}}{{> "stonetop.steading-tab-relmap"}}{{/unless}}{{/if}}');
	});

	it("draw the timeline's tab and panel on both sheets only while the timeline is on", () => {
		expect(steading).toMatch(/\{\{#if stonetop\.timelineShown\}\}\{\{#unless stonetop\.classicLayout\}\}\{\{> "stonetop\.tab-nav-item" tab="timeline"/);
		expect(steading).toContain('{{#if stonetop.timelineShown}}{{#unless stonetop.classicLayout}}{{> "stonetop.steading-tab-timeline"}}{{/unless}}{{/if}}');
		expect(character).toMatch(/\{\{#if stonetop\.timelineShown\}\}\{\{#unless stonetop\.classicLayout\}\}\{\{> "stonetop\.tab-nav-item" tab="timeline"/);
		expect(character).toContain('{{#if stonetop.timelineShown}}{{#unless stonetop.classicLayout}}{{> "stonetop.tab-timeline"}}{{/unless}}{{/if}}');
	});
});
