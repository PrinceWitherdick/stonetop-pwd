import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
	TIMELINE_JOURNAL_NAME, TIMELINE_PAGE_TYPE,
	allTracks, findTimelineJournal, findTrackPage, readTrack, trackForActor, worldTracks,
} from "../../module/timeline/timeline-store.js";
import { TIMELINE_TRACK_STEADING, trackKey } from "../../module/timeline/timeline-core.js";
import { SYSTEM_ID } from "../../module/system-id.js";

// The document half of the timeline: which actors get a track, how a track page is found, and what
// the aggregate view reads. Creating documents is Foundry's job and is verified in the world; what
// is worth pinning here is the LOOKUP, because every one of these resolves a page by a flag and a
// lookup that quietly matches nothing is the failure mode this feature has.

const CHRONICLE_FOLDER = { id: "folder-1", type: "JournalEntry", name: "The Chronicle" };

/** A stand-in JournalEntryPage: enough surface for the store's flag lookups and sorting. */
function fakePage({ key, name, type = TIMELINE_PAGE_TYPE, sort = 0, system = {} }) {
	return {
		name, type, sort,
		system: { trackKind: "", trackId: "", entries: [], ...system },
		getFlag: (scope, flag) => (scope === SYSTEM_ID && flag === "chronicleKey" ? key : undefined),
	};
}

function fakeActors(list) {
	return {
		contents: list,
		find: (fn) => list.find(fn) ?? null,
		get: (id) => list.find(a => a.id === id) ?? null,
	};
}

/** Put a world in place: a Chronicle folder, a Timeline journal holding `pages`, and `actors`. */
function world({ pages = [], actors = [], folder = CHRONICLE_FOLDER, journalName = TIMELINE_JOURNAL_NAME } = {}) {
	const journal = { name: journalName, folder: folder ? { id: folder.id } : null, pages };
	global.game.folders = { contents: folder ? [folder] : [] };
	global.game.journal = { contents: [journal] };
	global.game.actors = fakeActors(actors);
	return journal;
}

const STEADING = { id: "steading-1", type: "stonetop", name: "Stonetop" };
const ELLIS = { id: "pc-ellis", type: "character", name: "Ellis" };
const KEFTA = { id: "pc-kefta", type: "character", name: "Kefta" };

let savedGame;
beforeEach(() => { savedGame = { ...global.game }; });
afterEach(() => { global.game = savedGame; });

describe("trackForActor", () => {
	// The steading's actor TYPE is "stonetop", not "steading". A hand-rolled type test here is the
	// classic way to give the steading no thread at all, silently.
	it("gives the steading the steading track", () => {
		expect(trackForActor(STEADING)).toMatchObject({ trackId: TIMELINE_TRACK_STEADING, trackKind: "steading" });
	});

	it("recognises a steading on the legacy customType shape", () => {
		const legacy = { id: "old", type: "npc", system: { customType: "stonetop" }, name: "Stonetop" };
		expect(trackForActor(legacy)?.trackKind).toBe("steading");
	});

	it("keys a character track by actor id", () => {
		expect(trackForActor(ELLIS)).toMatchObject({ trackId: "pc-ellis", trackKind: "character", name: "Ellis" });
	});

	// A monster, an NPC and the GM Toolkit are not threads of the campaign's story.
	it("gives no track to anything else", () => {
		expect(trackForActor({ id: "m", type: "monster" })).toBeNull();
		expect(trackForActor({ id: "n", type: "npc" })).toBeNull();
		expect(trackForActor({ id: "g", type: "gmToolkit" })).toBeNull();
		expect(trackForActor(null)).toBeNull();
	});
});

describe("worldTracks", () => {
	it("puts the steading first, then every character", () => {
		world({ actors: [ELLIS, STEADING, KEFTA] });
		expect(worldTracks().map(t => t.trackId)).toEqual([TIMELINE_TRACK_STEADING, "pc-ellis", "pc-kefta"]);
	});

	it("copes with a world that has no steading yet", () => {
		world({ actors: [ELLIS] });
		expect(worldTracks().map(t => t.trackId)).toEqual(["pc-ellis"]);
	});
});

describe("findTimelineJournal", () => {
	it("finds the Timeline journal inside The Chronicle folder", () => {
		world({ pages: [] });
		expect(findTimelineJournal()?.name).toBe(TIMELINE_JOURNAL_NAME);
	});

	// Read-only by contract: a player resolving their own tab must not conjure a folder, and could
	// not create one anyway.
	it("answers null rather than creating anything when the folder is absent", () => {
		world({ folder: null });
		expect(findTimelineJournal()).toBeNull();
	});

	it("does not mistake another journal in the folder for the timeline", () => {
		world({ journalName: "Seasons Change" });
		expect(findTimelineJournal()).toBeNull();
	});
});

describe("findTrackPage", () => {
	// Matched by the chronicleKey flag, never by name: a page found by name loses its history the
	// day the character is renamed.
	it("matches a page on its chronicleKey, not its name", () => {
		world({ pages: [fakePage({ key: trackKey("pc-ellis"), name: "Some Older Name" }) ] });
		expect(findTrackPage("pc-ellis")?.name).toBe("Some Older Name");
	});

	it("does not match another Chronicle page that happens to share the folder", () => {
		world({ pages: [fakePage({ key: "place:d", name: "Cistern" })] });
		expect(findTrackPage("d")).toBeNull();
	});

	it("answers null for a track nobody has written in yet", () => {
		world({ pages: [] });
		expect(findTrackPage("pc-kefta")).toBeNull();
	});
});

describe("readTrack", () => {
	it("reads a track's entries in reading order", () => {
		world({ pages: [fakePage({
			key: trackKey("pc-ellis"),
			name: "Ellis",
			system: { entries: [
				{ id: "b", year: 2, season: "spring", order: 0, title: "Later" },
				{ id: "a", year: 1, season: "autumn", order: 0, title: "Earlier" },
			] },
		})] });
		expect(readTrack("pc-ellis").entries.map(e => e.id)).toEqual(["a", "b"]);
	});

	// A missing page is a track nobody has written in yet, not an error: the tab renders its
	// invitation off `page === null`.
	it("answers an empty track rather than throwing when there is no page", () => {
		world({ pages: [] });
		expect(readTrack("pc-kefta")).toMatchObject({ page: null, entries: [] });
	});
});

describe("allTracks", () => {
	it("reads every track page in sort order, and only timeline pages", () => {
		world({
			pages: [
				fakePage({ key: trackKey("pc-ellis"), name: "Ellis", sort: 20 }),
				fakePage({ key: "place:d", name: "Cistern", type: "chronicle", sort: 5 }),
				fakePage({ key: trackKey(TIMELINE_TRACK_STEADING), name: "Stonetop", sort: 10 }),
			],
			actors: [STEADING, ELLIS],
		});
		expect(allTracks().map(t => t.trackId)).toEqual([TIMELINE_TRACK_STEADING, "pc-ellis"]);
	});

	it("names a track from its live actor, so a rename shows through", () => {
		world({
			pages: [fakePage({ key: trackKey("pc-ellis"), name: "Ellis the Younger" })],
			actors: [{ ...ELLIS, name: "Ellis the Elder" }],
		});
		expect(allTracks()[0].name).toBe("Ellis the Elder");
	});

	// The page is the record. A character who died and was removed from the world is exactly the
	// thread a chronicle should still read back.
	it("keeps the thread of a character who is no longer in the world", () => {
		world({ pages: [fakePage({ key: trackKey("pc-gone"), name: "Gethin" })], actors: [] });
		const [track] = allTracks();
		expect(track).toMatchObject({ trackId: "pc-gone", name: "Gethin", actor: null });
	});
});
