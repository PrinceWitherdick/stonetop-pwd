import { describe, it, expect } from "vitest";
import { expeditionMilestone, expeditionParty, partySnapshot, tripBoundToName, tripCredits } from "../../module/timeline/timeline-expedition.js";
import { readRepo } from "../fakes/css.js";

// AN EXPEDITION ON THE TIMELINE: who went, what the row says, and that only making the trip (Next)
// writes it -- never reading the walkthrough.

describe("who went", () => {
	const pcs = [{ id: "a", name: "Bram" }, { id: "b", name: "Cora" }, { id: "c", name: "Dov" }];

	it("is everyone not ticked out of the party on the Outfit step", () => {
		expect(expeditionParty({ partyOut: { b: true } }, pcs).map(p => p.id)).toEqual(["a", "c"]);
		expect(expeditionParty({}, pcs)).toHaveLength(3);
	});
});

describe("the row a trip writes", () => {
	const base = { tripId: "t1", label: "The Ford", place: "Marshedge" };

	it("is one row per trip, keyed by the trip", () => {
		const row = expeditionMilestone(base);
		expect(row).toEqual(expect.objectContaining({
			source: "expedition", key: "expedition:t1", title: "The Ford", place: "Marshedge",
		}));
	});

	it("says when they set out, who went, and a triumph, in that order", () => {
		const row = expeditionMilestone({ ...base, setOut: { season: "summer", year: 2 }, partyNames: ["Bram", "Cora"], triumphant: true });
		expect(row.body).toBe("<p>Set out in Summer, Year Two.</p><p>With Bram &amp; Cora.</p><p>Returned triumphant.</p>");
	});

	// A name is the player's own text, landing in HTML.
	it("escapes the names it prints", () => {
		expect(expeditionMilestone({ ...base, partyNames: ["<b>Bram</b>"] }).body).not.toContain("<b>");
	});

	// A triumph arriving after the row was written changes its words, never its title or date.
	it("lets only its words and place follow a re-record", () => {
		expect(expeditionMilestone(base).refresh).toEqual(["body", "place"]);
	});

	// Audit WLK-1: a homecoming redone moves the row to the season it is redone in.
	it("moves its date only when the homecoming is redone", () => {
		expect(expeditionMilestone({ ...base, redate: true }).refresh).toEqual(["body", "place", "season", "year"]);
	});

	// Audit WLK-8: a renamed trip's rows take the new name, while they still wear the old one.
	it("follows a rename while the row still wears the name it was written with", () => {
		const row = expeditionMilestone({ ...base, retitleFrom: "Expedition 3" });
		expect(row.refresh).toContain("title");
		expect(row.refreshWhile).toEqual({ title: "Expedition 3" });
		const same = expeditionMilestone({ ...base, retitleFrom: "The Ford" });
		expect(same.refresh).not.toContain("title");
		expect(same.refreshWhile).toBeUndefined();
	});

	// Audit WLK-9: one id per trip, so two GMs recording at once add one row, not two.
	it("carries an id made from the trip", () => {
		expect(expeditionMilestone(base).id).toBe("expedition-t1");
	});
});

// Audit WLK-6: who a trip credits is who set out, not who happens to be in play at the homecoming.
describe("who a trip credits", () => {
	const pcs = [{ id: "a", name: "Bram" }, { id: "b", name: "Cora" }, { id: "c", name: "Dov" }];

	it("snapshots the party as it sets out, less anyone ticked out", () => {
		expect(partySnapshot({ partyOut: { b: true } }, pcs)).toEqual([{ id: "a", name: "Bram" }, { id: "c", name: "Dov" }]);
	});

	it("credits the party that set out, the dead included, and keeps a deleted sheet's name", () => {
		const trip = { party: [{ id: "a", name: "Bram" }, { id: "c", name: "Dov" }, { id: "gone", name: "Eli" }] };
		// Dov died on the road: out of play, still on every character list.
		const { actors, names } = tripCredits(trip, pcs, pcs.filter(p => p.id !== "c"));
		expect(actors.map(a => a.id)).toEqual(["a", "c"]);
		expect(names).toEqual(["Bram", "Dov", "Eli"]);
	});

	it("leaves out a PC rolled up after they left, and one ticked out since", () => {
		const trip = { party: [{ id: "a", name: "Bram" }, { id: "b", name: "Cora" }], partyOut: { b: true } };
		expect(tripCredits(trip, pcs, pcs).names).toEqual(["Bram"]);
	});

	it("falls back to everyone in play not ticked out, for a trip that set out before the snapshot", () => {
		expect(tripCredits({ partyOut: { b: true } }, pcs, pcs.slice(0, 2)).names).toEqual(["Bram"]);
	});
});

describe("where they were bound", () => {
	it("is the picked destination, by the name the books give it", () => {
		expect(tripBoundToName({ journey: { destination: "the-maw" } })).toBe("the Maw");
	});

	it("is nowhere for a trip that has not picked one", () => {
		expect(tripBoundToName({})).toBe("");
		expect(tripBoundToName(null)).toBe("");
	});
});

describe("when the walkthrough writes it", () => {
	const SRC = readRepo("module/dialogs/ExpeditionDialog.js");

	// The table of contents, Back and a reload's restore only MOVE the reader; a trip they previewed
	// has not happened. StepperDialog says which move it was (tests/dialogs/stepper-step-entered.test.js);
	// the walkthrough acts on Next alone.
	it("records from Next alone, through the stepper's arrival hook", () => {
		expect(SRC).toMatch(/_onStepEntered\(key, \{ via \}\) \{\s*if \(via !== "next" \|\| !game\.user\?\.isGM\) return;/);
		// It no longer wraps the stepper's own navigation to find out.
		expect(SRC).not.toMatch(/^\t_advance\(\)/m);
		expect(SRC).not.toMatch(/^\t_goTo\(/m);
	});

	// The writer is shared; the walkthrough only hands it the window's own copy of the log.
	it("keeps no copy of the writer", () => {
		expect(SRC).toContain('import("../timeline/timeline-expedition-record.js")');
		expect(SRC).not.toContain("expeditionMilestone(");
		expect(SRC).not.toContain("recordOnTracks(");
	});

	// The move credits the trip itself, from either door, so the walkthrough no longer passes a
	// callback that does it.
	it("leaves the triumph to the move", () => {
		expect(SRC).toContain("openReturnTriumphant(found.steading, { fromWalkthrough: true });");
		expect(SRC).not.toMatch(/triumphant: true/);
	});
});
