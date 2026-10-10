import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { SCOPE, installCombatChatFakes, uninstallCombatChatFakes, cardWithFlag, makeMessage } from "../fakes/combat-chat.js";
import { fakeActor, fakeToken, fakeScene, fakeCombatant, fakeCombat, collection } from "../fakes/fight.js";

// The fight's +N for several attackers (Book I p.414) on the incoming side of the attack flow, and
// the "Leave off the +N" control every seeded damage card carries.

const { sufferEnemyAttack, resolveSufferChoice, wireDamageSeed, wireApplyDamage, seedAdjustment, sufferArmorLine, reRollOwnWarning } =
	await import("../../module/combat/attack-flow.js");

// The chat fakes take `game` down after each test, i18n with it; the seed's words need it back.
const I18N = globalThis.game?.i18n;

let posted;
let fightTabOn;
let extraGlobals;

/** Pim (the character under attack), with HP to lose. */
const makePim = () => ({
	...fakeActor({ id: "pim", name: "Pim", type: "character" }),
	documentName: "Actor",
	uuid: "Actor.pim",
	isOwner: true,
	system: { attributes: { armor: { value: 0 }, hp: { value: 10, max: 10 } } },
	update: vi.fn(async function (changes) { this.system.attributes.hp.value = changes["system.attributes.hp.value"]; }),
});

/** A foe that bites for a d6. */
const biter = (id, name) => ({
	...fakeActor({ id, name, type: "monster" }),
	system: { attributes: { damage: { value: `bite d6 (close)`, rollFormula: "d6" }, hp: { value: 3, max: 3 } } },
});

/** Pim at (1,1) with `foes` placed around them; a fight holding everyone on the canvas scene. */
function fightAround(pim, foes) {
	const pimToken = Object.assign(fakeToken({ id: "tPim", col: 1, row: 1, actor: pim }), { uuid: "Scene.scene1.Token.tPim", documentName: "Token" });
	const spots = [[0, 1], [2, 1], [1, 0]];
	const foeTokens = foes.map((actor, i) => Object.assign(
		fakeToken({ id: `tF${i}`, col: spots[i][0], row: spots[i][1], actor }),
		{ uuid: `Scene.scene1.Token.tF${i}`, documentName: "Token" },
	));
	const scene = fakeScene({ tokens: [pimToken, ...foeTokens] });
	const combat = fakeCombat({ scene, combatants: [
		fakeCombatant({ id: "cPim", token: pimToken, scene }),
		...foeTokens.map((t, i) => fakeCombatant({ id: `cF${i}`, token: t, scene })),
	] });
	globalThis.game.combats = collection([combat]);
	globalThis.game.settings = { get: (scope, key) => (key === "fightTab" ? fightTabOn : "roll") };
	globalThis.ui.combat = { viewed: combat };
	globalThis.canvas = { scene };
	const byUuid = new Map([pimToken, ...foeTokens].map(t => [t.uuid, t]));
	globalThis.fromUuid = async uuid => (uuid === pim.uuid ? pim : byUuid.get(uuid) ?? null);
	globalThis.fromUuidSync = uuid => (uuid === pim.uuid ? pim : byUuid.get(uuid) ?? null);
	return { scene, combat, foeTokens };
}

beforeEach(() => {
	posted = installCombatChatFakes();
	globalThis.game.i18n = I18N;
	fightTabOn = true;
	extraGlobals = { canvas: globalThis.canvas, fromUuidSync: globalThis.fromUuidSync, CONST: globalThis.CONST };
	globalThis.CONST = { ...globalThis.CONST, GRID_TYPES: { GRIDLESS: 0, SQUARE: 1 } };
});
afterEach(() => {
	uninstallCombatChatFakes();
	Object.assign(globalThis, extraGlobals);
});

const damageCard = () => cardWithFlag(posted, "damage");

describe("a counter-attack from several foes at once", () => {
	it("rolls the +1 into the blow and names it on the card, with a way to leave it off", async () => {
		const pim = makePim();
		const { foeTokens } = fightAround(pim, [biter("crinwin", "Crinwin"), biter("crinwin", "Crinwin")]);
		await sufferEnemyAttack(pim, { targets: [{ uuid: foeTokens[0].uuid, name: "Crinwin" }] });
		const flag = damageCard().flags[SCOPE].damage;
		expect(flag.results[0].formula).toBe("d6+1");
		expect(flag.seed).toMatchObject({ bonus: 1, applied: true, rolled: true, target: "Pim" });
		expect(damageCard().content).toContain("+1 for 2 foes");
		expect(damageCard().content).toContain("Leave off the +1");
	});

	it("strikes with the foe in contact when nothing was targeted", async () => {
		const pim = makePim();
		fightAround(pim, [biter("crinwin", "Crinwin"), biter("crinwin", "Crinwin")]);
		await sufferEnemyAttack(pim, { targets: [] });
		expect(damageCard().flags[SCOPE].damage.move).toBe("Crinwin's attack");
		expect(damageCard().flags[SCOPE].damage.results[0].formula).toBe("d6+1");
	});

	it("asks the GM which blow landed when different foes are in contact, each row naming whose it is", async () => {
		const pim = makePim();
		fightAround(pim, [biter("crinwin", "Crinwin"), biter("wolf", "Wolf")]);
		await sufferEnemyAttack(pim, { targets: [] });
		const choice = cardWithFlag(posted, "sufferChoice");
		const flag = choice.flags[SCOPE].sufferChoice;
		expect(flag.attacks.map(a => a.foeName)).toEqual(["Crinwin", "Wolf"]);
		expect(flag.seed).toMatchObject({ bonus: 1 });
		expect(choice.content).toContain("Crinwin &amp; Wolf");
		expect(choice.content).toContain("+1: Pim is fighting Crinwin &amp; Wolf");

		posted.length = 0;
		const message = makeMessage({ sufferChoice: flag });
		expect(await resolveSufferChoice(message, 1)).toBe(true);
		expect(damageCard().flags[SCOPE].damage).toMatchObject({ move: "Wolf's attack", seed: { bonus: 1 } });
	});

	it("changes nothing with the Fight tab off", async () => {
		fightTabOn = false;
		const pim = makePim();
		const { foeTokens } = fightAround(pim, [biter("crinwin", "Crinwin"), biter("crinwin", "Crinwin")]);
		await sufferEnemyAttack(pim, { targets: [{ uuid: foeTokens[0].uuid, name: "Crinwin" }] });
		const flag = damageCard().flags[SCOPE].damage;
		expect(flag.results[0].formula).toBe("d6");
		expect(flag).not.toHaveProperty("seed");
		expect(damageCard().content).not.toContain("Leave off");
	});

	// ⚠ BUT THE CHARACTER'S OWN SKIN IS NOT THE FIGHT TAB'S TO SWITCH OFF. Never Gonna Keep Me Down
	// is about standing at 5 HP or less, not about being in a fight the tab has worked out. Gated on
	// the engagement, a counter-attack with the tab off - or on a map with no fight at all - skipped
	// the move entirely and the blow landed whole.
	it("still rolls a counter-attack at disadvantage for the hero's own moves with the tab off", async () => {
		fightTabOn = false;
		const pim = makePim();
		pim.items = [{ type: "move", name: "Never Gonna Keep Me Down" }];
		pim.system.attributes.hp.value = 5;
		const { foeTokens } = fightAround(pim, [biter("crinwin", "Crinwin")]);

		await sufferEnemyAttack(pim, { targets: [{ uuid: foeTokens[0].uuid, name: "Crinwin" }] });

		expect(damageCard().flags[SCOPE].damage.results[0].formula).toBe("2d6kl1");
	});

	// And it is the MOVE doing it, not the tab's absence: above 5 HP the same blow is straight.
	it("leaves that same counter-attack straight once the hero is above 5 HP", async () => {
		fightTabOn = false;
		const pim = makePim();
		pim.items = [{ type: "move", name: "Never Gonna Keep Me Down" }];
		const { foeTokens } = fightAround(pim, [biter("crinwin", "Crinwin")]);

		await sufferEnemyAttack(pim, { targets: [{ uuid: foeTokens[0].uuid, name: "Crinwin" }] });

		expect(damageCard().flags[SCOPE].damage.results[0].formula).toBe("d6");
	});
});

/** A rendered damage card: its rows, its pill and its two buttons, as the wiring reads them. */
function renderedCard(flag) {
	const listeners = { toggle: [], apply: [] };
	const button = kind => ({
		disabled: false, title: "", innerHTML: "", style: {},
		addEventListener: (type, fn) => listeners[kind].push(fn),
	});
	const toggle = button("toggle");
	const apply = button("apply");
	const number = { textContent: String(flag.results[0].raw) };
	const classes = new Set();
	const row = {
		dataset: { uuid: flag.results[0].uuid },
		querySelector: sel => (sel === ".stonetop-roll-result-number" ? number : null),
		classList: { toggle: (name, on) => (on ? classes.add(name) : classes.delete(name)) },
	};
	const pillClasses = new Set();
	const pill = { textContent: "", classList: { toggle: (name, on) => (on ? pillClasses.add(name) : pillClasses.delete(name)) } };
	const root = {
		querySelector: sel => ({ ".stonetop-damage-seed-toggle": toggle, ".stonetop-apply-damage": apply, ".stonetop-condition-numbers": pill })[sel] ?? null,
		querySelectorAll: sel => (sel === ".stonetop-damage-row[data-uuid]" ? [row] : []),
	};
	return { root, toggle, apply, number, row, rowClasses: classes, pill, pillClasses, listeners };
}

describe("an attack's own damage windows", () => {
	// Every place damage is asked about against targets (a tier's Confirm, Let Fly's easy shot, and a
	// damage roll at whoever the roller is fighting) hands the window the fight's seed for those targets.
	// Read off the source: standing up a rolled attack card to prove a one-argument hand-off would test
	// the card, not the hand-off.
	it("are offered the +N for a foe others are fighting", async () => {
		const fs = await import("node:fs");
		const path = await import("node:path");
		const src = fs.readFileSync(path.resolve(import.meta.dirname, "../../module/combat/attack-flow.js"), "utf8");
		const calls = src.match(/await askDamageAdjustment\([\s\S]*?\);/g) ?? [];
		// Defend's strike back from a parry (strikeBackAt) is one attacker's blow at the one who struck, and
		// takes no pile-on. Neither does a follower off the map (rollDamageAt's `striker`, which turns
		// `seeded` off): the fight counts the bodies on the map, and they are not one.
		const strikeBack = calls.filter(call => call.includes('rollMode: "dis", seed: null'));
		// And the window with NOBODY TO HIT takes the roller's own sheet seed instead, because the
		// pile-on is a +N against ONE target and this blow has none (rollDamageAt's no-target branch,
		// which asks this window so a ticked line is paid for and can tag the blow).
		const unaimed = calls.filter(call => call.includes("sheetSeed({ actor })"));
		// An Invocation's own damage (Go Back to the Shadow, rollInvocationDamage) is the Invocation's
		// number, not a blow anyone is piling on to.
		const invocation = calls.filter(call => call.includes('rollMode: "normal", seed: null, offers'));
		const aimed = calls.filter(call => !strikeBack.includes(call) && !unaimed.includes(call) && !invocation.includes(call));
		expect(calls).toHaveLength(6);
		expect(src).toContain("seeded = seeded && !striker;");
		expect(strikeBack).toHaveLength(1);
		expect(unaimed).toHaveLength(1);
		expect(invocation).toHaveLength(1);
		expect(aimed).toHaveLength(3);
		for (const call of aimed) expect(call).toContain("seedForTargets(actor, targets)");
	});
});

describe("leaving the +N off a damage card", () => {
	async function seededCard() {
		const pim = makePim();
		const { foeTokens } = fightAround(pim, [biter("crinwin", "Crinwin"), biter("crinwin", "Crinwin")]);
		await sufferEnemyAttack(pim, { targets: [{ uuid: foeTokens[0].uuid, name: "Crinwin" }] });
		const flags = { damage: damageCard().flags[SCOPE].damage };
		const message = makeMessage(flags);
		message.canUserModify = () => true;
		return { pim, message, flags };
	}

	it("works out how far the rolled totals are from what they should be now", () => {
		expect(seedAdjustment({ bonus: 2, applied: true, rolled: true })).toBe(0);
		expect(seedAdjustment({ bonus: 2, applied: false, rolled: true })).toBe(-2);
		expect(seedAdjustment({ bonus: 2, applied: true, rolled: false })).toBe(2);
		expect(seedAdjustment(null)).toBe(0);
	});

	it("lets the person who may apply the damage leave it off, and redraws the card from the flag", async () => {
		const { message, flags } = await seededCard();
		const card = renderedCard(flags.damage);
		wireDamageSeed(message, card.root);
		expect(card.toggle.disabled).toBe(false);
		expect(card.toggle.innerHTML).toContain("Leave off the +1");
		await card.listeners.toggle[0]();
		expect(flags.damage.seed.applied).toBe(false);

		const redrawn = renderedCard(flags.damage);
		wireDamageSeed(message, redrawn.root);
		expect(redrawn.number.textContent).toBe("8");
		expect(redrawn.rowClasses.has("is-seed-left-off")).toBe(true);
		expect(redrawn.pill.textContent).toBe("+1 for 2 foes, left off");
		expect(redrawn.pillClasses.has("is-left-off")).toBe(true);
		expect(redrawn.toggle.innerHTML).toContain("Add the +1 back");
	});

	it("offers a group's -N the same way, since the other side's armor is the table's to waive too", async () => {
		const flags = { damage: {
			move: "Bite", results: [{ uuid: "Scene.scene1.Token.tPim", name: "Pim", raw: 3, formula: "d6-2" }], applied: [],
			seed: { bonus: -2, direction: "groupBehind", pill: "-2 for their armor, 9 against 3", pillLeftOff: "-2 for their armor, 9 against 3, left off", applied: true, rolled: true },
		} };
		const message = makeMessage(flags);
		message.canUserModify = () => true;
		const card = renderedCard(flags.damage);
		wireDamageSeed(message, card.root);
		expect(card.toggle.innerHTML).toContain("Leave off the -2");
		await card.listeners.toggle[0]();
		expect(flags.damage.seed.applied).toBe(false);

		const redrawn = renderedCard(flags.damage);
		wireDamageSeed(message, redrawn.root);
		expect(redrawn.number.textContent).toBe("5");
		expect(redrawn.pill.textContent).toBe("-2 for their armor, 9 against 3, left off");
		expect(redrawn.toggle.innerHTML).toContain("Add the -2 back");
	});

	it("takes the left-off +1 back out when the damage is applied", async () => {
		const { pim, message, flags } = await seededCard();
		flags.damage = { ...flags.damage, seed: { ...flags.damage.seed, applied: false } };
		const card = renderedCard(flags.damage);
		wireApplyDamage(message, card.root);
		await card.listeners.apply[0]();
		expect(pim.system.attributes.hp.value).toBe(2);
		expect(flags.damage.applied).toEqual([expect.objectContaining({ effective: 8, oldHp: 10, newHp: 2 })]);
	});

	it("applies the rolled total untouched while the +1 stays on", async () => {
		const { pim, message, flags } = await seededCard();
		const card = renderedCard(flags.damage);
		wireApplyDamage(message, card.root);
		await card.listeners.apply[0]();
		expect(pim.system.attributes.hp.value).toBe(1);
	});

	it("warns to re-roll your own damage when the +N goes off a total rolled with another's die", async () => {
		const flags = { damage: {
			move: "Clash", applied: [], results: [{ uuid: "Scene.scene1.Token.tPim", name: "Crinwin", raw: 9, formula: "d8+1" }],
			seed: { bonus: 1, pill: "+1", pillLeftOff: "+1, left off", applied: true, rolled: true, useBest: true, best: { name: "Bram", formula: "d8" } },
		} };
		const message = makeMessage(flags);
		message.canUserModify = () => true;
		const card = renderedCard(flags.damage);
		wireDamageSeed(message, card.root);
		await card.listeners.toggle[0]();
		expect(flags.damage.seed.applied).toBe(false);
		expect(globalThis.ui.notifications.warn).toHaveBeenCalledWith(expect.stringContaining("re-roll your own damage"));
		expect(reRollOwnWarning(flags.damage.seed)).toContain("Bram's d8");
		// Not while the +N is on, and not for a total rolled with the roller's own die.
		expect(reRollOwnWarning({ ...flags.damage.seed, applied: true })).toBe("");
		expect(reRollOwnWarning({ ...flags.damage.seed, useBest: false })).toBe("");
	});

	it("stops offering the toggle once the damage has been applied", async () => {
		const { message, flags } = await seededCard();
		flags.damage = { ...flags.damage, applied: [{ uuid: flags.damage.results[0].uuid, effective: 9 }] };
		const card = renderedCard(flags.damage);
		wireDamageSeed(message, card.root);
		expect(card.toggle.disabled).toBe(true);
		expect(card.listeners.toggle).toHaveLength(0);
	});

	it("gives a second GM the same answer Apply gives them", async () => {
		const { message, flags } = await seededCard();
		globalThis.game.users = { activeGM: { id: "other-gm" }, find: () => null, players: [], get: () => null };
		const card = renderedCard(flags.damage);
		wireDamageSeed(message, card.root);
		expect(card.toggle.disabled).toBe(true);
		expect(card.toggle.title).toBe("Another GM will apply this damage");
	});

	/** Apply on a hand-built card aimed at Pim, and the damage Pim took. */
	async function applyTo(pim, damage) {
		fightAround(pim, []);
		const flags = { damage: { move: "Blow", applied: [], results: [{ uuid: "Actor.pim", name: "Pim", raw: damage.raw, formula: "d6" }], ...damage } };
		const message = makeMessage(flags);
		message.canUserModify = () => true;
		const card = renderedCard(flags.damage);
		wireApplyDamage(message, card.root);
		await card.listeners.apply[0]();
		return 10 - pim.system.attributes.hp.value;
	}

	it("takes the other attackers' piercing off with their +1, and brings it back with it", async () => {
		const seed = { bonus: 1, piercing: 2, pill: "+1", pillLeftOff: "+1, left off", rolled: true };
		const armored = () => { const pim = makePim(); pim.system.attributes.armor.value = 2; return pim; };
		// 6 rolled with the +1 in it: on, their 2 piercing takes all of Pim's 2 armor.
		expect(await applyTo(armored(), { raw: 6, weapon: { name: "", piercing: 0 }, seed: { ...seed, applied: true } })).toBe(6);
		// Left off: 5, against the whole 2 armor.
		expect(await applyTo(armored(), { raw: 6, weapon: { name: "", piercing: 0 }, seed: { ...seed, applied: false } })).toBe(3);
		// The blow's own piercing stays whatever happens to the +1.
		expect(await applyTo(armored(), { raw: 6, weapon: { name: "", piercing: 1 }, seed: { ...seed, applied: false } })).toBe(4);
	});

	it("counts a smaller group's -1 as the bigger group's armor, which piercing reaches (p.416)", async () => {
		const seed = { bonus: -1, direction: "groupBehind", pill: "-1", pillLeftOff: "-1, left off", rolled: true };
		// 5 rolled, 4 on the card: armor 0+1 against 1 piercing is nothing, so all 5 land.
		expect(await applyTo(makePim(), { raw: 4, weapon: { name: "", piercing: 1 }, seed: { ...seed, applied: true } })).toBe(5);
		// No piercing: the +1 armor takes one off, as the -1 did.
		expect(await applyTo(makePim(), { raw: 4, weapon: { name: "", piercing: 0 }, seed: { ...seed, applied: true } })).toBe(4);
		// "Ignores armor" ignores it too.
		expect(await applyTo(makePim(), { raw: 4, weapon: { name: "", ignoresArmor: true }, seed: { ...seed, applied: true } })).toBe(5);
		// Left off: the whole 5, no armor added.
		expect(await applyTo(makePim(), { raw: 4, weapon: { name: "", piercing: 0 }, seed: { ...seed, applied: false } })).toBe(5);
		// Unticked at the roll and added back on the card: 5 rolled, +1 armor.
		expect(await applyTo(makePim(), { raw: 5, weapon: { name: "", piercing: 0 }, seed: { ...seed, applied: true, rolled: false } })).toBe(4);
	});

	it("says where a group's -1 went when Apply starts from more than the card showed", async () => {
		const seed = { bonus: -1, direction: "groupBehind", pill: "-1", pillLeftOff: "-1, left off", rolled: true, applied: true };
		const pim = makePim();
		pim.system.attributes.armor.value = 2;
		// 4 rolled, 3 on the card: 4 against 2 armor and their 1.
		expect(await applyTo(pim, { raw: 3, weapon: { name: "", piercing: 0 }, seed })).toBe(1);
		expect(posted.at(-1).content).toContain("3 on the card, 4 before their 1 armor");
		expect(posted.at(-1).content).toContain("4 − 3 armor");
	});

	it("takes a character's armor off as it is stored, which the vitals mirror keeps current", async () => {
		const pim = makePim();
		pim.system.attributes.armor.value = 2;
		pim.typedActor = { computedVitals: vi.fn(async () => ({ armor: 0, unpierceable: 0, maxHp: 10 })) };
		expect(await applyTo(pim, { raw: 5, weapon: null })).toBe(3);
		expect(pim.typedActor.computedVitals).not.toHaveBeenCalled();
	});

	it("says what armor does to a named blow in Apply's own arithmetic", () => {
		expect(sufferArmorLine("Pim", { armor: 0 })).toBe("Pim wears no armor, so all of it lands.");
		expect(sufferArmorLine("Pim", { armor: 2 })).toBe("Pim's 2 armor comes off it when the damage is taken.");
		expect(sufferArmorLine("Pim", { armor: 2 }, { ignoresArmor: true })).toBe("It ignores Pim's armor, so all of it lands.");
		expect(sufferArmorLine("Pim", { armor: 3 }, { piercing: 1 })).toBe("2 of Pim's 3 armor comes off it when the damage is taken; the rest is pierced.");
		expect(sufferArmorLine("Pim", { armor: 3, unpierceable: 3 }, { ignoresArmor: true })).toBe("Pim's 3 armor comes off it when the damage is taken.");
		// Undaunted's +1 counts as Apply counts it, and says so.
		expect(sufferArmorLine("Pim", { armor: 2 }, null, { undaunted: true })).toBe("Pim's 3 armor (+1 armor, Undaunted) comes off it when the damage is taken.");
		expect(sufferArmorLine("Pim", { armor: 0 }, null, { undaunted: true })).toBe("Pim's 1 armor (+1 armor, Undaunted) comes off it when the damage is taken.");
	});

	it("does nothing on a card with no seed", () => {
		const message = makeMessage({ damage: { results: [{ uuid: "Actor.pim", raw: 9 }], applied: [] } });
		const card = renderedCard({ results: [{ uuid: "Actor.pim", raw: 9 }] });
		wireDamageSeed(message, card.root);
		expect(card.toggle.innerHTML).toBe("");
		expect(card.number.textContent).toBe("9");
	});
});

describe("Undaunted as the fight stood at the roll", () => {
	async function applyRow(row, extra = {}) {
		const pim = makePim();
		fightAround(pim, []);
		const flags = { damage: { move: "Blow", applied: [], results: [{ uuid: "Actor.pim", name: "Pim", raw: 4, formula: "d6", ...row }], ...extra } };
		const message = makeMessage(flags);
		message.canUserModify = () => true;
		const card = renderedCard(flags.damage);
		wireApplyDamage(message, card.root);
		await card.listeners.apply[0]();
		return 10 - pim.system.attributes.hp.value;
	}

	it("keeps the +1 armor the roll saw, whatever the applying client's scene shows now", async () => {
		// The fight here shows nothing (the GM is looking at another scene): the stamp still holds.
		expect(await applyRow({ undaunted: true })).toBe(3);
	});

	it("gives none where the roll saw none, unless the table ticked the card's box", async () => {
		expect(await applyRow({ undaunted: false })).toBe(4);
		expect(await applyRow({ undaunted: false }, { undauntedArmor: ["Actor.pim"] })).toBe(3);
	});
});

describe("the marks an Apply leaves on its card", () => {
	it("marks the card as being applied before any HP moves, and lets it go with the latch", async () => {
		const pim = makePim();
		fightAround(pim, []);
		const flags = { damage: { move: "Blow", applied: [], results: [{ uuid: "Actor.pim", name: "Pim", raw: 4, formula: "d6" }] } };
		const message = makeMessage(flags);
		message.canUserModify = () => true;
		const seen = [];
		const update = pim.update;
		pim.update = vi.fn(async function (changes) { seen.push(flags.damage.applying); return update.call(this, changes); });
		const card = renderedCard(flags.damage);
		wireApplyDamage(message, card.root);
		await card.listeners.apply[0]();
		// A Readiness spend recorded on another client meanwhile (fight/defend-spend.js#beingApplied) waits on this.
		expect(seen).toEqual([globalThis.game.user.id]);
		expect(flags.damage.applying).toBeNull();
		expect(flags.damage.applied).toEqual([expect.objectContaining({ uuid: "Actor.pim", effective: 4 })]);
		// And the ledger names the blow the HP went to.
		expect(pim.update).toHaveBeenCalledWith({ "system.attributes.hp.value": 6 }, { stonetopMove: "Blow" });
	});

	it("whispers the applied card as the card it answers was whispered", async () => {
		const pim = makePim();
		fightAround(pim, []);
		const flags = { damage: { move: "Blow", applied: [], results: [{ uuid: "Actor.pim", name: "Pim", raw: 4, formula: "d6" }] } };
		const message = Object.assign(makeMessage(flags), { whisper: ["gm1"], blind: true, canUserModify: () => true });
		const card = renderedCard(flags.damage);
		wireApplyDamage(message, card.root);
		await card.listeners.apply[0]();
		expect(posted.at(-1)).toMatchObject({ whisper: ["gm1"], blind: true });
	});

	it("latches the rows already written when a later row fails, so a second press cannot take them twice", async () => {
		const pim = makePim();
		fightAround(pim, []);
		const broken = { ...makePim(), uuid: "Actor.bad", name: "Bad", update: vi.fn(async () => { throw new Error("refused"); }) };
		const resolve = globalThis.fromUuid;
		globalThis.fromUuid = async uuid => (uuid === "Actor.bad" ? broken : resolve(uuid));
		const flags = { damage: { move: "Blow", applied: [], results: [
			{ uuid: "Actor.pim", name: "Pim", raw: 4, formula: "d6" },
			{ uuid: "Actor.bad", name: "Bad", raw: 4, formula: "d6" },
		] } };
		const message = makeMessage(flags);
		message.canUserModify = () => true;
		const card = renderedCard(flags.damage);
		const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
		wireApplyDamage(message, card.root);
		await card.listeners.apply[0]();
		quiet.mockRestore();
		expect(pim.system.attributes.hp.value).toBe(6);
		expect(flags.damage.applied).toEqual([expect.objectContaining({ uuid: "Actor.pim", effective: 4 })]);
		expect(flags.damage.applying).toBeNull();
		// Pressed again: Pim's row is latched and is not taken twice.
		broken.update = vi.fn(async function (changes) { this.system.attributes.hp.value = changes["system.attributes.hp.value"]; });
		const again = renderedCard(flags.damage);
		wireApplyDamage(message, again.root);
		await again.listeners.apply[0]();
		expect(pim.system.attributes.hp.value).toBe(6);
		expect(broken.system.attributes.hp.value).toBe(6);
	});
});
