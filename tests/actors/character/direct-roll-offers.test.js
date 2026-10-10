// The roll window's lines on a roll with no move item behind it (StonetopCharacter#onDirectStatRoll: a guided
// move, Improvise, Know Things or Seek Insight about an arcanum or an artifact, a bare stat roll, Struggle as
// One). Those rolls opened the window with no lines and settled none, so Binding Arbitration's "vs. an
// oathbreaker" line (the user's ruling: advantage on EVERY targeted roll against an oathbreaker, imposed; a roll
// aimed at nobody gets an unticked line) never reached a guided roll aimed at nobody, nor did the lines of every
// move roll (Constant Vigilance, Underestimated). They are offered by the name the roll is made under now
// (directRollOffers), and a ticked one is folded and paid for by the same code as onRoll's.

import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { buildLiveCharacter, makeLiveItem } from "../../fakes/LiveCharacter.js";
import { KNOW_THINGS_ADVANTAGE_MOVES } from "../../../module/actors/character/arcana-identify.js";

const SCOPE = "stonetop-pwd";
const BA = "Binding Arbitration";
const BA_KEY = "binding-arbitration";

// onDirectStatRoll imports the roll engine lazily; the options it hands rollStat are the whole answer.
let direct;
beforeEach(() => {
	direct = [];
	vi.doMock("../../../module/utils/roll-engine.js", async (importOriginal) => ({
		...(await importOriginal()),
		rollStat: vi.fn(async (stat, actor, options) => { direct.push(options); return { total: 8 }; }),
	}));
});
afterEach(() => { vi.doUnmock("../../../module/utils/roll-engine.js"); delete global.game.user; });

/** A character with `moves` learned (or `{ name, learned: false }`), `flags`, and `dazed` marked or not. */
function roller({ slug = "the-judge", name = "The Judge", moves = [], flags = {}, dazed = false } = {}) {
	const made = buildLiveCharacter({
		slug, name, seedStartingMoves: false, flags,
		items: moves.map(m => makeLiveItem({
			name: m.name ?? m, type: "move",
			system: { moveType: "playbook", ...(m.system ?? {}) },
			flags: m.learned === false ? { [SCOPE]: { learned: false } } : undefined,
		})),
	});
	made.actor.system.attributes.debilities.options.dazed.value = dazed;
	return made;
}
const oathbroken = { oaths: [{ id: "o1", name: "Brennan", broken: true }] };
const judge = ({ learned = true } = {}) => roller({ moves: [learned ? BA : { name: BA, learned: false }], flags: oathbroken });
const keysOf = async (char, moveName, opts) => (await char.directRollOffers(moveName, opts)).map(o => o.key);
const target = tokens => { global.game.user = { targets: new Set(tokens) }; };
const brennan = { document: { uuid: "Scene.s.Token.tb", name: "Brennan" }, actor: { id: "brennanActor" } };
const notes = options => options.conditionNotes ?? [];

describe("Binding Arbitration on a roll with no move behind it", () => {
	it("offers a guided roll aimed at nobody the unticked oathbreaker line; ticked, it is advantage, named", async () => {
		const { char } = judge();
		const offered = await char.directRollOffers("Trade & Barter");
		expect(offered).toEqual([expect.objectContaining({ key: BA_KEY, applied: false, source: BA })]);
		expect(offered[0].label).toContain("Brennan");
		await char.onDirectStatRoll("cha", { moveName: "Trade & Barter", takenOffers: [BA_KEY], offered });
		expect(direct[0].rollMode).toBe("adv");
		expect(notes(direct[0])).toContain(BA);
		// The window's answer is the roll's business, not an option handed on to the roll engine.
		expect(direct[0]).not.toHaveProperty("takenOffers");
		expect(direct[0]).not.toHaveProperty("offered");
		// Left unticked: nothing.
		await char.onDirectStatRoll("cha", { moveName: "Trade & Barter", takenOffers: [], offered });
		expect(direct[1].rollMode).toBe("normal");
		expect(notes(direct[1])).not.toContain(BA);
	});

	it("imposes it on a guided roll at a targeted oathbreaker, with no line, and names it once even if a stale line was ticked", async () => {
		target([brennan]);
		const { char } = judge();
		expect(await keysOf(char, "Trade & Barter")).toEqual([]);
		const stale = [{ key: BA_KEY, applied: false, source: BA, label: "vs. an oathbreaker" }];
		await char.onDirectStatRoll("cha", { moveName: "Trade & Barter", takenOffers: [BA_KEY], offered: stale });
		expect(direct[0].rollMode).toBe("adv");
		expect(notes(direct[0]).filter(n => n === BA)).toHaveLength(1);
	});

	it("offers a bare stat roll the line too (all rolls against them), worked out when the caller hands no list", async () => {
		const { char } = judge();
		expect(await keysOf(char, undefined)).toEqual([BA_KEY]);
		await char.onDirectStatRoll("str", { takenOffers: [BA_KEY] });
		expect(direct[0].rollMode).toBe("adv");
		expect(notes(direct[0])).toContain(BA);
	});

	it("offers nothing with the move not learned", async () => {
		expect(await keysOf(judge({ learned: false }).char, "Trade & Barter")).toEqual([]);
		expect(await keysOf(judge({ learned: false }).char, undefined)).toEqual([]);
	});
});

describe("the lines of every move roll, on a roll with no move item", () => {
	it("offers Constant Vigilance to a guided move, Improvise, Know Things and Seek Insight, never while dazed", async () => {
		const { char } = roller({ slug: "the-ranger", name: "The Ranger", moves: ["Constant Vigilance"] });
		for (const name of ["Forage", "Improvise", "Know Things", "Seek Insight"]) {
			expect(await char.directRollOffers(name)).toEqual([expect.objectContaining({ key: "constant-vigilance", applied: false, source: "Constant Vigilance" })]);
		}
		const dazed = roller({ slug: "the-ranger", name: "The Ranger", moves: ["Constant Vigilance"], dazed: true });
		expect(await keysOf(dazed.char, "Forage")).toEqual([]);
		await char.onDirectStatRoll("wis", { moveName: "Forage", takenOffers: ["constant-vigilance"] });
		expect(direct[0].rollMode).toBe("adv");
		expect(notes(direct[0])).toContain("Constant Vigilance");
	});

	// Battle Joy (p.114): "you ignore ... the effects of debilities as long as you keep fighting". Dazed stops
	// gating Constant Vigilance exactly while the dice ignore it: raging AND Battle Joy learned (wave 4 DEB-2).
	it("offers Constant Vigilance to a dazed character in their Battle Joy, but not to a stranded rage", async () => {
		const raging = roller({ slug: "the-heavy", name: "The Heavy", moves: ["Constant Vigilance", "Battle Joy"],
			flags: { battleJoy: true }, dazed: true });
		expect(await keysOf(raging.char, "Forage")).toEqual(["constant-vigilance"]);
		const stranded = roller({ slug: "the-heavy", name: "The Heavy",
			moves: ["Constant Vigilance", { name: "Battle Joy", learned: false }], flags: { battleJoy: true }, dazed: true });
		expect(await keysOf(stranded.char, "Forage")).toEqual([]);
	});

	it("offers Underestimated the same way", async () => {
		const { char } = roller({ slug: "the-would-be-hero", name: "The Would-Be Hero", moves: ["Underestimated"] });
		expect(await keysOf(char, "Improvise")).toEqual(["underestimated"]);
		await char.onDirectStatRoll("int", { moveName: "Improvise", takenOffers: ["underestimated"] });
		expect(direct[0].rollMode).toBe("adv");
		expect(notes(direct[0])).toContain("Underestimated");
	});

	it("gives a bare stat roll none of them (it is no move), not even ticked ones handed in", async () => {
		const { char } = roller({ moves: ["Constant Vigilance", "Underestimated"] });
		expect(await keysOf(char, undefined)).toEqual([]);
		await char.onDirectStatRoll("dex", { takenOffers: ["constant-vigilance", "underestimated"] });
		expect(direct[0].rollMode).toBe("normal");
		expect(notes(direct[0])).not.toContain("Constant Vigilance");
		expect(notes(direct[0])).not.toContain("Underestimated");
	});

	it("gives Struggle as One none: it asks no window, so it takes no line", async () => {
		const { char } = roller({ moves: ["Constant Vigilance", "Underestimated", BA], flags: oathbroken });
		await char.onDirectStatRoll("str", { moveName: "Struggle as One", targets: [], noXpOnMiss: true });
		expect(direct[0].rollMode).toBe("normal");
		expect(notes(direct[0])).toEqual([]);
	});
});

describe("a row that names its move, on a roll with no move item", () => {
	it("rides a roll made under that move's own name, and no other", async () => {
		const { char } = roller({ slug: "the-heavy", name: "The Heavy", moves: ["Stone Cold"] });
		expect(await keysOf(char, "Defy Danger")).toEqual(["stone-cold"]);
		expect(await keysOf(char, "Forage")).toEqual([]);
		await char.onDirectStatRoll("con", { moveName: "Defy Danger", takenOffers: ["stone-cold"] });
		expect(direct[0].missCountsAsPartial).toBe("Stone Cold");
		expect(direct[0].rollMode).toBe("normal");
	});

	it("leaves Polyglot and Naturalist to the identify roll's own picker, and still offers Legacy", async () => {
		const { char } = roller({ moves: ["Polyglot", "Naturalist"], flags: { "background.selected": "legacy" } });
		expect(await keysOf(char, "Know Things")).toEqual(["legacy", "naturalist", "polyglot"]);
		expect(await keysOf(char, "Know Things", { except: KNOW_THINGS_ADVANTAGE_MOVES })).toEqual(["legacy"]);
	});

	it("pays a taken line's price after the dice (Safety First's Protection)", async () => {
		const { char } = roller({
			slug: "the-seeker", name: "The Seeker",
			moves: [{ name: "Safety First", system: { resource: { max: 2, title: "Protection" } } }],
			flags: { "moves.backgroundChoices": { "Safety First": 2 } },
		});
		const offered = await char.directRollOffers("Defy Danger");
		expect(offered.map(o => o.key)).toEqual(["safety-first"]);
		await char.onDirectStatRoll("dex", { moveName: "Defy Danger", takenOffers: ["safety-first"], offered });
		expect(direct[0].rollMode).toBe("adv");
		expect(char.moveResources.getMoveResources()["Safety First"]).toBe(1);
	});
});
