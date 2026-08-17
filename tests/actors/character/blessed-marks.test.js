import { describe, it, expect } from "vitest";
import {
	BLESSED_MARKS_FLAG, MARK_KINDS, DEFAULT_KIND, SHARED_SOULS_LOYALTY,
	BARKSKIN, TRACKLESS_STEP, SHARED_SOULS, AMULETS_TALISMANS, WARDS_BINDINGS,
	canMarkBlessed, showBlessedMarks, availableKinds, markKind,
	readMarks, addMark, removeMark, noteMark, setMarkLoyalty, groupMarks,
} from "../../../module/actors/character/blessed-marks.js";

const actorWith = (...items) => ({ items });
const move = name => ({ type: "move", name });
const blessed = actorWith(move(BARKSKIN), move(SHARED_SOULS));

describe("who can lay a mark", () => {
	it("counts every one of the five marking moves", () => {
		for (const name of [BARKSKIN, TRACKLESS_STEP, SHARED_SOULS, AMULETS_TALISMANS, WARDS_BINDINGS]) {
			expect(canMarkBlessed(actorWith(move(name))), name).toBe(true);
		}
	});

	it("says no for a Blessed who has taken none of them", () => {
		expect(canMarkBlessed(actorWith(move("Spirit Tongue"), move("Big Magic")))).toBe(false);
		expect(canMarkBlessed(actorWith())).toBe(false);
		expect(canMarkBlessed(null)).toBe(false);
	});

	it("only counts MOVES, not anything else named the same", () => {
		expect(canMarkBlessed(actorWith({ type: "item", name: BARKSKIN }))).toBe(false);
	});

	// The add form offers what this character can actually lay, so a Blessed without Shared Souls
	// is never asked to name a beast.
	it("offers only the kinds whose move is owned, in roster order", () => {
		expect(availableKinds(blessed).map(k => k.key)).toEqual(["barkskin", "beast"]);
	});

	// Every kind, one at a time: its own move puts it on offer and no other kind with it. The
	// list assertion above pins one hand-picked pair, so a `move` renamed on one row of the
	// table — or two rows' moves swapped — would still satisfy it as long as the count held.
	for (const def of MARK_KINDS) {
		it(`offers "${def.label}" for "${def.move}", and nothing else`, () => {
			expect(availableKinds(actorWith(move(def.move))).map(k => k.key)).toEqual([def.key]);
		});
	}

	// The glyph and the add form answer the same question, so they must never disagree: a glyph
	// that lights over an empty form is a button that opens onto nothing.
	it("lights the glyph exactly when the form has something to offer", () => {
		for (const actor of [blessed, actorWith(), actorWith(move("Big Magic")), actorWith(move(BARKSKIN))]) {
			expect(canMarkBlessed(actor)).toBe(availableKinds(actor).length > 0);
		}
	});

	// Both take the sheet's one-pass Set when it has one. A falsy non-Set means "no Set was
	// passed", not something to call `.has` on — this used to throw where its sibling predicates
	// fell back to the scan.
	it("agrees whether it is handed the owned-move Set, builds its own, or is handed junk", () => {
		const names = new Set([BARKSKIN, SHARED_SOULS]);
		expect(availableKinds(blessed, names).map(k => k.key)).toEqual(["barkskin", "beast"]);
		for (const notASet of [null, undefined, 0, "", false]) {
			expect(canMarkBlessed(blessed, notASet), String(notASet)).toBe(true);
			expect(canMarkBlessed(actorWith(), notASet), String(notASet)).toBe(false);
		}
	});
});

describe("whether the glyph renders at all", () => {
	it("shows for anyone who can lay one", () => {
		expect(showBlessedMarks({ owns: true, count: 0 })).toBe(true);
	});

	it("keeps showing while marks stand on a sheet that lost the moves", () => {
		expect(showBlessedMarks({ owns: false, count: 2 })).toBe(true);
	});

	it("stays off an ordinary sheet", () => {
		expect(showBlessedMarks({ owns: false, count: 0 })).toBe(false);
		expect(showBlessedMarks({ owns: false, count: undefined })).toBe(false);
	});
});

describe("reading stored marks", () => {
	it("normalises a row and trims it", () => {
		const [row] = readMarks([{ id: "a", kind: "ward", name: "  the north gate ", note: " keeps them out " }]);
		expect(row).toEqual({
			id: "a", kind: "ward", name: "the north gate", uuid: "", note: "keeps them out", loyalty: null,
		});
	});

	// The store is a flag, which validates nothing.
	it("survives garbage", () => {
		expect(readMarks(null)).toEqual([]);
		expect(readMarks("nope")).toEqual([]);
		expect(readMarks([null, undefined, 7])).toEqual([]);
	});

	it("drops rows with no name, since they name nobody to lift", () => {
		expect(readMarks([{ name: "" }, { kind: "ward", name: "  " }, { name: "Aeronwen" }])).toHaveLength(1);
	});

	it("gives an id-less row a positional handle so it stays addressable", () => {
		const [a, b] = readMarks([{ name: "One" }, { name: "Two" }]);
		expect(a.id).toBe("mark-0");
		expect(b.id).toBe("mark-1");
	});

	// A future build renaming a key must not make old rows vanish: an unlisted row cannot be
	// lifted at all, which is worse than one filed under the wrong heading.
	it("falls back rather than dropping a row whose kind it does not know", () => {
		expect(readMarks([{ kind: "wildsoul", name: "Alun" }])[0].kind).toBe(DEFAULT_KIND);
		expect(readMarks([{ name: "Alun" }])[0].kind).toBe(DEFAULT_KIND);
	});
});

describe("Loyalty, which only a Shared Souls beast has", () => {
	it("is null on every other kind, never zero", () => {
		for (const key of ["barkskin", "trackless", "charm", "ward"]) {
			expect(readMarks([{ kind: key, name: "x" }])[0].loyalty, key).toBeNull();
		}
	});

	// A beast marked a moment ago is at full Loyalty; an absent value must fill the track rather
	// than render an exhausted one.
	it("starts a fresh beast at full", () => {
		expect(readMarks([{ kind: "beast", name: "the vixen" }])[0].loyalty).toBe(SHARED_SOULS_LOYALTY);
	});

	it("clamps a stored value into range and coerces nonsense", () => {
		const at = raw => readMarks([{ kind: "beast", name: "b", loyalty: raw }])[0].loyalty;
		expect(at(0)).toBe(0);
		expect(at(2)).toBe(2);
		expect(at(9)).toBe(SHARED_SOULS_LOYALTY);
		expect(at(-4)).toBe(0);
		expect(at("nope")).toBe(SHARED_SOULS_LOYALTY);
	});

	it("reports the end of the mark when the last one is spent", () => {
		const list = [{ id: "m", kind: "beast", name: "the vixen", loyalty: 1 }];
		expect(setMarkLoyalty(list, "m", 0)).toMatchObject({ ended: true });
		expect(setMarkLoyalty(list, "m", 2)).toMatchObject({ ended: false });
	});

	it("is a no-op on a kind that never had one", () => {
		const list = [{ id: "m", kind: "ward", name: "the gate" }];
		expect(setMarkLoyalty(list, "m", 1)).toMatchObject({ changed: null, ended: false });
	});

	// The mark going is part of the same act as the spend, so it is part of the same WRITE: a beast
	// row with an empty three-pip track is a state nothing should ever be shown.
	it("takes the row with it, in one result, when liftOnEnd is asked for", () => {
		const list = [{ id: "m", kind: "beast", name: "the vixen", loyalty: 1 }];
		const spent = setMarkLoyalty(list, "m", 0, { liftOnEnd: true });

		expect(spent.ended).toBe(true);
		expect(spent.changed).toMatchObject({ id: "m", loyalty: 0 });
		expect(spent.entries).toEqual([]);
	});

	it("leaves the exhausted row standing when liftOnEnd isn't asked for", () => {
		const list = [{ id: "m", kind: "beast", name: "the vixen", loyalty: 1 }];
		expect(setMarkLoyalty(list, "m", 0).entries).toHaveLength(1);
	});

	it("keeps a beast that still has Loyalty, liftOnEnd or not", () => {
		const list = [{ id: "m", kind: "beast", name: "the vixen", loyalty: 2 }];
		expect(setMarkLoyalty(list, "m", 1, { liftOnEnd: true }))
			.toMatchObject({ ended: false, entries: [{ id: "m", loyalty: 1 }] });
	});
});

describe("laying and lifting", () => {
	it("refuses a second mark of the SAME kind on one person", () => {
		const first = addMark([], { kind: "barkskin", name: "Aeronwen" }, () => "a").entries;
		expect(addMark(first, { kind: "barkskin", name: "aeronwen" }).added).toBeNull();
	});

	// The whole reason the roster is scoped by kind: nothing stops the same woman wearing Barkskin
	// and Trackless Step at once, and only Amulets & Talismans says otherwise about its own.
	it("allows a DIFFERENT kind on the same person", () => {
		const first = addMark([], { kind: "barkskin", name: "Aeronwen" }, () => "a").entries;
		const second = addMark(first, { kind: "trackless", name: "Aeronwen" }, () => "b");
		expect(second.added).not.toBeNull();
		expect(second.entries).toHaveLength(2);
	});

	it("refuses a nameless mark and writes nothing", () => {
		expect(addMark([], { kind: "ward", name: "   " }).added).toBeNull();
	});

	it("lifts one row by its own handle", () => {
		const { entries } = addMark([], { kind: "ward", name: "the gate" }, () => "w");
		expect(removeMark(entries, "w").removed).toMatchObject({ name: "the gate" });
		expect(removeMark(entries, "nope").removed).toBeNull();
	});

	it("re-words a mark, and reports no change when the text did not move", () => {
		const { entries } = addMark([], { kind: "ward", name: "the gate", note: "fae" }, () => "w");
		expect(noteMark(entries, "w", "fae").changed).toBeNull();
		expect(noteMark(entries, "w", "the fae").changed).toMatchObject({ note: "the fae" });
	});
});

describe("grouping for the roster", () => {
	it("keeps only kinds with rows or with the move owned", () => {
		const list = [{ kind: "ward", name: "the gate" }];
		const keys = groupMarks(list, blessed).map(g => g.def.key);
		// barkskin + beast are owned; ward has a row on a sheet that never took the move.
		expect(keys).toEqual(["barkskin", "beast", "ward"]);
	});

	it("filters a kind's own rows", () => {
		const list = [{ kind: "ward", name: "the gate" }, { kind: "barkskin", name: "Alun" }];
		const groups = groupMarks(list, blessed);
		expect(groups.find(g => g.def.key === "ward").rows.map(m => m.name)).toEqual(["the gate"]);
		expect(groups.find(g => g.def.key === "barkskin").rows.map(m => m.name)).toEqual(["Alun"]);
	});
});

// The gate is name-matched against the pack files, so a rename in either place silently stops
// offering the kind. This is the guard for that.
describe("the names the gate matches on", () => {
	it("spells the five moves exactly as the packs do", () => {
		expect(MARK_KINDS.map(k => k.move)).toEqual([
			"Barkskin", "Trackless Step", "Shared Souls", "Amulets & Talismans", "Wards & Bindings",
		]);
	});

	it("keys the flag on blessedMarks, and every kind resolves", () => {
		expect(BLESSED_MARKS_FLAG).toBe("blessedMarks");
		for (const def of MARK_KINDS) expect(markKind(def.key), def.key).toBe(def);
	});
});
