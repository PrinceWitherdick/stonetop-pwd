import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { stubAsk } from "../fakes/confirm.js";
import { readRepo as read } from "../fakes/css.js";

// The Expedition walkthrough's two stamps, and the smaller fixes from the 2026-11-03 audit (WLK):
//
//  • WLK-1: a Next into Running the journey or Going home used to stamp the trip outright, and Player
//    moves (read WHILE travelling) is one Next from Going home. The first Next in now ASKS ("Setting
//    out now?" / "Are they home now?"); "Not yet" leaves it unset and is not asked again in this
//    window. Each step keeps a control to stamp, redo or clear. A Next never mints a trip.
//  • WLK-6: the stamp's note names who the trip credits.
//  • WLK-10: the Outfit step shows the charted requirements read-only; Running can add a challenge.
//  • WLK-11: Going home has a to-do field, into `home.notes`.

vi.mock("../../module/book2-art/travel-map-art.js", () => ({
	browseTravelMapArt: () => Promise.resolve({ has: () => false }),
	travelMapFile:      () => Promise.resolve(null),
	resolveTravelMap:   () => Promise.resolve(null),
}));

const writer = vi.hoisted(() => ({
	stampSetOut:   vi.fn(async () => true),
	clearSetOut:   vi.fn(async () => true),
	clearTripHome: vi.fn(async () => true),
	recordTrip:    vi.fn(async () => true),
}));
vi.mock("../../module/timeline/timeline-expedition-record.js", async importOriginal => ({
	...(await importOriginal()),
	...writer,
}));

const { ExpeditionDialog } = await import("../../module/dialogs/ExpeditionDialog.js");

const HBS = read("templates/dialogs/expedition.hbs");

let store;

function dialog(trips = [{ id: "trip-1", title: "The Long Walk", createdAt: 0 }], currentId = "trip-1") {
	store.expeditionAnswers = { currentId, list: trips };
	const d = Object.create(ExpeditionDialog.prototype);
	d._rolls = {};
	d.render = vi.fn();
	return d;
}

const stepOf = key => Object.create(ExpeditionDialog.prototype)._steps.find(s => s.key === key);

beforeEach(() => {
	store = { expeditionAnswers: {} };
	for (const fn of Object.values(writer)) fn.mockClear();
	global.game = {
		i18n: global.game.i18n,
		user: { id: "gm-a", isGM: true },
		actors: { contents: [] },
		settings: {
			settings: new Map([["stonetop-pwd.expeditionAnswers", { scope: "world" }]]),
			get: (_ns, key) => store[key],
			set: (_ns, key, value) => { store[key] = value; return Promise.resolve(value); },
		},
	};
	global.ui = { windows: {}, notifications: { warn: () => {}, info: () => {} } };
});

afterEach(() => vi.restoreAllMocks());

describe("the first Next into a step that stamps the trip", () => {
	it("asks whether they are setting out now, and stamps it on a yes", async () => {
		const asked = stubAsk("now");
		const d = dialog();
		await d._noteTripStep("running");
		expect(asked.mock.calls[0][0].window.title).toBe("Setting out now?");
		expect(asked.mock.calls[0][0].content).toContain("The Long Walk");
		expect(writer.stampSetOut).toHaveBeenCalledOnce();
	});

	it("asks whether they are home now, and records the trip on a yes", async () => {
		stubAsk("now");
		await dialog()._noteTripStep("home");
		expect(writer.recordTrip).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ redate: false }));
	});

	it("leaves the stamp unset on Not yet, and does not ask again in this window", async () => {
		const asked = stubAsk("later");
		const d = dialog();
		await d._noteTripStep("home");
		await d._noteTripStep("home");
		expect(asked).toHaveBeenCalledOnce();
		expect(writer.recordTrip).not.toHaveBeenCalled();
	});

	it("asks nothing once the stamp is there", async () => {
		const asked = stubAsk("now");
		await dialog([{ id: "trip-1", title: "", createdAt: 0, setOut: { season: "spring", year: 1 }, timelineRecorded: { season: "summer", year: 1 } }])
			._noteTripStep("running");
		expect(asked).not.toHaveBeenCalled();
	});

	it("never mints a trip from a Next", async () => {
		const asked = stubAsk("now");
		await dialog([], null)._noteTripStep("home");
		expect(asked).not.toHaveBeenCalled();
		expect(writer.recordTrip).not.toHaveBeenCalled();
		expect(store.expeditionAnswers.list).toEqual([]);
	});

	it("is still driven by Next alone, for the GM", () => {
		const SRC = read("module/dialogs/ExpeditionDialog.js");
		expect(SRC).toMatch(/_onStepEntered\(key, \{ via \}\) \{\s*if \(via !== "next" \|\| !game\.user\?\.isGM\) return;/);
	});
});

describe("the step's own control for its stamp", () => {
	it("sits on Running the journey and on Going home", () => {
		expect(stepOf("running").tripStamp).toBe("setOut");
		expect(stepOf("home").tripStamp).toBe("home");
		expect(HBS).toContain("stonetop-exp-stamp-btn");
		expect(HBS).toContain('data-stamp-act="{{this.act}}"');
	});

	it("offers to stamp a trip that has not set out", () => {
		const ctx = dialog()._tripStampContext("setOut");
		expect(ctx.note).toMatch(/Not marked as set out yet/);
		expect(ctx.buttons.map(b => b.act)).toEqual(["stamp"]);
		expect(ctx.buttons[0].kind).toBe("setOut");
	});

	it("says when they set out and who went, and offers a redo and a clear", () => {
		const ctx = dialog([{
			id: "trip-1", title: "", createdAt: 0, setOut: { season: "summer", year: 1 },
			party: [{ id: "a", name: "Bram" }, { id: "c", name: "Dov" }],
		}])._tripStampContext("setOut");
		expect(ctx.note).toMatch(/^Set out in Summer/);
		expect(ctx.party).toBe("Party: Bram & Dov.");
		expect(ctx.buttons.map(b => b.act)).toEqual(["redo", "clear"]);
	});

	it("draws nothing before there is a trip", () => {
		expect(dialog([], null)._tripStampContext("home")).toBeNull();
	});

	it("hands each act to the writer: a redone homecoming re-dates, a cleared one comes off", async () => {
		const d = dialog();
		await d._tripStamp("home", "redo");
		expect(writer.recordTrip).toHaveBeenCalledWith(expect.objectContaining({ redate: true }));
		await d._tripStamp("home", "clear");
		expect(writer.clearTripHome).toHaveBeenCalledOnce();
		await d._tripStamp("setOut", "clear");
		expect(writer.clearSetOut).toHaveBeenCalledOnce();
		await d._tripStamp("setOut", "redo");
		expect(writer.stampSetOut).toHaveBeenCalledOnce();
	});

	it("takes one press at a time", async () => {
		const d = dialog();
		let release;
		writer.recordTrip.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
		const button = { disabled: false, dataset: { stampKind: "home", stampAct: "stamp" } };
		const first = d._onStampButton(button);
		expect(button.disabled).toBe(true);
		await d._onStampButton(button);
		await vi.waitFor(() => expect(release).toBeTypeOf("function"));
		release(true);
		await first;
		expect(writer.recordTrip).toHaveBeenCalledOnce();
		expect(button.disabled).toBe(false);
	});
});

describe("what Chart a Course required, on the Outfit step", () => {
	it("is the requirements alone, read-only, with what was said spliced in", () => {
		const d = dialog([{ id: "trip-1", title: "", createdAt: 0, chart: { picked: [
			{ id: "r1", group: "requirements", key: "bring", answer: "warm clothes" },
			{ id: "c1", group: "challenges", key: "lost", answer: "" },
		] } }]);
		d._journeyRoute = () => null;
		const req = d._outfitRequirements();
		expect(req.entries).toHaveLength(1);
		expect(req.entries[0].line).toContain("warm clothes");
		expect(stepOf("outfit").requirements).toBe(true);
		expect(HBS).toContain("{{#if this.outfitRequirements}}");
	});

	it("prints nothing when nothing was required", () => {
		const d = dialog();
		d._journeyRoute = () => null;
		expect(d._outfitRequirements()).toBeNull();
	});
});

describe("a challenge added on Running the journey", () => {
	it("uses Chart a Course's own add button, aimed at the challenges", () => {
		const todo = HBS.slice(HBS.indexOf("{{#if chartTodo}}"), HBS.indexOf("{{#if endAside}}"));
		expect(todo).toMatch(/class="[^"]*stonetop-exp-chart-add[^"]*"\s+data-chart-group="challenges"/);
		expect(todo).toContain("stonetop.expedition.requirements.addChallenge");
	});
});

describe("the homecoming to-do", () => {
	it("writes home.notes, which the Chronicle prints under Coming home", () => {
		expect(stepOf("home").homeTodo).toBe(true);
		expect(stepOf("home").qa.notes).toBeUndefined();
		expect(HBS).toContain('data-answer-path="{{this.homeTodo.path}}"');
		expect(HBS).toContain('aria-label="{{this.homeTodo.prompt}}"');
		const CORE = read("module/utils/chronicle-core.js");
		expect(CORE).toMatch(/proseCandidate\("Coming home", paragraphs\(home\.notes\)\)/);
	});
});
