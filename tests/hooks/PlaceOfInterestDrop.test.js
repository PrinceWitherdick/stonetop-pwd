import { describe, it, expect, vi, beforeEach } from "vitest";
import {
	PLACE_OF_INTEREST_DRAG_TYPE,
	isLandmarkNote,
	landmarkLetterOf,
	landmarkNoteData,
	linkLandmarkNotes,
	onDropPlaceOfInterest,
	refitLandmarkNotes,
	revealLandmarkNotesOnce,
	switchToJournalNotesControls,
} from "../../module/hooks/PlaceOfInterestDrop.js";
import {
	MAP_PIN_FONT_SIZE, MAP_PIN_ICON_SIZE, PLACE_MARKER_ICON_SUFFIX, placeMarkerNoteData,
} from "../../module/utils/map-pins.js";
import { asColor } from "../fakes/color.js";

// The drop hook has to answer core synchronously, so it fires the note creation and
// returns. That chain now also resolves the pin's Chronicle page, so counting microtasks
// no longer works — drain the queue instead.
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

describe("PlaceOfInterestDrop", () => {
	beforeEach(() => {
		globalThis.CONST = { TEXT_ANCHOR_POINTS: { BOTTOM: 1 } };
		globalThis.game = { user: { can: vi.fn(() => true) } };
		globalThis.ui = {
			controls: { activate: vi.fn(async () => {}) },
			notifications: {
				info: vi.fn(),
				warn: vi.fn(),
				error: vi.fn(),
			},
		};
	});

	it("switches to journal Notes controls using the current Foundry API", async () => {
		const controls = { activate: vi.fn(async () => {}) };

		await switchToJournalNotesControls(controls);

		expect(controls.activate).toHaveBeenCalledWith({ control: "notes", tool: "select" });
	});

	it("falls back to the older controls initializer shape", async () => {
		const controls = { initialize: vi.fn(async () => {}) };

		await switchToJournalNotesControls(controls);

		expect(controls.initialize).toHaveBeenCalledWith({ layer: "notes", control: "notes", tool: "select" });
	});

	it("creates the place note, then switches the dropping user to Notes mode", async () => {
		const scene = {
			name: "Village",
			createEmbeddedDocuments: vi.fn(async () => {}),
		};

		const result = onDropPlaceOfInterest({ scene }, {
			type: PLACE_OF_INTEREST_DRAG_TYPE,
			x: 120,
			y: 240,
			letter: "C",
			name: "The Cistern",
		});
		await settle();

		expect(result).toBe(false);
		expect(scene.createEmbeddedDocuments).toHaveBeenCalledWith("Note", [expect.objectContaining({
			x: 120,
			y: 240,
			text: "The Cistern",
			texture: expect.objectContaining({
				src: "systems/stonetop-pwd/assets/icons/landmarks/landmark-c.svg",
			}),
		})]);
		expect(globalThis.ui.controls.activate).toHaveBeenCalledWith({ control: "notes", tool: "select" });
		expect(globalThis.ui.notifications.info).toHaveBeenCalledWith('Placed "The Cistern" on Village.');
	});

	// The regression that sent the whole village map GM-only. Foundry 14 makes a note with no
	// journal entry behind it visible to its AUTHOR alone (falling back to "authorless, or a
	// player wrote it" for everyone else), and it short-circuits before `global` is consulted —
	// so a pin the GM drops has to be written both public and unowned or the table cannot see it.
	it("writes every pin visible to players: unowned and immune to fog", () => {
		const note = landmarkNoteData({ x: 10, y: 20, letter: "a", name: "The Stone" });

		expect(note.global).toBe(true);
		expect(note.author).toBe(null);
	});

	it("drops a pin the players can see", async () => {
		const scene = { name: "Village", createEmbeddedDocuments: vi.fn(async () => {}) };

		onDropPlaceOfInterest({ scene }, {
			type: PLACE_OF_INTEREST_DRAG_TYPE, x: 1, y: 2, letter: "b", name: "The Granary",
		});
		await settle();

		expect(scene.createEmbeddedDocuments).toHaveBeenCalledWith("Note", [
			expect.objectContaining({ global: true, author: null }),
		]);
	});

	describe("isLandmarkNote", () => {
		it("claims a pin wearing one of our lettered discs", () => {
			expect(isLandmarkNote(landmarkNoteData({ x: 0, y: 0, letter: "d", name: "Cistern" }))).toBe(true);
		});

		it("claims one placed before the system-id rename", () => {
			expect(isLandmarkNote({
				texture: { src: "systems/stonetop_pwd/assets/icons/landmarks/landmark-f.svg" },
			})).toBe(true);
		});

		it("leaves other people's notes alone", () => {
			expect(isLandmarkNote({ texture: { src: "icons/svg/book.svg" } })).toBe(false);
			expect(isLandmarkNote({ texture: {} })).toBe(false);
			expect(isLandmarkNote(undefined)).toBe(false);
		});
	});

	describe("revealLandmarkNotesOnce", () => {
		// A pin as a pre-14 world stored it: no global visibility, owned by the GM who dropped it.
		const stalePin = (id, letter = "a") => ({
			id,
			global: false,
			_source: { author: "gm-user-id" },
			texture: { src: `systems/stonetop-pwd/assets/icons/landmarks/landmark-${letter}.svg` },
		});
		const sceneWith = (notes) => ({ notes, updateEmbeddedDocuments: vi.fn(async () => {}) });

		function world({ revealed = false } = {}) {
			const stored = { landmarkNotesRevealed: revealed };
			return {
				stored,
				read: (key) => stored[key],
				write: vi.fn(async (key, value) => { stored[key] = value; }),
			};
		}

		it("opens up every stale pin across every scene, then latches", async () => {
			const village = sceneWith([stalePin("n1", "a"), stalePin("n2", "b")]);
			const vicinity = sceneWith([stalePin("n3", "f")]);
			const { read, write, stored } = world();

			const revealed = await revealLandmarkNotesOnce({ scenes: [village, vicinity], isGM: true, read, write });

			expect(revealed).toBe(3);
			expect(village.updateEmbeddedDocuments).toHaveBeenCalledWith("Note", [
				{ _id: "n1", global: true, author: null },
				{ _id: "n2", global: true, author: null },
			]);
			expect(vicinity.updateEmbeddedDocuments).toHaveBeenCalledWith("Note", [
				{ _id: "n3", global: true, author: null },
			]);
			expect(stored.landmarkNotesRevealed).toBe(true);
		});

		it("leaves notes that are not ours alone", async () => {
			const scene = sceneWith([
				{ id: "book", global: false, _source: {}, texture: { src: "icons/svg/book.svg" } },
				{ id: "threat", global: true, _source: { author: "gm-user-id" }, texture: { src: "systems/stonetop-pwd/assets/icons/threat-note.svg" } },
			]);
			const { read, write } = world();

			expect(await revealLandmarkNotesOnce({ scenes: [scene], isGM: true, read, write })).toBe(0);
			expect(scene.updateEmbeddedDocuments).not.toHaveBeenCalled();
		});

		it("does not rewrite a pin that is already public", async () => {
			const scene = sceneWith([{ ...stalePin("n1"), global: true, _source: { author: null } }]);
			const { read, write } = world();

			expect(await revealLandmarkNotesOnce({ scenes: [scene], isGM: true, read, write })).toBe(0);
			expect(scene.updateEmbeddedDocuments).not.toHaveBeenCalled();
		});

		// v13 has no `author` field at all, so a pin there needs nothing but its global flag —
		// and once it has that, re-running must not keep writing to it.
		it("treats a v13 pin with global visibility as already done", async () => {
			const scene = sceneWith([{ id: "n1", global: true, _source: {}, texture: stalePin("n1").texture }]);
			const { read, write } = world();

			expect(await revealLandmarkNotesOnce({ scenes: [scene], isGM: true, read, write })).toBe(0);
		});

		it("stays out of a world that has already had its pins revealed", async () => {
			const scene = sceneWith([stalePin("n1")]);
			const { read, write } = world({ revealed: true });

			expect(await revealLandmarkNotesOnce({ scenes: [scene], isGM: true, read, write })).toBe(0);
			expect(scene.updateEmbeddedDocuments).not.toHaveBeenCalled();
			expect(write).not.toHaveBeenCalled();
		});

		it("does nothing at all for a player, who may not write either", async () => {
			const scene = sceneWith([stalePin("n1")]);
			const { read, write } = world();

			expect(await revealLandmarkNotesOnce({ scenes: [scene], isGM: false, read, write })).toBe(0);
			expect(scene.updateEmbeddedDocuments).not.toHaveBeenCalled();
			expect(write).not.toHaveBeenCalled();
		});

		// The flag is the only thing standing between a half-finished run and a world whose
		// remaining scenes are never visited again, so it must not be stamped ahead of the writes.
		it("leaves the flag unset when a scene write fails, so the next load retries", async () => {
			const broken = {
				notes: [stalePin("n1")],
				updateEmbeddedDocuments: vi.fn(async () => { throw new Error("no"); }),
			};
			const { read, write, stored } = world();

			await expect(revealLandmarkNotesOnce({ scenes: [broken], isGM: true, read, write })).rejects.toThrow();
			expect(stored.landmarkNotesRevealed).toBe(false);
		});
	});

	describe("landmarkLetterOf", () => {
		// The letter is nowhere on the note but its icon: the drag payload carries it, the
		// document that comes out keeps only the picture and the label.
		it("reads the letter back out of the pin's icon", () => {
			expect(landmarkLetterOf(landmarkNoteData({ x: 0, y: 0, letter: "D", name: "Cistern" }))).toBe("d");
			expect(landmarkLetterOf({ texture: { src: "systems/stonetop_pwd/assets/icons/landmarks/landmark-f.svg" } })).toBe("f");
		});

		it("is null for anything that is not one of ours", () => {
			expect(landmarkLetterOf({ texture: { src: "icons/svg/book.svg" } })).toBe(null);
			expect(landmarkLetterOf(undefined)).toBe(null);
		});

		// A letter outside A-R falls back to the generic book icon, which names no place.
		it("is null for a pin that fell back to the generic icon", () => {
			expect(landmarkLetterOf(landmarkNoteData({ x: 0, y: 0, letter: "z", name: "Nowhere" }))).toBe(null);
		});
	});

	describe("linkLandmarkNotes", () => {
		const pin = (id, letter, extra = {}) => ({
			id,
			entryId: null,
			texture: { src: `systems/stonetop-pwd/assets/icons/landmarks/landmark-${letter}.svg` },
			...extra,
		});
		const sceneWith = (notes) => ({ notes, updateEmbeddedDocuments: vi.fn(async () => {}) });
		const journal = { id: "journal-id" };
		const pageFor = (letters) => (_journal, letter) => (letters.includes(letter) ? { id: `page-${letter}` } : null);

		it("points every unlinked pin at its page", async () => {
			const scene = sceneWith([pin("n1", "a"), pin("n2", "d")]);
			const seed = vi.fn(async () => journal);

			const linked = await linkLandmarkNotes({
				scenes: [scene], isGM: true, seed, findPage: pageFor(["a", "d"]),
			});

			expect(linked).toBe(2);
			expect(scene.updateEmbeddedDocuments).toHaveBeenCalledWith("Note", [
				{ _id: "n1", entryId: "journal-id", pageId: "page-a" },
				{ _id: "n2", entryId: "journal-id", pageId: "page-d" },
			]);
		});

		// The guard that makes running this every load safe: a pin the GM re-pointed at a
		// journal of their own already has an entry, so it is never a candidate.
		it("never touches a pin that already opens something", async () => {
			const scene = sceneWith([pin("n1", "a", { entryId: "the-gm-s-own-journal" })]);
			const seed = vi.fn(async () => journal);

			expect(await linkLandmarkNotes({ scenes: [scene], isGM: true, seed, findPage: pageFor(["a"]) })).toBe(0);
			expect(scene.updateEmbeddedDocuments).not.toHaveBeenCalled();
		});

		// A world with no village map should not grow a journal it will never open.
		it("creates no journal for a world with no pins to link", async () => {
			const seed = vi.fn(async () => journal);

			expect(await linkLandmarkNotes({ scenes: [sceneWith([])], isGM: true, seed, findPage: pageFor([]) })).toBe(0);
			expect(seed).not.toHaveBeenCalled();
		});

		// Naming that letter on the steading sheet is all it then takes: the next load finds
		// the pin still unlinked and the page now there.
		it("leaves a pin alone when its letter is still a blank slot", async () => {
			const scene = sceneWith([pin("n1", "a"), pin("n2", "g")]);
			const seed = vi.fn(async () => journal);

			expect(await linkLandmarkNotes({ scenes: [scene], isGM: true, seed, findPage: pageFor(["a"]) })).toBe(1);
			expect(scene.updateEmbeddedDocuments).toHaveBeenCalledWith("Note", [
				{ _id: "n1", entryId: "journal-id", pageId: "page-a" },
			]);
		});

		it("does nothing for a player, who may not create journals", async () => {
			const scene = sceneWith([pin("n1", "a")]);
			const seed = vi.fn(async () => journal);

			expect(await linkLandmarkNotes({ scenes: [scene], isGM: false, seed, findPage: pageFor(["a"]) })).toBe(0);
			expect(seed).not.toHaveBeenCalled();
		});

		it("gives up quietly when the journal could not be seeded", async () => {
			const scene = sceneWith([pin("n1", "a")]);

			expect(await linkLandmarkNotes({
				scenes: [scene], isGM: true, seed: async () => null, findPage: pageFor(["a"]),
			})).toBe(0);
			expect(scene.updateEmbeddedDocuments).not.toHaveBeenCalled();
		});
	});

	describe("refitLandmarkNotes", () => {
		// A disc is written once and nothing ever went back to one, which was fine while the discs
		// were the only pins on their map. The village map now carries the captions its printing
		// letters too, so the two families sit inches apart and a size change to either leaves the
		// other visibly stale on every table that ran the older one.
		const disc = (id, over = {}) => ({
			id, texture: { src: "systems/stonetop-pwd/assets/icons/landmarks/landmark-c.svg" },
			iconSize: MAP_PIN_ICON_SIZE, fontSize: MAP_PIN_FONT_SIZE, textColor: "#1b1009",
			x: 100, y: 200, text: "The Public House",
			entryId: "journal-1", ...over,
		});
		const sceneWith = (notes) => ({ notes, updateEmbeddedDocuments: vi.fn(async () => {}) });

		it("brings a disc down to the size and label the map pins share", async () => {
			// The two sizes the discs shipped at before they had captions for company.
			const scene = sceneWith([disc("n1", { iconSize: 90, fontSize: 60 })]);
			expect(await refitLandmarkNotes({ scenes: [scene], isGM: true })).toBe(1);
			expect(scene.updateEmbeddedDocuments).toHaveBeenCalledWith("Note", [
				{ _id: "n1", fontSize: MAP_PIN_FONT_SIZE, iconSize: MAP_PIN_ICON_SIZE },
			]);
		});

		it("sets a disc and a marker at the same size, which is the point of sharing it", async () => {
			expect(landmarkNoteData({ x: 0, y: 0, letter: "a", name: "The Stone" }).iconSize)
				.toBe(MAP_PIN_ICON_SIZE);
			expect(placeMarkerNoteData({ x: 0, y: 0, name: "The Stream" }).iconSize)
				.toBe(MAP_PIN_ICON_SIZE);
		});

		it("is the same number the markers are set in, not a second copy of it", async () => {
			expect(landmarkNoteData({ x: 0, y: 0, letter: "a", name: "The Stone" }).fontSize)
				.toBe(MAP_PIN_FONT_SIZE);
		});

		it("writes nothing at all once they agree, since it runs on every load", async () => {
			const scene = sceneWith([disc("n1"), disc("n2")]);
			expect(await refitLandmarkNotes({ scenes: [scene], isGM: true })).toBe(0);
			expect(scene.updateEmbeddedDocuments).not.toHaveBeenCalled();
		});

		it("counts the ink as agreeing when a live disc hands it back as a Color", async () => {
			// The shape the test above cannot catch, and the one every real world is in: `textColor`
			// is a ColorField, so a Note document answers with a `Color` and never the string this
			// module declares. Compared with ===, no disc ever agrees and "silence in the steady
			// state" is silence this pass never keeps.
			const scene = sceneWith([disc("n1", { textColor: asColor("#1b1009") })]);
			expect(await refitLandmarkNotes({ scenes: [scene], isGM: true })).toBe(0);
			expect(scene.updateEmbeddedDocuments).not.toHaveBeenCalled();
		});

		it("still repaints a disc whose Color is genuinely the wrong ink", async () => {
			const scene = sceneWith([disc("n1", { textColor: asColor("#ffffff") })]);
			expect(await refitLandmarkNotes({ scenes: [scene], isGM: true })).toBe(1);
			expect(scene.updateEmbeddedDocuments).toHaveBeenCalledWith("Note", [
				{ _id: "n1", textColor: "#1b1009" },
			]);
		});

		it("leaves the position, the label and the link alone", async () => {
			// Those are the GM's the moment they touch them. Only the design is claimed.
			const scene = sceneWith([disc("n1", { fontSize: 60, x: 4321, text: "Renamed", entryId: "theirs" })]);
			// iconSize already agrees on this one, so the only design field left is the type size.
			await refitLandmarkNotes({ scenes: [scene], isGM: true });
			const [[, updates]] = scene.updateEmbeddedDocuments.mock.calls;
			expect(Object.keys(updates[0]).sort()).toEqual(["_id", "fontSize"]);
		});

		it("never touches a place marker, which the other pass owns", async () => {
			// The wide "is this ours" test claims markers too, since both families live in the same
			// folder. Resizing one here to a disc's 90 would have this pass and the marker reconcile
			// take turns resizing the same pin on every load, forever.
			const marker = {
				id: "m1", texture: { src: `systems/stonetop-pwd/${PLACE_MARKER_ICON_SUFFIX}` },
				iconSize: 70, fontSize: 45, textColor: "#1b1009",
			};
			const scene = sceneWith([marker]);
			expect(await refitLandmarkNotes({ scenes: [scene], isGM: true })).toBe(0);
			expect(scene.updateEmbeddedDocuments).not.toHaveBeenCalled();
		});

		it("leaves everyone else's notes alone, and does nothing for a player", async () => {
			const theirs = sceneWith([{ id: "x", texture: { src: "icons/svg/book.svg" }, fontSize: 60 }]);
			expect(await refitLandmarkNotes({ scenes: [theirs], isGM: true })).toBe(0);

			const ours = sceneWith([disc("n1", { fontSize: 60 })]);
			expect(await refitLandmarkNotes({ scenes: [ours], isGM: false })).toBe(0);
			expect(ours.updateEmbeddedDocuments).not.toHaveBeenCalled();
		});
	});

	it("does not claim unrelated canvas drops", () => {
		const scene = { createEmbeddedDocuments: vi.fn() };

		const result = onDropPlaceOfInterest({ scene }, { type: "Actor" });

		expect(result).toBeUndefined();
		expect(scene.createEmbeddedDocuments).not.toHaveBeenCalled();
		expect(globalThis.ui.controls.activate).not.toHaveBeenCalled();
	});
});
