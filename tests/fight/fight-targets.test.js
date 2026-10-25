import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { engagedOpponents, foesInFight, rollTargets, withoutDowned, whoItHitsWindow, whoItHitsConfirm, askWhoItHits, TARGET_FIELD } from "../../module/fight/fight-targets.js";
import { fakeActor, fakeToken, fakeScene, fakeCombatant, fakeCombat, collection } from "../fakes/fight.js";

// Who a roll hits when nobody targeted anyone by hand: whoever the roller is fighting on the map.

let saved;
let fightTabOn;
beforeEach(() => {
	saved = { game: globalThis.game, ui: globalThis.ui, canvas: globalThis.canvas, CONST: globalThis.CONST, fromUuidSync: globalThis.fromUuidSync };
	fightTabOn = true;
	globalThis.CONST = { GRID_TYPES: { GRIDLESS: 0, SQUARE: 1 } };
});
afterEach(() => { Object.assign(globalThis, saved); });

/**
 * Bram against a crinwin; Cadi between two wolves; Aeliana, far off, shooting at the first wolf and at a
 * boar nobody is touching.
 */
function fight() {
	const actor = (id, type) => fakeActor({ id, name: id[0].toUpperCase() + id.slice(1), type });
	const bramActor = actor("bram", "character");
	const cadiActor = actor("cadi", "character");
	const aelianaActor = actor("aeliana", "character");
	const wolfActor = actor("wolf", "monster");
	// A real token document reads its disposition at the top level as well as in its saved data.
	const token = (id, col, row, a, name) => Object.assign(fakeToken({ id, col, row, actor: a, ...(name ? { name } : {}) }), {
		uuid: `Scene.scene1.Token.${id}`, documentName: "Token", disposition: -1,
	});
	const tokens = {
		bram: token("tBram", 0, 1, bramActor),
		crinwin: token("tCrin", 0, 2, actor("crinwin", "monster")),
		cadi: token("tCadi", 6, 1, cadiActor),
		wolf1: token("tW1", 5, 1, wolfActor, "Wolf (1)"),
		wolf2: token("tW2", 7, 1, wolfActor, "Wolf (2)"),
		aeliana: token("tAel", 12, 12, aelianaActor),
		boar: token("tBoar", 20, 20, actor("boar", "monster")),
	};
	const scene = fakeScene({ tokens: Object.values(tokens) });
	const c = (id, t) => fakeCombatant({ id, token: t, scene });
	const combat = fakeCombat({ scene, combatants: [
		c("cBram", tokens.bram), c("cCadi", tokens.cadi), c("cAel", tokens.aeliana),
		c("cCrin", tokens.crinwin), c("cW1", tokens.wolf1), c("cW2", tokens.wolf2), c("cBoar", tokens.boar),
	] });
	const player = { id: "p1", isGM: false, active: true, character: aelianaActor, targets: new Set([{ document: { id: "tW1" } }, { document: { id: "tBoar" } }]) };
	globalThis.game = {
		...saved.game,
		user: { id: "gm", isGM: true },
		users: collection([player]),
		combats: collection([combat]),
		settings: { get: (scope, key) => (key === "fightTab" ? fightTabOn : undefined) },
	};
	globalThis.ui = { combat: { viewed: combat } };
	globalThis.canvas = { scene };
	const tokenActor = key => ({ ...tokens[key].actor, token: tokens[key] });
	return { scene, combat, tokens, bramActor, cadiActor, aelianaActor, wolfActor, tokenActor };
}

const names = targets => targets.map(t => t.name);

describe("engagedOpponents", () => {
	it("gives a character the foe they are standing against, as a hand target is frozen", () => {
		const { bramActor } = fight();
		expect(engagedOpponents(bramActor)).toEqual([
			{ uuid: "Scene.scene1.Token.tCrin", name: "Crinwin", actorId: "crinwin", disposition: -1, hasActor: true },
		]);
	});

	it("gives a character between two foes both, in the order the Fight tab lists them", () => {
		const { cadiActor } = fight();
		expect(names(engagedOpponents(cadiActor))).toEqual(["Wolf (1)", "Wolf (2)"]);
	});

	it("gives a character the foes they are shooting at", () => {
		const { aelianaActor } = fight();
		expect(names(engagedOpponents(aelianaActor))).toEqual(["Wolf (1)", "Boar"]);
	});

	it("gives a monster the character standing against it", () => {
		const { tokenActor } = fight();
		expect(names(engagedOpponents(tokenActor("crinwin")))).toEqual(["Bram"]);
	});

	it("gives a monster the character in its face before the one shooting at it", () => {
		const { tokenActor } = fight();
		expect(names(engagedOpponents(tokenActor("wolf1")))).toEqual(["Cadi"]);
	});

	it("gives a monster nobody is touching the character shooting at it", () => {
		const { tokenActor } = fight();
		expect(names(engagedOpponents(tokenActor("boar")))).toEqual(["Aeliana"]);
	});

	it("is empty for a stat block with several tokens in the fight, since any of them could be rolling", () => {
		const { wolfActor } = fight();
		expect(engagedOpponents(wolfActor)).toEqual([]);
	});

	it("is empty outside a fight, with the Fight tab off, or with no map", () => {
		const { bramActor } = fight();
		expect(engagedOpponents(fakeActor({ id: "stranger", type: "character" }))).toEqual([]);
		expect(engagedOpponents(bramActor, { scene: null })).toEqual([]);
		fightTabOn = false;
		expect(engagedOpponents(bramActor)).toEqual([]);
	});
});

describe("rollTargets", () => {
	it("keeps the roller's own targets, without asking", async () => {
		const { cadiActor } = fight();
		const ask = vi.fn();
		const hand = [{ uuid: "Scene.scene1.Token.tBoar", name: "Boar" }];
		expect(await rollTargets(cadiActor, { handTargets: hand, ask })).toBe(hand);
		expect(ask).not.toHaveBeenCalled();
	});

	it("takes the one opponent without asking, and nobody when there is nobody", async () => {
		const { bramActor } = fight();
		const ask = vi.fn();
		expect(names(await rollTargets(bramActor, { ask }))).toEqual(["Crinwin"]);
		expect(await rollTargets(fakeActor({ id: "stranger", type: "character" }), { ask })).toEqual([]);
		expect(ask).not.toHaveBeenCalled();
	});

	it("asks who it hits when the roller is fighting more than one, and hands back the answer", async () => {
		const { cadiActor } = fight();
		const ask = vi.fn(async ({ candidates }) => candidates.slice(1));
		expect(names(await rollTargets(cadiActor, { ask }))).toEqual(["Wolf (2)"]);
		expect(ask).toHaveBeenCalledWith({ roller: "Cadi", candidates: expect.any(Array) });
		expect(names(ask.mock.calls[0][0].candidates)).toEqual(["Wolf (1)", "Wolf (2)"]);
	});

	it("calls the roll off when the question is backed out of", async () => {
		const { cadiActor } = fight();
		expect(await rollTargets(cadiActor, { ask: async () => null })).toBeNull();
	});

	// FGT-4: a target left up on a foe the fight has put down is not an aim. Kept, it aimed the next Clash at
	// the corpse, and a 7-9 or a miss had the corpse strike back.
	it("drops a hand target the fight has put down, and lets the engagement aim the blow", async () => {
		const { cadiActor, combat, tokens } = fight();
		globalThis.fromUuidSync = uuid => Object.values(tokens).find(t => t.uuid === uuid) ?? null;
		const w1 = combat.combatants.get("cW1");
		w1.isDefeated = true;
		const ask = vi.fn();
		const hand = [{ uuid: tokens.wolf1.uuid, name: "Wolf (1)" }];
		expect(withoutDowned(hand)).toEqual([]);
		// Wolf (1) is down: Cadi is fighting Wolf (2) alone now, so that is who the blow lands on, unasked.
		expect(names(await rollTargets(cadiActor, { handTargets: hand, ask }))).toEqual(["Wolf (2)"]);
		expect(ask).not.toHaveBeenCalled();
		// A target still up, or one not in the fight at all, is kept as it was handed in.
		const alive = [{ uuid: tokens.wolf2.uuid }, { uuid: "Actor.somebody" }];
		expect(withoutDowned(alive)).toBe(alive);
		// So is everything with the Fight tab off.
		fightTabOn = false;
		expect(withoutDowned(hand)).toBe(hand);
	});
});

// FGT-3: the foe picker a player sees (Speak Softly's "They refused") never names a fighter the GM has hidden.
describe("foesInFight", () => {
	it("lists the foes in the fight a player can see, and leaves a GM-hidden one out", () => {
		const { bramActor, tokens } = fight();
		tokens.boar.hidden = true;
		globalThis.game.user = { id: "p1", isGM: false };
		expect(names(foesInFight(bramActor))).not.toContain("Boar");
		expect(names(foesInFight(bramActor))).toEqual(["Crinwin", "Wolf (1)", "Wolf (2)"]);
		globalThis.game.user = { id: "gm", isGM: true };
		expect(names(foesInFight(bramActor))).toContain("Boar");
	});
});

describe("an area attack (Berserker)", () => {
	/** Bram with a crinwin in front of him and Cadi at his shoulder. */
	function shoulderToShoulder() {
		const actor = (id, type) => fakeActor({ id, name: id[0].toUpperCase() + id.slice(1), type });
		const bramActor = actor("bram", "character");
		const token = (id, col, row, a, disposition) => Object.assign(fakeToken({ id, col, row, actor: a }), {
			uuid: `Scene.scene1.Token.${id}`, documentName: "Token", disposition,
		});
		const tokens = {
			bram: token("tBram", 1, 1, bramActor, 1),
			cadi: token("tCadi", 2, 1, actor("cadi", "character"), 1),
			crinwin: token("tCrin", 1, 2, actor("crinwin", "monster"), -1),
		};
		const scene = fakeScene({ tokens: Object.values(tokens) });
		const combat = fakeCombat({ scene, combatants: Object.entries(tokens).map(([key, t]) => fakeCombatant({ id: `c${key}`, token: t, scene })) });
		globalThis.game = {
			...saved.game, user: { id: "gm", isGM: true }, users: collection([]), combats: collection([combat]),
			settings: { get: (scope, key) => (key === "fightTab" ? true : undefined) },
		};
		globalThis.ui = { combat: { viewed: combat } };
		globalThis.canvas = { scene };
		return { bramActor };
	}

	it("asks even about a single foe, because the answer includes who else is standing there", async () => {
		const { bramActor } = shoulderToShoulder();
		const ask = vi.fn(async q => q.candidates);
		const hit = await rollTargets(bramActor, { area: true, ask });
		expect(names(hit)).toEqual(["Crinwin", "Cadi"]);
		expect(ask.mock.calls[0][0].area).toBe(true);
	});

	it("marks the ally as one of the roller's own side, and leaves them out of an ordinary roll", async () => {
		const { bramActor } = shoulderToShoulder();
		const ask = vi.fn(async q => q.candidates);
		const hit = await rollTargets(bramActor, { area: true, ask });
		expect(hit.find(t => t.name === "Cadi").ally).toBe(true);
		// Without the area tag a lone foe is taken without a question, and no ally is in reach of it.
		expect(names(await rollTargets(bramActor, { ask }))).toEqual(["Crinwin"]);
	});

	// ⚠ A HIDDEN TOKEN IS NOT A CANDIDATE, because this list is shown to whoever is rolling and a
	// player is often whoever that is. `visible` is the tracker's own rule (fight-state.js#fighterOf),
	// and without it the window named a GM-hidden ambusher beside the Berserker, pre-ticked, and gave
	// the ambush away before it was sprung. A GM sees everyone and can still sweep it in.
	it("leaves a token this viewer cannot see out of the list, though a GM still sees it", async () => {
		const { bramActor } = shoulderToShoulder();
		const ask = vi.fn(async q => q.candidates);
		const hidden = [...globalThis.canvas.scene.tokens].find(t => t.id === "tCadi");
		hidden.hidden = true;

		// The GM is told, because the GM is the one hiding it.
		expect(names(await rollTargets(bramActor, { area: true, ask }))).toEqual(["Crinwin", "Cadi"]);

		globalThis.game.user = { id: "p1", isGM: false };
		expect(names(await rollTargets(bramActor, { area: true, ask }))).toEqual(["Crinwin"]);
	});

	it("ticks them all and says why, where an ordinary question ticks the first", () => {
		const candidates = [{ name: "Crinwin" }, { name: "Cadi", ally: true }];
		const area = whoItHitsWindow({ roller: "Bram", candidates, area: true });
		expect(area.content.match(/checked/g)).toHaveLength(2);
		expect(area.content).toContain("friend and foe alike");
		expect(area.content).toContain("(your side)");
		expect(area.confirm).toBe(whoItHitsConfirm(candidates));
		expect(whoItHitsWindow({ roller: "Bram", candidates }).content.match(/checked/g)).toHaveLength(1);
	});
});

describe("an area attack loosed at the far end (Blot Out the Sun)", () => {
	/** Aeliana shooting a wolf across the field: Robin at her shoulder, Cadi at the wolf's. */
	function acrossTheField() {
		const actor = (id, type) => fakeActor({ id, name: id[0].toUpperCase() + id.slice(1), type });
		const aelianaActor = actor("aeliana", "character");
		const token = (id, col, row, a, disposition) => Object.assign(fakeToken({ id, col, row, actor: a }), {
			uuid: `Scene.scene1.Token.${id}`, documentName: "Token", disposition,
		});
		const tokens = {
			aeliana: token("tAel", 0, 0, aelianaActor, 1),
			robin: token("tRob", 1, 0, actor("robin", "character"), 1),
			wolf: token("tWolf", 10, 0, actor("wolf", "monster"), -1),
			cadi: token("tCadi", 11, 0, actor("cadi", "character"), 1),
		};
		const scene = fakeScene({ tokens: Object.values(tokens) });
		const combat = fakeCombat({ scene, combatants: Object.entries(tokens).map(([key, t]) => fakeCombatant({ id: `c${key}`, token: t, scene })) });
		const player = { id: "p1", isGM: false, active: true, character: aelianaActor, targets: new Set([{ document: { id: "tWolf" } }]) };
		globalThis.game = {
			...saved.game, user: { id: "gm", isGM: true }, users: collection([player]), combats: collection([combat]),
			settings: { get: (scope, key) => (key === "fightTab" ? true : undefined) },
		};
		globalThis.ui = { combat: { viewed: combat } };
		globalThis.canvas = { scene };
		return { aelianaActor };
	}

	it("catches who is standing where the arrows land, not who is standing by the archer", async () => {
		const { aelianaActor } = acrossTheField();
		const ask = vi.fn(async q => q.candidates);
		const hit = await rollTargets(aelianaActor, { area: true, areaAround: "targets", ask });
		expect(names(hit)).toEqual(["Wolf", "Cadi"]);
		// Robin is at the Ranger's shoulder, which is nowhere near the volley.
		expect(names(hit)).not.toContain("Robin");
		expect(hit.find(t => t.name === "Cadi").ally).toBe(true);
	});

	it("still measures a Heavy's own lashing out from the Heavy", async () => {
		const { aelianaActor } = acrossTheField();
		const ask = vi.fn(async q => q.candidates);
		expect(names(await rollTargets(aelianaActor, { area: true, ask }))).toEqual(["Wolf", "Robin"]);
	});

	// ⚠ HAND TARGETS DO NOT END AN AREA ATTACK'S QUESTION. An ordinary blow is aimed at a thing and
	// the roller's own target settles it; a volley is aimed at a PLACE, and who else is standing
	// there is the whole of what the tag buys. Returned on the hand target alone, Blot Out the Sun
	// spent the quiver on a sweep that fell on the one foe already picked.
	it("still sweeps what is standing where a hand-targeted volley lands", async () => {
		const { aelianaActor } = acrossTheField();
		const ask = vi.fn(async q => q.candidates);
		const wolf = { uuid: "Scene.scene1.Token.tWolf", name: "Wolf", hasActor: true };

		const hit = await rollTargets(aelianaActor, { handTargets: [wolf], area: true, areaAround: "targets", ask });

		expect(names(hit)).toEqual(["Wolf", "Cadi"]);
	});

	// And an ordinary blow is still the roller's own to aim: no question, no sweep.
	it("takes a hand target and asks nothing when there is no area tag", async () => {
		const { aelianaActor } = acrossTheField();
		const ask = vi.fn(async q => q.candidates);
		const wolf = { uuid: "Scene.scene1.Token.tWolf", name: "Wolf", hasActor: true };

		expect(await rollTargets(aelianaActor, { handTargets: [wolf], ask })).toEqual([wolf]);
		expect(ask).not.toHaveBeenCalled();
	});

	it("says where the volley falls rather than quoting Berserker", () => {
		const candidates = [{ name: "Wolf" }, { name: "Cadi", ally: true }];
		const volley = whoItHitsWindow({ roller: "Aeliana", candidates, area: true, areaAround: "targets" });
		expect(volley.content).toContain("where the arrows land");
		expect(volley.content).not.toContain("Battle Joy");
		expect(volley.content.match(/checked/g)).toHaveLength(2);
	});
});

describe("the \"Who does this hit?\" window", () => {
	const candidates = [{ name: "Wolf (1)" }, { name: "<b>Wolf</b>" }];

	it("lists everyone the roller is fighting with only the first ticked, and cites the rule", () => {
		const view = whoItHitsWindow({ roller: "Cadi", candidates });
		expect(view.title).toBe("Cadi: who does this hit?");
		const boxes = view.content.match(/<input[^>]*>/g);
		expect(boxes).toHaveLength(2);
		expect(boxes[0]).toContain("checked");
		expect(boxes[1]).not.toContain("checked");
		expect(boxes[1]).toContain(`name="${TARGET_FIELD}" value="1"`);
		expect(view.content).toContain("&lt;b&gt;Wolf&lt;/b&gt;");
		expect(view.content).toContain("Book I, page 414");
		expect(view.confirm).toBe("Attack Wolf (1)");
		expect(view.cancel).toBe("Don't roll");
	});

	it("names who is ticked on the confirm button, and says so when nobody is", () => {
		expect(whoItHitsConfirm([{ name: "Wolf (1)" }, { name: "Wolf (2)" }])).toBe("Attack Wolf (1) & Wolf (2)");
		expect(whoItHitsConfirm([])).toBe("Tick who this hits");
	});

	/** A form holding the window's boxes, ticked as given. */
	function formWith(ticks) {
		const inputs = ticks.map((checked, i) => ({ value: String(i), checked }));
		return { querySelectorAll: selector => (selector.endsWith(":checked") ? inputs.filter(i => i.checked) : inputs), inputs };
	}
	const fakeDocument = { createElement: () => ({ innerHTML: "" }) };

	it("hands back the ticked opponents, and nothing for a cancel or a close", async () => {
		let config = null;
		const form = formWith([true, true]);
		const DialogV2 = { wait: vi.fn(async given => { config = given; return given.buttons[0].callback(null, { form }); }) };
		expect(names(await askWhoItHits({ roller: "Cadi", candidates }, { DialogV2, document: fakeDocument })))
			.toEqual(["Wolf (1)", "<b>Wolf</b>"]);
		expect(config.classes).toContain("stonetop");
		expect(config.buttons.map(b => b.action)).toEqual(["hit", "cancel"]);
		expect(config.rejectClose).toBe(false);

		const cancelled = { wait: async given => given.buttons[1].callback() };
		expect(await askWhoItHits({ roller: "Cadi", candidates }, { DialogV2: cancelled, document: fakeDocument })).toBeNull();
		const closed = { wait: async () => null };
		expect(await askWhoItHits({ roller: "Cadi", candidates }, { DialogV2: closed, document: fakeDocument })).toBeNull();
	});

	it("keeps the confirm button saying who is ticked, and unpressable with nobody", async () => {
		let config = null;
		const DialogV2 = { wait: vi.fn(async given => { config = given; return null; }) };
		await askWhoItHits({ roller: "Cadi", candidates }, { DialogV2, document: fakeDocument });
		const form = formWith([false, false]);
		// Core's button holds its label in a span.
		const label = { textContent: "" };
		const confirm = { disabled: false, querySelector: selector => (selector === "span" ? label : null) };
		let onChange = null;
		const root = {
			querySelector: selector => (selector === "form" ? form : selector === 'button[data-action="hit"]' ? confirm : null),
			addEventListener: (type, fn) => { if (type === "change") onChange = fn; },
		};
		config.render(null, { element: root });
		onChange();
		expect([label.textContent, confirm.disabled]).toEqual(["Tick who this hits", true]);
		form.inputs[1].checked = true;
		onChange();
		expect([label.textContent, confirm.disabled]).toEqual(["Attack <b>Wolf</b>", false]);
	});
});
