import { describe, it, expect, beforeEach } from "vitest";
import { IMPORT_BANDS, bandFor, castPlan, gatherCast, gatherRatings, importPlan } from "../../module/relmap/relmap-import.js";
import { emptyGraph, normalizeGraph } from "../../module/relmap/relmap-store.js";
import { REL_LANES } from "../../module/utils/relationship-board.js";
import { SETTLEMENTS } from "../../module/data/settlements.js";

// Seeding a relationship map from the 1-5 hearts the sheets already carry.
//
// A ONE-TIME import, so what has to hold is: it reads only what somebody actually judged, it says
// which way round the judgment ran, and pressing it twice does nothing.

const PREFIX = "flags.stonetop-pwd.relationshipMap";

/** An actor with a relationships table. */
const actorOf = (id, name, type, relationships = {}) => ({
	id, name, type, uuid: `Actor.${id}`, img: `${id}.webp`,
	system: { relationships },
});

let world;
beforeEach(() => {
	world = [];
	globalThis.game = {
		actors: { get: id => world.find(a => a.id === id) ?? null, get contents() { return world; } },
		i18n: { localize: key => key.split(".").pop() },
	};
});

describe("which ratings count as ratings", () => {
	// THE TRAP THIS GUARDS. Storage is sparse and an absent entry reads as neutral 3, so "every
	// entry" would be every pair of actors in the world. Only a rating somebody actually stored is
	// a line — and an entry also gets created by ticking a visibility box or typing a note, neither
	// of which is a judgment about anybody.
	it("ignores an entry that carries no rating", () => {
		world = [
			actorOf("a", "Elena", "character", {
				b: { shown: true },                 // visibility ticked, never rated
				c: { notes: "we have met" },        // a note, never rated
				d: { hearts: 5 },                   // rated
			}),
			actorOf("b", "Stefan", "character"),
			actorOf("c", "Damon", "character"),
			actorOf("d", "Bonnie", "character"),
		];
		const rows = gatherRatings(world);
		expect(rows).toHaveLength(1);
		expect(rows[0].to.name).toBe("Bonnie");
	});

	it("reads the legacy bare-number shape as a rating", () => {
		world = [actorOf("a", "Elena", "character", { b: 4 }), actorOf("b", "Stefan", "character")];
		expect(gatherRatings(world)).toHaveLength(1);
	});

	it("looks at characters, NPCs and the steading, and nothing else", () => {
		world = [
			actorOf("a", "Elena", "character", { b: { hearts: 5 } }),
			actorOf("b", "Bran", "npc", { a: { hearts: 2 } }),
			actorOf("c", "Stonetop", "stonetop", { [SETTLEMENTS[0].slug]: { hearts: 1 } }),
			actorOf("d", "A wolf", "monster", { a: { hearts: 5 } }),
		];
		const names = gatherRatings(world).map(r => `${r.from.name}->${r.to.name}`);
		expect(names).toContain("Elena->Bran");
		expect(names).toContain("Bran->Elena");
		expect(names).toContain(`Stonetop->${SETTLEMENTS[0].name}`);
		expect(names.some(n => n.startsWith("A wolf"))).toBe(false);
	});

	// Two key spaces: an actor's table is keyed by actor ID, the steading's by settlement SLUG.
	// A settlement is a place with no actor, which the map draws as a plain named circle.
	it("brings a settlement across with no actor behind it", () => {
		world = [actorOf("s", "Stonetop", "stonetop", { [SETTLEMENTS[1].slug]: { hearts: 2 } })];
		const [row] = gatherRatings(world);
		expect(row.to).toEqual({ uuid: null, name: SETTLEMENTS[1].name, img: "" });
	});

	it("drops a rating whose target no longer exists", () => {
		world = [
			actorOf("a", "Elena", "character", { gone: { hearts: 5 } }),
			actorOf("s", "Stonetop", "stonetop", { "not-a-settlement": { hearts: 5 } }),
		];
		expect(gatherRatings(world)).toEqual([]);
	});

	it("survives an actor with no table at all", () => {
		world = [{ id: "a", name: "Elena", type: "character", uuid: "Actor.a", system: {} }];
		expect(gatherRatings(world)).toEqual([]);
		expect(gatherRatings([])).toEqual([]);
		expect(gatherRatings()).toEqual([]);
	});
});

describe("which band a rating falls in", () => {
	// The board already cuts the 1-5 into three lanes. A second cut here that disagreed would
	// colour a line "hostile" for a rating the standings board files under Neutral.
	it("cuts the scale exactly where the standings board cuts it", () => {
		const lanes = Object.fromEntries(REL_LANES.map(l => [l.key, l.steps]));
		for (const band of IMPORT_BANDS) {
			for (const step of lanes[band.key]) expect(bandFor(step).key).toBe(band.key);
		}
	});

	it("gives each band its own ink", () => {
		expect(new Set(IMPORT_BANDS.map(b => b.ink)).size).toBe(IMPORT_BANDS.length);
	});

	it("falls back to the middle for a rating that is not a number", () => {
		for (const bad of [null, undefined, "x", NaN]) expect(bandFor(bad).key).toBe("neutral");
	});
});

describe("planning the import", () => {
	let n = 0;
	const ids = () => `id${String(++n).padStart(2, "0")}`;
	beforeEach(() => { n = 0; });

	const twoRated = () => {
		world = [
			actorOf("a", "Elena", "character", { b: { hearts: 5, notes: "would die for her" } }),
			actorOf("b", "Stefan", "character"),
		];
		return gatherRatings(world);
	};

	it("adds a person per end and a line per rating", () => {
		const plan = importPlan(emptyGraph(), twoRated(), ids);
		expect(plan.addedPeople).toBe(2);
		expect(plan.addedLinks).toBe(1);
		expect(plan.patch[`${PREFIX}.nodes.id01.name`]).toBe("Elena");
		expect(plan.patch[`${PREFIX}.nodes.id02.name`]).toBe("Stefan");
	});

	// The stored note is already a sentence about this pair, so it IS the label; the band name is
	// only the fallback.
	it("labels the line with the stored note where there is one", () => {
		const plan = importPlan(emptyGraph(), twoRated(), ids);
		expect(plan.patch[`${PREFIX}.edges.id03.label`]).toBe("would die for her");
	});

	it("falls back to the band's name when no note was written", () => {
		world = [
			actorOf("a", "Elena", "character", { b: { hearts: 1 } }),
			actorOf("b", "Stefan", "character"),
		];
		const plan = importPlan(emptyGraph(), gatherRatings(world), ids);
		expect(plan.patch[`${PREFIX}.edges.id03.label`]).toBe("hostile");
		expect(plan.patch[`${PREFIX}.edges.id03.ink`]).toBe("rust");
	});

	// THE POINT OF THE WHOLE FEATURE. A rating is one person's regard for another and says nothing
	// about the return. Drawing it as a mutual line would assert something nobody recorded.
	it("draws a rating ONE WAY, from the person who made it", () => {
		const plan = importPlan(emptyGraph(), twoRated(), ids);
		expect(plan.patch[`${PREFIX}.edges.id03.dir`]).toBe("a-b");
		expect(plan.patch[`${PREFIX}.edges.id03.a`]).toBe("id01");
		expect(plan.patch[`${PREFIX}.edges.id03.b`]).toBe("id02");
	});

	// And the pay-off: a pair who disagree get two arrows, which is the one thing the sheets can
	// never show side by side.
	it("gives a pair who have both rated each other two lines, one each way", () => {
		world = [
			actorOf("a", "Elena", "character", { b: { hearts: 5 } }),
			actorOf("b", "Stefan", "character", { a: { hearts: 1 } }),
		];
		const plan = importPlan(emptyGraph(), gatherRatings(world), ids);
		expect(plan.addedPeople).toBe(2);
		expect(plan.addedLinks).toBe(2);
		expect(plan.patch[`${PREFIX}.edges.id03.ink`]).toBe("sage");
		expect(plan.patch[`${PREFIX}.edges.id04.ink`]).toBe("rust");
		expect(plan.patch[`${PREFIX}.edges.id04.a`]).toBe("id02");
	});

	it("puts nobody on top of anybody else", () => {
		world = [
			actorOf("a", "A", "character", { b: { hearts: 5 }, c: { hearts: 5 }, d: { hearts: 5 } }),
			actorOf("b", "B", "character"), actorOf("c", "C", "character"), actorOf("d", "D", "character"),
		];
		const plan = importPlan(emptyGraph(), gatherRatings(world), ids);
		const spots = Object.entries(plan.patch)
			.filter(([k]) => k.endsWith(".x"))
			.map(([k, x]) => `${x},${plan.patch[k.replace(/\.x$/, ".y")]}`);
		expect(new Set(spots).size).toBe(spots.length);
	});
});

describe("pressing it twice", () => {
	let n = 0;
	const ids = () => `id${String(++n).padStart(2, "0")}`;

	// Idempotent, or the button is a trap: a GM who presses it again after renaming half the labels
	// would get a second copy of every line stacked behind the first.
	it("adds nothing the second time", () => {
		n = 0;
		world = [
			actorOf("a", "Elena", "character", { b: { hearts: 5 } }),
			actorOf("b", "Stefan", "character", { a: { hearts: 2 } }),
		];
		const rows = gatherRatings(world);
		const first = importPlan(emptyGraph(), rows, ids);
		// Apply the plan by hand, the way `entry.update` would.
		const graph = normalizeGraph({
			nodes: {
				id01: { uuid: "Actor.a", name: "Elena", x: 10, y: 10 },
				id02: { uuid: "Actor.b", name: "Stefan", x: 40, y: 40 },
			},
			edges: {
				id03: { a: "id01", b: "id02", dir: "a-b" },
				id04: { a: "id02", b: "id01", dir: "a-b" },
			},
		});
		const second = importPlan(graph, rows, ids);
		expect(first.addedLinks).toBe(2);
		expect(second.addedPeople).toBe(0);
		expect(second.addedLinks).toBe(0);
		expect(second.patch).toEqual({});
	});

	// A rename on the map must survive: the import recognises the PERSON, not the label.
	it("does not re-add somebody whose line has been renamed", () => {
		n = 0;
		world = [
			actorOf("a", "Elena", "character", { b: { hearts: 5, notes: "would die for her" } }),
			actorOf("b", "Stefan", "character"),
		];
		const graph = normalizeGraph({
			nodes: {
				id01: { uuid: "Actor.a", name: "Elena", x: 10, y: 10 },
				id02: { uuid: "Actor.b", name: "Stefan", x: 40, y: 40 },
			},
			edges: { id03: { a: "id01", b: "id02", label: "something the GM typed instead", dir: "a-b" } },
		});
		const plan = importPlan(graph, gatherRatings(world), ids);
		expect(plan.addedLinks).toBe(0);
		expect(plan.patch).toEqual({});
	});

	// Somebody dragged onto the board by hand is the same person as the one behind the rating.
	it("reuses a person already on the board rather than adding a twin", () => {
		n = 0;
		world = [
			actorOf("a", "Elena", "character", { b: { hearts: 5 } }),
			actorOf("b", "Stefan", "character"),
		];
		const graph = normalizeGraph({
			nodes: { hand1: { uuid: "Actor.a", name: "Elena", x: 50, y: 50 } },
			edges: {},
		});
		const plan = importPlan(graph, gatherRatings(world), ids);
		expect(plan.addedPeople).toBe(1);
		expect(plan.patch[`${PREFIX}.edges.id02.a`]).toBe("hand1");
	});

	// A settlement has no actor, so it can only be recognised by name.
	it("reuses a settlement already on the board", () => {
		n = 0;
		world = [actorOf("s", "Stonetop", "stonetop", { [SETTLEMENTS[0].slug]: { hearts: 2 } })];
		const graph = normalizeGraph({
			nodes: { place: { uuid: null, name: SETTLEMENTS[0].name, x: 20, y: 20 } },
			edges: {},
		});
		const plan = importPlan(graph, gatherRatings(world), ids);
		// Only the steading itself is new.
		expect(plan.addedPeople).toBe(1);
		expect(plan.addedLinks).toBe(1);
	});
});

describe("putting the whole cast on the board", () => {
	let n = 0;
	const ids = () => `c${String(++n).padStart(2, "0")}`;

	/** A steading whose rosters resolve to `people`. */
	const steadingOf = (id, people) => ({
		id, name: "Stonetop", type: "stonetop", uuid: `Actor.${id}`, img: "", system: {},
		getFlag: (scope, key) => (scope === "stonetop-pwd" && key === "steading"
			? { residents: people.map(p => ({ id: p.id })), neighbors: [] }
			: null),
	});

	beforeEach(() => {
		n = 0;
		globalThis.CONFIG = { ...globalThis.CONFIG };
	});

	function cast(pcs, npcs) {
		const steading = steadingOf("s", npcs);
		world = [...pcs, ...npcs, steading];
		// `personRowActor` resolves a roster row through game.actors.
		globalThis.game.actors.get = id => world.find(a => a.id === id) ?? null;
		return { steading };
	}

	it("gathers the player characters and the steading's people, and nobody else", () => {
		cast(
			[actorOf("p1", "Elena", "character"), actorOf("p2", "Damon", "character")],
			[actorOf("n1", "Bran", "npc"), actorOf("n2", "Wenna", "npc")],
		);
		world.push(actorOf("m1", "A wolf", "monster"));
		const names = gatherCast().map(p => p.name);
		expect(names).toEqual(expect.arrayContaining(["Elena", "Damon", "Bran", "Wenna"]));
		expect(names).not.toContain("A wolf");
	});

	it("names each person once, however many rosters they are on", () => {
		cast([actorOf("p1", "Elena", "character")], [actorOf("n1", "Bran", "npc")]);
		const names = gatherCast().map(p => p.name);
		expect(new Set(names).size).toBe(names.length);
	});

	it("adds everybody to an empty board, and draws no lines at all", () => {
		cast([actorOf("p1", "Elena", "character")], [actorOf("n1", "Bran", "npc")]);
		const plan = castPlan(emptyGraph(), gatherCast(), ids);
		expect(plan.added).toBe(2);
		expect(Object.keys(plan.patch).some(k => k.includes(".edges."))).toBe(false);
	});

	it("spreads them out rather than stacking them", () => {
		cast(
			[actorOf("p1", "A", "character"), actorOf("p2", "B", "character")],
			Array.from({ length: 20 }, (_, i) => actorOf(`n${i}`, `N${i}`, "npc")),
		);
		const plan = castPlan(emptyGraph(), gatherCast(), ids);
		expect(plan.added).toBe(22);
		const spots = Object.entries(plan.patch)
			.filter(([k]) => k.endsWith(".x"))
			.map(([k, x]) => `${x},${plan.patch[k.replace(/\.x$/, ".y")]}`);
		expect(new Set(spots).size).toBe(spots.length);
	});

	// Pressing it on a board somebody has already arranged must not move what they arranged.
	it("leaves everyone already placed exactly where they were", () => {
		cast([actorOf("p1", "Elena", "character")], [actorOf("n1", "Bran", "npc")]);
		const graph = normalizeGraph({
			nodes: { hand1: { uuid: "Actor.p1", name: "Elena", x: 12, y: 34 } },
			edges: {},
		});
		const plan = castPlan(graph, gatherCast(), ids);
		expect(plan.added).toBe(1);
		expect(plan.already).toBe(1);
		expect(Object.keys(plan.patch).some(k => k.includes("hand1"))).toBe(false);
	});

	it("adds nothing the second time", () => {
		cast([actorOf("p1", "Elena", "character")], [actorOf("n1", "Bran", "npc")]);
		const graph = normalizeGraph({
			nodes: {
				a: { uuid: "Actor.p1", name: "Elena", x: 10, y: 10 },
				b: { uuid: "Actor.n1", name: "Bran", x: 60, y: 60 },
			},
			edges: {},
		});
		const plan = castPlan(graph, gatherCast(), ids);
		expect(plan.added).toBe(0);
		expect(plan.patch).toEqual({});
	});

	it("has nothing to do in a world with nobody in it", () => {
		world = [];
		expect(gatherCast()).toEqual([]);
		expect(castPlan(emptyGraph(), [], ids).added).toBe(0);
	});
});
