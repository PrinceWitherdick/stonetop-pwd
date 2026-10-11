import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { SCOPE, pc, installCombatChatFakes, uninstallCombatChatFakes, cardWithFlag, makeMessage, NO_ACTIVE_GM } from "../fakes/combat-chat.js";

// Everything else in utils/damage.js stays real — parseMonsterAttacks above all, since the three
// routes below are chosen by what it reads out of a shipped stat block's prose.
const attackFlow = await import("../../module/combat/attack-flow.js");
const { sufferEnemyAttack, maybeCounterOnMiss, tagNoticesHtml, resolveSufferChoice, dealSufferedAmount, tierCounters, reconcileClashCounter } = attackFlow;
const { FICTION_DAMAGE_TAGS } = await import("../../module/utils/damage.js");

let posted;

/** A targeted foe whose stat block prints `damageValue`. */
function targeting(damageValue, rollFormula = "") {
	globalThis.fromUuid = async () => ({
		actor: { name: "Rime Lord", system: { attributes: { damage: { value: damageValue, rollFormula } } } },
	});
	return [{ uuid: "Scene.s.Token.t", name: "Rime Lord" }];
}

/** The same foe, plus a `fromUuid` that can still find the CHARACTER — which the card handlers
 *  re-resolve from the uuid they stored, where `sufferEnemyAttack` was handed the actor itself. */
function targetingResolvable(damageValue, rollFormula = "") {
	const targets = targeting(damageValue, rollFormula);
	const foe = globalThis.fromUuid;
	globalThis.fromUuid = async (uuid) => (uuid === pc.uuid ? pc : foe(uuid));
	return targets;
}

const damageCard = () => cardWithFlag(posted, "damage");
const choiceCard = () => cardWithFlag(posted, "sufferChoice");
const amountCard = () => cardWithFlag(posted, "sufferAmount");

// `targets` on the user because this end of the flow reads whatever the attacker holds.
beforeEach(() => { posted = installCombatChatFakes({ user: { targets: new Set() } }); });
afterEach(uninstallCombatChatFakes);

// -- Which of the three routes a foe's damage line takes -----------------------

describe("a foe with ONE printed attack strikes straight away", () => {
	it("rolls it and posts a damage card, with nobody asked anything", async () => {
		await sufferEnemyAttack(pc, { targets: targeting("bronze khopesh d10+2 (close, messy)", "d10+2") });

		expect(choiceCard()).toBeUndefined();
		expect(amountCard()).toBeUndefined();
		const flag = damageCard().flags[SCOPE].damage;
		expect(flag.results[0]).toMatchObject({ uuid: "Actor.pim", name: "Pim", raw: 9 });
		// Aimed at the character, so the button says so rather than reading as somebody else's job.
		expect(flag.selfHarm).toBe(true);
		expect(damageCard().content).toContain("Take this damage");
	});

	it("carries the attack's OWN armor clause onto the card, for Apply to mitigate with", async () => {
		// The whole point of reading the prose: "ignores armor" has to survive as far as the HP.
		await sufferEnemyAttack(pc, { targets: targeting("heat-drain d12+1 (reach, ignores armor)", "d12+1") });
		expect(damageCard().flags[SCOPE].damage.weapon).toMatchObject({ name: "heat-drain", ignoresArmor: true });

		posted.length = 0;  // in place: the recorder holds this same array
		await sufferEnemyAttack(pc, { targets: targeting("antler d10+2 (close, 1 piercing)", "d10+2") });
		expect(damageCard().flags[SCOPE].damage.weapon).toMatchObject({ name: "antler", piercing: 1 });
	});

	it("names the foe in the title and the blow in the fine print", async () => {
		await sufferEnemyAttack(pc, { targets: targeting("heat-drain d12+1 (reach, ignores armor)", "d12+1") });
		expect(damageCard().flags[SCOPE].damage.move).toBe("Rime Lord's attack");
		expect(damageCard().content).toContain("heat-drain");
		expect(damageCard().content).toContain("ignores armor");
	});

	it("reminds the table about a messy incoming blow, as it does an outgoing one", async () => {
		await sufferEnemyAttack(pc, { targets: targeting("bronze khopesh d10+2 (close, messy)", "d10+2") });
		// ON the damage card, not under it: the fiction belongs with the number it qualifies, and
		// a card per tag buried that number under follow-ups on any foe carrying several.
		expect(damageCard().content).toContain("Messy.");
		expect(posted).toHaveLength(1);
	});

	it("prints every tag's fiction on the one card, however many the blow carries", async () => {
		// The Bear of Winter's blow, which under a card-per-tag would have cost chat FOUR messages
		// for one swing. `1 piercing` gets no note of its own: it rides the number, and the card's
		// fine print already says it.
		await sufferEnemyAttack(pc, {
			targets: targeting("bite or maul d12+5 (close, hand, reach, forceful, grabby, messy, 1 piercing)", "d12+5"),
		});
		expect(posted).toHaveLength(1);
		const card = damageCard().content;
		for (const label of ["Messy.", "Forceful.", "Grabby."]) expect(card).toContain(label);
		// Declaration order (utils/damage.js#FICTION_DAMAGE_TAGS), not the order the book listed
		// them in, so two foes carrying the same three consequences read the same way down.
		expect(card.indexOf("Messy.")).toBeLessThan(card.indexOf("Forceful."));
		expect(card.indexOf("Forceful.")).toBeLessThan(card.indexOf("Grabby."));
	});

	// The vocabulary is stated in two places by necessity — the NAMES and their print order in
	// utils/damage.js (where the readers are), the icon and wording for each in attack-flow.js
	// (where the card is) — and nothing but this holds them together. A name added to the first
	// without a note in the second throws on every damage post the moment a foe carries it, which
	// is a long way from where the edit was made.
	it("has a note written for every tag the readers recognise", () => {
		for (const tag of FICTION_DAMAGE_TAGS) {
			expect(tagNoticesHtml({ tags: [tag] }), `no note for "${tag}"`).toContain("Beyond the damage");
		}
	});

	it("reads a tag the book printed with a qualifier beside it", async () => {
		// The Nine-Fingered Stranger, whose "+forceful" an exact-match lookup dropped in silence.
		await sufferEnemyAttack(pc, { targets: targeting("by weapon d10+2 (tags by weapon, +forceful)", "d10+2") });
		expect(damageCard().content).toContain("Forceful.");
	});

	it("prints no notice block at all for a blow that carries no fiction tag", async () => {
		await sufferEnemyAttack(pc, { targets: targeting("heat-drain d12+1 (reach, ignores armor)", "d12+1") });
		expect(damageCard().content).not.toContain("Beyond the damage");
	});

	it("rolls the stat line's own advantage on the damage die", async () => {
		await sufferEnemyAttack(pc, { targets: targeting("gore d8 w/advantage (close, forceful)", "d8") });
		// damageRollFormula doubles the first dice term and keeps the higher.
		expect(damageCard().flags[SCOPE].damage.results[0].formula).toContain("kh");
	});
});

describe("a foe with SEVERAL printed attacks asks the GM first", () => {
	const RIME_LORD = "conjured ice d12+3 (any range, area, grabby, forceful) or heat-drain d12+1 (reach, ignores armor)";

	it("whispers a card of buttons instead of guessing, and deals nothing yet", async () => {
		await sufferEnemyAttack(pc, { targets: targeting(RIME_LORD, "d12+3") });

		expect(damageCard()).toBeUndefined();
		const card = choiceCard();
		// Whispered: the buttons ARE the stat block, and that is the GM's to know.
		expect(card.whisper).toEqual(["gm1"]);
		expect(card.flags[SCOPE].sufferChoice.attacks.map(a => a.label)).toEqual(["conjured ice", "heat-drain"]);
		expect(card.content).toContain("d12+1");
		expect(card.content).toContain("ignores armor");
	});

	it("points back at nothing, now that no player button is waiting on the answer", async () => {
		await sufferEnemyAttack(pc, { targets: targeting(RIME_LORD, "d12+3") });
		const choice = choiceCard().flags[SCOPE].sufferChoice;
		expect(choice.sourceId).toBeUndefined();
		expect(choice.flagKey).toBeUndefined();
		expect(choice.chosen).toBe(null);
	});
});

describe("a foe with NO printed attack asks the GM for the number", () => {
	it("whispers a card with a field: the 22 spirits print no die to roll", async () => {
		// Inventing a die for them would be damage the book never gave.
		await sufferEnemyAttack(pc, { targets: targeting("none", "") });

		expect(damageCard()).toBeUndefined();
		const card = amountCard();
		expect(card.whisper).toEqual(["gm1"]);
		expect(card.content).toContain('class="stonetop-suffer-amount"');
		expect(card.flags[SCOPE].sufferAmount).toMatchObject({ pcUuid: "Actor.pim", dealt: null });
	});

	it("says what the number will meet, so it is typed knowing the armor comes off", async () => {
		await sufferEnemyAttack(pc, { targets: targeting("none", "") });
		expect(amountCard().content).toContain("2 armor comes off");
	});

	it("asks the same way when nothing was targeted at all", async () => {
		globalThis.fromUuid = async () => null;
		await sufferEnemyAttack(pc, { targets: [] });
		expect(amountCard()).toBeTruthy();
		expect(amountCard().content).toContain("The enemy");
	});
});

// -- A printed attack that prints no die ---------------------------------------
//
// A die-less segment carrying its own tag list is a WHOLE printed attack, not a spare name for the
// next one (utils/damage.js#splitMonsterAttackProse). So "how many attacks are there" and "is
// there a die to roll" are two questions, and routing on the first alone rolled `formula || "0"`
// and posted a damage card for 0 — the consequence recorded as paid without anything being paid.

describe("a printed attack with no die is priced, not rolled as zero", () => {
	// Not a hypothetical line: this is a whole damage line with no die anywhere in it, which is
	// how a stat block says the thing hits with whatever it picked up.
	const BY_WEAPON = "by weapon (close, forceful)";

	it("asks the GM what it costs instead of dealing 0 damage", async () => {
		await sufferEnemyAttack(pc, { targets: targeting(BY_WEAPON, "") });

		expect(damageCard()).toBeUndefined();
		expect(amountCard()).toBeTruthy();
	});

	it("names the blow being priced, and keeps what it carries besides a number", async () => {
		await sufferEnemyAttack(pc, { targets: targeting(BY_WEAPON, "") });

		expect(amountCard().content).toContain("by weapon");
		// The tags ride the stored attack, so the number the GM names still lands under this
		// blow's name and prints its fiction — a forceful blow is forceful for 3 damage too.
		expect(amountCard().flags[SCOPE].sufferAmount.attack).toMatchObject({
			label: "by weapon", tags: ["close", "forceful"],
		});
	});

	it("still rolls the one attack that DOES print a die", async () => {
		await sufferEnemyAttack(pc, { targets: targeting("bronze khopesh d10+2 (close)", "d10+2") });
		expect(amountCard()).toBeUndefined();
		expect(damageCard()).toBeTruthy();
	});
});

describe("picking a die-less attack off the 'Which attack?' card", () => {
	// The Thraulgwyn Raider, whose net is thrown, crude and grabby and prints no die. Its row on
	// the choice card already reads "no damage die"; pressing it must ask rather than roll 0.
	const RAIDER = "hair-rope net (thrown, crude, grabby), bite d6 (hand)";

	it("asks what the net cost rather than dealing 0 for it", async () => {
		await sufferEnemyAttack(pc, { targets: targetingResolvable(RAIDER, "d6") });
		const message = makeMessage({ sufferChoice: choiceCard().flags[SCOPE].sufferChoice });

		expect(await resolveSufferChoice(message, 0)).toBe(true);
		expect(damageCard()).toBeUndefined();
		expect(amountCard().flags[SCOPE].sufferAmount.attack).toMatchObject({ label: "hair-rope net" });
	});

	it("rolls the bite, which has one", async () => {
		await sufferEnemyAttack(pc, { targets: targetingResolvable(RAIDER, "d6") });
		const message = makeMessage({ sufferChoice: choiceCard().flags[SCOPE].sufferChoice });

		expect(await resolveSufferChoice(message, 1)).toBe(true);
		expect(damageCard().flags[SCOPE].damage.weapon).toMatchObject({ name: "bite" });
	});

	it("pays the named number under the priced attack's own name and armor clause", async () => {
		const attack = { label: "hair-rope net", formula: "", tags: ["thrown", "crude", "grabby"], piercing: 2, ignoresArmor: true, rollMode: "normal" };
		targetingResolvable("hair-rope net (thrown, crude, grabby)", "");
		const message = makeMessage({ sufferAmount: { pcUuid: "Actor.pim", foeName: "Raider", attack, dealt: null } });

		expect(await dealSufferedAmount(message, 3)).toBe(true);
		const flag = damageCard().flags[SCOPE].damage;
		expect(flag.weapon).toMatchObject({ name: "hair-rope net", piercing: 2, ignoresArmor: true });
		// The typed number, not the attack's own empty formula.
		expect(flag.results[0].formula).toBe("3");
	});
});

// -- Whispering to a table with no GM in it -------------------------------------

describe("a whispered ask with nobody there to read it", () => {
	// `getWhisperRecipients("GM")` lists every user holding the role whether or not they are
	// logged in, so the whisper "sends" to an empty room and the player's screen shows nothing at
	// all — the stated consequence swallowed, which is what firing the counter automatically was
	// for. One public line, and only when there is genuinely no GM here.
	beforeEach(() => { globalThis.game.users = NO_ACTIVE_GM; });

	const waitingCard = () => posted.find(p => String(p.content).includes("Waiting on the GM"));

	it("says out loud that the blow is waiting, when the GM is away", async () => {
		await sufferEnemyAttack(pc, { targets: targeting("conjured ice d12+3 (area) or heat-drain d12+1 (reach)", "d12+3") });

		expect(choiceCard()).toBeTruthy();
		expect(waitingCard()).toBeTruthy();
		// Public: the point is that the table can see it.
		expect(waitingCard().whisper).toBeUndefined();
	});

	it("keeps the blows themselves behind the whisper even so", async () => {
		await sufferEnemyAttack(pc, { targets: targeting("conjured ice d12+3 (area) or heat-drain d12+1 (reach)", "d12+3") });
		// A choice is pending; what there is to choose from is still the GM's to know.
		expect(waitingCard().content).not.toContain("heat-drain");
		expect(waitingCard().content).not.toContain("d12");
	});

	it("says it for the ask-for-a-number card too", async () => {
		await sufferEnemyAttack(pc, { targets: targeting("none", "") });
		expect(amountCard()).toBeTruthy();
		expect(waitingCard()).toBeTruthy();
	});

	it("stays quiet when a GM IS here, so an ordinary counter costs chat one card", async () => {
		globalThis.game.users = { activeGM: { id: "gm1" }, find: () => ({ id: "gm1" }) };
		await sufferEnemyAttack(pc, { targets: targeting("none", "") });
		expect(waitingCard()).toBeUndefined();
		expect(posted).toHaveLength(1);
	});
});

// -- Clash's miss, firing its own counter-attack --------------------------------
//
// "On a 6-, your maneuver fails and you suffer your enemy's attack": a flat consequence with
// nothing in the tier for a player to decide, which is why it no longer waits on a button.

describe("maybeCounterOnMiss", () => {
	const clash = { name: "Clash", system: { moveType: "basic" } };
	const frozen = (targets) => ({ messageFlags: { [SCOPE]: { attack: { targets } } } });

	beforeEach(() => { globalThis.game.user.targets = new Set(); });

	it("strikes back on a miss, off the dice rather than off a click", async () => {
		const targets = targeting("bronze khopesh d10+2 (close)", "d10+2");
		expect(await maybeCounterOnMiss(pc, clash, { total: 5 }, frozen(targets))).toBe(true);
		expect(damageCard().flags[SCOPE].damage.results[0].raw).toBe(9);
	});

	it("leaves a hit alone: its own tier button fires the counter after the damage", async () => {
		const targets = targeting("bronze khopesh d10+2 (close)", "d10+2");
		expect(await maybeCounterOnMiss(pc, clash, { total: 7 }, frozen(targets))).toBe(false);
		expect(await maybeCounterOnMiss(pc, clash, { total: 11 }, frozen(targets))).toBe(false);
		expect(posted).toHaveLength(0);
	});

	it("leaves the other four attack moves alone: their 6- is the GM's move to make", async () => {
		const targets = targeting("bronze khopesh d10+2 (close)", "d10+2");
		for (const name of ["Let Fly", "Ambush", "Call the Shot", "The Hammer and the Book"]) {
			const item = { name, system: { moveType: name === "Let Fly" ? "basic" : "playbook" } };
			expect(await maybeCounterOnMiss(pc, item, { total: 4 }, frozen(targets))).toBe(false);
		}
		expect(posted).toHaveLength(0);
	});

	it("leaves a move that merely shares a PLAYBOOK move's name alone", async () => {
		// A move a world wrote (the custom-move flag) that happens to be called Ambush is the move
		// they wrote — the same rule attackMoveFor applies everywhere else in this flow. Clash
		// needs no such guard: nothing but Clash is called Clash.
		const targets = targeting("bronze khopesh d10+2 (close)", "d10+2");
		const theirs = { name: "Ambush", system: { moveType: "other" }, flags: { "stonetop-pwd": { custom: true } } };
		expect(await maybeCounterOnMiss(pc, theirs, { total: 4 }, frozen(targets))).toBe(false);
	});

	it("ignores a roll that never landed", async () => {
		expect(await maybeCounterOnMiss(pc, clash, null, frozen([]))).toBe(false);
		expect(await maybeCounterOnMiss(pc, clash, { total: undefined }, frozen([]))).toBe(false);
		expect(posted).toHaveLength(0);
	});

	it("honours a foe targeted only after the dice landed", async () => {
		// The same latitude the tier Confirm allowed: this runs on the attacker's own client,
		// where game.user.targets is theirs.
		targeting("bronze khopesh d10+2 (close)", "d10+2");
		globalThis.game.user.targets = new Set([
			{ document: { uuid: "Scene.s.Token.t", disposition: -1 }, actor: { name: "Rime Lord", id: "r" }, name: "Rime Lord" },
		]);
		expect(await maybeCounterOnMiss(pc, clash, { total: 3 }, frozen([]))).toBe(true);
		expect(damageCard().flags[SCOPE].damage.move).toBe("Rime Lord's attack");
	});

	it("latches the blow on its card, so a 6- lifted onto a 7-9 is not struck twice", async () => {
		const targets = targeting("bronze khopesh d10+2 (close)", "d10+2");
		const message = makeMessage({ attack: { moveKey: "clash", targets } });
		expect(await maybeCounterOnMiss(pc, clash, { total: 6 }, frozen(targets), { message })).toBe(true);
		expect(message.flags.attack.countered).toBe(true);
		// Burn Brightly makes it a 7: the 7-9 Confirm's own counter is already paid.
		expect(tierCounters(message.flags.attack, { button: true })).toBe(false);
		expect(tierCounters({ moveKey: "clash" }, { button: true })).toBe(true);
		expect(tierCounters({ moveKey: "clash" }, { button: true, dancing: true })).toBe(false);
	});
});

describe("a blow whose dice come to less than nothing", () => {
	it("shows 0 on the card and keeps the true sum on its flag", async () => {
		globalThis.Roll = class {
			constructor(formula) { this.formula = formula; }
			async evaluate() { this.total = -1; this.dice = []; return this; }
		};
		await sufferEnemyAttack(pc, { targets: targeting("nip d4-2 (hand)", "d4-2") });
		expect(damageCard().flags[SCOPE].damage.results[0].raw).toBe(-1);
		expect(damageCard().content).toContain('stonetop-roll-result-number">0<');
		expect(damageCard().content).not.toContain(">-1<");
	});
});

describe("the targeted damage card follows the roller's chat mode", () => {
	it("is whispered on a blind roll, as the no-target card already was", async () => {
		globalThis.game.settings = { get: (scope, key) => (key === "rollMode" ? "blindroll" : "roll") };
		globalThis.ChatMessage.applyRollMode = vi.fn((data, mode) => {
			if (mode === "blindroll") Object.assign(data, { whisper: ["gm1"], blind: true });
		});
		await sufferEnemyAttack(pc, { targets: targeting("bronze khopesh d10+2 (close)", "d10+2") });
		expect(globalThis.ChatMessage.applyRollMode).toHaveBeenCalledWith(expect.anything(), "blindroll");
		expect(damageCard()).toMatchObject({ whisper: ["gm1"], blind: true });
	});
});

describe("reconcileClashCounter: a rewritten Clash total", () => {
	it("strikes the counter-attack when a hit is shifted down onto a 6-, once", async () => {
		const targets = targeting("bronze khopesh d10+2 (close)", "d10+2");
		const message = makeMessage({ attack: { moveKey: "clash", targets } });
		expect(await reconcileClashCounter(message, pc, 5)).toBe(true);
		expect(damageCard()).toBeTruthy();
		expect(message.flags.attack.countered).toBe(true);
		expect(await reconcileClashCounter(message, pc, 4)).toBe(false);
		expect(posted.filter(p => p.flags?.[SCOPE]?.damage)).toHaveLength(1);
	});

	it("does nothing for a hit, a card already countered, or another attack move", async () => {
		const targets = targeting("bronze khopesh d10+2 (close)", "d10+2");
		expect(await reconcileClashCounter(makeMessage({ attack: { moveKey: "clash", targets } }), pc, 8)).toBe(false);
		expect(await reconcileClashCounter(makeMessage({ attack: { moveKey: "clash", targets, countered: true } }), pc, 5)).toBe(false);
		expect(await reconcileClashCounter(makeMessage({ attack: { moveKey: "let-fly", targets } }), pc, 5)).toBe(false);
		expect(posted).toHaveLength(0);
	});
});

// Wave 3 RAW re-check RA-2: Clash's 10+ "pick 1: Avoid, prevent, or counter your enemy's attack" (Book I
// p.214). A 6- whose counter-attack was already struck, lifted onto a 10+ that avoids it, leaves that blow
// on the log: its "Take this damage" stands down (never applied, never deleted), and comes back when a
// rewrite moves the card onto a tier that suffers the attack again.
describe("a counter-attack the 10+ avoided", () => {
	const { counterAvoided, registerCounterAvoidedHooks, wireApplyDamage, AVOIDS_BY_PICK, AVOIDS_BY_DANCE } = attackFlow;
	const clash = { name: "Clash", system: { moveType: "basic" } };

	it("is posted naming the Clash card it answers", async () => {
		const targets = targeting("bronze khopesh d10+2 (close)", "d10+2");
		const message = makeMessage({ attack: { moveKey: "clash", targets } });
		await maybeCounterOnMiss(pc, clash, { total: 5 }, { messageFlags: { [SCOPE]: { attack: { targets } } } }, { message });
		expect(damageCard().flags[SCOPE].damage.counterOf).toBe("msg1");
	});

	it("carries the Clash card through the GM's 'Which attack?' and 'Name the damage' cards", async () => {
		const targets = targetingResolvable("rusty sword d8+2 (close) or crushing grip (grabby)", "");
		await sufferEnemyAttack(pc, { targets, counterOf: "msg1" });
		const choice = choiceCard();
		expect(choice.flags[SCOPE].sufferChoice.counterOf).toBe("msg1");
		const ask = makeMessage(choice.flags[SCOPE]);
		await resolveSufferChoice(ask, 1);
		const amount = amountCard();
		expect(amount.flags[SCOPE].sufferAmount.counterOf).toBe("msg1");
		await dealSufferedAmount(makeMessage(amount.flags[SCOPE]), "3");
		expect(damageCard().flags[SCOPE].damage.counterOf).toBe("msg1");
	});

	it("is avoided only while the card stands on the 10+ that avoided it", () => {
		expect(counterAvoided({ countered: true, avoids: true }, "success")).toBe(true);
		expect(counterAvoided({ countered: true, avoids: true }, "partial")).toBe(false);
		expect(counterAvoided({ countered: true, avoids: true }, "failure")).toBe(false);
		expect(counterAvoided({ countered: true }, "success")).toBe(false);
		expect(counterAvoided({ avoids: true }, "success")).toBe(false);
	});

	// A 12+ is a 10+ for the pick (counted-tier.js#outcomeTier): lifted on past 11, the avoid stands.
	it("stays avoided by the pick when the card goes on up to a 12+", () => {
		expect(counterAvoided({ countered: true, avoids: AVOIDS_BY_PICK }, "critical", 12)).toBe(true);
		expect(counterAvoided({ countered: true, avoids: true }, "critical", 13)).toBe(true);
		expect(counterAvoided({ countered: true, avoids: AVOIDS_BY_PICK }, "success", 10)).toBe(true);
	});

	// Battle Dancer: "on a 12+ you deal your damage, avoid your enemy's attack" (the Fox's sheet). The dance's
	// avoid is the 12+'s own, and nothing was picked, so a card shifted down to 10-11 suffers the attack.
	it("is avoided by the dance only while the card stands on the 12+", () => {
		expect(counterAvoided({ countered: true, avoids: AVOIDS_BY_DANCE }, "critical", 12)).toBe(true);
		expect(counterAvoided({ countered: true, avoids: AVOIDS_BY_DANCE }, "critical", 14)).toBe(true);
		expect(counterAvoided({ countered: true, avoids: AVOIDS_BY_DANCE }, "success", 11)).toBe(false);
		expect(counterAvoided({ countered: true, avoids: AVOIDS_BY_DANCE }, "partial", 8)).toBe(false);
	});

	it("keeps a pick's avoid when a rewrite lifts the card from 10 to 12, and drops a dance's at 11", async () => {
		const targets = targeting("bronze khopesh d10+2 (close)", "d10+2");
		const picked = makeMessage({ attack: { moveKey: "clash", targets, countered: true, avoids: AVOIDS_BY_PICK, avoided: true, resolved: true } });
		await reconcileClashCounter(picked, pc, 12);
		expect(picked.flags.attack.avoided).toBe(true);
		const danced = makeMessage({ attack: { moveKey: "clash", targets, countered: true, avoids: AVOIDS_BY_DANCE, avoided: true, resolved: true } });
		await reconcileClashCounter(danced, pc, 11);
		expect(danced.flags.attack.avoided).toBe(false);
		await reconcileClashCounter(danced, pc, 12);
		expect(danced.flags.attack.avoided).toBe(true);
		expect(posted).toHaveLength(0);
	});

	it("is settled by a rewrite that moves the card off the 10+ and back, striking nothing new", async () => {
		const targets = targeting("bronze khopesh d10+2 (close)", "d10+2");
		const message = makeMessage({ attack: { moveKey: "clash", targets, countered: true, avoids: true, avoided: true, resolved: true } });
		expect(await reconcileClashCounter(message, pc, 8)).toBe(false);
		expect(message.flags.attack.avoided).toBe(false);
		expect(await reconcileClashCounter(message, pc, 11)).toBe(false);
		expect(message.flags.attack.avoided).toBe(true);
		expect(posted).toHaveLength(0);
	});

	function applyButton(damage, clashCard) {
		const listeners = [];
		const button = { disabled: false, title: "", innerHTML: "", style: {}, addEventListener: (type, fn) => listeners.push(fn) };
		globalThis.game.messages = { get: id => (id === clashCard?.id ? clashCard : null) };
		globalThis.fromUuidSync = uuid => (uuid === pc.uuid ? pc : null);
		const message = makeMessage({ damage });
		wireApplyDamage(message, { querySelector: sel => (sel === ".stonetop-apply-damage" ? button : null) });
		return { button, listeners };
	}

	it("stands its card's 'Take this damage' down while avoided, and leaves it live otherwise", () => {
		const damage = { selfHarm: true, move: "Rime Lord's attack", counterOf: "clash1", results: [{ uuid: pc.uuid, name: "Pim", raw: 9 }] };
		const avoided = applyButton(damage, { id: "clash1", getFlag: () => ({ countered: true, avoids: true, avoided: true }) });
		expect(avoided.button.disabled).toBe(true);
		expect(avoided.button.innerHTML).toContain("Avoided");
		expect(avoided.listeners).toHaveLength(0);

		const suffered = applyButton(damage, { id: "clash1", getFlag: () => ({ countered: true, avoids: true, avoided: false }) });
		expect(suffered.button.disabled).toBe(false);
		expect(suffered.listeners).toHaveLength(1);
	});

	it("redraws the blow's card on every client when the Clash card's avoid changes", () => {
		let onUpdate = null;
		const was = globalThis.Hooks;
		globalThis.Hooks = { on: (name, fn) => { if (name === "updateChatMessage") onUpdate = fn; } };
		try {
			registerCounterAvoidedHooks();
		} finally {
			globalThis.Hooks = was;
		}
		const blow = { logged: true, getFlag: (scope, key) => (key === "damage" ? { counterOf: "clash1" } : undefined) };
		const other = { logged: true, getFlag: () => undefined };
		globalThis.game.messages = [blow, other];
		globalThis.ui.chat = { updateMessage: vi.fn() };
		onUpdate({ id: "clash1" }, { flags: { [SCOPE]: { attack: { avoided: true } } } });
		expect(globalThis.ui.chat.updateMessage).toHaveBeenCalledTimes(1);
		expect(globalThis.ui.chat.updateMessage).toHaveBeenCalledWith(blow);
		onUpdate({ id: "clash1" }, { flags: { [SCOPE]: { attack: { resolved: true } } } });
		expect(globalThis.ui.chat.updateMessage).toHaveBeenCalledTimes(1);
	});
});
