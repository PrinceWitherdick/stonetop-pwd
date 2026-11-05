import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// THE ONE WRITER FOR A TRIP'S ROW. The walkthrough and the Return Triumphant move both reach it, and
// it works on whichever copy of the expedition log is live: an open walkthrough's own, else the
// world setting. These drive it against a store and fakes for the threads it writes on.

const fakes = vi.hoisted(() => ({
	recordOnTracks: vi.fn(async () => []),
	recordManyOnTracks: vi.fn(async () => []),
	primary:        true,
	forgetMilestones: vi.fn(async () => ({})),
	timelineNow:    vi.fn(() => ({ season: "autumn", year: 2 })),
	tracks:         [],
	characters:     [],
	steading:       { id: "steading" },
	setting:        null,
	setWorldSetting: vi.fn(async () => {}),
}));

vi.mock("../../module/timeline/timeline-record.js", () => ({
	recordOnTracks:   fakes.recordOnTracks,
	recordManyOnTracks: fakes.recordManyOnTracks,
	forgetMilestones: fakes.forgetMilestones,
	timelineNow:      fakes.timelineNow,
}));
vi.mock("../../module/timeline/timeline-store.js", () => ({ allTracks: () => fakes.tracks }));
vi.mock("../../module/utils/primary-gm.js", () => ({ isPrimaryGM: () => fakes.primary }));
vi.mock("../../module/utils/playbook-actors.js", () => ({ getPlayerCharacters: () => fakes.characters }));
vi.mock("../../module/utils/world.js", () => ({ getStonetopSteadingActor: () => fakes.steading }));
vi.mock("../../module/actors/character/deaths-door-actor.js", () => ({ isOutOfPlay: pc => !!pc.dead }));
vi.mock("../../module/settings.js", () => ({
	getSetting:      () => fakes.setting,
	setWorldSetting: fakes.setWorldSetting,
}));

const {
	recordTrip, tripLogStore, stampSetOut, clearSetOut, clearTripHome, forgetTripRows,
	retitleRenumberedTrips, recordExpeditionTakes,
} = await import("../../module/timeline/timeline-expedition-record.js");

/** A store over an in-memory log, the shape the walkthrough hands over. */
function memoryStore(log, { mints = false } = {}) {
	const store = {
		log,
		read:  () => store.log,
		write: vi.fn(async next => { store.log = next; }),
	};
	if (mints) store.newTrip = () => ({ id: "minted", title: "", createdAt: 1 });
	return store;
}

const trip = (extra = {}) => ({ id: "t1", title: "The Ford", journey: { destination: "the-maw" }, ...extra });

beforeEach(() => {
	game.user = { isGM: true };
	fakes.characters = [{ id: "a", name: "Bram" }, { id: "b", name: "Cora" }, { id: "c", name: "Dov", dead: true }];
	fakes.recordOnTracks.mockReset();
	fakes.recordManyOnTracks.mockReset();
	fakes.recordManyOnTracks.mockImplementation(async () => []);
	fakes.primary = true;
	fakes.recordOnTracks.mockImplementation(async () => []);
	fakes.forgetMilestones.mockClear();
	fakes.setWorldSetting.mockClear();
	fakes.tracks = [];
	fakes.setting = null;
});

// Audit WLK-1/6/8/9: the stamps are asked for and can be redone or cleared; the row credits who set
// out; a rename follows; the trip is stamped only once its rows are down.
describe("setting out", () => {
	it("stamps the season and who went, less anyone ticked out, and never the dead", async () => {
		const store = memoryStore({ currentId: "t1", list: [trip({ partyOut: { b: true } })] });
		expect(await stampSetOut({ store })).toBe(true);
		expect(store.log.list[0].setOut).toEqual({ season: "autumn", year: 2 });
		expect(store.log.list[0].party).toEqual([{ id: "a", name: "Bram" }]);
	});

	it("never mints a trip", async () => {
		const store = memoryStore({ currentId: null, list: [] }, { mints: true });
		expect(await stampSetOut({ store })).toBe(false);
		expect(store.write).not.toHaveBeenCalled();
	});

	it("comes back off when cleared", async () => {
		const store = memoryStore({ currentId: "t1", list: [trip({ setOut: { season: "summer", year: 1 }, party: [] })] });
		await clearSetOut({ store });
		expect(store.log.list[0].setOut).toBeUndefined();
		expect(store.log.list[0].party).toBeUndefined();
	});
});

describe("who the row is for", () => {
	it("is the party that set out, the one who died on the road included", async () => {
		const store = memoryStore({ currentId: "t1", list: [trip({ party: [{ id: "a", name: "Bram" }, { id: "c", name: "Dov" }] })] });
		await recordTrip({ store });
		const [targets, milestone] = fakes.recordOnTracks.mock.calls[0];
		expect(targets.map(t => t.id)).toEqual(["a", "c", "steading"]);
		expect(milestone.body).toContain("Dov");
		expect(milestone.body).not.toContain("Cora");
	});
});

describe("redoing and clearing the homecoming", () => {
	it("moves the stamp and the row's date to now on a redo", async () => {
		const store = memoryStore({ currentId: "t1", list: [trip({ timelineRecorded: { season: "spring", year: 2 } })] });
		await recordTrip({ store, redate: true });
		expect(store.log.list[0].timelineRecorded).toEqual({ season: "autumn", year: 2 });
		expect(fakes.recordOnTracks.mock.calls[0][1].refresh).toEqual(["body", "place", "season", "year"]);
	});

	it("takes the rows off every thread and the stamp off the trip, keeping a triumph", async () => {
		fakes.tracks = [{ trackId: "a" }, { trackId: "steading" }];
		const store = memoryStore({ currentId: "t1", list: [trip({ timelineRecorded: { season: "autumn", year: 2 }, timelineTitle: "The Ford", returnedTriumphant: true })] });
		expect(await clearTripHome({ store })).toBe(true);
		expect(fakes.forgetMilestones.mock.calls.map(c => c[1])).toEqual(["expedition:t1", "expedition:t1"]);
		expect(store.log.list[0].timelineRecorded).toBeUndefined();
		expect(store.log.list[0].timelineTitle).toBeUndefined();
		expect(store.log.list[0].returnedTriumphant).toBe(true);
	});

	it("forgets a deleted trip's rows by its id", async () => {
		fakes.tracks = [{ trackId: "a" }];
		expect(await forgetTripRows("gone")).toBe(1);
		expect(fakes.forgetMilestones).toHaveBeenCalledWith({ trackId: "a" }, "expedition:gone");
	});
});

describe("a renamed trip", () => {
	it("retitles the rows still wearing the name they were written with, and remembers the new one", async () => {
		const store = memoryStore({ currentId: "t1", list: [trip({ timelineRecorded: { season: "autumn", year: 2 }, timelineTitle: "Expedition 1" })] });
		await recordTrip({ store });
		const milestone = fakes.recordOnTracks.mock.calls[0][1];
		expect(milestone.refresh).toContain("title");
		expect(milestone.refreshWhile).toEqual({ title: "Expedition 1" });
		expect(store.log.list[0].timelineTitle).toBe("The Ford");
	});

	it("can be named by id rather than being the current trip", async () => {
		const store = memoryStore({ currentId: "t1", list: [trip(), { id: "t2", title: "Second", timelineRecorded: { season: "summer", year: 1 } }] });
		await recordTrip({ store, tripId: "t2" });
		expect(fakes.recordOnTracks.mock.calls[0][1].key).toBe("expedition:t2");
		expect(store.log.list[1].timelineRecorded).toEqual({ season: "summer", year: 1 });
		expect(store.log.list[0].timelineRecorded).toBeUndefined();
	});
});

describe("a row that could not be written", () => {
	it("leaves the trip unstamped and says so", async () => {
		const warned = [];
		globalThis.ui = { notifications: { warn: msg => warned.push(msg) } };
		fakes.recordOnTracks.mockRejectedValueOnce(new Error("no page"));
		const store = memoryStore({ currentId: "t1", list: [trip()] });
		expect(await recordTrip({ store })).toBe(false);
		expect(store.write).not.toHaveBeenCalled();
		expect(warned).toHaveLength(1);
		expect(fakes.recordOnTracks.mock.calls[0][2]).toEqual({ strict: true });
	});

	// The stamp lands on the log as it is AFTER the rows, not on a copy from before them.
	it("keeps what was written to the log while the rows were going down", async () => {
		const store = memoryStore({ currentId: "t1", list: [trip()] });
		fakes.recordOnTracks.mockImplementationOnce(async () => {
			store.log = { currentId: "t1", list: [{ ...store.log.list[0], chart: { notes: "typed meanwhile" } }] };
			return [];
		});
		await recordTrip({ store });
		expect(store.log.list[0].chart).toEqual({ notes: "typed meanwhile" });
		expect(store.log.list[0].timelineRecorded).toEqual({ season: "autumn", year: 2 });
	});
});

afterEach(() => {
	delete game.user;
	delete globalThis.ui;
});

describe("writing the row", () => {
	it("puts it on everyone who went, and Stonetop's", async () => {
		const store = memoryStore({ currentId: "t1", list: [trip({ partyOut: { b: true } })] });
		expect(await recordTrip({ store })).toBe(true);

		const [targets, milestone] = fakes.recordOnTracks.mock.calls[0];
		// Cora stayed home; Dov is past the Door.
		expect(targets.map(t => t.id)).toEqual(["a", "steading"]);
		expect(milestone).toEqual(expect.objectContaining({
			key: "expedition:t1", title: "The Ford", place: "the Maw",
		}));
		expect(milestone.body).toContain("Bram");
	});

	it("stamps the season it first went down in, and keeps that stamp on a rewrite", async () => {
		const store = memoryStore({ currentId: "t1", list: [trip()] });
		await recordTrip({ store });
		expect(store.log.list[0].timelineRecorded).toEqual({ season: "autumn", year: 2 });

		fakes.timelineNow.mockReturnValueOnce({ season: "winter", year: 2 });
		await recordTrip({ store });
		expect(store.log.list[0].timelineRecorded).toEqual({ season: "autumn", year: 2 });
	});

	// A triumph is part of the trip once made: recording again from the walkthrough's button must
	// not take it back off the row.
	it("keeps a triumph once it has been marked", async () => {
		const store = memoryStore({ currentId: "t1", list: [trip()] });
		await recordTrip({ store, triumphant: true });
		expect(store.log.list[0].returnedTriumphant).toBe(true);

		await recordTrip({ store });
		expect(fakes.recordOnTracks.mock.calls[1][1].body).toContain("Returned triumphant.");
	});

	// The store's log is the window's draft; the writer works on a copy and hands the whole back.
	it("does not touch the log it was handed until it writes", async () => {
		const before = { currentId: "t1", list: [trip()] };
		const store = memoryStore(before);
		await recordTrip({ store, triumphant: true });
		expect(before.list[0].returnedTriumphant).toBeUndefined();
		expect(store.write).toHaveBeenCalledOnce();
	});

	it("writes nothing for a player", async () => {
		game.user = { isGM: false };
		const store = memoryStore({ currentId: "t1", list: [trip()] });
		expect(await recordTrip({ store, triumphant: true })).toBe(false);
		expect(store.write).not.toHaveBeenCalled();
		expect(fakes.recordOnTracks).not.toHaveBeenCalled();
	});
});

// The steading sheet's door cannot see which trip is meant, so it credits only one that came home
// this season: never one still being planned, never one that came home seasons ago.
describe("a triumph made from the steading sheet", () => {
	it("credits the trip that came home this season", async () => {
		const store = memoryStore({ currentId: "t1", list: [trip({ timelineRecorded: { season: "autumn", year: 2 } })] });
		expect(await recordTrip({ store, triumphant: true, homeOnly: true })).toBe(true);
		expect(store.log.list[0].returnedTriumphant).toBe(true);
	});

	it("leaves a trip that has not come home alone, even in an open walkthrough that could mint one", async () => {
		const store = memoryStore({ currentId: "t1", list: [trip({ setOut: { season: "autumn", year: 2 } })] }, { mints: true });
		expect(await recordTrip({ store, triumphant: true, homeOnly: true })).toBe(false);
		const empty = memoryStore({ currentId: null, list: [] }, { mints: true });
		expect(await recordTrip({ store: empty, triumphant: true, homeOnly: true })).toBe(false);
		expect(store.write).not.toHaveBeenCalled();
		expect(empty.write).not.toHaveBeenCalled();
		expect(fakes.recordOnTracks).not.toHaveBeenCalled();
	});

	it("leaves a trip that came home in an earlier season alone", async () => {
		const store = memoryStore({ currentId: "t1", list: [trip({ timelineRecorded: { season: "summer", year: 2 } })] });
		expect(await recordTrip({ store, triumphant: true, homeOnly: true })).toBe(false);
		expect(fakes.recordOnTracks).not.toHaveBeenCalled();
	});
});

describe("a log with no trip in it", () => {
	// The steading sheet's door: a world that never logged an expedition has no trip to credit.
	it("is left alone by a store that cannot mint one", async () => {
		const store = memoryStore({ currentId: null, list: [] });
		expect(await recordTrip({ store, triumphant: true })).toBe(false);
		expect(store.write).not.toHaveBeenCalled();
		expect(fakes.recordOnTracks).not.toHaveBeenCalled();
	});

	// The walkthrough's door: a GM standing in it is on a trip, typed into or not.
	it("gets one from a store that can", async () => {
		const store = memoryStore({ currentId: null, list: [] }, { mints: true });
		expect(await recordTrip({ store })).toBe(true);
		expect(store.log.currentId).toBe("minted");
		expect(fakes.recordOnTracks.mock.calls[0][1].title).toBe("Expedition 1");
	});
});

describe("which copy of the log", () => {
	// Its draft is the log while it is up; writing the setting under it would be undone by its next save.
	it("is an open walkthrough's own, when one is up", () => {
		const own = { read: () => null, write: async () => {} };
		globalThis.ui = { windows: { 1: { id: "stonetop-expedition", rendered: true, tripLogStore: () => own } } };
		expect(tripLogStore()).toBe(own);
	});

	it("is the world setting otherwise, read normalized and written whole", async () => {
		fakes.setting = { list: [trip()] };
		const store = tripLogStore();
		expect(store.newTrip).toBeUndefined();
		expect(store.read()).toEqual({ currentId: "t1", list: [trip()] });

		await recordTrip({ triumphant: true });
		expect(fakes.setWorldSetting).toHaveBeenCalledWith("expeditionAnswers", expect.objectContaining({ currentId: "t1" }));
		expect(fakes.setWorldSetting.mock.calls[0][1].list[0].returnedTriumphant).toBe(true);
	});
});

// Audit WLK-8, batched: a delete that renumbers several recorded trips writes each thread once and
// the log once.
describe("trips a delete renumbered", () => {
	it("re-titles every renumbered trip's rows in one batch, and remembers each new name in one log write", async () => {
		const store = memoryStore({ currentId: "t3", list: [
			{ id: "t2", title: "", timelineRecorded: { season: "spring", year: 1 }, timelineTitle: "Expedition 2" },
			{ id: "t3", title: "", timelineRecorded: { season: "summer", year: 1 }, timelineTitle: "Expedition 3" },
			{ id: "t4", title: "Named", timelineRecorded: { season: "summer", year: 1 }, timelineTitle: "Named" },
		] });
		expect(await retitleRenumberedTrips({ store })).toBe(2);
		expect(fakes.recordManyOnTracks).toHaveBeenCalledTimes(1);
		const [entries] = fakes.recordManyOnTracks.mock.calls[0];
		expect(entries.map(e => e.milestone.title)).toEqual(["Expedition 1", "Expedition 2"]);
		expect(entries.every(e => e.milestone.refreshWhile?.title)).toBe(true);
		expect(store.write).toHaveBeenCalledTimes(1);
		expect(store.log.list.map(t => t.timelineTitle)).toEqual(["Expedition 1", "Expedition 2", "Named"]);
	});

	it("writes nothing when no recorded trip moved", async () => {
		const store = memoryStore({ currentId: "t1", list: [{ id: "t1", title: "", timelineRecorded: { season: "spring", year: 1 }, timelineTitle: "Expedition 1" }] });
		expect(await retitleRenumberedTrips({ store })).toBe(0);
		expect(fakes.recordManyOnTracks).not.toHaveBeenCalled();
		expect(store.write).not.toHaveBeenCalled();
	});

	it("leaves the titles alone when a thread could not be written", async () => {
		vi.spyOn(console, "warn").mockImplementation(() => {});
		fakes.recordManyOnTracks.mockImplementation(async () => { throw new Error("locked"); });
		const store = memoryStore({ currentId: "t2", list: [{ id: "t2", title: "", timelineRecorded: { season: "spring", year: 1 }, timelineTitle: "Expedition 2" }] });
		expect(await retitleRenumberedTrips({ store })).toBe(0);
		expect(store.write).not.toHaveBeenCalled();
	});
});

// A player's Requisition from their sheet reaches its trip's record as it lands.
describe("a player's take", () => {
	const steadingWith = out => ({ getAssetsOnExpedition: id => out[id] ?? [] });

	it("goes on the trip it is out with, once, on the primary GM", async () => {
		const store = memoryStore({ currentId: "t1", list: [{ id: "t1", title: "", requisitioned: [{ name: "Wagon" }] }, { id: "t2", title: "" }] });
		const steading = steadingWith({ t1: [{ name: "Wagon" }, { name: "Rope" }], t2: [] });
		expect(await recordExpeditionTakes(steading, { store })).toBe(1);
		expect(store.log.list[0].requisitioned).toEqual([{ name: "Wagon" }, { name: "Rope" }]);
		expect(await recordExpeditionTakes(steading, { store })).toBe(0);
		expect(store.write).toHaveBeenCalledTimes(1);
	});

	it("is left to the primary GM", async () => {
		fakes.primary = false;
		const store = memoryStore({ currentId: "t1", list: [{ id: "t1", title: "" }] });
		expect(await recordExpeditionTakes(steadingWith({ t1: [{ name: "Rope" }] }), { store })).toBe(0);
		game.user = { isGM: false };
		fakes.primary = true;
		expect(await recordExpeditionTakes(steadingWith({ t1: [{ name: "Rope" }] }), { store })).toBe(0);
		expect(store.write).not.toHaveBeenCalled();
	});
});
