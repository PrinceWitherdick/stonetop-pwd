import { describe, it, expect, beforeEach, afterEach } from "vitest";

// ONE TRACK DESCRIPTOR, PASSED HAND TO HAND, and the keys have to match the whole way.
//
// `trackForActor` mints `{trackId, trackKind, name}`. The tab hands that straight to the panel
// (timeline-tab.js), the panel hands it to the window's constructor (TimelinePanel extends it),
// and `_trackDescriptor` hands the same shape back OUT to `ensureTrackPage`, which mints the
// journal page. Nothing in that chain validates anything, and a key renamed at any hop reads as
// `""` and fails SILENTLY IN TWO PLACES:
//
//  • the window title and the entry dialog lose the thread's name; and, far worse,
//  • the first entry written on a track that has no page yet mints one titled `track.name ||
//    track.trackId` -- the RAW ACTOR ID -- and nothing renames it afterwards.
//
// That is exactly what a `trackName`/`name` mismatch between the store and the window's
// constructor did. Constructed for real here rather than through `Object.create`, because the
// constructor is the hop that broke and a hand-assembled instance cannot see it.

const { TimelineWindow } = await import("../../module/dialogs/TimelineWindow.js");
const { trackForActor } = await import("../../module/timeline/timeline-store.js");

const ELLIS = { id: "pc-ellis", type: "character", name: "Ellis" };

let savedGame;
beforeEach(() => {
	savedGame = globalThis.game;
	globalThis.game = {
		...globalThis.game,
		actors: Object.assign([ELLIS], { get: (id) => (id === ELLIS.id ? ELLIS : null) }),
		journal: [],
	};
});
afterEach(() => { globalThis.game = savedGame; });

describe("the track descriptor survives the trip from the store to the window", () => {
	it("reads the name off the very keys `trackForActor` writes", () => {
		const window = new TimelineWindow(trackForActor(ELLIS));

		expect(window._trackId).toBe("pc-ellis");
		expect(window._trackKind).toBe("character");
		expect(window._trackName, "the thread's name was dropped between the store and the window").toBe("Ellis");
	});

	it("titles the window with the thread rather than an empty name", () => {
		expect(new TimelineWindow(trackForActor(ELLIS)).title).toContain("Ellis");
	});

	// The page is minted ONCE and nothing renames it, so this is the assertion that matters most.
	it("hands `ensureTrackPage` a name and never the raw actor id", () => {
		const window = new TimelineWindow(trackForActor(ELLIS));
		expect(window._trackDescriptor("pc-ellis")).toEqual({
			trackId: "pc-ellis", trackKind: "character", name: "Ellis",
		});
	});

	// Belt and braces on the same failure: a window opened with no name at all still resolves one
	// off the live actor, so the worst case is a stale title and never a page called `pc-ellis`.
	it("resolves a missing name off the actor rather than minting a page named for its id", () => {
		const window = new TimelineWindow({ trackId: "pc-ellis", trackKind: "character" });
		expect(window._trackDescriptor("pc-ellis").name).toBe("Ellis");
	});

	// The aggregate takes no descriptor at all and must stay that way: it draws every track.
	it("leaves the aggregate trackless", () => {
		const window = new TimelineWindow();
		expect(window.isSingleTrack).toBe(false);
	});
});
