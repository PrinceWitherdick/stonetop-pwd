import { describe, it, expect, afterEach } from "vitest";
import {
	clampHearts, readRelationship, relationshipRow, relationSummary,
	setRelationshipHearts, setRelationshipNote, setRelationshipShown,
	buildRelationshipRows, relationshipDropResult, relationshipDropNotice,
	HEARTS_DEFAULT, HEARTS_MAX, readOrder, updateRelationships,
} from "../../module/utils/relationship-hearts.js";

// A fake actor that records the update patch, so the tests can assert on the exact
// ENTRY SHAPE written — which is the load-bearing detail: `shown` must stay absent
// until someone actually sets it, or today's per-group default freezes into world data.
function fakeActor(relationships = {}, name = "Aldric") {
	return {
		name,
		system: { relationships },
		patches: [],
		async update(patch) { this.patches.push(patch); },
		get lastEntry() {
			const patch = this.patches.at(-1) ?? {};
			return Object.values(patch)[0];
		},
		get lastKey() { return Object.keys(this.patches.at(-1) ?? {})[0]; },
	};
}

const other = (id = "vera", name = "Vera", img = null) => ({ id, name, img });

describe("clampHearts", () => {
	it("holds the 1-5 range and coerces a real number", () => {
		expect(clampHearts(0)).toBe(1);
		expect(clampHearts(-4)).toBe(1);
		expect(clampHearts(6)).toBe(5);
		expect(clampHearts("3")).toBe(3);
		expect(clampHearts(3.9)).toBe(3);
	});

	// The map is an unvalidated ObjectField, so a corrupt value must not become NaN —
	// that would empty the hearts and index the feeling table out of range. Neutral is
	// the honest reading of garbage; the 1-heart minimum would assert active hatred.
	it("falls back to neutral, never NaN, for a non-numeric value", () => {
		expect(clampHearts(undefined)).toBe(HEARTS_DEFAULT);
		expect(clampHearts("nonsense")).toBe(HEARTS_DEFAULT);
		expect(clampHearts(null)).toBe(HEARTS_DEFAULT);
		expect(clampHearts(Infinity)).toBe(HEARTS_DEFAULT);
	});
});

describe("readRelationship", () => {
	it("defaults an absent entry to neutral, with no note, visibility choice or position", () => {
		expect(readRelationship(undefined))
			.toEqual({ hearts: HEARTS_DEFAULT, notes: "", shown: undefined, order: null });
	});

	it("reads the legacy bare-number shape early builds stored", () => {
		expect(readRelationship(4)).toEqual({ hearts: 4, notes: "", shown: undefined, order: null });
	});

	it("reads the object shape and clamps a bad rating", () => {
		expect(readRelationship({ hearts: 99, notes: "owes a debt", shown: false, order: 2 }))
			.toEqual({ hearts: 5, notes: "owes a debt", shown: false, order: 2 });
	});

	it("treats a non-boolean shown as unset, so the caller's default still applies", () => {
		expect(readRelationship({ hearts: 3, shown: "yes" }).shown).toBeUndefined();
	});
});

describe("relationshipRow", () => {
	it("applies the caller's default when nobody has ticked the box", () => {
		const actor = fakeActor();
		expect(relationshipRow(actor, other(), { defaultShown: true }).shown).toBe(true);
		expect(relationshipRow(actor, other(), { defaultShown: false }).shown).toBe(false);
	});

	it("lets a stored choice outrank the default, in both directions", () => {
		const hidden = fakeActor({ vera: { hearts: 3, notes: "", shown: false } });
		expect(relationshipRow(hidden, other(), { defaultShown: true }).shown).toBe(false);
		const shown = fakeActor({ vera: { hearts: 3, notes: "", shown: true } });
		expect(relationshipRow(shown, other(), { defaultShown: false }).shown).toBe(true);
	});

	it("builds one slot per heart, filled up to the rating", () => {
		const actor = fakeActor({ vera: { hearts: 2 } });
		const row = relationshipRow(actor, other());
		expect(row.heartSlots).toHaveLength(HEARTS_MAX);
		expect(row.heartSlots.filter(s => s.filled)).toHaveLength(2);
		expect(row.heartSlots.map(s => s.position)).toEqual([1, 2, 3, 4, 5]);
	});

	it("drops Foundry's placeholder art so the template can pick its own icon", () => {
		const actor = fakeActor();
		expect(relationshipRow(actor, other("v", "Vera", "icons/svg/mystery-man.svg")).img).toBeNull();
		expect(relationshipRow(actor, other("v", "Vera", "art/vera.webp")).img).toBe("art/vera.webp");
	});

	it("works for a non-actor row keyed by slug (the steading's settlements)", () => {
		const steading = fakeActor({ marshedge: { hearts: 5 } }, "Stonetop");
		const row = relationshipRow(steading, { id: "marshedge", name: "Marshedge", img: null });
		expect(row.id).toBe("marshedge");
		expect(row.hearts).toBe(5);
		expect(row.feeling).toBe("Stonetop loves Marshedge");
	});
});

describe("relationSummary", () => {
	it("reads as a sentence about the pair, one per rating", () => {
		expect(relationSummary(1, "Vera", "Aldric")).toBe("Vera hates Aldric");
		expect(relationSummary(3, "Vera", "Aldric")).toBe("Vera feels neutral toward Aldric");
		expect(relationSummary(5, "Vera", "Aldric")).toBe("Vera loves Aldric");
	});
});

describe("write helpers", () => {
	it("writes the whole entry under the id, never a nested key", async () => {
		const actor = fakeActor();
		await setRelationshipHearts(actor, "vera", 4);
		expect(actor.lastKey).toBe("system.relationships.vera");
		expect(actor.lastEntry).toEqual({ hearts: 4 });
	});

	it("omits `shown` until it has actually been chosen", async () => {
		const actor = fakeActor();
		await setRelationshipHearts(actor, "vera", 4);
		expect("shown" in actor.lastEntry).toBe(false);
	});

	it("carries an existing `shown` through a rating or note change", async () => {
		const actor = fakeActor({ vera: { hearts: 3, notes: "n", shown: false } });
		await setRelationshipHearts(actor, "vera", 5);
		expect(actor.lastEntry).toEqual({ hearts: 5, notes: "n", shown: false });
		await setRelationshipNote(actor, "vera", "rewritten");
		expect(actor.lastEntry).toEqual({ hearts: 3, notes: "rewritten", shown: false });
	});

	it("steps the rating down when you click the last filled heart", async () => {
		const actor = fakeActor({ vera: { hearts: 4 } });
		await setRelationshipHearts(actor, "vera", 4);
		expect(actor.lastEntry.hearts).toBe(3);
	});

	it("never drops a relationship below one heart", async () => {
		const actor = fakeActor({ vera: { hearts: 1 } });
		await setRelationshipHearts(actor, "vera", 1);
		expect(actor.lastEntry.hearts).toBe(1);
	});

	it("setRelationshipShown records an explicit boolean, replacing a legacy number", async () => {
		const actor = fakeActor({ vera: 2 });
		await setRelationshipShown(actor, "vera", true);
		// The bare number is carried up into `hearts` — it IS a rating — but no `notes` is
		// invented for a row that never had one.
		expect(actor.lastEntry).toEqual({ hearts: 2, shown: true });
	});
});

// A rating is a judgment about someone. Ticking their visibility box or jotting a note is
// not — but both used to persist the neutral DEFAULT as though it were a verdict, because
// updateRelationship always wrote the whole entry. That made the board's "never rated"
// dimming wrong, made committing an unrated card to Neutral a silent no-op, and made the
// NPC ledger log "set to Neutral (3)" for a show-box tick.
describe("a rating is only stored once someone actually rates", () => {
	it("does not persist hearts when only the visibility box is ticked", async () => {
		const actor = fakeActor();
		await setRelationshipShown(actor, "vera", true);
		// Only the box. Not the neutral default rating, and not a blank note either.
		expect(actor.lastEntry).toEqual({ shown: true });
		expect("hearts" in actor.lastEntry).toBe(false);
	});

	it("does not persist hearts when only a note is written", async () => {
		const actor = fakeActor();
		await setRelationshipNote(actor, "vera", "owes me money");
		expect(actor.lastEntry).toEqual({ notes: "owes me money" });
	});

	it("still reads back as neutral, so nothing downstream sees a hole", async () => {
		const actor = fakeActor();
		await setRelationshipNote(actor, "vera", "owes me money");
		actor.system.relationships.vera = actor.lastEntry;
		const row = relationshipRow(actor, other());
		expect(row.hearts).toBe(HEARTS_DEFAULT);
		expect(row.notes).toBe("owes me money");
	});

	it("reports `rated` false after a reveal or a note, true after an actual rating", async () => {
		const revealed = fakeActor({ vera: { notes: "", shown: true } });
		expect(relationshipRow(revealed, other()).rated).toBe(false);

		const noted = fakeActor({ vera: { notes: "owes me money" } });
		expect(relationshipRow(noted, other()).rated).toBe(false);

		const judged = fakeActor({ vera: { hearts: 3, notes: "" } });
		expect(relationshipRow(judged, other()).rated).toBe(true);
	});

	it("treats the legacy bare-number shape as rated — the number IS the rating", () => {
		expect(relationshipRow(fakeActor({ vera: 3 }), other()).rated).toBe(true);
	});

	it("keeps an existing rating when a later write only touches the note or visibility", async () => {
		const actor = fakeActor({ vera: { hearts: 5, notes: "" } });
		await setRelationshipShown(actor, "vera", false);
		expect(actor.lastEntry).toEqual({ hearts: 5, notes: "", shown: false });
	});
});

// buildRelationshipRows reads game.actors to resolve stored-but-uncovered ids.
const withWorldActors = docs => { global.game.actors = { get: id => docs.find(d => d.id === id) ?? null }; };
afterEach(() => { delete global.game.actors; });

describe("buildRelationshipRows", () => {
	const pc = (id, name) => ({ id, name, img: null, type: "character" });
	const npc = (id, name) => ({ id, name, img: null, type: "npc" });

	it("keeps group order and each group's own default visibility", () => {
		withWorldActors([]);
		const actor = fakeActor();
		const rows = buildRelationshipRows(actor, [
			{ actors: [pc("v", "Vera")], defaultShown: true },
			{ actors: [npc("b", "Blodwen")], defaultShown: false },
		]);
		expect(rows.map(r => [r.name, r.shown])).toEqual([["Vera", true], ["Blodwen", false]]);
	});

	it("never lists the sheet's own actor", () => {
		withWorldActors([]);
		const actor = fakeActor({}, "Aldric");
		actor.id = "self";
		const rows = buildRelationshipRows(actor, [{ actors: [pc("self", "Aldric"), pc("v", "Vera")] }]);
		expect(rows.map(r => r.id)).toEqual(["v"]);
	});

	it("adds a stored id no group covered — how a dropped person stays a row", () => {
		const stranger = npc("wanderer", "Wandering Stranger");
		withWorldActors([stranger]);
		const actor = fakeActor({ wanderer: { hearts: 3, notes: "", shown: true } });
		const rows = buildRelationshipRows(actor, [{ actors: [] }]);
		expect(rows.map(r => r.name)).toEqual(["Wandering Stranger"]);
	});

	it("keeps a stored extra listed after it is unticked, so it can be re-shown", () => {
		const stranger = npc("wanderer", "Wandering Stranger");
		withWorldActors([stranger]);
		const actor = fakeActor({ wanderer: { hearts: 3, notes: "", shown: false } });
		const rows = buildRelationshipRows(actor, [{ actors: [] }]);
		expect(rows).toHaveLength(1);
		expect(rows[0].shown).toBe(false);
	});

	it("drops a stored id whose actor is gone, and never double-lists one a group has", () => {
		withWorldActors([pc("v", "Vera")]);
		const actor = fakeActor({ v: { hearts: 4 }, deleted: { hearts: 2 } });
		const rows = buildRelationshipRows(actor, [{ actors: [pc("v", "Vera")] }]);
		expect(rows.map(r => r.id)).toEqual(["v"]);
	});

	it("ignores slug keys, so a steading's settlements map adds no phantom rows", () => {
		withWorldActors([]);
		const steading = fakeActor({ marshedge: { hearts: 5 } }, "Stonetop");
		expect(buildRelationshipRows(steading, [{ actors: [] }])).toEqual([]);
	});
});

describe("relationshipDropResult", () => {
	const actor = () => Object.assign(fakeActor(), { id: "self" });
	const rows = shown => [{ id: "vera", shown }];

	it("adds someone with no row yet", async () => {
		const a = actor();
		expect(await relationshipDropResult(a, { id: "vera", type: "character" }, [])).toBe("added");
		expect(a.lastEntry.shown).toBe(true);
	});

	it("reveals a row that exists but is hidden", async () => {
		const a = actor();
		expect(await relationshipDropResult(a, { id: "vera", type: "character" }, rows(false))).toBe("revealed");
		expect(a.lastEntry.shown).toBe(true);
	});

	it("no-ops on someone already visible, without writing", async () => {
		const a = actor();
		expect(await relationshipDropResult(a, { id: "vera", type: "character" }, rows(true))).toBe("already");
		expect(a.patches).toHaveLength(0);
	});

	// A pack entry's id means nothing to game.actors, so storing it would write a key
	// buildRelationshipRows can never turn into a row — while the notice said "added".
	it("refuses a compendium actor rather than storing an id no row can resolve", async () => {
		const a = actor();
		const doc = { id: "packEntry", type: "npc", pack: "world.villagers" };
		expect(await relationshipDropResult(a, doc, [])).toBe("compendium");
		expect(a.patches).toHaveLength(0);
	});

	it("refuses self, non-people, and a sheet you can't edit — writing nothing", async () => {
		for (const [doc, opts, expected] of [
			[{ id: "self", type: "character" }, {}, "self"],
			[{ id: "x", type: "monster" }, {}, "unsupported"],
			[null, {}, "unsupported"],
			[{ id: "vera", type: "character", pack: "world.villagers" }, {}, "compendium"],
			[{ id: "vera", type: "character" }, { editable: false }, "readonly"],
		]) {
			const a = actor();
			expect(await relationshipDropResult(a, doc, [], opts)).toBe(expected);
			expect(a.patches).toHaveLength(0);
		}
	});
});

describe("relationshipDropNotice", () => {
	it("names the dropped person, and reports the sheet's own actor for a self-drop", () => {
		expect(relationshipDropNotice("added", { name: "Aldric" }, { name: "Vera" }))
			.toEqual(["info", "Vera added to Relationships."]);
		expect(relationshipDropNotice("self", { name: "Aldric" }, { name: "Aldric" }))
			.toEqual(["warn", "Aldric can't have a relationship with themselves."]);
	});

	it("warns rather than informs on every refusal", () => {
		for (const r of ["self", "readonly", "unsupported", "compendium"]) {
			expect(relationshipDropNotice(r, { name: "A" }, { name: "B" })[0]).toBe("warn");
		}
		for (const r of ["added", "revealed", "already"]) {
			expect(relationshipDropNotice(r, { name: "A" }, { name: "B" })[0]).toBe("info");
		}
	});
});

describe("readOrder", () => {
	// A position comes out of an ObjectField, which validates nothing, so every shape a
	// hand-edited world could hold has to read as SOMETHING — and "unplaced" is the only
	// safe answer for a value that is not a slot number.
	it("accepts a whole non-negative index and refuses everything else", () => {
		expect(readOrder(0)).toBe(0);
		expect(readOrder(7)).toBe(7);
		for (const junk of [null, undefined, -1, 1.5, "2", "", NaN, Infinity, true, {}]) {
			expect(readOrder(junk)).toBeNull();
		}
	});
});

describe("relationship positions in storage", () => {
	// Sparse, like every other field here. A rating or a note on a board nobody has arranged
	// must not start writing a position into world data.
	it("stores nothing for a row nobody has placed", async () => {
		const actor = fakeActor();
		await setRelationshipNote(actor, "vera", "owes a debt");
		expect(actor.lastEntry).toEqual({ notes: "owes a debt" });
	});

	// The one field re-emitted from STORAGE rather than left to the merge. An omitted key
	// keeps whatever core had, which is very probably fine — but "very probably" is not a
	// thing to hang a lane's arrangement on, and one integer is a cheap way not to care.
	it("carries an existing position through an unrelated write", async () => {
		const actor = fakeActor({ vera: { hearts: 4, order: 2 } });
		await setRelationshipNote(actor, "vera", "owes a debt");
		expect(actor.lastEntry).toEqual({ hearts: 4, notes: "owes a debt", order: 2 });
	});

	// Cleared with a stored null rather than by dropping the key. `-=` is the reliable way
	// to delete, but only as a dotted leaf path — and the same write carries the new rating,
	// so the two would have to share one path under `system.relationships.<id>`.
	it("clears a position with an explicit null, which reads back as unplaced", async () => {
		const actor = fakeActor({ vera: { hearts: 4, order: 2 } });
		await updateRelationships(actor, { vera: { order: null } });
		expect(actor.lastEntry).toEqual({ hearts: 4, order: null });
		expect(readRelationship(actor.lastEntry).order).toBeNull();
	});

	it("patches several rows in one update, and none at all when handed nothing", async () => {
		const actor = fakeActor({ a: { hearts: 4 }, b: { hearts: 2 } });
		await updateRelationships(actor, { a: { order: 1 }, b: { order: 0 } });
		expect(actor.patches).toHaveLength(1);
		expect(actor.patches[0]).toEqual({
			"system.relationships.a": { hearts: 4, order: 1 },
			"system.relationships.b": { hearts: 2, order: 0 },
		});
		await updateRelationships(actor, {});
		expect(actor.patches).toHaveLength(1);
	});

	it("hands the row builder the stored position, for the board to sort by", () => {
		const actor = fakeActor({ vera: { hearts: 4, order: 3 } });
		expect(relationshipRow(actor, { id: "vera", name: "Vera" }).order).toBe(3);
		expect(relationshipRow(actor, { id: "bran", name: "Bran" }).order).toBeNull();
	});
});
