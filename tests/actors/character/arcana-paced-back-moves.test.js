import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
	CharacterArcana, consequenceBoxRange, markedConsequenceIndexes, pacedBackMoveState, unlockChoiceState,
} from "../../../module/actors/character/CharacterArcana.js";
import { PACED_BACK_MOVES } from "../../../module/data/arcana-rules.js";
import { askUnlockChoice, chooseUnlockChoices, settleArcanumBoxTick } from "../../../module/actors/character/arcana-seeker-moves.js";
import { frontTaskTrack } from "../../../module/actors/character/seeker-collection.js";
import { FakeArcanaRepository } from "../../fakes/FakeArcanaRepository.js";
import { flagFragmentOps } from "../../fakes/flag-fragments.js";

// Level Up audit 2026-11-06, PBB-1 / C1: major arcana whose back moves come over time. Book II:
// Noruba's Ice Sphere (p.547) and the Redwood Effigy (p.571), "For every 2 Consequences you mark, gain
// one of the following moves"; the Twisted Spear (p.542), "When you have marked 3 tasks... Choose one of
// the moves on the reverse... Each time you mark a task thereafter, gain another move from the
// reverse"; the Demonhide Cloak (p.545), "When you have marked 3 Consequences, you gain the following
// move"; the Azure Hand (p.574), "When you make the last mark... choose one of the moves on the reverse,
// and erase all marks above". A cue while one is owed, a caution when more are ticked: never a block.

const readCard = rel => ({ ...JSON.parse(fs.readFileSync(path.resolve(rel), "utf8")).flags.stonetop });
const card = slug => readCard(`packs/src/stonetop-arcana/major/${slug}.json`);
const ICE    = card("norubas-ice-sphere");
const SPEAR  = card("twisted-spear");
const CLOAK  = card("demonhide-cloak");
const AZURE  = card("azure-hand");
const CODEX  = card("hectumel-codex");

function makeFlags(store = {}) {
	return {
		_store: store,
		...flagFragmentOps(store),
		getFlag: key => store[key] ?? null,
		setFlag: vi.fn(async (key, value) => { store[key] = value; }),
		batch: vi.fn(async ({ sets = {} } = {}) => { for (const [k, v] of Object.entries(sets)) store[k] = v; }),
	};
}
const arcana = (store, cards) => new CharacterArcana(makeFlags(store), new FakeArcanaRepository(cards));

// The first `n` Consequence boxes of a card, ticked.
function consequences(item, n) {
	const range = consequenceBoxRange(item.back.description);
	const out = {};
	for (let i = 0; i < n; i++) out[`${item.slug}:back:${range.from + i}`] = true;
	return out;
}
const choiceIndex = (item, label) => pacedBackMoveState(item, {}).choices.find(c => c.label === label).index;

describe("PACED_BACK_MOVES reads the shipped cards", () => {
	it("finds every listed move's □ on the back, outside the Consequences, each once", () => {
		for (const slug of Object.keys(PACED_BACK_MOVES)) {
			const item = card(slug);
			const state = pacedBackMoveState(item, {});
			expect(state, slug).not.toBeNull();
			expect(state.choices.map(c => c.label), slug).toEqual(PACED_BACK_MOVES[slug].choices.map(l => l.replace(/[.:]$/, "")));
			const indexes = state.choices.map(c => c.index);
			expect(new Set(indexes).size, slug).toBe(indexes.length);
			const range = consequenceBoxRange(item.back.description);
			for (const i of indexes) expect(i < range.from || i >= range.to, `${slug} ${i}`).toBe(true);
		}
	});

	it("leaves the Codex to its own unlock choice, and other cards alone", () => {
		expect(unlockChoiceState(CODEX, {}).paced).toBeUndefined();
		expect(pacedBackMoveState(card("mindgem"), {})).toBeNull();
	});
});

describe("how many back moves a card has given", () => {
	it("counts the Consequences ticked inside the card's Consequences section only", () => {
		const range = consequenceBoxRange(ICE.back.description);
		const boxes = { ...consequences(ICE, 2), [`${ICE.slug}:back:${choiceIndex(ICE, "TELEPATHY")}`]: true, [`other:back:${range.from + 2}`]: true };
		expect(markedConsequenceIndexes(ICE.back.description, boxes, ICE.slug)).toEqual([range.from, range.from + 1]);
		expect(markedConsequenceIndexes("<p>No consequences here.</p>", boxes, ICE.slug)).toEqual([]);
		expect(markedConsequenceIndexes(undefined, boxes, ICE.slug)).toEqual([]);
	});

	it("Ice Sphere: one per 2 Consequences marked", () => {
		expect(pacedBackMoveState(ICE, consequences(ICE, 1)).owed).toBe(0);
		expect(pacedBackMoveState(ICE, consequences(ICE, 2))).toMatchObject({ earned: 1, owed: 1, over: 0 });
		expect(pacedBackMoveState(ICE, consequences(ICE, 3)).owed).toBe(1);
		expect(pacedBackMoveState(ICE, consequences(ICE, 4)).owed).toBe(2);
		const chosen = { ...consequences(ICE, 2), [`${ICE.slug}:back:${choiceIndex(ICE, "TELEPATHY")}`]: true };
		expect(pacedBackMoveState(ICE, chosen)).toMatchObject({ owed: 0, over: 0 });
		expect(pacedBackMoveState(ICE, chosen).open.map(c => c.label)).not.toContain("TELEPATHY");
	});

	it("a move ticked before it is earned is a caution, never undone", () => {
		const early = { [`${ICE.slug}:back:${choiceIndex(ICE, "FARWALKER")}`]: true };
		expect(pacedBackMoveState(ICE, early)).toMatchObject({ earned: 0, owed: 0, over: 1 });
		expect(early[`${ICE.slug}:back:${choiceIndex(ICE, "FARWALKER")}`]).toBe(true);
	});

	it("Twisted Spear: none until 3 tasks, then one more per task", () => {
		const tasks = frontTaskTrack(SPEAR.front).markers;
		const marked = n => Object.fromEntries(tasks.slice(0, n).map(m => [`${SPEAR.slug}:front:${m.index}`, true]));
		expect(pacedBackMoveState(SPEAR, marked(2)).earned).toBe(0);
		expect(pacedBackMoveState(SPEAR, marked(3)).earned).toBe(1);
		expect(pacedBackMoveState(SPEAR, marked(5)).earned).toBe(3);
	});

	it("Demonhide Cloak: Unholy Visage at 3 Consequences", () => {
		expect(pacedBackMoveState(CLOAK, consequences(CLOAK, 2)).owed).toBe(0);
		const three = pacedBackMoveState(CLOAK, consequences(CLOAK, 3));
		expect(three).toMatchObject({ earned: 1, owed: 1 });
		expect(three.open.map(c => c.label)).toEqual(["UNHOLY VISAGE"]);
	});

	it("Azure Hand: one per completed track, read from the count kept", () => {
		expect(pacedBackMoveState(AZURE, {}, { completions: 0 }).owed).toBe(0);
		expect(pacedBackMoveState(AZURE, {}, { completions: 2 }).owed).toBe(2);
	});
});

describe("the completed-track count on cards that erase their marks", () => {
	const slug = "azure-hand";
	const circles = n => Object.fromEntries(Array.from({ length: n }, (_, i) => [`${slug}:unlock:${i}`, true]));

	it("counts each completion, keeps it through the erase, and the card owes one per", async () => {
		const store = { owned: [slug], identified: [slug], boxes: circles(3) };
		const a = arcana(store, [AZURE]);
		await a.setArcanumBoxChecked(slug, "unlock", 3, true);
		expect(a.completionCount(slug)).toBe(1);
		await a.setArcanumBoxChecked(slug, "back", choiceIndex(AZURE, "BATTERY"), true);
		for (let i = 0; i < 4; i++) await a.setArcanumBoxChecked(slug, "unlock", i, false);
		expect(a.completionCount(slug)).toBe(1);
		for (let i = 0; i < 4; i++) await a.setArcanumBoxChecked(slug, "unlock", i, true);
		expect(a.completionCount(slug)).toBe(2);
		const snap = await a.buildSnapshot();
		expect(snap.major.items[0].unlockChoice).toMatchObject({ paced: true, owed: 1, over: 0, earned: 2 });
	});

	it("a last mark taken back before its move is chosen counts no completion", async () => {
		const store = { owned: [slug], identified: [slug], boxes: circles(3) };
		const a = arcana(store, [AZURE]);
		await a.setArcanumBoxChecked(slug, "unlock", 3, true);
		await a.setArcanumBoxChecked(slug, "unlock", 3, false);
		expect(a.completionCount(slug)).toBe(0);
	});

	it("mastering the card counts its completion in the same update, as a hand-marked track does", async () => {
		const store = { owned: [slug], identified: [slug] };
		const a = arcana(store, [AZURE]);
		await a.masterArcanum(slug);
		expect(store.unlockedOnce).toEqual([slug]);
		expect(store.completions?.[slug]).toBe(1);
	});

	it("a card unlocked before the count was kept has given 1", () => {
		expect(arcana({ unlockedOnce: [slug] }, [AZURE]).completionCount(slug)).toBe(1);
		expect(arcana({}, [AZURE]).completionCount(slug)).toBe(0);
	});

	it("Remove forgets the count with the card's other marks", async () => {
		const store = { owned: [slug], completions: { [slug]: 2 } };
		const flags = makeFlags(store);
		const a = new CharacterArcana(flags, new FakeArcanaRepository([AZURE]));
		await flags.applyUpdateData(await a.removeArcanumData(slug));
		expect(store.completions?.[slug]).toBeUndefined();
	});
});

describe("the snapshot's cue", () => {
	it("is shown only while a move is owed or too many are ticked", async () => {
		const slug = ICE.slug;
		const quiet = await arcana({ owned: [slug], identified: [slug], boxes: consequences(ICE, 1) }, [ICE]).buildSnapshot();
		expect(quiet.major.items[0].unlockChoice).toBeNull();
		const owing = await arcana({ owned: [slug], identified: [slug], boxes: consequences(ICE, 2) }, [ICE]).buildSnapshot();
		expect(owing.major.items[0].unlockChoice).toMatchObject({
			paced: true, owed: 1, over: 0, earned: 1, learned: 0, html: null, page: "Book II p.547",
			rule: "For every 2 Consequences you mark, gain one of the following moves",
		});
	});
});

describe("the ask after a tick", () => {
	let saved;
	beforeEach(() => {
		saved = { ChatMessage: globalThis.ChatMessage, ui: globalThis.ui };
		globalThis.ChatMessage = { create: vi.fn(async () => {}), getSpeaker: ({ actor }) => ({ alias: actor?.name }) };
		globalThis.ui = { notifications: { warn: vi.fn(), info: vi.fn() } };
	});
	afterEach(() => {
		globalThis.ChatMessage = saved.ChatMessage;
		globalThis.ui = saved.ui;
	});

	// A minor-tier stand-in (no Consequence diversions), so the tick is written as it stands.
	function seeker(item, boxes = {}) {
		const model = {
			getArcanum: vi.fn(async slug => (slug === item.slug ? item : null)),
			setArcanumBoxChecked: vi.fn(async (slug, context, index, checked) => { boxes[`${slug}:${context}:${index}`] = checked; }),
			arcanaBoxStates: boxes,
			arcanaCompletionCount: () => 0,
		};
		return { actor: { id: "a", name: "Corvin", isOwner: true, items: [], typedActor: model }, boxes };
	}

	it("the 2nd Consequence on the Ice Sphere asks for a move and ticks it", async () => {
		const range = consequenceBoxRange(ICE.back.description);
		const { actor, boxes } = seeker(ICE, consequences(ICE, 1));
		const pick = vi.fn(async ({ choices }) => choices.find(c => c.label === "A MIGHTY WILL"));
		const result = await settleArcanumBoxTick(actor, { slug: ICE.slug, context: "back", index: range.from + 1, checked: true }, { pick, ask: async () => ({ kind: "consequence" }) });
		expect(result).toBe("marked");
		expect(pick).toHaveBeenCalledOnce();
		expect(pick.mock.calls[0][0]).toMatchObject({ rule: PACED_BACK_MOVES[ICE.slug].rule, page: "Book II p.547" });
		expect(boxes[`${ICE.slug}:back:${choiceIndex(ICE, "A MIGHTY WILL")}`]).toBe(true);
		// The card is read once for the owed count before and after, and handed to the ask; the other read is the
		// Consequence check's own (majorConsequenceCard).
		expect(actor.typedActor.getArcanum).toHaveBeenCalledTimes(2);
	});

	it("a tick that earns nothing asks nothing, and nor does a move ticked by hand", async () => {
		const range = consequenceBoxRange(ICE.back.description);
		const pick = vi.fn();
		const first = seeker(ICE);
		await settleArcanumBoxTick(first.actor, { slug: ICE.slug, context: "back", index: range.from, checked: true }, { pick, ask: async () => ({ kind: "consequence" }) });
		const early = seeker(ICE);
		await settleArcanumBoxTick(early.actor, { slug: ICE.slug, context: "back", index: choiceIndex(ICE, "FARWALKER"), checked: true }, { pick });
		expect(pick).not.toHaveBeenCalled();
	});

	it("the card's Choose cue asks for each owed move, quoting the card", async () => {
		const { actor, boxes } = seeker(CLOAK, consequences(CLOAK, 3));
		const ask = vi.fn(async ({ choices }) => choices[0]);
		expect(await chooseUnlockChoices(actor, CLOAK.slug, { ask })).toBe(1);
		expect(boxes[`${CLOAK.slug}:back:${choiceIndex(CLOAK, "UNHOLY VISAGE")}`]).toBe(true);
	});

	it("the ask quotes a paced card's rule and page", async () => {
		const ask = vi.fn(async () => null);
		await askUnlockChoice({ title: "Demonhide Cloak", name: "moves on the reverse", choices: [{ index: 1, label: "UNHOLY VISAGE" }],
			rule: PACED_BACK_MOVES["demonhide-cloak"].rule, page: "Book II p.545" }, { ask });
		const { content, buttons } = ask.mock.calls[0][0];
		expect(content).toContain("When you have marked 3 Consequences, you gain the following move");
		expect(content).toContain("Book II p.545");
		expect(buttons.map(b => b.label)).toEqual(["UNHOLY VISAGE", "Choose later"]);
	});
});
