import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
	CharacterArcana, unlockChoiceSection, unlockChoiceState,
} from "../../../module/actors/character/CharacterArcana.js";
import {
	MIND_OVER_MAGIC, askUnlockChoice, chooseUnlockChoices, improviseOffer, markImproviseStep, mindOverMagicRoll, settleArcanumBoxTick,
} from "../../../module/actors/character/arcana-seeker-moves.js";
import { FakeArcanaRepository } from "../../fakes/FakeArcanaRepository.js";

// Three arcana fixes from the Seeker re-audit (2026-10-18):
//  - the rolls printed on a card's FRONT are rollable handles, with Mind Over Magic's +INT;
//  - the Hec'tumel Codex's "Each time you make a mark, choose one of the Codex Spells (see reverse)";
//  - a discovered lead is a found card: identified AND revealed.

const readCard = rel => ({ ...JSON.parse(fs.readFileSync(path.resolve(rel), "utf8")).flags.stonetop });
const AZURE  = readCard("packs/src/stonetop-arcana/major/azure-hand.json");
const CODEX  = readCard("packs/src/stonetop-arcana/major/hectumel-codex.json");
const MINDGEM = readCard("packs/src/stonetop-arcana/major/mindgem.json");
const ARCH   = readCard("packs/src/stonetop-arcana/minor/crumbling-arch.json");

function makeFlags(store = {}) {
	return {
		_store: store,
		getFlag: key => store[key] ?? null,
		setFlag: vi.fn(async (key, value) => { store[key] = value; }),
		batch: vi.fn(async ({ sets = {} } = {}) => { for (const [k, v] of Object.entries(sets)) store[k] = v; }),
	};
}
const arcana = (store, cards) => new CharacterArcana(makeFlags(store), new FakeArcanaRepository(cards));

describe("front-side moves through CharacterArcana", () => {
	it("getArcanumMove resolves a front handle, learned once the card is identified", async () => {
		const store = { owned: ["azure-hand"], identified: ["azure-hand"] };
		const move = await arcana(store, [AZURE]).getArcanumMove("azure-hand", "~front:0");
		expect(move).toMatchObject({ slug: "~front:0", roll: "con", learned: true, front: true, boxIndex: null, cardTitle: AZURE.front.title });
		expect(move.picks).toHaveLength(4);
	});

	it("an unidentified card's front move reads but does not roll", async () => {
		const move = await arcana({ owned: ["azure-hand"] }, [AZURE]).getArcanumMove("azure-hand", "~front:0");
		expect(move.learned).toBe(false);
	});

	it("resolves an unlock requirement's roll", async () => {
		const store = { owned: ["crumbling-arch"], identified: ["crumbling-arch"] };
		const move = await arcana(store, [ARCH]).getArcanumMove("crumbling-arch", "~req:gaze-and-roll:0");
		expect(move).toMatchObject({ roll: "wis", learned: true, name: "A crumbling arch" });
	});

	it("buildSnapshot puts the handle on the front and keeps the front's □ indices", async () => {
		const store = { owned: ["mindgem"], identified: ["mindgem"], boxes: { "mindgem:front:2": true } };
		const snap = await arcana(store, [MINDGEM]).buildSnapshot();
		const desc = snap.major.items[0].front.description;
		expect(desc).toContain('data-move-slug="~front:0"');
		// The four □ tasks are still front boxes 0-3, the third one still ticked.
		expect(desc.match(/data-context="front" data-index="\d"/g)).toEqual([0, 1, 2, 3].map(i => `data-context="front" data-index="${i}"`));
		expect(desc).toMatch(/data-context="front" data-index="2" checked/);
	});

	it("wraps a requirement line's roll on the snapshot", async () => {
		const snap = await arcana({ owned: ["crumbling-arch"], identified: ["crumbling-arch"] }, [ARCH]).buildSnapshot();
		const req = snap.minor.items[0].front.unlock.requirements.find(i => i.slug === "gaze-and-roll");
		expect(req.description).toContain('data-move-slug="~req:gaze-and-roll:0"');
	});

	it("a front move gets Mind Over Magic's +INT, and no Improvise", () => {
		const seeker = { items: [{ type: "move", name: MIND_OVER_MAGIC, system: {}, flags: {} }, { type: "move", name: "Improvise", system: {}, flags: {} }] };
		expect(mindOverMagicRoll(seeker, "con")).toMatchObject({ stat: "int" });
		// Cast a Codex Spell already rolls +INT: nothing to swap.
		expect(mindOverMagicRoll(seeker, "int")).toBeNull();
		expect(improviseOffer(seeker, { slug: "~front:0", name: "X", learned: false, front: true }, "azure-hand")).toBeNull();
	});
});

describe("unlock choices: the Hec'tumel Codex's spells", () => {
	it("finds the section the unlock line names, and its four spells", () => {
		const section = unlockChoiceSection(CODEX.front.unlock.description, CODEX.back.description);
		expect(section.name).toBe("Codex Spells");
		expect(section.title).toBe("Spells of the Codex");
		expect(section.choices).toEqual([
			{ index: 0, label: "Call Up the Dead" },
			{ index: 1, label: "Serpentine" },
			{ index: 2, label: "Snuff the Spirit" },
			{ index: 3, label: "Torpor" },
		]);
	});

	it("is no card's but the Codex's among the shipped ones", () => {
		const dir = "packs/src/stonetop-arcana";
		const hits = ["major", "minor"].flatMap(tier => fs.readdirSync(path.join(dir, tier)).map(f => readCard(path.join(dir, tier, f))))
			.filter(c => unlockChoiceSection(c.front?.unlock?.description, c.back?.description))
			.map(c => c.slug);
		expect(hits).toEqual(["hectumel-codex"]);
	});

	it("counts the marks that still owe a spell", () => {
		const slug = "hectumel-codex";
		expect(unlockChoiceState(CODEX, {}).owed).toBe(0);
		const one = unlockChoiceState(CODEX, { [`${slug}:unlock:0`]: true });
		expect(one).toMatchObject({ marked: 1, owed: 1 });
		expect(one.open.map(c => c.index)).toEqual([0, 1, 2, 3]);
		const chosen = unlockChoiceState(CODEX, { [`${slug}:unlock:0`]: true, [`${slug}:back:2`]: true });
		expect(chosen).toMatchObject({ marked: 1, owed: 0 });
		expect(chosen.learned.map(c => c.label)).toEqual(["Snuff the Spirit"]);
		expect(chosen.open.map(c => c.index)).toEqual([0, 1, 3]);
	});

	it("buildSnapshot carries the owed count and only the learned spells onto the front", async () => {
		const slug = "hectumel-codex";
		const owing = await arcana({ owned: [slug], identified: [slug], boxes: { [`${slug}:unlock:0`]: true } }, [CODEX]).buildSnapshot();
		expect(owing.major.items[0].unlockChoice).toEqual({ name: "Codex Spells", owed: 1, html: null });

		const store = { owned: [slug], identified: [slug], boxes: { [`${slug}:unlock:0`]: true, [`${slug}:back:1`]: true } };
		const { unlockChoice } = (await arcana(store, [CODEX]).buildSnapshot()).major.items[0];
		expect(unlockChoice.owed).toBe(0);
		expect(unlockChoice.html).toMatch(/^<h3>Spells of the Codex<\/h3>/);
		expect(unlockChoice.html).toContain("Serpentine");
		expect(unlockChoice.html).toMatch(/data-context="back" data-index="1" checked/);
		for (const hidden of ["Call Up the Dead", "Snuff the Spirit", "Torpor", "DARKSOME VESSEL"]) expect(unlockChoice.html).not.toContain(hidden);
	});

	it("is null on a card with no unlock choice", async () => {
		const snap = await arcana({ owned: ["azure-hand"], identified: ["azure-hand"] }, [AZURE]).buildSnapshot();
		expect(snap.major.items[0].unlockChoice).toBeNull();
	});
});

describe("unlock choices: the asks", () => {
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

	const CARD = { slug: "hectumel-codex", ...CODEX };
	function seeker(boxes = {}) {
		const model = {
			getArcanum: vi.fn(async slug => (slug === CARD.slug ? CARD : null)),
			setArcanumBoxChecked: vi.fn(async (slug, context, index, checked) => { boxes[`${slug}:${context}:${index}`] = checked; }),
			markNextArcanumUnlockStep: vi.fn(async slug => {
				for (let i = 0; i < 4; i++) {
					if (!boxes[`${slug}:unlock:${i}`]) { boxes[`${slug}:unlock:${i}`] = true; return { index: i, count: 4, title: CODEX.front.title }; }
				}
				return { index: null, count: 4, title: CODEX.front.title };
			}),
			arcanaBoxStates: boxes,
		};
		return { actor: { id: "a", name: "Corvin", isOwner: true, items: [], typedActor: model }, model, boxes };
	}
	const TICK = { slug: "hectumel-codex", context: "unlock", index: 0, checked: true };

	it("a newly ticked Codex circle asks for a spell and ticks it on the back", async () => {
		const { actor, boxes } = seeker();
		const pick = vi.fn(async ({ choices }) => choices.find(c => c.label === "Torpor"));
		expect(await settleArcanumBoxTick(actor, TICK, { pick })).toBe("marked");
		expect(pick).toHaveBeenCalledOnce();
		expect(pick.mock.calls[0][0].choices).toHaveLength(4);
		expect(boxes["hectumel-codex:unlock:0"]).toBe(true);
		expect(boxes["hectumel-codex:back:3"]).toBe(true);
	});

	it("closing the ask leaves the circle marked, no spell chosen, and says so", async () => {
		const { actor, boxes } = seeker();
		expect(await settleArcanumBoxTick(actor, TICK, { pick: async () => null })).toBe("marked");
		expect(boxes["hectumel-codex:unlock:0"]).toBe(true);
		expect(Object.keys(boxes).some(k => k.includes(":back:"))).toBe(false);
		expect(globalThis.ui.notifications.info).toHaveBeenCalledWith(expect.stringMatching(/No Codex Spells chosen yet/));
	});

	it("unticking never asks, and a circle that owes nothing asks nothing", async () => {
		const pick = vi.fn();
		const { actor } = seeker({ "hectumel-codex:unlock:0": true, "hectumel-codex:back:0": true });
		expect(await settleArcanumBoxTick(actor, { ...TICK, checked: false }, { pick })).toBe("unticked");
		const other = seeker({ "hectumel-codex:back:0": true, "hectumel-codex:back:1": true });
		// One mark against two spells already chosen (ticked on a revealed back): nothing owed.
		expect(await settleArcanumBoxTick(other.actor, TICK, { pick })).toBe("marked");
		expect(pick).not.toHaveBeenCalled();
	});

	it("the card's cue asks for each owed spell in turn, offering only the unchosen", async () => {
		const { actor, boxes } = seeker({ "hectumel-codex:unlock:0": true, "hectumel-codex:unlock:1": true, "hectumel-codex:back:0": false });
		const offered = [];
		const pick = vi.fn(async ({ choices }) => { offered.push(choices.map(c => c.index)); return choices[0]; });
		expect(await chooseUnlockChoices(actor, "hectumel-codex", { ask: pick })).toBe(2);
		expect(offered).toEqual([[0, 1, 2, 3], [1, 2, 3]]);
		expect(boxes["hectumel-codex:back:0"]).toBe(true);
		expect(boxes["hectumel-codex:back:1"]).toBe(true);
	});

	it("Improvise's 10+ step on the Codex asks for its spell too", async () => {
		const { actor, boxes } = seeker();
		const pick = vi.fn(async ({ choices }) => choices[2]);
		expect(await markImproviseStep(actor, "hectumel-codex", { pick })).toBe(true);
		expect(boxes["hectumel-codex:unlock:0"]).toBe(true);
		expect(boxes["hectumel-codex:back:2"]).toBe(true);
	});

	it("the ask offers each spell and a way to choose later", async () => {
		const ask = vi.fn(async () => null);
		await askUnlockChoice({ title: "Hec'tumel Codex", name: "Codex Spells", choices: [{ index: 0, label: "Call Up the Dead" }] }, { ask });
		const { buttons, title } = ask.mock.calls[0][0];
		expect(title).toBe("Hec'tumel Codex: choose one of the Codex Spells");
		expect(buttons.map(b => b.label)).toEqual(["Call Up the Dead", "Choose later"]);
		expect(buttons.at(-1).value).toBeNull();
	});
});

describe("discovering a lead: a found card", () => {
	it("drops the lead and identifies AND reveals the card, settling any owed back", async () => {
		const store = { owned: ["giant-oak-leaf"], leads: ["giant-oak-leaf"], backOwed: ["giant-oak-leaf"] };
		await arcana(store, []).discoverArcanum("giant-oak-leaf");
		expect(store).toMatchObject({ leads: [], identified: ["giant-oak-leaf"], revealed: ["giant-oak-leaf"], backOwed: [] });
	});
});
