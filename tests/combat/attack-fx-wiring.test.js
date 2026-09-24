import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { SCOPE, pc, installCombatChatFakes, uninstallCombatChatFakes, cardWithFlag, makeMessage } from "../fakes/combat-chat.js";
import { fakeActor, fakeToken, fakeScene, fakeCombatant, fakeCombat, collection } from "../fakes/fight.js";
import { attackWeapon } from "../../module/utils/damage.js";

// Where the attack flow hands its blows to the map (combat/attack-fx.js). The three entry points
// are spies that CALL THROUGH to the real ones, which with no Sequencer and no modules in these
// worlds do nothing, so a test can both read what was asked for and prove the real code stays out
// of the way when it breaks.
vi.mock("../../module/combat/attack-fx.js", async importOriginal => {
	const real = await importOriginal();
	return {
		...real,
		playBlowFx: vi.fn(real.playBlowFx),
		playMissFx: vi.fn(real.playMissFx),
		playHitReactions: vi.fn(real.playHitReactions),
	};
});
const fx = await import("../../module/combat/attack-fx.js");
vi.mock("../../module/combat/readiness-loss.js", () => ({ settleReadinessOnAttack: vi.fn(async () => false) }));
vi.mock("../../module/combat/battle-joy-offer.js", () => ({ offerBattleJoyOnDamage: vi.fn(async () => false) }));
vi.mock("../../module/utils/logger.js", () => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn() }));
const { warn } = await import("../../module/utils/logger.js");
const {
	rollDamageAt, rollMoveDamageAt, rollOptionDamage, sufferEnemyAttack, maybeMissFx, wireApplyDamage,
} = await import("../../module/combat/attack-flow.js");

const I18N = globalThis.game?.i18n;
let posted;
let saved;

const hero = (id, name) => ({
	...fakeActor({ id, name, type: "character" }),
	documentName: "Actor",
	uuid: `Actor.${id}`,
	isOwner: true,
	items: [],
	getFlag: () => ({}),
	system: { attributes: { armor: { value: 2 }, hp: { value: 10, max: 10 }, damage: { value: "d8" } } },
	update: vi.fn(async function (changes) { this.system.attributes.hp.value = changes["system.attributes.hp.value"]; }),
});

const crinwin = id => ({
	...fakeActor({ id, name: "Crinwin", type: "monster" }),
	system: { attributes: { damage: { value: "bite d6 (close, 1 piercing)", rollFormula: "d6" }, armor: { value: 1 }, hp: { value: 3, max: 3 } } },
});

/** Tokens one square apart on one row of the canvas scene, all in one fight (as roll-damage-at.test.js). */
function fightInARow(row) {
	const tokens = {};
	row.forEach(([key, actor], col) => {
		tokens[key] = Object.assign(fakeToken({ id: `t${key}`, col, row: 1, actor, name: actor.name }), {
			uuid: `Scene.scene1.Token.t${key}`, documentName: "Token", disposition: actor.type === "character" ? 1 : -1,
		});
	});
	const scene = fakeScene({ tokens: Object.values(tokens) });
	const combat = fakeCombat({ scene, combatants: Object.entries(tokens).map(([key, t]) => fakeCombatant({ id: `c${key}`, token: t, scene })) });
	globalThis.game.combats = collection([combat]);
	globalThis.game.settings = { get: (scope, key) => (key === "fightTab" ? true : "roll") };
	globalThis.ui.combat = { viewed: combat };
	globalThis.canvas = { scene };
	const byUuid = new Map(Object.values(tokens).map(t => [t.uuid, t]));
	globalThis.fromUuid = async uuid => byUuid.get(uuid) ?? null;
	globalThis.fromUuidSync = uuid => byUuid.get(uuid) ?? null;
	const tokenActor = key => ({ ...tokens[key].actor, token: tokens[key] });
	return { tokens, tokenActor };
}

async function apply(flag) {
	const listeners = [];
	const button = { disabled: false, title: "", innerHTML: "", style: {}, addEventListener: (type, fn) => listeners.push(fn) };
	const message = makeMessage({ damage: flag });
	message.canUserModify = () => true;
	wireApplyDamage(message, { querySelector: sel => (sel === ".stonetop-apply-damage" ? button : null) });
	await listeners[0]();
	return message;
}

beforeEach(() => {
	posted = installCombatChatFakes({ user: { targets: new Set() } });
	globalThis.game.i18n = I18N;
	saved = { canvas: globalThis.canvas, fromUuidSync: globalThis.fromUuidSync, Sequence: globalThis.Sequence };
	globalThis.CONST = { ...globalThis.CONST, GRID_TYPES: { GRIDLESS: 0, SQUARE: 1 } };
	globalThis.ui.notifications.info = vi.fn();
	vi.mocked(fx.playBlowFx).mockClear();
	vi.mocked(fx.playMissFx).mockClear();
	vi.mocked(fx.playHitReactions).mockClear();
	vi.mocked(warn).mockClear();
});
afterEach(() => {
	uninstallCombatChatFakes();
	globalThis.canvas = saved.canvas;
	globalThis.fromUuidSync = saved.fromUuidSync;
	globalThis.Sequence = saved.Sequence;
});

describe("a blow that lands is handed to the map", () => {
	it("draws a stat block's bite at the character it is fighting, once the card is posted", async () => {
		const pim = hero("pim", "Pim");
		const { tokens, tokenActor } = fightInARow([["crin", crinwin("crinwin")], ["pim", pim]]);
		let cardsWhenDrawn = null;
		vi.mocked(fx.playBlowFx).mockImplementationOnce(() => { cardsWhenDrawn = posted.length; });
		const crin = tokenActor("crin");
		await rollDamageAt(crin, { formula: "d6", label: "Bite", weapon: attackWeapon({ tags: ["close"] }), shiftKey: true });

		expect(fx.playBlowFx).toHaveBeenCalledTimes(1);
		const [blow] = vi.mocked(fx.playBlowFx).mock.calls[0];
		expect(blow.attacker).toBe(crin);
		expect(blow.blow).toBe("Bite");
		expect(blow.moveKey).toBe("");
		expect(blow.targets.map(t => t.uuid)).toEqual([tokens.pim.uuid]);
		// The weapon as swung, before Apply's armor and fiction tags were laid over it.
		expect(blow.weapon.tags).toEqual(["close"]);
		expect(cardWithFlag(posted, "damage")).toBeTruthy();
		expect(cardsWhenDrawn).toBe(posted.length);
	});

	it("draws nothing for a move's own number", async () => {
		const pim = hero("pim", "Pim");
		const { tokens } = fightInARow([["pim", pim], ["crin", crinwin("crinwin")]]);
		await rollMoveDamageAt(pim, tokens.crin, { move: "Castigate", formula: "1d4" });
		await rollOptionDamage(pim, { move: "Danu's Grasp", damage: { formula: "2d4", self: true } });
		expect(cardWithFlag(posted, "damage")).toBeTruthy();
		expect(fx.playBlowFx).not.toHaveBeenCalled();
	});

	it("aims a foe's counter-attack from the foe's token at the character", async () => {
		globalThis.fromUuid = async () => ({ actor: { name: "Rime Lord", system: { attributes: { damage: { value: "bite d6 (close)", rollFormula: "d6" } } } } });
		await sufferEnemyAttack(pc, { targets: [{ uuid: "Scene.s.Token.t", name: "Rime Lord" }] });
		expect(fx.playBlowFx).toHaveBeenCalledTimes(1);
		const [blow] = vi.mocked(fx.playBlowFx).mock.calls[0];
		expect(blow.attacker).toBe("Scene.s.Token.t");
		expect(blow.blow).toBe("bite");
		expect(blow.targets.map(t => t.uuid)).toEqual([pc.uuid]);
	});

	it("still posts the damage when the effects themselves break", async () => {
		const pim = hero("pim", "Pim");
		const { tokenActor } = fightInARow([["crin", crinwin("crinwin")], ["pim", pim]]);
		// Every gate open, and a Sequencer that throws the moment it is asked for anything.
		globalThis.game.modules = { get: () => ({ active: true }) };
		globalThis.game.settings = { get: (scope, key) => (key === "fightTab" || key === "attackFx" ? true : "roll") };
		globalThis.canvas.ready = true;
		globalThis.Sequence = class { constructor() { throw new Error("broken"); } };
		globalThis.Sequencer = { Database: { flattenedEntries: [] } };
		try {
			await expect(rollDamageAt(tokenActor("crin"), { formula: "d6", label: "Bite", shiftKey: true })).resolves.toBe(true);
			expect(cardWithFlag(posted, "damage")).toBeTruthy();
			await vi.waitFor(() => expect(warn).toHaveBeenCalledWith("an attack effect didn't play", expect.objectContaining({ message: "broken" })));
		} finally {
			delete globalThis.Sequencer;
			delete globalThis.game.modules;
		}
	});
});

describe("Apply is handed to the map", () => {
	it("bursts on HP lost and clanks on armor that held, after the latch", async () => {
		const pim = hero("pim", "Pim");
		const bram = hero("bram", "Bram");
		const { tokens } = fightInARow([["pim", pim], ["bram", bram]]);
		let latched = null;
		vi.mocked(fx.playHitReactions).mockImplementationOnce(() => { latched = posted.at(-1)?.content ?? ""; });
		await apply({
			move: "Bite", weapon: null, applied: [],
			results: [{ uuid: tokens.pim.uuid, name: "Pim", raw: 5 }, { uuid: tokens.bram.uuid, name: "Bram", raw: 2 }],
		});
		expect(fx.playHitReactions).toHaveBeenCalledTimes(1);
		expect(vi.mocked(fx.playHitReactions).mock.calls[0][0]).toEqual([
			{ uuid: tokens.pim.uuid, reaction: "burst" },
			{ uuid: tokens.bram.uuid, reaction: "clank" },
		]);
		// The "damage applied" card was out before the map was told.
		expect(latched).toContain("damage applied");
	});
});

describe("maybeMissFx", () => {
	const bow = { slug: "bow-arrows", name: "Bow & arrows", range: ["near"], tags: [] };
	const extra = (targets = [{ uuid: "Scene.s.Token.foe" }]) => ({ messageFlags: { [SCOPE]: { attack: { weapon: bow, targets } } } });
	const letFly = { name: "Let Fly", system: {} };
	const chat = mode => {
		globalThis.game.release = { generation: 14 };
		globalThis.game.settings = { get: (scope, key) => (scope === "core" && key === "messageMode" ? mode : undefined) };
	};

	it("draws a public Let Fly 6- going wide", () => {
		chat("public");
		const hunter = hero("hunter", "Hunter");
		expect(maybeMissFx(hunter, letFly, { total: 5 }, extra())).toBe(true);
		expect(fx.playMissFx).toHaveBeenCalledWith({ attacker: hunter, weapon: bow, moveKey: "let-fly", targets: [{ uuid: "Scene.s.Token.foe" }] });
	});

	it("leaves Clash's 6- to its counter-attack, and a hit to its card", () => {
		chat("public");
		const hunter = hero("hunter", "Hunter");
		expect(maybeMissFx(hunter, { name: "Clash", system: {} }, { total: 3 }, extra())).toBe(false);
		expect(maybeMissFx(hunter, letFly, { total: 8 }, extra())).toBe(false);
		expect(maybeMissFx(hunter, letFly, { total: 5 }, extra([]))).toBe(false);
		expect(fx.playMissFx).not.toHaveBeenCalled();
	});

	it("keeps a whispered miss off the map", () => {
		chat("gm");
		expect(maybeMissFx(hero("hunter", "Hunter"), letFly, { total: 5 }, extra())).toBe(false);
		expect(fx.playMissFx).not.toHaveBeenCalled();
	});
});
