import { describe, it, expect } from "vitest";
import { SteadingLedger } from "../../../module/actors/steading/SteadingLedger.js";
import { ledgerNoun } from "../../../module/utils/ledger-core.js";

function steadingUpdate(steading) {
	return { flags: { stonetop: { steading } } };
}

function makeActor(flags = {}) {
	return {
		type: "stonetop",
		flags,
	};
}

describe("SteadingLedger", () => {
	it("records silver and gold denomination changes distinctly", () => {
		const actor = makeActor({
			stonetop: {
				steading: {
					silver: { purses: 1, handfuls: 2, coins: 3 },
					gold: { purses: 0, handfuls: 1, coins: 2 },
				},
			},
		});

		const entries = SteadingLedger.entriesForActorUpdate(actor, {
			flags: {
				stonetop: {
					steading: {
						silver: { purses: 2, handfuls: 2, coins: 4 },
						gold: { purses: 1, handfuls: 1, coins: 3 },
					},
				},
			},
		});

		expect(entries.map(e => e.action)).toEqual([
			"Silver purses changed from 1 to 2",
			"Silver coins changed from 3 to 4",
			"Gold purses changed from 0 to 1",
			"Gold coins changed from 2 to 3",
		]);
	});

	it("records fortification list changes without object formatting", () => {
		const actor = makeActor({
			stonetop: {
				steading: {
					fortifications: [
						{ name: "Village militia", checked: true },
						{ name: "The Ringwall", checked: false },
						{ name: "Some bows", checked: true },
						{ name: "", checked: false },
					],
				},
			},
		});

		const entries = SteadingLedger.entriesForActorUpdate(actor, {
			flags: {
				stonetop: {
					steading: {
						fortifications: [
							{ name: "Village militia", checked: true },
							{ name: "The Ringwall", checked: true },
							{ name: "Many bows", checked: false },
							{ name: "Palisade", checked: true },
						],
					},
				},
			},
		});

		expect(entries.map(e => e.action)).toEqual([
			"The Ringwall selected",
			"Fortification renamed from Some bows to Many bows",
			"Many bows deselected",
			"Fortification added: Palisade",
			"Palisade selected",
		]);
		expect(entries.map(e => e.action).join(" ")).not.toContain("[object Object]");
	});

	it("records place changes by map letter", () => {
		const actor = makeActor({
			stonetop: {
				steading: {
					places: [
						{ letter: "A", name: "The Stone" },
						{ letter: "B", name: "" },
						{ letter: "C", name: "Cistern" },
					],
				},
			},
		});

		const entries = SteadingLedger.entriesForActorUpdate(actor, {
			flags: {
				stonetop: {
					steading: {
						places: [
							{ letter: "A", name: "The Old Stone" },
							{ letter: "B", name: "Smithy" },
							{ letter: "C", name: "" },
						],
					},
				},
			},
		});

		expect(entries.map(e => e.action)).toEqual([
			"Place A changed from The Stone to The Old Stone",
			"Place B set to Smithy",
			"Place C cleared (Cistern)",
		]);
	});

	it("records neighbor changes with home and trait text", () => {
		const actor = makeActor({
			stonetop: {
				steading: {
					neighbors: [
						{ name: "Ennis", home: "Marshedge", traits: "generous", checked: true },
						{ name: "Shahar", home: "Gordin's Delve", traits: "", checked: false },
					],
				},
			},
		});

		const entries = SteadingLedger.entriesForActorUpdate(actor, {
			flags: {
				stonetop: {
					steading: {
						neighbors: [
							{ name: "Ennis", home: "Marshedge", traits: "wary", checked: true },
							{ name: "Shahar", home: "Gordin's Delve", traits: "ambitious", checked: true },
							{ name: "Tovia", home: "Lygos", traits: "", checked: true },
						],
					},
				},
			},
		});

		// Every line for one neighbour leads with that neighbour's bare name, so the ledger's
		// subject filter groups their edits together instead of splitting "home" changes under
		// a generic "Neighbor" subject and trait changes under "<Name> trait".
		expect(entries.map(e => e.action)).toEqual([
			"Ennis traits changed from generous to wary",
			"Shahar traits set to ambitious",
			"Shahar selected",
			"Neighbor added: Tovia (from Lygos)",
			"Tovia selected",
		]);
		expect(entries.map(e => e.action).join(" ")).not.toContain("[object Object]");
	});

	it("names the neighbour and the field when a home is cleared", () => {
		const actor = makeActor({
			stonetop: {
				steading: { neighbors: [{ name: "Tierney", home: "Marshedge", traits: "gets the best deals" }] },
			},
		});

		const entries = SteadingLedger.entriesForActorUpdate(actor, {
			flags: { stonetop: { steading: { neighbors: [{ name: "Tierney", home: "", traits: "" }] } } },
		});

		// Previously this pair read "Neighbor changed from Tierney (from Marshedge) to Tierney"
		// and "Tierney trait cleared (…)" — the first of which never said what changed.
		expect(entries.map(e => e.action)).toEqual([
			"Tierney home cleared (was Marshedge)",
			"Tierney traits cleared (was gets the best deals)",
		]);
	});

	it("keeps the traits of a neighbour entered complete", () => {
		// "Neighbor added: Ione (from Barrier Pass)" carries the name and the home and nothing
		// else, so skipping every field on an add lost the trait the same form just captured.
		const actor = makeActor({ stonetop: { steading: { neighbors: [] } } });

		const entries = SteadingLedger.entriesForActorUpdate(actor, {
			flags: { stonetop: { steading: { neighbors: [
				{ name: "Ione", home: "Barrier Pass", traits: "owes you a favour" },
			] } } },
		});

		expect(entries.map(e => e.action)).toEqual([
			"Neighbor added: Ione (from Barrier Pass)",
			"Ione traits set to owes you a favour",
		]);
	});

	it("does not restate a removed neighbour's fields", () => {
		// The removal line is the whole story; "Ione traits cleared" after it would read as an
		// edit to somebody still on the list.
		const actor = makeActor({
			stonetop: { steading: { neighbors: [{ name: "Ione", home: "Barrier Pass", traits: "owes you a favour" }] } },
		});

		const entries = SteadingLedger.entriesForActorUpdate(actor, {
			flags: { stonetop: { steading: { neighbors: [{ name: "", home: "", traits: "" }] } } },
		});

		expect(entries.map(e => e.action)).toEqual(["Neighbor removed: Ione (from Barrier Pass)"]);
	});

	it("records when a built-in improvement is completed", () => {
		const actor = makeActor({
			stonetop: { steading: { improvements: { palisade: { completed: false, r: [true, true, true, true] } } } },
		});

		const entries = SteadingLedger.entriesForActorUpdate(actor, steadingUpdate({
			improvements: { palisade: { completed: true, r: [true, true, true, true] } },
		}));

		expect(entries.map(e => e.action)).toEqual(["Improvement completed: Palisade"]);
		expect(entries.map(e => ledgerNoun(e.action))).toEqual(["Improvement"]);
	});

	it("records a requirement step toggle by its plain-text label", () => {
		const actor = makeActor({
			stonetop: { steading: { improvements: { mill: { completed: false, r: [false, false, false, false, false, false] } } } },
		});

		const entries = SteadingLedger.entriesForActorUpdate(actor, steadingUpdate({
			improvements: { mill: { completed: false, r: [false, false, false, false, false, true] } },
		}));

		expect(entries.map(e => e.action)).toEqual(["Improvement step marked: Mill · A full-time miller"]);
		expect(entries.map(e => ledgerNoun(e.action))).toEqual(["Improvement step"]);
	});

	it("strips HTML from requirement step labels", () => {
		const actor = makeActor({
			stonetop: { steading: { improvements: { palisade: { completed: false, r: [false, false, false, false] } } } },
		});

		const entries = SteadingLedger.entriesForActorUpdate(actor, steadingUpdate({
			improvements: { palisade: { completed: false, r: [false, false, false, true] } },
		}));

		expect(entries.map(e => e.action)).toEqual([
			"Improvement step marked: Palisade · Pulling Together, costing a month and 1 Surplus",
		]);
	});

	it("names custom (journal-sourced) improvements from the actor's tracked list", () => {
		const actor = makeActor({
			stonetop: {
				steading: {
					customImprovements: [
						{ slug: "custom-foo", label: "Foo Bar", sections: [{ heading: "", items: ["Do the thing"] }], effect: "" },
					],
					improvements: { "custom-foo": { completed: false, r: [false] } },
				},
			},
		});

		const entries = SteadingLedger.entriesForActorUpdate(actor, steadingUpdate({
			customImprovements: [
				{ slug: "custom-foo", label: "Foo Bar", sections: [{ heading: "", items: ["Do the thing"] }], effect: "" },
			],
			improvements: { "custom-foo": { completed: true, r: [true] } },
		}));

		expect(entries.map(e => e.action)).toEqual([
			"Improvement completed: Foo Bar",
			"Improvement step marked: Foo Bar · Do the thing",
		]);
	});

	it("records herd tier changes by age, ignoring unchanged tiers", () => {
		const actor = makeActor({
			stonetop: { steading: { herd: { grown: 12, yearlings: 0, foals: 0 } } },
		});

		const entries = SteadingLedger.entriesForActorUpdate(actor, steadingUpdate({
			herd: { grown: 13, yearlings: 0, foals: 2 },
		}));

		expect(entries.map(e => e.action)).toEqual([
			"Herd: grown horses changed from 12 to 13",
			"Herd: foals changed from 0 to 2",
		]);
	});

	it("suppresses blank→0 herd tiers when a herd is first seeded", () => {
		const actor = makeActor({ stonetop: { steading: {} } }); // no herd yet

		const entries = SteadingLedger.entriesForActorUpdate(actor, steadingUpdate({
			herd: { grown: 12, yearlings: 0, foals: 0 },
		}));

		// Only the meaningful tier is logged — not "yearlings set to 0" / "foals set to 0".
		expect(entries.map(e => e.action)).toEqual(["Herd: grown horses set to 12"]);
	});

	it("emits nothing when the improvements map is unchanged", () => {
		const imps = { palisade: { completed: true, r: [true, true, true, true] } };
		const actor = makeActor({ stonetop: { steading: { improvements: imps } } });

		const entries = SteadingLedger.entriesForActorUpdate(actor, steadingUpdate({ improvements: imps }));

		expect(entries).toEqual([]);
	});
});
