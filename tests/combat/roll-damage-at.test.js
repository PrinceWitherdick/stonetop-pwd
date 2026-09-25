import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { SCOPE, installCombatChatFakes, uninstallCombatChatFakes, cardWithFlag, makeMessage } from "../fakes/combat-chat.js";
import { fakeActor, fakeToken, fakeScene, fakeCombatant, fakeCombat, collection } from "../fakes/fight.js";
import { attackWeapon, parseMonsterAttacks } from "../../module/utils/damage.js";

// The plain card is roll-engine's business and has its own tests; here it only matters that it is
// what a roll with nobody to hit falls back to, and what it was handed. The WINDOW in front of it is
// the real one: every case below passes `shiftKey`, which it answers without opening anything.
vi.mock("../../module/utils/roll-engine.js", async importOriginal => ({
	...(await importOriginal()),
	rollDamage: vi.fn(async () => ({ total: 0 })),
}));
const { rollDamage: plainCard } = await import("../../module/utils/roll-engine.js");
vi.mock("../../module/combat/readiness-loss.js", () => ({ settleReadinessOnAttack: vi.fn(async () => false) }));
const { settleReadinessOnAttack } = await import("../../module/combat/readiness-loss.js");
vi.mock("../../module/combat/battle-joy-offer.js", () => ({ offerBattleJoyOnDamage: vi.fn(async () => false) }));
const { offerBattleJoyOnDamage } = await import("../../module/combat/battle-joy-offer.js");
const { rollDamageAt, maybeBeginAttack, wireApplyDamage, withSeedTags, rollCharacterDamageAt, strikeBackAt, rollFollowerDamageAt, wireAttackConfirm, rollMoveDamageAt, wireConditionalArmor } = await import("../../module/combat/attack-flow.js");

// Rolls aimed by the fight: a monster's damage at the character it is fighting, a character's at the
// foe, the "Who does this hit?" question when there are several, and the plain card when nobody is there.

const I18N = globalThis.game?.i18n;
let posted;
let saved;

/** A character with HP to lose and 2 armor. */
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

/** A crinwin that bites for a d6, 1 piercing. */
const crinwin = id => ({
	...fakeActor({ id, name: "Crinwin", type: "monster" }),
	system: { attributes: { damage: { value: "bite d6 (close, 1 piercing)", rollFormula: "d6" }, armor: { value: 1 }, hp: { value: 3, max: 3 } } },
});

/**
 * Tokens on one row of the canvas scene, all in one fight. `row` lists [key, actor] left to right, one
 * square apart, so neighbours are in melee.
 */
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
	/** The token's own actor, as a click on an unlinked monster token hands it over. */
	const tokenActor = key => ({ ...tokens[key].actor, token: tokens[key] });
	return { tokens, combat, tokenActor };
}

beforeEach(() => {
	posted = installCombatChatFakes();
	globalThis.game.i18n = I18N;
	saved = { canvas: globalThis.canvas, fromUuidSync: globalThis.fromUuidSync, document: globalThis.document, applications: globalThis.foundry?.applications };
	globalThis.CONST = { ...globalThis.CONST, GRID_TYPES: { GRIDLESS: 0, SQUARE: 1 } };
	globalThis.ui.notifications.info = vi.fn();
	vi.mocked(plainCard).mockClear();
});
afterEach(() => {
	uninstallCombatChatFakes();
	globalThis.canvas = saved.canvas;
	globalThis.fromUuidSync = saved.fromUuidSync;
	globalThis.document = saved.document;
	if (globalThis.foundry) globalThis.foundry.applications = saved.applications;
});

const damageFlag = () => cardWithFlag(posted, "damage")?.flags[SCOPE].damage;

/** Answer "Who does this hit?" by pressing a button: the confirm with `ticks` ticked, or cancel (null). */
function answerWhoItHits(ticks) {
	globalThis.document = { createElement: () => ({ innerHTML: "" }) };
	const wait = vi.fn(async config => {
		if (ticks === null) return config.buttons[1].callback();
		const inputs = ticks.map((checked, i) => ({ value: String(i), checked }));
		return config.buttons[0].callback(null, { form: { querySelectorAll: () => inputs.filter(i => i.checked) } });
	});
	globalThis.foundry.applications = { api: { DialogV2: { wait } } };
	return wait;
}

/** Press Apply on a damage card, as the GM. */
async function apply(flag) {
	const listeners = [];
	const button = { disabled: false, title: "", innerHTML: "", style: {}, addEventListener: (type, fn) => listeners.push(fn) };
	const message = makeMessage({ damage: flag });
	message.canUserModify = () => true;
	wireApplyDamage(message, { querySelector: sel => (sel === ".stonetop-apply-damage" ? button : null) });
	await listeners[0]();
}

describe("Apply damage and the fight's rules", () => {
	/** A horde of twelve crinwin fighting as one token, one crinwin's 3 HP for its pool. */
	const horde = () => ({
		...fakeActor({ id: "horde", name: "Crinwin horde", type: "monster" }),
		flags: {},
		system: { organization: "horde", fightAsGroup: true, count: 12, attributes: { armor: { value: 1 }, hp: { value: 3, max: 3 } } },
		update: vi.fn(async function (changes) {
			if ("system.count" in changes) this.system.count = changes["system.count"];
			if ("system.attributes.hp.value" in changes) this.system.attributes.hp.value = changes["system.attributes.hp.value"];
		}),
	});

	it("drops one member of a horde token for a lone character's blow, and leaves its pool alone (p.416)", async () => {
		const bram = hero("bram", "Bram");
		const crowd = horde();
		const { tokens } = fightInARow([["bram", bram], ["horde", crowd]]);
		await apply({ move: "Clash", attackerUuid: bram.uuid, weapon: null, results: [{ uuid: tokens.horde.uuid, name: "Crinwin horde", raw: 5 }], applied: [] });
		expect(crowd.system.count).toBe(11);
		expect(crowd.system.attributes.hp.value).toBe(3);
		expect(posted.at(-1).content).toContain("one of them goes down, 11 still standing");
	});

	it("applies a blow once however fast Apply is pressed twice", async () => {
		const pim = hero("pim", "Pim");
		const { tokens } = fightInARow([["pim", pim]]);
		const listeners = [];
		const button = { disabled: false, title: "", innerHTML: "", style: {}, addEventListener: (type, fn) => listeners.push(fn) };
		const message = makeMessage({ damage: { move: "Bite", weapon: null, results: [{ uuid: tokens.pim.uuid, name: "Pim", raw: 5 }], applied: [] } });
		message.canUserModify = () => true;
		wireApplyDamage(message, { querySelector: sel => (sel === ".stonetop-apply-damage" ? button : null) });
		await Promise.all([listeners[0](), listeners[0]()]);
		// 5 less Pim's 2 armor, taken once.
		expect(pim.system.attributes.hp.value).toBe(7);
		expect(button.disabled).toBe(true);
	});

	it("halves a blow before armor when Readiness was spent on it (p.216)", async () => {
		const pim = hero("pim", "Pim");
		const { tokens } = fightInARow([["pim", pim]]);
		await apply({ move: "Bite", weapon: null, results: [{ uuid: tokens.pim.uuid, name: "Pim", raw: 9 }], applied: [], halvedBy: [{ uuid: tokens.pim.uuid, name: "Pim", how: "halve" }] });
		// 9 halved, rounded up, to 5; less Pim's 2 armor.
		expect(pim.system.attributes.hp.value).toBe(7);
	});

	it("halves a blow for I Get Knocked Down, and halves it again when Readiness was spent too", async () => {
		const pim = hero("pim", "Pim");
		const { tokens } = fightInARow([["pim", pim]]);
		const row = { uuid: tokens.pim.uuid, name: "Pim", raw: 9 };
		const knocked = [{ uuid: tokens.pim.uuid, name: "Pim", how: "knockedDown" }];
		await apply({ move: "Bite", weapon: null, results: [row], applied: [], knockedDownBy: knocked });
		// 9 knocked down to 5, less Pim's 2 armor.
		expect(pim.system.attributes.hp.value).toBe(7);

		const pim2 = hero("pim2", "Pim");
		const second = fightInARow([["pim2", pim2]]);
		const row2 = { uuid: second.tokens.pim2.uuid, name: "Pim", raw: 9 };
		await apply({
			move: "Bite", weapon: null, results: [row2], applied: [],
			halvedBy: [{ uuid: row2.uuid, name: "Pim", how: "halve" }],
			knockedDownBy: [{ uuid: row2.uuid, name: "Pim", how: "knockedDown" }],
		});
		// Two different moves, each paid for: 9 to 5 to 3, less 2 armor.
		expect(pim2.system.attributes.hp.value).toBe(9);
	});

	it("leaves the armor a move's fiction granted out of a blow when its box is unticked", async () => {
		// Aerin's 2 armor is Barkskin's, so Apply takes it off when the table says she was not on the earth.
		const aerin = hero("aerin", "Aerin");
		aerin.system.attributes.armor = { value: 2, unpierceable: 0, conditional: 2, conditionalSource: "Barkskin" };
		const { tokens } = fightInARow([["aerin", aerin]]);
		const row = { uuid: tokens.aerin.uuid, name: "Aerin", raw: 6 };
		await apply({ move: "Bite", weapon: null, results: [row], applied: [], armorOff: [row.uuid] });
		expect(aerin.system.attributes.hp.value).toBe(4);
		expect(posted.at(-1).content).toContain("without Barkskin");
	});

	it("keeps it when the box is left ticked, which is how it opens", async () => {
		const aerin = hero("aerin", "Aerin");
		aerin.system.attributes.armor = { value: 2, unpierceable: 0, conditional: 2, conditionalSource: "Barkskin" };
		const { tokens } = fightInARow([["aerin", aerin]]);
		await apply({ move: "Bite", weapon: null, results: [{ uuid: tokens.aerin.uuid, name: "Aerin", raw: 6 }], applied: [] });
		expect(aerin.system.attributes.hp.value).toBe(6);
	});

	it("draws that box ticked on the card, and writes the card when it is unticked", async () => {
		const aerin = hero("aerin", "Aerin");
		aerin.system.attributes.armor = { value: 2, unpierceable: 0, conditional: 2, conditionalSource: "Barkskin" };
		const { tokens } = fightInARow([["aerin", aerin]]);
		// A DOM small enough to wire into: the actions block a card's buttons live in.
		const made = [];
		const element = tag => { const el = { tagName: tag, className: "", type: "", checked: false, disabled: false, title: "", textContent: "", kids: [], append(...k) { this.kids.push(...k); }, addEventListener(_t, fn) { this.fire = fn; } }; made.push(el); return el; };
		globalThis.document = { createElement: element };
		const actions = element("div");
		const root = { querySelector: sel => (sel === ".stonetop-attack-actions" ? actions : null) };
		const message = makeMessage({ damage: { move: "Bite", results: [{ uuid: tokens.aerin.uuid, name: "Aerin", raw: 6 }], applied: [] } });
		message.canUserModify = () => true;

		wireConditionalArmor(message, root);
		const label = actions.kids[0];
		const box = label.kids[0];
		expect(box.checked).toBe(true);
		expect(label.kids[1].textContent).toContain("Barkskin");
		expect(label.kids[1].textContent).toContain("touching the earth");

		box.checked = false;
		await box.fire();
		expect(message.getFlag(SCOPE, "damage").armorOff).toEqual([tokens.aerin.uuid]);
	});

	// ⚠ THE BOX BELONGS TO WHOEVER THE ARITHMETIC IS ABOUT. A Defend that puts someone in the ward's
	// place moves the whole armor calculation onto the STAND-IN (applyOwedDamage), so a box drawn from
	// the ward asked about skin the subtraction never touched: unticking it did nothing at all, and a
	// stand-in who really was Barkskin'd was offered no box to untick.
	it("draws the box for the defender standing in, not the ward whose row it is", async () => {
		const pim = hero("pim", "Pim");
		const aerin = hero("aerin", "Aerin");
		aerin.system.attributes.armor = { value: 2, unpierceable: 0, conditional: 2, conditionalSource: "Barkskin" };
		const { tokens } = fightInARow([["pim", pim], ["aerin", aerin]]);
		// A stand-in is named by ACTOR uuid, which the row-token map fightInARow installs does not hold.
		const byToken = globalThis.fromUuidSync;
		globalThis.fromUuidSync = uuid => (uuid === aerin.uuid ? aerin : byToken(uuid));
		const made = [];
		const element = tag => { const el = { tagName: tag, className: "", type: "", checked: false, disabled: false, title: "", textContent: "", kids: [], append(...k) { this.kids.push(...k); }, addEventListener(_t, fn) { this.fire = fn; } }; made.push(el); return el; };
		globalThis.document = { createElement: element };
		const actions = element("div");
		const root = { querySelector: sel => (sel === ".stonetop-attack-actions" ? actions : null) };
		const message = makeMessage({ damage: {
			move: "Bite",
			results: [{ uuid: tokens.pim.uuid, name: "Pim", raw: 6 }],
			applied: [],
			standIns: [{ uuid: tokens.pim.uuid, by: aerin.uuid, name: "Aerin" }],
		} });
		message.canUserModify = () => true;

		wireConditionalArmor(message, root);

		const label = actions.kids[0];
		expect(label).toBeTruthy();
		expect(label.kids[0].checked).toBe(true);
		// And it says whose skin it is asking about, on a card with one row as on a card with several.
		expect(label.kids[1].textContent).toContain("Aerin");
		expect(label.kids[1].textContent).toContain("Barkskin");
	});

	it("draws no box when the ward has the gated armor but the defender standing in does not", async () => {
		const aerin = hero("aerin", "Aerin");
		aerin.system.attributes.armor = { value: 2, unpierceable: 0, conditional: 2, conditionalSource: "Barkskin" };
		const pim = hero("pim", "Pim");
		const { tokens } = fightInARow([["aerin", aerin], ["pim", pim]]);
		const byToken = globalThis.fromUuidSync;
		globalThis.fromUuidSync = uuid => (uuid === pim.uuid ? pim : byToken(uuid));
		const actions = { kids: [], append(...k) { this.kids.push(...k); } };
		const root = { querySelector: sel => (sel === ".stonetop-attack-actions" ? actions : null) };
		const message = makeMessage({ damage: {
			move: "Bite",
			results: [{ uuid: tokens.aerin.uuid, name: "Aerin", raw: 6 }],
			applied: [],
			standIns: [{ uuid: tokens.aerin.uuid, by: pim.uuid, name: "Pim" }],
		} });
		message.canUserModify = () => true;

		wireConditionalArmor(message, root);

		expect(actions.kids).toEqual([]);
	});

	it("draws no such box for a character whose armor is all their own gear", async () => {
		const pim = hero("pim", "Pim");
		const { tokens } = fightInARow([["pim", pim]]);
		const actions = { kids: [], append(...k) { this.kids.push(...k); } };
		const root = { querySelector: sel => (sel === ".stonetop-attack-actions" ? actions : null) };
		const message = makeMessage({ damage: { move: "Bite", results: [{ uuid: tokens.pim.uuid, name: "Pim", raw: 6 }], applied: [] } });
		message.canUserModify = () => true;
		wireConditionalArmor(message, root);
		expect(actions.kids).toEqual([]);
	});

	/** A follower's NPC: HP to lose, and whatever armor its card gave it. */
	const followerNpc = (id, name, armor) => ({
		...hero(id, name), type: "npc",
		system: { attributes: { armor, hp: { value: 8, max: 8 }, damage: { value: "d6" } } },
	});
	/** Wire a card's armor boxes into a DOM small enough to read back. */
	function armorBoxes(results) {
		const element = tag => ({ tagName: tag, className: "", type: "", checked: false, disabled: false, title: "", textContent: "", kids: [], append(...k) { this.kids.push(...k); }, addEventListener(_t, fn) { this.fire = fn; } });
		globalThis.document = { createElement: element };
		const actions = element("div");
		const message = makeMessage({ damage: { move: "Bite", results, applied: [] } });
		message.canUserModify = () => true;
		wireConditionalArmor(message, { querySelector: sel => (sel === ".stonetop-attack-actions" ? actions : null) });
		return { actions, message };
	}

	// Afon's "Armor 2 (0 vs. iron)" (Book I p.145): his armor applies, and the card asks about iron.
	it("asks about a follower's printed armor clause with a ticked box, and takes the armor off when unticked", async () => {
		const afon = followerNpc("afon", "Afon", { value: 2, conditional: 2, conditionalSource: "vs. iron" });
		const { tokens } = fightInARow([["afon", afon]]);
		const row = { uuid: tokens.afon.uuid, name: "Afon", raw: 5 };
		const { actions, message } = armorBoxes([row]);
		const label = actions.kids[0];
		expect(label.kids[0].checked).toBe(true);
		expect(label.kids[1].textContent).toContain("Not iron");
		label.kids[0].checked = false;
		await label.kids[0].fire();
		expect(message.getFlag(SCOPE, "damage").armorOff).toEqual([row.uuid]);

		// Ticked: his 2 armor takes 2 off the 5. Unticked, iron goes straight through.
		await apply({ move: "Bite", weapon: null, results: [row], applied: [] });
		expect(afon.system.attributes.hp.value).toBe(5);
		afon.system.attributes.hp.value = 8;
		await apply({ move: "Bite", weapon: null, results: [row], applied: [], armorOff: [row.uuid] });
		expect(afon.system.attributes.hp.value).toBe(3);
		expect(posted.at(-1).content).toContain("iron goes through 2 armor");
	});

	// Barkskin: "When you mark another with 1 Stock, they gain this benefit." A follower's NPC keeps only
	// its card's numbers, so the mark is read when the blow lands.
	it("gives a follower wearing a Blessed's Barkskin a 2-armor base, with the earth box", async () => {
		const enfys = followerNpc("enfys", "Enfys", { value: 0 });
		const { tokens } = fightInARow([["enfys", enfys]]);
		const aerin = {
			id: "aerin", name: "Aerin", type: "character", uuid: "Actor.aerin",
			items: [{ type: "move", name: "Barkskin" }],
			getFlag: (scope, key) => (key === "blessedMarks" ? [{ kind: "barkskin", name: "Enfys" }] : undefined),
		};
		globalThis.game.actors = collection([aerin, enfys]);
		const row = { uuid: tokens.enfys.uuid, name: "Enfys", raw: 5 };
		const { actions } = armorBoxes([row]);
		expect(actions.kids[0].kids[1].textContent).toContain("Barkskin");
		expect(actions.kids[0].kids[1].textContent).toContain("touching the earth");

		await apply({ move: "Bite", weapon: null, results: [row], applied: [] });
		expect(enfys.system.attributes.hp.value).toBe(5);
		enfys.system.attributes.hp.value = 8;
		await apply({ move: "Bite", weapon: null, results: [row], applied: [], armorOff: [row.uuid] });
		expect(enfys.system.attributes.hp.value).toBe(3);

		// No mark, no bark.
		globalThis.game.actors = collection([enfys]);
		enfys.system.attributes.hp.value = 8;
		await apply({ move: "Bite", weapon: null, results: [row], applied: [] });
		expect(enfys.system.attributes.hp.value).toBe(3);
	});

	it("hands a blow to the defender who took it for their ward, against the defender's armor", async () => {
		const pim = hero("pim", "Pim");
		const aeliana = hero("aeliana", "Aeliana");
		const { tokens } = fightInARow([["pim", pim], ["aeliana", aeliana]]);
		const byToken = globalThis.fromUuid;
		globalThis.fromUuid = async uuid => (uuid === aeliana.uuid ? aeliana : byToken(uuid));
		await apply({ move: "Bite", weapon: null, results: [{ uuid: tokens.pim.uuid, name: "Pim", raw: 6 }], applied: [], standIns: [{ uuid: tokens.pim.uuid, by: aeliana.uuid, name: "Aeliana" }] });
		expect(pim.system.attributes.hp.value).toBe(10);
		expect(aeliana.system.attributes.hp.value).toBe(6);
		expect(posted.at(-1).content).toContain("Aeliana (for Pim)");
	});

	it("lets the defender's player press Apply for the blow they took, not the ward's", async () => {
		const owners = { pim: "u-pim", aeliana: "u-ael" };
		const player = (id, key) => Object.assign(hero(key, key), { testUserPermission: user => user.id === owners[key] });
		const pim = player("u-pim", "pim");
		const aeliana = player("u-ael", "aeliana");
		const { tokens } = fightInARow([["pim", pim], ["aeliana", aeliana]]);
		globalThis.fromUuidSync = uuid => (uuid === aeliana.uuid ? aeliana : uuid === tokens.pim.uuid ? tokens.pim : null);
		globalThis.game.users = {
			...globalThis.game.users,
			players: [{ id: "u-pim", active: true }, { id: "u-ael", active: true }],
			get: id => ({ id, name: id === "u-ael" ? "Aeliana's player" : "Pim's player" }),
		};
		const flag = { move: "Bite", weapon: null, results: [{ uuid: tokens.pim.uuid, name: "Pim", raw: 6 }], applied: [], standIns: [{ uuid: tokens.pim.uuid, by: aeliana.uuid, name: "Aeliana" }] };
		const button = { disabled: false, title: "", innerHTML: "", style: {}, addEventListener: () => {} };
		const message = makeMessage({ damage: flag });
		message.canUserModify = () => true;
		wireApplyDamage(message, { querySelector: sel => (sel === ".stonetop-apply-damage" ? button : null) });
		// The GM's copy stands down for the player whose character takes the blow.
		expect(button.disabled).toBe(true);
		expect(button.title).toBe("Aeliana's player will take this damage");
	});

	it("lets a blow pass for A Mighty Rampart", async () => {
		const pim = hero("pim", "Pim");
		const { tokens } = fightInARow([["pim", pim]]);
		await apply({ move: "Bite", weapon: null, results: [{ uuid: tokens.pim.uuid, name: "Pim", raw: 9 }], applied: [], ignoredBy: [{ uuid: tokens.pim.uuid, name: "Pim", how: "ignore" }] });
		expect(pim.system.attributes.hp.value).toBe(10);
		expect(posted.at(-1).content).toContain("ignored it (A Mighty Rampart)");
	});

	it("gives an Undaunted hero +1 armor while they are outnumbered", async () => {
		const pim = Object.assign(hero("pim", "Pim"), { items: [{ type: "move", name: "Undaunted" }] });
		const { tokens } = fightInARow([["crin", crinwin("crinwin")], ["pim", pim], ["crin2", crinwin("crinwin2")]]);
		await apply({ move: "Bite", weapon: null, results: [{ uuid: tokens.pim.uuid, name: "Pim", raw: 9 }], applied: [] });
		// 9 less 2 armor and Undaunted's 1.
		expect(pim.system.attributes.hp.value).toBe(4);
		expect(posted.at(-1).content).toContain("+1 armor, Undaunted");
	});

	it("rolls a foe's damage at disadvantage against a hero who locked eyes with it (Big Damn Hero)", async () => {
		const pim = hero("pim", "Pim");
		const { tokenActor, combat } = fightInARow([["crin", crinwin("crinwin")], ["pim", pim]]);
		combat.combatants.get("cpim").flags["stonetop-pwd"].lockedEyes = ["ccrin"];
		await rollDamageAt(tokenActor("crin"), { formula: "d6", label: "Bite", shiftKey: true });
		expect(damageFlag().results[0].formula).toBe("2d6kl1");
	});

	it("rolls straight when the foe's blow already had advantage: locked eyes cancels it (p.230)", async () => {
		const pim = hero("pim", "Pim");
		const { tokenActor, combat } = fightInARow([["crin", crinwin("crinwin")], ["pim", pim]]);
		combat.combatants.get("cpim").flags["stonetop-pwd"].lockedEyes = ["ccrin"];
		await rollDamageAt(tokenActor("crin"), { formula: "d6", label: "Bite", rollMode: "adv", shiftKey: true });
		expect(damageFlag().results[0].formula).toBe("d6");
	});

	it("adds the other attackers' tags and piercing to the blow while the +N is on", () => {
		const weapon = { name: "Sword", range: ["close"], piercing: 0, tags: ["close"] };
		expect(withSeedTags(weapon, { bonus: 1, applied: true, tags: ["forceful"], piercing: 1 }))
			.toEqual({ name: "Sword", range: ["close"], piercing: 1, tags: ["close", "forceful"] });
		expect(withSeedTags(weapon, { bonus: 1, applied: false, tags: ["forceful"], piercing: 1 })).toBe(weapon);
		expect(withSeedTags(weapon, { bonus: 1, applied: true, tags: [], piercing: 0 })).toBe(weapon);
	});
});

describe("a character's own damage, with the weapon in hand", () => {
	/** Pim carrying one catalog weapon, so nothing needs asking. */
	const armed = slug => Object.assign(hero("pim", "Pim"), {
		typedActor: {
			carriedWeaponGear: async () => [{ slug, weaponSlug: slug, catalog: true }],
			computedDamageDie: async () => "d8",
		},
	});

	it("rolls a sword's +1 at the foe in contact (the sheet's Damage cell and the ring's Damage)", async () => {
		const pim = armed("sword");
		const { tokens } = fightInARow([["pim", pim], ["crin", crinwin("crinwin")]]);
		expect(await rollCharacterDamageAt(pim, { label: "Damage", shiftKey: true })).toBe(true);
		const flag = damageFlag();
		expect(flag.move).toBe("Damage: Sword");
		expect(flag.results).toEqual([expect.objectContaining({ uuid: tokens.crin.uuid, formula: "d8+1" })]);
	});

	it("asks whether they went on the offense once the blow is rolled, but not for a strike back (p.216)", async () => {
		const pim = armed("sword");
		fightInARow([["pim", pim], ["crin", crinwin("crinwin")]]);
		vi.mocked(settleReadinessOnAttack).mockClear();
		await rollCharacterDamageAt(pim, { label: "Strike back", seeded: false, shiftKey: true });
		expect(settleReadinessOnAttack).not.toHaveBeenCalled();
		await rollCharacterDamageAt(pim, { label: "Damage", shiftKey: true });
		expect(settleReadinessOnAttack).toHaveBeenCalledWith(pim, "Damage");
	});

	it("offers the Battle Joy on the character's own blow, and never on a follower's or the enemy's", async () => {
		const pim = armed("sword");
		fightInARow([["pim", pim], ["crin", crinwin("crinwin")]]);
		vi.mocked(offerBattleJoyOnDamage).mockClear();
		await rollCharacterDamageAt(pim, { label: "Damage", shiftKey: true });
		expect(offerBattleJoyOnDamage).toHaveBeenCalledTimes(1);
		expect(offerBattleJoyOnDamage).toHaveBeenCalledWith(pim, "Damage: Sword", [expect.any(Number)]);

		vi.mocked(offerBattleJoyOnDamage).mockClear();
		await rollFollowerDamageAt(pim, { formula: "d6", label: "Pim's crew attacks", attacker: "Pim's crew", shiftKey: true });
		expect(offerBattleJoyOnDamage).not.toHaveBeenCalled();
	});

	it("offers the Battle Joy on the plain card too, when nobody is there to hit", async () => {
		const pim = armed("sword");
		vi.mocked(offerBattleJoyOnDamage).mockClear();
		vi.mocked(plainCard).mockResolvedValueOnce({ total: 4 });
		await rollDamageAt(pim, { formula: "d8", label: "Damage", shiftKey: true });
		expect(offerBattleJoyOnDamage).toHaveBeenCalledWith(pim, "Damage", [4]);
	});

	it("carries a warhammer's 2 piercing to Apply", async () => {
		const pim = armed("warhammer");
		fightInARow([["pim", pim], ["crin", crinwin("crinwin")]]);
		await rollCharacterDamageAt(pim, { label: "Damage", shiftKey: true });
		expect(damageFlag().weapon).toMatchObject({ name: "Warhammer", piercing: 2 });
	});

	it("rolls naphtha's own d8, ignoring armor", async () => {
		const pim = armed("naphtha");
		fightInARow([["pim", pim], ["crin", crinwin("crinwin")]]);
		await rollCharacterDamageAt(pim, { label: "Damage", shiftKey: true });
		expect(damageFlag().results[0].formula).toBe("d8");
		expect(damageFlag().weapon).toMatchObject({ ignoresArmor: true });
	});

	it("prints the weapon's fiction on the plain card when there is nobody to hit, as Clash does", async () => {
		const pim = armed("battleaxe");
		globalThis.game.combats = collection([]);
		expect(await rollCharacterDamageAt(pim, { label: "Damage", shiftKey: true })).toBe(true);
		const [formula, , options] = vi.mocked(plainCard).mock.calls[0];
		expect(formula).toBe("d8");
		expect(options.label).toBe("Damage: Battleaxe");
		expect(options.notices).toContain("Messy.");
	});

	it("strikes nothing back with no damage die, though the parry is still paid for", async () => {
		const pim = Object.assign(hero("pim", "Pim"), { typedActor: { carriedWeaponGear: async () => [], computedDamageDie: async () => "" } });
		pim.system.attributes.damage.value = "";
		const commit = vi.fn(async () => true);
		expect(await strikeBackAt(pim, "", "Parry", { commit })).toBe(false);
		expect(commit).toHaveBeenCalledTimes(1);
		expect(posted).toEqual([]);
	});

	it("takes the parry's price before a ticked line pays for itself", async () => {
		// Pim owes the crinwin a grudge (But I Get Up Again), which the damage window would spend on
		// this blow — but the Readiness the parry costs cannot be paid, so there is no blow to spend it on.
		const pim = Object.assign(armed("sword"), {
			items: [{ type: "move", name: "But I Get Up Again" }],
			getFlag: (scope, key) => (key === "knockedDownBy" ? { key: "Scene.scene1.Token.tcrin", name: "Crinwin" } : {}),
			setFlag: vi.fn(async () => true),
		});
		const { tokens } = fightInARow([["pim", pim], ["crin", crinwin("crinwin")]]);
		globalThis.fromUuid = async uuid => (uuid === tokens.crin.uuid ? tokens.crin : null);
		globalThis.game.settings = { get: (scope, key) => (key === "promptDamageModifier" ? false : key === "fightTab") };
		expect(await strikeBackAt(pim, tokens.crin.uuid, "Parry", { commit: async () => false })).toBe(false);
		expect(pim.setFlag).not.toHaveBeenCalled();
		expect(posted).toEqual([]);
		// ...and the same blow with the price paid does spend it, which is what makes the above a saving.
		expect(await strikeBackAt(pim, tokens.crin.uuid, "Parry", { commit: async () => true })).toBe(true);
		expect(pim.setFlag).toHaveBeenCalledWith("stonetop-pwd", "knockedDownBy", null);
	});

	it("strikes back from a parry with the weapon too (p.216 \"deal your damage\")", async () => {
		const pim = armed("sword");
		const { tokens } = fightInARow([["pim", pim], ["crin", crinwin("crinwin")]]);
		globalThis.fromUuid = async uuid => (uuid === tokens.crin.uuid ? tokens.crin : null);
		globalThis.game.settings = { get: (scope, key) => (key === "promptDamageModifier" ? false : key === "fightTab") };
		expect(await strikeBackAt(pim, tokens.crin.uuid, "Parry")).toBe(true);
		const flag = damageFlag();
		expect(flag.move).toBe("Parry: Sword");
		expect(flag.results[0].formula).toContain("+1");
		expect(flag.results[0].formula).toContain("d8");
	});
});

describe("Dangerous (the Heavy): \"When you deal your damage, you have advantage\"", () => {
	/** Bram, a Heavy with Dangerous, carrying a sword. */
	const heavy = () => Object.assign(hero("bram", "Bram"), {
		items: [{ type: "move", name: "Dangerous" }],
		typedActor: { carriedWeaponGear: async () => [{ slug: "sword", weaponSlug: "sword", catalog: true }], computedDamageDie: async () => "d8" },
	});

	it("rolls the Heavy's own damage with advantage (the sheet's Damage cell and the ring's Damage)", async () => {
		const bram = heavy();
		fightInARow([["bram", bram], ["crin", crinwin("crinwin")]]);
		await rollCharacterDamageAt(bram, { label: "Damage", shiftKey: true });
		expect(damageFlag().results[0].formula).toMatch(/^2d8kh/);
	});

	it("rolls a strike back straight: its disadvantage and Dangerous cancel", async () => {
		const bram = heavy();
		fightInARow([["bram", bram], ["crin", crinwin("crinwin")]]);
		await rollCharacterDamageAt(bram, { label: "Strike back", rollMode: "dis", seeded: false, shiftKey: true });
		expect(damageFlag().results[0].formula).toBe("d8+1");
	});

	it("gives nothing to a follower striking from the Heavy's sheet", async () => {
		const bram = heavy();
		fightInARow([["bram", bram], ["crin", crinwin("crinwin")]]);
		await rollFollowerDamageAt(bram, { formula: "d6", label: "Bram's crew attacks", attacker: "Bram's crew", shiftKey: true });
		expect(damageFlag().results[0].formula).toBe("d6");
	});

	it("carries advantage to the plain card when there is nobody to hit", async () => {
		const bram = heavy();
		globalThis.game.combats = collection([]);
		await rollCharacterDamageAt(bram, { label: "Damage", shiftKey: true });
		expect(vi.mocked(plainCard).mock.calls[0][2].rollMode).toBe("adv");
	});
});

describe("a character's own moves on the blow they deal", () => {
	/** Bram with a sword and whichever moves the case is about. */
	const heavy = (...moves) => Object.assign(hero("bram", "Bram"), {
		items: moves.map(name => ({ type: "move", name })),
		typedActor: { carriedWeaponGear: async () => [{ slug: "sword", weaponSlug: "sword", catalog: true }], computedDamageDie: async () => "d8" },
	});

	it("makes a Musclebound Heavy's melee blow forceful and messy on the card", async () => {
		const bram = heavy("Musclebound");
		fightInARow([["bram", bram], ["crin", crinwin("crinwin")]]);
		await rollCharacterDamageAt(bram, { label: "Damage", shiftKey: true });
		// Tags ride the card as the fiction they owe the table (tagNoticesHtml); the flag keeps only armor.
		const card = cardWithFlag(posted, "damage");
		expect(card.content).toContain("Forceful.");
		expect(card.content).toContain("Messy.");
	});

	it("leaves a bow alone: Musclebound is hand-to-hand or thrown", async () => {
		const bram = Object.assign(heavy("Musclebound"), {
			typedActor: { carriedWeaponGear: async () => [{ slug: "bow-arrows", weaponSlug: "bow-arrows", catalog: true }], computedDamageDie: async () => "d8" },
		});
		fightInARow([["bram", bram], ["crin", crinwin("crinwin")]]);
		await rollCharacterDamageAt(bram, { label: "Damage", shiftKey: true });
		expect(cardWithFlag(posted, "damage").content).not.toContain("Forceful.");
	});

	it("makes a bare-handed Musclebound blow forceful and messy, with a foe targeted as without one", async () => {
		const fists = () => Object.assign(heavy("Musclebound"), {
			typedActor: { carriedWeaponGear: async () => [], computedDamageDie: async () => "d8" },
		});
		const bram = fists();
		fightInARow([["bram", bram], ["crin", crinwin("crinwin")]]);
		await rollCharacterDamageAt(bram, { label: "Damage", shiftKey: true });
		expect(cardWithFlag(posted, "damage").content).toContain("Forceful.");

		// Nothing in hand is a hand blow either way: the record the card carries must not unmake it.
		globalThis.game.combats = collection([]);
		await rollCharacterDamageAt(fists(), { label: "Damage", shiftKey: true });
		expect(vi.mocked(plainCard).mock.calls.at(-1)[2].notices).toContain("Forceful.");
	});

	it("leaves a follower's blow from the same sheet untouched by the character's moves", async () => {
		const bram = heavy("Musclebound", "Dangerous");
		fightInARow([["bram", bram], ["crin", crinwin("crinwin")]]);
		await rollFollowerDamageAt(bram, { formula: "d6", label: "Bram's crew attacks", attacker: "Bram's crew", shiftKey: true });
		const flag = damageFlag();
		expect(flag.results[0].formula).toBe("d6");
		expect(flag.weapon?.tags ?? []).not.toContain("forceful");
	});

	it("offers Uncanny Reflexes as a ticked line rather than imposing it, and rolls it when nothing is unticked", async () => {
		const bram = hero("bram", "Bram");
		bram.items = [{ type: "move", name: "Uncanny Reflexes" }];
		bram.typedActor = { buildSnapshot: async () => ({ vitals: { wornArmor: 0 }, inventory: { outfit: { load: { selected: "light" } } } }) };
		const { tokenActor } = fightInARow([["crin", crinwin("crinwin")], ["bram", bram]]);
		// Shift skips the window, and a ticked line still applies — which is what "defaults to checked" means.
		await rollDamageAt(tokenActor("crin"), { formula: "d6", label: "Bite", shiftKey: true });
		expect(damageFlag().results[0].formula).toBe("2d6kl1");
		expect(cardWithFlag(posted, "damage").content).toContain("Uncanny Reflexes");
	});

	it("puts the line in front of whoever rolls, worded for the character it belongs to", async () => {
		const bram = hero("bram", "Bram");
		bram.items = [{ type: "move", name: "Uncanny Reflexes" }];
		bram.typedActor = { buildSnapshot: async () => ({ vitals: { wornArmor: 0 }, inventory: { outfit: { load: { selected: "light" } } } }) };
		const { tokenActor } = fightInARow([["crin", crinwin("crinwin")], ["bram", bram]]);
		globalThis.game.settings = { get: (scope, key) => (key === "fightTab" ? true : key === "promptDamageModifier" ? true : "roll") };
		let offered = [];
		globalThis.Dialog = class {
			constructor(config) { this.config = config; offered = config.content; }
			render() { Promise.resolve().then(() => this.config.buttons.roll?.callback?.({ querySelector: () => null, querySelectorAll: () => [] })); }
		};
		await rollDamageAt(tokenActor("crin"), { formula: "d6", label: "Bite" });
		expect(offered).toContain("offer-uncanny");
		expect(offered).toContain("Bram&#x27;s Uncanny Reflexes");
	});

	it("rolls a monster's blow at disadvantage against a hero at 5 HP with Never Gonna Keep Me Down", async () => {
		const pim = hero("pim", "Pim");
		pim.items = [{ type: "move", name: "Never Gonna Keep Me Down" }];
		pim.system.attributes.hp.value = 5;
		const { tokenActor } = fightInARow([["crin", crinwin("crinwin")], ["pim", pim]]);
		await rollDamageAt(tokenActor("crin"), { formula: "d6", label: "Bite", shiftKey: true });
		expect(damageFlag().results[0].formula).toBe("2d6kl1");
	});

	it("leaves that blow straight once the hero is above 5 HP", async () => {
		const pim = hero("pim", "Pim");
		pim.items = [{ type: "move", name: "Never Gonna Keep Me Down" }];
		const { tokenActor } = fightInARow([["crin", crinwin("crinwin")], ["pim", pim]]);
		await rollDamageAt(tokenActor("crin"), { formula: "d6", label: "Bite", shiftKey: true });
		expect(damageFlag().results[0].formula).toBe("d6");
	});
});

describe("a stat block's damage, aimed by the fight", () => {
	it("lands on the character the monster is fighting, and Apply takes their armor off less its piercing", async () => {
		const pim = hero("pim", "Pim");
		const { tokens, tokenActor } = fightInARow([["crin", crinwin("crinwin")], ["pim", pim]]);
		const bite = parseMonsterAttacks("bite d6 (close, 1 piercing)")[0];

		expect(await rollDamageAt(tokenActor("crin"), {
			formula: "d6", label: "Bite", keywords: "close, 1 piercing", rollMode: "normal", weapon: attackWeapon(bite), shiftKey: true,
		})).toBe(true);

		const flag = damageFlag();
		expect(flag).toMatchObject({ move: "Bite", weapon: { name: "", piercing: 1, ignoresArmor: false } });
		expect(flag.results).toEqual([expect.objectContaining({ uuid: tokens.pim.uuid, name: "Pim", raw: 9, formula: "d6" })]);
		const content = cardWithFlag(posted, "damage").content;
		expect(content).toContain("Bite: damage");
		expect(content).toContain("piercing");
		expect(content).toContain("Apply damage");
		expect(plainCard).not.toHaveBeenCalled();

		await apply(flag);
		// 9, less Pim's 2 armor pierced by 1.
		expect(pim.system.attributes.hp.value).toBe(2);
	});

	it("carries the +1 when another foe is on the same character", async () => {
		const pim = hero("pim", "Pim");
		const { tokenActor } = fightInARow([["crin", crinwin("crinwin")], ["pim", pim], ["crin2", crinwin("crinwin2")]]);
		await rollDamageAt(tokenActor("crin"), { formula: "d6", label: "Bite", shiftKey: true });
		expect(damageFlag()).toMatchObject({ seed: { bonus: 1, direction: "onHero", target: "Pim" } });
		expect(damageFlag().results[0].formula).toBe("d6+1");
	});

	it("says another foe's piercing counts only while the +1 does, and keeps the blow's own for Apply", async () => {
		const pim = hero("pim", "Pim");
		const { tokenActor } = fightInARow([["crin", crinwin("crinwin")], ["pim", pim], ["crin2", crinwin("crinwin2")]]);
		await rollDamageAt(tokenActor("crin"), { formula: "d6", label: "Bite", weapon: { name: "", range: [], piercing: 0 }, shiftKey: true });
		expect(damageFlag().weapon.piercing).toBe(0);
		expect(cardWithFlag(posted, "damage").content).toContain("while the +1 is on");
	});

	it("leaves the fight's +N off a row whose formula already has it", async () => {
		const pim = hero("pim", "Pim");
		const { tokenActor } = fightInARow([["crin", crinwin("crinwin")], ["pim", pim], ["crin2", crinwin("crinwin2")]]);
		await rollDamageAt(tokenActor("crin"), { formula: "d6+1", label: "Crinwin (swarm)", seeded: false, shiftKey: true });
		expect(damageFlag()).not.toHaveProperty("seed");
	});

	it("hits the roller's own target rather than whoever it is fighting", async () => {
		const pim = hero("pim", "Pim");
		const { tokens, tokenActor } = fightInARow([["crin", crinwin("crinwin")], ["pim", pim], ["gap", crinwin("far")], ["cadi", hero("cadi", "Cadi")]]);
		globalThis.game.user.targets = new Set([{ document: tokens.cadi, actor: tokens.cadi.actor }]);
		await rollDamageAt(tokenActor("crin"), { formula: "d6", label: "Bite", shiftKey: true });
		expect(damageFlag().results.map(r => r.name)).toEqual(["Cadi"]);
	});

	it("posts the plain card, as before, when there is nobody to hit", async () => {
		const loner = crinwin("loner");
		globalThis.game.combats = collection([]);
		expect(await rollDamageAt(loner, { formula: "d6", label: "Bite", keywords: "close", rollMode: "dis", shiftKey: true })).toBe(true);
		expect(plainCard).toHaveBeenCalledWith("d6", loner, expect.objectContaining({
			label: "Bite", keywords: "close", description: "", rollMode: "dis",
		}));
		expect(damageFlag()).toBeUndefined();
	});
});

describe("damage at several", () => {
	it("asks who a blow hits when the roller is fighting two, and rolls nothing when that is backed out of", async () => {
		const pim = hero("pim", "Pim");
		fightInARow([["crin", crinwin("crinwin")], ["pim", pim], ["crin2", crinwin("crinwin2")]]);
		const wait = answerWhoItHits(null);
		expect(await rollDamageAt(pim, { formula: "d8", label: "Damage", shiftKey: true })).toBe(false);
		expect(wait).toHaveBeenCalledTimes(1);
		expect(posted).toEqual([]);
		expect(plainCard).not.toHaveBeenCalled();
	});

	it("rolls separately against each one ticked, and says why on the card", async () => {
		const pim = hero("pim", "Pim");
		const { tokens } = fightInARow([["crin", crinwin("crinwin")], ["pim", pim], ["crin2", crinwin("crinwin2")]]);
		answerWhoItHits([true, true]);
		await rollDamageAt(pim, { formula: "d8", label: "Damage", shiftKey: true });
		expect(damageFlag().results.map(r => r.uuid)).toEqual([tokens.crin.uuid, tokens.crin2.uuid]);
		// One card, one +N: a pile-on is against a single target.
		expect(damageFlag()).not.toHaveProperty("seed");
		expect(cardWithFlag(posted, "damage").content).toContain("damage is rolled separately against each");
	});

	it("rolls at the one ticked, with the +N for the other character on that foe", async () => {
		const pim = hero("pim", "Pim");
		const { tokens } = fightInARow([["cadi", hero("cadi", "Cadi")], ["crin", crinwin("crinwin")], ["pim", pim], ["crin2", crinwin("crinwin2")]]);
		answerWhoItHits([true, false]);
		await rollDamageAt(pim, { formula: "d8", label: "Damage", shiftKey: true });
		expect(damageFlag().results.map(r => r.uuid)).toEqual([tokens.crin.uuid]);
		expect(damageFlag()).toMatchObject({ seed: { bonus: 1, direction: "onFoe", target: "Crinwin" } });
	});
});

describe("a Clash with nothing targeted", () => {
	it("freezes the foe the character is fighting as its target", async () => {
		const pim = hero("pim", "Pim");
		const { tokens } = fightInARow([["pim", pim], ["crin", crinwin("crinwin")]]);
		const begun = await maybeBeginAttack(pim, { name: "Clash" });
		expect(begun.messageFlags[SCOPE].attack.targets).toEqual([
			{ uuid: tokens.crin.uuid, name: "Crinwin", actorId: "crinwin", disposition: -1, hasActor: true },
		]);
		expect(globalThis.ui.notifications.info).not.toHaveBeenCalled();
	});

	it("is called off when the player backs out of who it hits", async () => {
		const pim = hero("pim", "Pim");
		fightInARow([["crin", crinwin("crinwin")], ["pim", pim], ["crin2", crinwin("crinwin2")]]);
		answerWhoItHits(null);
		expect(await maybeBeginAttack(pim, { name: "Clash" })).toBe("cancel");
	});

	it("still says nothing is targeted when the character is fighting nobody", async () => {
		const pim = hero("pim", "Pim");
		fightInARow([["pim", pim], ["gap", hero("cadi", "Cadi")]]);
		const begun = await maybeBeginAttack(pim, { name: "Clash" });
		expect(begun.messageFlags[SCOPE].attack.targets).toEqual([]);
		expect(globalThis.ui.notifications.info).toHaveBeenCalled();
	});
});

describe("a move's own damage at somebody it names (Castigate)", () => {
	it("aims at the person the move named, ignoring armor, with no window and no playbook lines", async () => {
		const judge = Object.assign(hero("judge", "Hafgan"), { items: [{ type: "move", name: "Castigate" }, { type: "move", name: "Dangerous" }] });
		const bandit = hero("bandit", "Bandit");
		fightInARow([["judge", judge], ["crin", crinwin("crinwin")]]);
		await rollMoveDamageAt(judge, bandit, { move: "Castigate", formula: "1d4", ignoresArmor: true, tags: ["loud"] });
		const flag = damageFlag();
		expect(flag.move).toBe("Castigate");
		expect(flag.results).toEqual([expect.objectContaining({ uuid: bandit.uuid, name: "Bandit", formula: "1d4" })]);
		expect(flag.weapon).toMatchObject({ ignoresArmor: true });
	});

	it("rolls nothing without a target or a die", async () => {
		const judge = hero("judge", "Hafgan");
		expect(await rollMoveDamageAt(judge, null, { move: "Castigate", formula: "1d4" })).toBeNull();
		expect(await rollMoveDamageAt(judge, hero("b", "B"), { move: "Castigate", formula: "" })).toBeNull();
		expect(posted).toEqual([]);
	});
});

describe("Blot Out the Sun", () => {
	/** A Ranger with a bow, and a fake attack-mode dialog that presses `pick`. */
	function ranger(pick, moves = ["Blot Out the Sun"]) {
		const wren = Object.assign(hero("wren", "Wren"), {
			items: moves.map(name => ({ type: "move", name })),
			typedActor: { carriedWeaponGear: async () => [{ slug: "bow-arrows", weaponSlug: "bow-arrows", catalog: true }], computedDamageDie: async () => "d8" },
			update: vi.fn(async function (changes) { this.updates = { ...(this.updates ?? {}), ...changes }; }),
			getFlag: (scope, key) => (key === "inventory.resources" ? { "bow-arrows": 0 } : {}),
		});
		// Let Fly asks its own question first ("easy shot, or tricky?"), so the fake answers whichever
		// window is in front of it: the roll, then the volley.
		globalThis.Dialog = class {
			constructor(config) { this.config = config; }
			render() {
				const buttons = this.config.buttons;
				const key = buttons[pick] ? pick : (buttons.roll ? "roll" : Object.keys(buttons)[0]);
				Promise.resolve().then(() => buttons[key]?.callback?.());
			}
		};
		return wren;
	}

	it("spends the ammo and opens the damage window on advantage", async () => {
		const wren = ranger("advantage");
		fightInARow([["wren", wren], ["crin", crinwin("crinwin")]]);
		const begun = await maybeBeginAttack(wren, { name: "Let Fly" });
		expect(begun.messageFlags[SCOPE].attack.damageMode).toBe("adv");
		expect(wren.updates).toMatchObject({ "flags.stonetop-pwd.inventory.resources.bow-arrows": 1 });
		expect(posted.at(-1).content).toContain("Low ammo");
	});

	it("spends the ammo for the area tag instead, which asks who the volley falls on", async () => {
		const wren = ranger("area");
		fightInARow([["wren", wren], ["crin", crinwin("crinwin")]]);
		const wait = answerWhoItHits([true]);
		const begun = await maybeBeginAttack(wren, { name: "Let Fly" });
		expect(begun.messageFlags[SCOPE].attack.damageMode).toBeUndefined();
		expect(wait).toHaveBeenCalledTimes(1);
		expect(wren.updates).toMatchObject({ "flags.stonetop-pwd.inventory.resources.bow-arrows": 1 });
	});

	/** Answer each window in turn by the key it is pressed with; anything unlisted closes. */
	function pressInTurn(answers) {
		globalThis.Dialog = class {
			constructor(config) { this.config = config; }
			render() {
				const key = answers.shift();
				const button = this.config.buttons[key] ?? this.config.buttons.cancel;
				// An empty root: the damage window's Roll button reads its answer off the DOM it was
				// rendered into, and every read there is optional-chained.
				Promise.resolve().then(() => button?.callback?.({}));
			}
		};
	}

	it("keeps the arrows when the easy shot's damage window is closed", async () => {
		const wren = ranger("advantage");
		fightInARow([["wren", wren], ["crin", crinwin("crinwin")]]);
		// "Easy shot", then the volley, then the damage window — which is the last way out of an easy
		// shot, since it deals its damage with no card to roll from later.
		pressInTurn(["deal", "advantage", "cancel"]);
		expect(await maybeBeginAttack(wren, { name: "Let Fly" })).toBe("cancel");
		expect(wren.updates).toBeUndefined();
		expect(posted).toEqual([]);
	});

	it("spends them once the easy shot's damage is settled", async () => {
		const wren = ranger("advantage");
		fightInARow([["wren", wren], ["crin", crinwin("crinwin")]]);
		pressInTurn(["deal", "advantage", "roll"]);
		expect(await maybeBeginAttack(wren, { name: "Let Fly" })).toBe("handled");
		expect(wren.updates).toMatchObject({ "flags.stonetop-pwd.inventory.resources.bow-arrows": 1 });
		expect(posted.some(card => card.content?.includes?.("looses a volley"))).toBe(true);
	});

	it("keeps the arrows when they say so, and never asks a Ranger without the move", async () => {
		const wren = ranger("keep");
		fightInARow([["wren", wren], ["crin", crinwin("crinwin")]]);
		await maybeBeginAttack(wren, { name: "Let Fly" });
		expect(wren.updates).toBeUndefined();

		const plain = ranger("advantage", ["Home on the Range"]);
		fightInARow([["wren", plain], ["crin", crinwin("crinwin")]]);
		await maybeBeginAttack(plain, { name: "Let Fly" });
		expect(plain.updates).toBeUndefined();
	});
});

describe("a follower's damage from their card", () => {
	/** An NPC follower, as the card's own damage line made it. */
	const hound = () => ({
		...fakeActor({ id: "hound", name: "Gwyn", type: "npc" }),
		system: { attributes: { damage: { value: "d6 (hand, messy)", rollFormula: "d6" }, armor: { value: 0 }, hp: { value: 6, max: 6 } } },
	});
	const crewBlow = (extra = {}) => ({ formula: "d6", label: "Pim's crew attacks", attacker: "Pim's crew", shiftKey: true, ...extra });

	it("swings as the follower's own token when it has one in the fight, at the foe the follower is fighting", async () => {
		const pim = hero("pim", "Pim");
		const { tokens, tokenActor, combat } = fightInARow([
			["crin", crinwin("crinwin")], ["pim", pim], ["ally", hero("ally", "Ally")], ["hound", hound()], ["crin2", crinwin("crinwin2")],
		]);
		combat.combatants.get("chound").flags["stonetop-pwd"].side = "heroes";
		expect(await rollFollowerDamageAt(pim, crewBlow({ fighter: tokenActor("hound"), label: "Gwyn attacks", attacker: "Gwyn" }))).toBe(true);
		expect(damageFlag().results.map(r => r.uuid)).toEqual([tokens.crin2.uuid]);
	});

	it("is aimed by the character's fight when the follower is off the map, without the character's +N", async () => {
		const pim = hero("pim", "Pim");
		const { tokens } = fightInARow([["cadi", hero("cadi", "Cadi")], ["crin", crinwin("crinwin")], ["pim", pim]]);
		expect(await rollFollowerDamageAt(pim, crewBlow())).toBe(true);
		const flag = damageFlag();
		expect(flag.move).toBe("Pim's crew attacks");
		expect(flag.results.map(r => r.uuid)).toEqual([tokens.crin.uuid]);
		expect(flag).not.toHaveProperty("seed");
		expect(flag).not.toHaveProperty("groupBlow");
	});

	it("records no shot in the character's name for a blow they did not strike", async () => {
		const pim = hero("pim", "Pim");
		const { tokens, combat } = fightInARow([["pim", pim], ["ally", hero("ally", "Ally")], ["far", crinwin("far")]]);
		const update = vi.fn(async () => {});
		Object.assign(combat.combatants.get("cpim"), { canUserModify: () => true, update });
		globalThis.game.user.targets = new Set([{ document: tokens.far, actor: tokens.far.actor }]);

		await rollFollowerDamageAt(pim, crewBlow());
		expect(damageFlag().results.map(r => r.uuid)).toEqual([tokens.far.uuid]);
		expect(update).not.toHaveBeenCalled();

		// The character's own blow at the same foe is a shot, which is what the follower's must not be.
		await rollDamageAt(pim, { formula: "d8", label: "Damage", shiftKey: true });
		expect(update).toHaveBeenCalledWith({ "flags.stonetop-pwd.shots": ["cfar"] });
	});

	it("names a hand-targeted foe by its token, not the actor every one of them shares", async () => {
		const pim = hero("pim", "Pim");
		const { tokens } = fightInARow([["pim", pim], ["gap", hero("gap", "Gap")], ["far", crinwin("far")]]);
		tokens.far.name = "Crinwin (4)";
		globalThis.game.user.targets = new Set([{ document: tokens.far, actor: tokens.far.actor }]);
		await rollDamageAt(pim, { formula: "d8", label: "Damage", shiftKey: true });
		expect(damageFlag().results.map(r => r.name)).toEqual(["Crinwin (4)"]);
	});

	it("names the follower when it asks who the blow hits", async () => {
		const pim = hero("pim", "Pim");
		fightInARow([["crin", crinwin("crinwin")], ["pim", pim], ["crin2", crinwin("crinwin2")]]);
		const wait = answerWhoItHits([true, false]);
		await rollFollowerDamageAt(pim, crewBlow());
		expect(wait.mock.calls[0][0].window.title).toContain("Pim's crew");
	});

	it("posts the plain card, naming the follower, when there is nobody to hit", async () => {
		const pim = hero("pim", "Pim");
		globalThis.game.combats = collection([]);
		expect(await rollFollowerDamageAt(pim, crewBlow({ keywords: "messy" }))).toBe(true);
		expect(plainCard).toHaveBeenCalledWith("d6", pim, expect.objectContaining({
			// "normal", not the empty string handed in: an unspoken mode is a straight roll, and the
			// window settles that before the card is posted (dialogs/RollDialog.js#promptDamage).
			label: "Pim's crew attacks", keywords: "messy", description: "", rollMode: "normal",
		}));
		expect(damageFlag()).toBeUndefined();
	});

	it("tells Apply a group's blow is the group's, so a horde's pool takes it rather than one member", async () => {
		const pim = hero("pim", "Pim");
		const crowd = {
			...fakeActor({ id: "horde", name: "Crinwin horde", type: "monster" }),
			flags: {},
			system: { organization: "horde", fightAsGroup: true, count: 12, attributes: { armor: { value: 1 }, hp: { value: 3, max: 3 } } },
			update: vi.fn(async function (changes) {
				if ("system.count" in changes) this.system.count = changes["system.count"];
				if ("system.attributes.hp.value" in changes) this.system.attributes.hp.value = changes["system.attributes.hp.value"];
			}),
		};
		fightInARow([["pim", pim], ["horde", crowd]]);
		await rollFollowerDamageAt(pim, crewBlow({ group: true }));
		const flag = damageFlag();
		expect(flag.groupBlow).toBe(true);
		await apply(flag);
		expect(crowd.system.count).toBe(12);
		expect(crowd.system.attributes.hp.value).toBe(0);
	});
});

describe("a Clash confirmed after the dice", () => {
	/** Press the card's Confirm, as the attacking player, on a Clash rolled with `targets` frozen. */
	async function confirmClash(pim, targets = []) {
		const listeners = [];
		const btn = { disabled: false, title: "", innerHTML: "", dataset: {}, addEventListener: (type, fn) => listeners.push(fn) };
		const root = { querySelectorAll: sel => (sel === ".stonetop-attack-confirm" ? [btn] : []), querySelector: () => null };
		const message = makeMessage({ attack: { move: "Clash", moveKey: "clash", attackerUuid: pim.uuid, weapon: null, targets } });
		const byToken = globalThis.fromUuid;
		globalThis.fromUuid = async uuid => (uuid === pim.uuid ? pim : byToken(uuid));
		wireAttackConfirm(message, root);
		await new Promise(resolve => setTimeout(resolve, 0));
		await listeners[0]({ shiftKey: true });
		return { message, btn };
	}

	it("hits the foe the character has stepped into contact with since, when nobody was there at the roll", async () => {
		const pim = hero("pim", "Pim");
		const { tokens } = fightInARow([["pim", pim], ["crin", crinwin("crinwin")]]);
		const { message } = await confirmClash(pim);
		expect(damageFlag().results.map(r => r.uuid)).toEqual([tokens.crin.uuid]);
		expect(message.flags.attack).toMatchObject({ resolved: true, targets: [expect.objectContaining({ uuid: tokens.crin.uuid })] });
	});

	it("hands the Confirm back when the player backs out of who it hits", async () => {
		const pim = hero("pim", "Pim");
		fightInARow([["crin", crinwin("crinwin")], ["pim", pim], ["crin2", crinwin("crinwin2")]]);
		answerWhoItHits(null);
		const { message, btn } = await confirmClash(pim);
		expect(btn.disabled).toBe(false);
		expect(message.flags.attack.resolved).toBeUndefined();
		expect(posted).toEqual([]);
	});

	it("rolls at disadvantage against a hero with Never Gonna Keep Me Down, as the sheet's own damage does", async () => {
		const pim = hero("pim", "Pim");
		const wren = hero("wren", "Wren");
		wren.items = [{ type: "move", name: "Never Gonna Keep Me Down" }];
		wren.system.attributes.hp.value = 5;
		const { tokens } = fightInARow([["pim", pim], ["wren", wren]]);
		const frozen = { uuid: tokens.wren.uuid, name: "Wren", actorId: "wren", disposition: 1, hasActor: true };
		await confirmClash(pim, [frozen]);
		// What the people being hit bring reaches the card's Confirm too, not just the sheet's Damage cell.
		expect(damageFlag().results[0].formula).toMatch(/kl1$/);
	});

	it("keeps the foe frozen at the roll, whoever the character is fighting now", async () => {
		const pim = hero("pim", "Pim");
		const { tokens } = fightInARow([["crin", crinwin("crinwin")], ["pim", pim], ["gap", hero("ally", "Ally")], ["far", crinwin("far")]]);
		const frozen = { uuid: tokens.far.uuid, name: "Crinwin", actorId: "far", disposition: -1, hasActor: true };
		await confirmClash(pim, [frozen]);
		expect(damageFlag().results.map(r => r.uuid)).toEqual([tokens.far.uuid]);
	});
});
