import { describe, it, expect } from "vitest";
import { TIMELINE_LEDGER_CATEGORIES, isTimelineWorthy, ledgerTimelineRows } from "../../module/timeline/timeline-auto-rows.js";
import { normalizeEntry, sortEntries } from "../../module/timeline/timeline-core.js";

// WHAT THE SYSTEM ALREADY WROTE DOWN, ON THE TIMELINE. The ledger is an audit trail: it records
// every point of HP and every tick of a supply. A timeline that folded those in would bury the one
// line somebody actually wrote about that season under forty rows of bookkeeping, so the filter is
// the whole design and is what these tests are mostly about.

const LOG = [
	{ key: "1:spring", year: 1, season: "spring", at: 1_000 },
	{ key: "1:summer", year: 1, season: "summer", at: 2_000 },
];

function ledgerEntry(over = {}) {
	return { id: "l1", timestamp: 1_500, action: "Level changed from 3 to 4", category: "leveling", ...over };
}

describe("what earns a place", () => {
	it("keeps the handful of things a reader would have written down themselves", () => {
		for (const category of TIMELINE_LEDGER_CATEGORIES) {
			expect(isTimelineWorthy(ledgerEntry({ category })), category).toBe(true);
		}
	});

	// Each of these changes many times a session. The ledger wants them; a timeline does not.
	it("drops the bookkeeping", () => {
		for (const category of ["stats", "inventory", "relations", "notes", "followers", "other"]) {
			expect(isTimelineWorthy(ledgerEntry({ category, action: "HP changed from 6 to 4" })), category).toBe(false);
		}
	});

	// A wound is worth a row and lives under `stats`, which as a whole is not. Matched on the action
	// text rather than by inventing a category for the timeline's benefit, which would have to be
	// threaded through CharacterLedger for no other reader.
	it("keeps a wound out of the stats it is filed under", () => {
		expect(isTimelineWorthy(ledgerEntry({ category: "stats", action: 'Wound recorded: "gut wound"' }))).toBe(true);
		expect(isTimelineWorthy(ledgerEntry({ category: "stats", action: "Wound healed to a scar: gut wound" }))).toBe(true);
	});

	it("is safe on nothing at all", () => {
		expect(isTimelineWorthy(null)).toBe(false);
		expect(isTimelineWorthy({})).toBe(false);
	});
});

describe("ledgerTimelineRows", () => {
	it("dates a row by the season the campaign was in when it happened", () => {
		const [row] = ledgerTimelineRows([ledgerEntry({ timestamp: 2_500 })], LOG);
		expect(row).toMatchObject({ season: "summer", year: 1 });
	});

	// Every world in play before this shipped has a ledger going back further than its log. Filing
	// those under the first recorded season would invent a date; the timeline has a block for them.
	it("leaves a row from before the log undated rather than guessing", () => {
		const [row] = ledgerTimelineRows([ledgerEntry({ timestamp: 500 })], LOG);
		expect(row.season).toBe("");
	});

	it("prints the ledger's own wording, which is already written to be read", () => {
		const [row] = ledgerTimelineRows([ledgerEntry({ action: "Moves learned (3): Aid, Clash, Defend" })], LOG);
		expect(row.title).toBe("Moves learned (3): Aid, Clash, Defend");
	});

	// A bare "XP changed from 4 to 5" does not say why. Naming the move that caused it is what makes
	// the row worth a place, and is the same attribution the ledger dialog itself prints.
	it("names the move that caused it, where one was recorded", () => {
		const [row] = ledgerTimelineRows([ledgerEntry({ action: "XP changed from 4 to 5", move: "Defy Danger" })], LOG);
		expect(row.title).toBe("XP changed from 4 to 5 (via Defy Danger)");
	});

	it("drops the bookkeeping on the way through", () => {
		const rows = ledgerTimelineRows([
			ledgerEntry({ id: "a", category: "leveling" }),
			ledgerEntry({ id: "b", category: "stats", action: "HP changed from 6 to 4" }),
			ledgerEntry({ id: "c", category: "moves" }),
		], LOG);
		expect(rows.map(r => r.id)).toEqual(["ledger:a", "ledger:c"]);
	});

	// ⚠ A card's id is what a click is read back against. A ledger id equal to a stored entry's
	// would point an edit at the wrong record, and a stored id is an alphanumeric randomID, so the
	// colon puts these in a namespace the other cannot reach.
	it("puts its ids in a namespace a stored entry cannot reach", () => {
		const [row] = ledgerTimelineRows([ledgerEntry({ id: "abc123" })], LOG);
		expect(row.id).toBe("ledger:abc123");
		// And it survives normalisation, which strips dots from an id but not colons.
		expect(normalizeEntry(row).id).toBe("ledger:abc123");
	});

	// The source is what the view model reads to mark a row as derived and take its controls off.
	// If it were a value timeline-core did not accept, every one of these would come back marked as
	// somebody's own writing.
	it("survives normalisation still marked as derived", () => {
		const [row] = ledgerTimelineRows([ledgerEntry()], LOG);
		expect(normalizeEntry(row).source).toBe("ledger");
	});

	// Order 0, so a typed entry (which is given a real slot when it is added) always sorts above the
	// bookkeeping of the same season.
	it("sorts below the entries somebody actually typed in that season", () => {
		const typed = { id: "typed", season: "summer", year: 1, order: 0, title: "The barrow", source: "hand" };
		const derived = ledgerTimelineRows([ledgerEntry({ timestamp: 2_500 })], LOG);
		// A typed entry added to a season with one already in it lands at order 1; the derived rows
		// stay at 0 and so read first. What matters is that the two are ordered at all, not which.
		const sorted = sortEntries([...derived, { ...typed, order: 1 }]);
		expect(sorted.map(e => e.source)).toEqual(["ledger", "hand"]);
	});

	it("answers empty for a world with no ledger and no log", () => {
		expect(ledgerTimelineRows([], [])).toEqual([]);
		expect(ledgerTimelineRows()).toEqual([]);
	});
});
