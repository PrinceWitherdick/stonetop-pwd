import { describe, expect, it } from "vitest";
import { MOVE, ROW_KIND } from "../../module/struggle/struggle-rules.js";
import {
	followerKey, journeyMatters, newSetupDraft, setupHelpers, setupRows, setupView,
} from "../../module/struggle/struggle-setup.js";

/** The GM's setup: what it offers, and the rows it calls the struggle with. */

const crew = { fkey: followerKey("rhianna", "crew", ""), ftype: "crew", slug: "", name: "Crew", img: "", tags: ["stealthy"], exceptional: false, isGroup: true, party: false };
const andras = { fkey: followerKey("rhianna", "custom", "andras"), ftype: "custom", slug: "andras", name: "Andras", img: "", tags: [], exceptional: true, isGroup: false, party: true };

const roster = () => [
	{ actorId: "rhianna", name: "Rhianna", img: "", owns: [MOVE.HOME_ON_THE_RANGE], load: "normal", overloaded: false, followers: [crew, andras] },
	{ actorId: "vahid", name: "Vahid", img: "", owns: [MOVE.STONE_COLD, MOVE.BUNDLE_OF_STICKS], load: "heavy", overloaded: false, followers: [] },
	{ actorId: "garet", name: "Garet", img: "", owns: [MOVE.MANY_HANDS], load: "light", overloaded: false, followers: [] },
];

describe("the draft a setup opens on", () => {
	it("has everyone in, rolling their choice, and a follower in when marked as travelling", () => {
		const draft = newSetupDraft(roster());
		expect(draft.pcs.vahid).toMatchObject({ include: true, stats: [], mode: "normal" });
		expect(draft.followers[crew.fkey].include).toBe(false);
		expect(draft.followers[andras.fkey].include).toBe(true);
	});

	it("can start with only some characters in", () => {
		const draft = newSetupDraft(roster(), { only: ["vahid"] });
		expect(draft.pcs.rhianna.include).toBe(false);
		expect(draft.pcs.vahid.include).toBe(true);
	});
});

describe("the rows a struggle is called with", () => {
	it("carries a ticked half-miss move only when the character knows it", () => {
		const r = roster();
		const draft = newSetupDraft(r);
		draft.pcs.vahid.ticks = [MOVE.STONE_COLD, MOVE.TOWER_ETERNAL];
		const vahid = setupRows(r, draft).find(row => row.actorId === "vahid" && row.kind === ROW_KIND.PC);
		expect(vahid.halfMisses).toEqual([MOVE.STONE_COLD]);
		expect(vahid.owns).toEqual([MOVE.BUNDLE_OF_STICKS]);
	});

	it("carries the GM's stats, mode and outside Aid", () => {
		const r = roster();
		const draft = newSetupDraft(r);
		Object.assign(draft.pcs.rhianna, { stats: ["int", "wis", "luck"], mode: "adv", aidBy: " Lowri ", aidAdv: false });
		const row = setupRows(r, draft)[0];
		expect(row).toMatchObject({ stats: ["int", "wis"], mode: "adv", aid: { by: "Lowri", advantage: false } });
	});

	it("rolls a follower at +2 only when they are exceptional", () => {
		const r = roster();
		const draft = newSetupDraft(r);
		draft.followers[crew.fkey] = { include: true, bonus: 2, mode: "normal" };
		draft.followers[andras.fkey].bonus = 2;
		const rows = setupRows(r, draft).filter(row => row.kind === ROW_KIND.FOLLOWER);
		expect(rows.map(row => [row.name, row.bonus, row.isGroup])).toEqual([["Crew", 1, true], ["Andras", 2, false]]);
	});

	it("leaves out anyone the GM ticked out", () => {
		const r = roster();
		const draft = newSetupDraft(r);
		draft.pcs.garet.include = false;
		expect(setupRows(r, draft).some(row => row.actorId === "garet")).toBe(false);
	});
});

describe("Many Hands Make Light Work", () => {
	it("is a helper's only when they are outside the struggle", () => {
		const r = roster();
		const draft = newSetupDraft(r);
		expect(setupHelpers(r, draft)).toEqual([]);
		draft.pcs.garet.include = false;
		expect(setupHelpers(r, draft)).toEqual(["Garet"]);
	});
});

describe("the setup view", () => {
	it("asks about a journey only when a move on the roster cares", () => {
		expect(journeyMatters(roster())).toBe(true);
		expect(journeyMatters(roster().slice(1))).toBe(false);
	});

	it("offers each fiction-gated move only to the character who knows it, in the move's own terms", () => {
		const r = roster();
		const view = setupView(r, newSetupDraft(r));
		const vahid = view.pcs.find(p => p.actorId === "vahid");
		expect(vahid.ticks.map(t => t.label)).toEqual(["Stone Cold: they keep calm and carry on, so a 6- counts as a 7-9"]);
		expect(vahid.loadText).toBe("Heavy load");
		expect(view.pcs.find(p => p.actorId === "rhianna").ticks).toEqual([]);
	});

	it("will not call a struggle while one is under way, or with nobody in it", () => {
		const r = roster();
		expect(setupView(r, newSetupDraft(r), { live: true })).toMatchObject({ canCall: false });
		const none = newSetupDraft(r, { only: [] });
		for (const f of Object.values(none.followers)) f.include = false;
		expect(setupView(r, none).canCall).toBe(false);
	});
});
