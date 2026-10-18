import { describe, it, expect, beforeEach, vi } from "vitest";

// Crossing a threat off the tracker (Book I p.299: "if it's no longer a threat (because it's dead,
// it's left, the conflict has been resolved, etc.), then cross it off the threat tracker"). The
// page stays, greyed and off the active board (the toolkit's three trackers and the on-canvas
// cards), and it can be put back. A page from before the field reads as active.

const pages = vi.hoisted(() => ({ threats: [] }));
vi.mock("../../module/threats/threat-store.js", async importOriginal => ({
	...(await importOriginal()),
	listThreatPages: () => pages.threats,
}));
vi.mock("../../module/hazards/hazard-store.js", async importOriginal => ({
	...(await importOriginal()),
	listHazardPages: () => [],
}));
vi.mock("../../module/settings.js", async importOriginal => ({
	...(await importOriginal()),
	getSetting: () => true,
}));
vi.mock("../../module/utils/foundry-compat.js", async importOriginal => ({
	...(await importOriginal()),
	renderTemplate: async () => "<article></article>",
}));

const { setThreatResolved, isThreatResolved } = await import("../../module/threats/threat-store.js");
const { buildThreatCardVM } = await import("../../module/threats/threat-view.js");
const { withGmPrepTabs } = await import("../../module/actors/gmtoolkit/gm-prep-tabs.js");
const { ThreatBoard } = await import("../../module/threats/threat-board.js");

function threat(id, system = {}) {
	const page = {
		id, uuid: `JournalEntry.e.JournalEntryPage.${id}`, name: id, type: "threat", isOwner: true,
		_stats: { modifiedTime: 1 },
		system: { type: "villain", proximity: "nearby", ...system },
		update: vi.fn(async change => { if ("system.resolved" in change) page.system.resolved = change["system.resolved"]; }),
	};
	return page;
}

beforeEach(() => {
	pages.threats = [];
	global.game = { i18n: global.game.i18n, user: { isGM: true } };
});

describe("the resolved flag", () => {
	it("reads a page written before the field as active", () => {
		expect(isThreatResolved(threat("old"))).toBe(false);
		expect(isThreatResolved(threat("gone", { resolved: true }))).toBe(true);
	});

	it("crosses off and puts back, and writes nothing when it already reads that way", async () => {
		const page = threat("Sajra");
		expect(await setThreatResolved(page, true)).toBe(true);
		expect(page.update).toHaveBeenCalledWith({ "system.resolved": true });
		expect(await setThreatResolved(page, true)).toBe(false);
		expect(await setThreatResolved(page, false)).toBe(true);
		expect(page.system.resolved).toBe(false);
	});

	it("rides onto the card, which greys itself and says why", async () => {
		expect((await buildThreatCardVM(threat("a"))).resolved).toBe(false);
		expect((await buildThreatCardVM(threat("b", { resolved: true }))).resolved).toBe(true);
	});
});

describe("the toolkit's trackers", () => {
	const host = () => new (withGmPrepTabs(class { render = vi.fn(); }))();

	it("keeps a crossed-off threat off its tracker and lists it under its own heading", async () => {
		pages.threats = [threat("live"), threat("dead", { resolved: true })];
		const ctx = await host()._buildThreatsContext({});
		const tracked = ctx.threatGroups.flatMap(g => g.threats).map(t => t.name);
		expect(tracked).toEqual(["live"]);
		expect(ctx.resolvedThreats.map(t => t.name)).toEqual(["dead"]);
	});

	it("offers Cross off on a live card and Put back on a crossed-off one, never both", async () => {
		const h = host();
		const [live] = await h._cardVMsFor("threat", [threat("x")], async () => ({ isOwner: true, resolved: false }));
		const [dead] = await h._cardVMsFor("threat", [threat("y")], async () => ({ isOwner: true, resolved: true }));
		expect(live.prepActions.map(a => a.cls)).toEqual(["threat-resolve"]);
		expect(dead.prepActions.map(a => a.cls)).toEqual(["threat-restore"]);
	});
});

describe("the on-canvas board", () => {
	it("draws no card over a crossed-off threat's pin", async () => {
		const el = () => ({ className: "", innerHTML: "", style: {}, remove: () => {}, appendChild: () => {} });
		global.document = { createElement: el };
		global.canvas = { ready: true, stage: { worldTransform: { apply: p => p }, scale: { x: 1 } } };
		const board = new ThreatBoard();
		board._ensureLayer = () => el();
		const live = threat("live");
		const dead = threat("dead", { resolved: true });
		board._threatNotes = () => [{ id: "n1", center: { x: 0, y: 0 }, page: live }, { id: "n2", center: { x: 0, y: 0 }, page: dead }];
		board._pageFor = note => note.page;
		await board.refresh();
		expect([...board.cards.keys()]).toEqual(["n1"]);
		delete global.document;
		delete global.canvas;
	});
});
