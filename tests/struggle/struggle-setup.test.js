import { describe, expect, it } from "vitest";
import { MOVE, ROW_KIND } from "../../module/struggle/struggle-rules.js";
import {
	AID_OTHER, followerKey, journeyMatters, newSetupDraft, setupHelpers, setupRows, setupView,
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
		Object.assign(draft.pcs.rhianna, { stats: ["int", "wis", "luck"], mode: "adv", aidPick: AID_OTHER, aidOther: " Lowri ", aidAdv: false });
		const row = setupRows(r, draft)[0];
		expect(row).toMatchObject({ stats: ["int", "wis"], mode: "adv", aid: { by: "Lowri", advantage: false } });
	});

	it("names outside Aid by who was picked: a character left out, or a follower not rolling", () => {
		const r = roster();
		const draft = newSetupDraft(r);
		draft.pcs.garet.include = false;
		draft.pcs.rhianna.aidPick = "pc:garet";
		draft.pcs.vahid.aidPick = `follower:${crew.fkey}`;
		const rows = setupRows(r, draft);
		expect(rows.find(row => row.actorId === "rhianna").aid).toEqual({ by: "Garet", advantage: true });
		expect(rows.find(row => row.actorId === "vahid" && row.kind === ROW_KIND.PC).aid).toEqual({ by: "Crew", advantage: true });
	});

	it("carries no Aid for nobody, or for someone else left unnamed", () => {
		const r = roster();
		const draft = newSetupDraft(r);
		draft.pcs.vahid.aidPick = AID_OTHER;
		draft.pcs.vahid.aidOther = "  ";
		expect(setupRows(r, draft).filter(row => row.kind === ROW_KIND.PC).map(row => row.aid)).toEqual([null, null, null]);
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

	it("offers as outside Aid only those outside the struggle, then someone else", () => {
		const r = roster();
		const draft = newSetupDraft(r);
		draft.pcs.garet.include = false;
		const aid = setupView(r, draft).pcs.find(p => p.actorId === "rhianna").aid;
		expect(aid.groups.map(g => [g.label, g.options.map(o => [o.value, o.label])])).toEqual([
			["Left out of the struggle", [["pc:garet", "Garet"]]],
			["Followers not rolling", [[`follower:${crew.fkey}`, "Crew (Rhianna's)"]]],
		]);
		expect(aid).toMatchObject({ picked: false, isOther: false, flags: [] });
	});

	it("asks for a name only for someone else, and what the Aid gives only once someone is picked", () => {
		const r = roster();
		const draft = newSetupDraft(r);
		draft.pcs.vahid.aidPick = AID_OTHER;
		draft.pcs.vahid.aidAdv = false;
		const aid = setupView(r, draft).pcs.find(p => p.actorId === "vahid").aid;
		expect(aid).toMatchObject({ picked: true, isOther: true });
		expect(aid.gives.find(g => g.selected).value).toBe("more");
	});

	it("flags, without refusing, an Aider who is rolling in the struggle, and one person Aiding two", () => {
		const r = roster();
		const draft = newSetupDraft(r);
		draft.pcs.garet.include = false;
		draft.pcs.rhianna.aidPick = "pc:garet";
		draft.pcs.vahid.aidPick = "pc:garet";
		let view = setupView(r, draft);
		expect(view.pcs.find(p => p.actorId === "rhianna").aid.flags).toEqual(["Garet is also Aiding Vahid."]);

		draft.pcs.garet.include = true;
		view = setupView(r, draft);
		const rhianna = view.pcs.find(p => p.actorId === "rhianna").aid;
		expect(rhianna.flags[0]).toBe("Garet is rolling in the struggle, and only someone outside it can Aid (Book I p.328).");
		expect(rhianna.groups.at(-1)).toEqual({ label: "Rolling in the struggle", options: [{ value: "pc:garet", label: "Garet", selected: true }] });
		expect(setupRows(r, draft).find(row => row.actorId === "rhianna").aid).toEqual({ by: "Garet", advantage: true });
	});

	it("will not call a struggle while one is under way, or with nobody in it", () => {
		const r = roster();
		expect(setupView(r, newSetupDraft(r), { live: true })).toMatchObject({ canCall: false });
		const none = newSetupDraft(r, { only: [] });
		for (const f of Object.values(none.followers)) f.include = false;
		expect(setupView(r, none).canCall).toBe(false);
	});
});
