import { describe, it, expect, beforeEach } from "vitest";
import { partyBoardPlan } from "../../module/relmap/relmap-party.js";
import { emptyGraph, normalizeGraph } from "../../module/relmap/relmap-store.js";
import { RELMAP_BOARD_ASPECT, boardMetrics } from "../../module/utils/relmap-geometry.js";

// "The Party": the board that seats the party by itself and draws what they answered about each
// other during the introductions.
//
// ⚠ WHAT THIS SUITE IS REALLY FOR IS THE THREE THINGS IT MUST NOT DO. It runs on every open of the
// map, on a board the table arranges by hand, so the danger is never "it drew too little" -- it is
// that it moves somebody, doubles a line, or brings back a board that was deleted. Only the first
// two are here; the third is `syncPartyPage`'s, in relmap-doc.test.js.

let n = 0;
const ids = () => `id${String(++n).padStart(2, "0")}`;
beforeEach(() => { n = 0; });

const pc = (id, name) => ({ id, uuid: `Actor.${id}`, name, img: `${id}.webp` });
const PIM = pc("pim", "Pim");
const SELA = pc("sela", "Sela");
const MARREC = pc("marrec", "Marrec");

/** One answer as `introRegards` hands it over: the caption, the whole of what was written, the
 * colour of its step, and the KEY of the answer it came from. A blank key stands for every
 * answer read by a caller that had none to give. */
const line = (label, { ink = "sage", key = "" } = {}) => ({ key, label, said: `${label}?  yes.`, ink });

/** `introRegards`' shape: from-uuid -> to-uuid -> one entry per answer. */
const regards = rows => new Map(Object.entries(rows).map(
	([from, to]) => [from, new Map(Object.entries(to))],
));

describe("seeding an empty party board", () => {
	it("puts every player character on it, and nobody else", () => {
		const plan = partyBoardPlan(emptyGraph(), [PIM, SELA, MARREC], new Map(), ids);
		expect(plan.addedPeople).toBe(3);
		expect(Object.values(plan.nodes).map(node => node.name).sort())
			.toEqual(["Marrec", "Pim", "Sela"]);
		expect(Object.values(plan.nodes).map(node => node.uuid).sort())
			.toEqual(["Actor.marrec", "Actor.pim", "Actor.sela"]);
	});

	// A RING, and clear of one another. Distances are compared in FLAT space: the board is wider
	// than it is tall, so a raw percentage down is not the same distance as a percentage across.
	it("seats them clear of each other", () => {
		const plan = partyBoardPlan(emptyGraph(), [PIM, SELA, MARREC], new Map(), ids);
		const seats = Object.values(plan.nodes);
		const r = boardMetrics(3).r;
		for (let i = 0; i < seats.length; i++) {
			for (let k = i + 1; k < seats.length; k++) {
				const dx = seats[i].x - seats[k].x;
				const dy = (seats[i].y - seats[k].y) / RELMAP_BOARD_ASPECT;
				expect(Math.hypot(dx, dy)).toBeGreaterThanOrEqual(2 * r);
			}
		}
	});

	// THE POINT OF THE BOARD. What one person answered about another says nothing about what came
	// back, so a pair who both wrote get an arrow each way, and the two together are the picture.
	it("draws an arrow each way, pointing from whoever wrote it", () => {
		const plan = partyBoardPlan(emptyGraph(), [PIM, SELA], regards({
			"Actor.pim": { "Actor.sela": [line("closest kin")] },
			"Actor.sela": { "Actor.pim": [line("trusts me not one bit", { ink: "indigo" })] },
		}), ids);
		expect(plan.addedLines).toBe(2);
		const drawn = Object.values(plan.edges);
		expect(drawn.every(edge => edge.dir === "a-b")).toBe(true);
		expect(drawn.every(edge => edge.src === "intros")).toBe(true);
		expect(drawn.map(edge => edge.label).sort()).toEqual(["closest kin", "trusts me not one bit"]);
	});

	// A person can be asked eight questions and name one friend in all of them.
	it("draws every answer about the same person, not just the first", () => {
		const plan = partyBoardPlan(emptyGraph(), [PIM, SELA], regards({
			"Actor.pim": { "Actor.sela": [line("closest kin"), line("held the ladder")] },
		}), ids);
		expect(plan.addedLines).toBe(2);
	});

	// The whole of the question and the answer, where the caption is only as much of the question
	// as the board has room for. It is the line's NOTE, so it is in the tooltip and in the editor.
	it("keeps the whole of what was written on the line", () => {
		const plan = partyBoardPlan(emptyGraph(), [PIM, SELA], regards({
			"Actor.pim": { "Actor.sela": [line("closest kin")] },
		}), ids);
		expect(Object.values(plan.edges)[0].note).toBe("closest kin?  yes.");
	});

	// The board is the party's. An answer naming somebody who is not on it has no second end.
	it("draws nothing for an answer about somebody who is not in the party", () => {
		const plan = partyBoardPlan(emptyGraph(), [PIM, SELA], regards({
			"Actor.pim": { "Actor.ordga": [line("her apprentice")] },
		}), ids);
		expect(plan.addedLines).toBe(0);
	});

	it("survives a party with nothing recorded, and no party at all", () => {
		expect(partyBoardPlan(emptyGraph(), [PIM, SELA], new Map(), ids).addedLines).toBe(0);
		expect(partyBoardPlan(emptyGraph(), [], new Map(), ids).addedPeople).toBe(0);
		expect(partyBoardPlan(emptyGraph(), undefined, undefined, ids).addedPeople).toBe(0);
	});
});

describe("opening the map again", () => {
	/** The board as it stands after one seeding, with everybody moved somewhere by hand. */
	const seeded = () => normalizeGraph({
		nodes: {
			a: { uuid: "Actor.pim", name: "Pim", x: 12, y: 88 },
			b: { uuid: "Actor.sela", name: "Sela", x: 90, y: 4 },
		},
		edges: {
			e1: { a: "a", b: "b", label: "closest kin", dir: "a-b", src: "intros" },
		},
	});

	// ⚠ THE ONE THAT MATTERS. This runs on every open, on a board the table arranges by hand. A
	// second copy of every line each time would bury the board in a week.
	it("adds nothing at all when nothing has changed", () => {
		const plan = partyBoardPlan(seeded(), [PIM, SELA], regards({
			"Actor.pim": { "Actor.sela": [line("closest kin")] },
		}), ids);
		expect(plan).toMatchObject({ addedPeople: 0, addedLines: 0 });
		expect(plan.nodes).toEqual({});
		expect(plan.edges).toEqual({});
	});

	// ⚠ COUNTED, NEVER COMPARED AGAINST THE WORDS. A caption the table has rewritten in their own
	// wording is still that answer's line; matching on the text would draw a second one beside it
	// on every open, which is the worst possible answer to somebody tidying up their own board.
	it("adds nothing when the caption has been rewritten by hand", () => {
		const renamed = seeded();
		renamed.edges.e1.label = "the only family she has left";
		const plan = partyBoardPlan(renamed, [PIM, SELA], regards({
			"Actor.pim": { "Actor.sela": [line("closest kin")] },
		}), ids);
		expect(plan.addedLines).toBe(0);
	});

	// The list grows at the END, so what arrives is what was answered since.
	it("adds only the answers recorded since last time", () => {
		const plan = partyBoardPlan(seeded(), [PIM, SELA], regards({
			"Actor.pim": { "Actor.sela": [line("closest kin"), line("held the ladder")] },
		}), ids);
		expect(plan.addedLines).toBe(1);
		expect(Object.values(plan.edges)[0].label).toBe("held the ladder");
	});

	// ⚠ A LINE THE TABLE DREW IS NOT ONE OF THESE. It carries no `intros` stamp, so it must not be
	// counted as an answer already drawn -- otherwise drawing a line by hand between two player
	// characters would silently stop the next real answer from arriving.
	it("does not count a hand-drawn line as an answer already on the board", () => {
		const board = seeded();
		board.edges.byHand = { ...board.edges.e1, label: "drawn by hand", src: "" };
		const plan = partyBoardPlan(board, [PIM, SELA], regards({
			"Actor.pim": { "Actor.sela": [line("closest kin"), line("held the ladder")] },
		}), ids);
		expect(plan.addedLines).toBe(1);
	});

	// ⚠ NOBODY IS MOVED. The board exists to be arranged, and re-seating it on open would throw
	// that away. A newcomer is dropped into whatever room is left instead.
	it("leaves everybody where they were put, and finds room for a newcomer", () => {
		const plan = partyBoardPlan(seeded(), [PIM, SELA, MARREC], new Map(), ids);
		expect(plan.addedPeople).toBe(1);
		expect(Object.values(plan.nodes)[0].name).toBe("Marrec");
		// The two already placed are not in the patch at all, so nothing can move them.
		expect(Object.values(plan.nodes).map(node => node.uuid)).toEqual(["Actor.marrec"]);
	});

	it("recognises somebody already on the board and does not add a twin", () => {
		const plan = partyBoardPlan(seeded(), [PIM, SELA], new Map(), ids);
		expect(plan.addedPeople).toBe(0);
	});
});

// ── Which answers are already drawn ─────────────────────────────────────────────────────────────
//
// ⚠ THE SUITE THAT REPLACES THE COUNTING. The board used to decide what to add by how many of a
// pair's lines were drawn, and that is only right while the list can grow at the END. It cannot:
// `introRegards` groups a pair's answers BY STEP, so a "Bonds & ties" answer somebody has just
// pointed at a person is inserted in FRONT of the step-6 lines already on the board. Each line now
// carries the KEY of the answer it was drawn from, so nothing about this depends on the order.

describe("matching drawn lines to the answers they came from", () => {
	/** A board carrying one keyed line: Pim's step-6 answer about Sela, already drawn. */
	const keyed = () => normalizeGraph({
		nodes: {
			a: { uuid: "Actor.pim", name: "Pim", x: 12, y: 88 },
			b: { uuid: "Actor.sela", name: "Sela", x: 90, y: 4 },
		},
		edges: {
			e1: {
				a: "a", b: "b", label: "stayed my hand", dir: "a-b", src: "intros",
				origin: "pim::step6::0", note: "stayed my hand?  yes.",
			},
		},
	});

	const both = () => regards({
		"Actor.pim": {
			"Actor.sela": [
				line("closest kin", { key: "pim::step4::0" }),
				line("stayed my hand", { ink: "indigo", key: "pim::step6::0" }),
			],
		},
	});

	// ⚠ THE BUG THIS EXISTS FOR. Counted, the board saw one line drawn, took the TAIL of a
	// two-entry list, and wrote a second copy of "stayed my hand" -- while "closest kin", the
	// answer the reader had just matched, was never drawn at all.
	it("draws an answer that arrives mid-list, and no second copy of the one already there", () => {
		const plan = partyBoardPlan(keyed(), [PIM, SELA], both(), ids);
		expect(plan.addedLines).toBe(1);
		expect(Object.values(plan.edges)[0]).toMatchObject({
			label: "closest kin", origin: "pim::step4::0",
		});
	});

	it("adds nothing once every answer has its line", () => {
		const board = keyed();
		board.edges.e2 = {
			...board.edges.e1, label: "closest kin", ink: "sage", origin: "pim::step4::0",
		};
		const plan = partyBoardPlan(board, [PIM, SELA], both(), ids);
		expect(plan.addedLines).toBe(0);
		expect(plan.marks).toEqual({});
	});

	// The key is what a line is recognised by, so the words stay the table's own.
	it("adds nothing when a keyed line's caption and note have both been rewritten", () => {
		const board = keyed();
		board.edges.e1.label = "the only one who ever stopped him";
		board.edges.e1.note = "she talked him down, is what happened";
		const plan = partyBoardPlan(board, [PIM, SELA], regards({
			"Actor.pim": { "Actor.sela": [line("stayed my hand", { ink: "indigo", key: "pim::step6::0" })] },
		}), ids);
		expect(plan.addedLines).toBe(0);
	});

	// A key is stamped on every line this draws, so the next open has something to recognise.
	it("stamps the answer's key on every line it draws", () => {
		const plan = partyBoardPlan(emptyGraph(), [PIM, SELA], both(), ids);
		expect(Object.values(plan.edges).map(edge => edge.origin).sort())
			.toEqual(["pim::step4::0", "pim::step6::0"]);
	});
});

// ── Adopting a board drawn before keys existed ──────────────────────────────────────────────────
//
// Keys arrived after the party board did, so every line seeded before them is unnamed. Matched by
// key alone, the next open would draw the whole board over again; so each bare line is paired with
// the answer it came from ONCE and marked, and from then on that board is matched by identity.

describe("a board seeded before the lines carried keys", () => {
	const bare = () => normalizeGraph({
		nodes: {
			a: { uuid: "Actor.pim", name: "Pim", x: 12, y: 88 },
			b: { uuid: "Actor.sela", name: "Sela", x: 90, y: 4 },
		},
		edges: {
			e1: {
				a: "a", b: "b", label: "closest kin", dir: "a-b", src: "intros",
				note: "closest kin?  yes.",
			},
		},
	});

	// ⚠ AND IT MUST NOT DRAW ANYTHING. An adoption that also added a line would double the board on
	// the first open after the change, on every table that already has one.
	it("marks the line it already has instead of drawing it again", () => {
		const plan = partyBoardPlan(bare(), [PIM, SELA], regards({
			"Actor.pim": { "Actor.sela": [line("closest kin", { key: "pim::step4::0" })] },
		}), ids);
		expect(plan.addedLines).toBe(0);
		expect(plan.marks).toEqual({ e1: "pim::step4::0" });
	});

	// BY THE WRITING, which on a board nobody has edited is exact rather than a guess: the note
	// carries the question and the answer whole. Here the answers arrive in the other order.
	it("pairs a bare line with the answer whose writing it carries, not with the first", () => {
		const plan = partyBoardPlan(bare(), [PIM, SELA], regards({
			"Actor.pim": {
				"Actor.sela": [
					line("stayed my hand", { ink: "indigo", key: "pim::step6::0" }),
					line("closest kin", { key: "pim::step4::0" }),
				],
			},
		}), ids);
		expect(plan.marks).toEqual({ e1: "pim::step4::0" });
		expect(plan.addedLines).toBe(1);
		expect(Object.values(plan.edges)[0]).toMatchObject({ label: "stayed my hand" });
	});

	// BY POSITION FOR THE REST -- exactly what the counting rule always did. A line whose note the
	// table has rewritten is taken as the first answer still unaccounted for, once, and settled.
	it("falls back to position for a line whose note has been rewritten", () => {
		const board = bare();
		board.edges.e1.note = "she took me in when nobody else would";
		const plan = partyBoardPlan(board, [PIM, SELA], regards({
			"Actor.pim": {
				"Actor.sela": [
					line("closest kin", { key: "pim::step4::0" }),
					line("stayed my hand", { ink: "indigo", key: "pim::step6::0" }),
				],
			},
		}), ids);
		expect(plan.marks).toEqual({ e1: "pim::step4::0" });
		expect(plan.addedLines).toBe(1);
	});

	// ⚠ A LINE WITH NOTHING TO NAME IT IS LEFT AS IT IS, and this is what keeps the whole change
	// silent on a caller with no keys to give: no mark is written, the line still counts as drawn,
	// and the pairing is simply done again next time -- which is the behaviour that was there.
	it("writes no mark for an answer with no key, and still counts the line as drawn", () => {
		const plan = partyBoardPlan(bare(), [PIM, SELA], regards({
			"Actor.pim": { "Actor.sela": [line("closest kin")] },
		}), ids);
		expect(plan.marks).toEqual({});
		expect(plan.addedLines).toBe(0);
	});

	// A line the table drew by hand carries no `intros` stamp, so it is never adopted: marking one
	// would make the table's own line into an answer, and stop the real one ever arriving.
	it("never adopts a line the table drew by hand", () => {
		const board = bare();
		board.edges.byHand = { ...board.edges.e1, label: "drawn by hand", src: "" };
		const plan = partyBoardPlan(board, [PIM, SELA], regards({
			"Actor.pim": {
				"Actor.sela": [
					line("closest kin", { key: "pim::step4::0" }),
					line("stayed my hand", { ink: "indigo", key: "pim::step6::0" }),
				],
			},
		}), ids);
		expect(plan.marks).toEqual({ e1: "pim::step4::0" });
		expect(plan.addedLines).toBe(1);
	});
});
