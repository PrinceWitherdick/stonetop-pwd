import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
	attackMoveFor, buildTierActions, maybeBeginAttack, pickedEffects,
} from "../../module/combat/attack-flow.js";
import { firstOptionList } from "../../module/utils/chat.js";
import { moveCardBody } from "../../module/utils/move-tiers.js";

// The SHIPPED moves, not a paraphrase of them. Every label these controls print is one of the
// move's own printed bullets, word for word, so a test that retyped either side would keep
// passing after a reword had already left the card offering an option the move no longer has.
const packMove = (rel) => JSON.parse(
	fs.readFileSync(path.resolve("packs/src/stonetop-items", rel), "utf8")).system;

const CLASH    = packMove("basic-moves/clash.json");
const LET_FLY  = packMove("basic-moves/let-fly.json");
const AMBUSH   = packMove("playbook-moves/the-fox/ambush.json");
const CALL     = packMove("playbook-moves/the-ranger/call-the-shot.json");
const HAMMER   = packMove("playbook-moves/the-judge/the-hammer-and-the-book.json");

// The bullets a move prints, read off the SHIPPED text. Every effect the card can apply is
// keyed by one of these (combat/attack-flow.js#PICK_EFFECTS), so the tests ask what the move's
// own words are worth rather than what a retyped copy of them would be.
const bulletsOf = (description) => firstOptionList(description)?.items ?? [];

const item = (name, moveType = "playbook") => ({ type: "move", name, system: { moveType } });

describe("attackMoveFor: which moves deal a character's damage", () => {
	it("takes the two basic attacks and the three playbook moves that also deal your damage", () => {
		expect(attackMoveFor(item("Clash", "basic")).key).toBe("clash");
		expect(attackMoveFor(item("Let Fly", "basic")).key).toBe("let-fly");
		expect(attackMoveFor(item("Ambush")).key).toBe("ambush");
		expect(attackMoveFor(item("Call the Shot")).key).toBe("call-the-shot");
		expect(attackMoveFor(item("The Hammer and the Book")).key).toBe("hammer-and-book");
	});

	it("leaves every other move alone", () => {
		expect(attackMoveFor(item("Cheap Shot"))).toBeNull();
		expect(attackMoveFor(item("Defend", "basic"))).toBeNull();
		expect(attackMoveFor(null)).toBeNull();
	});

	it("lets a move a player wrote under the same name act as itself", () => {
		// A world's own "Ambush" is whatever they wrote; hijacking it into a weapon prompt and a
		// damage card would be this flow deciding what someone else's move means.
		expect(attackMoveFor(item("Ambush", "other"))).toBeNull();
		expect(attackMoveFor(item("Call the Shot", "other"))).toBeNull();
	});

	it("still claims Clash, whatever a world stores it as", () => {
		// The guard is for the playbook names only: nothing but Clash is called Clash, and a world
		// that re-typed it as a custom move still means the basic move.
		expect(attackMoveFor(item("Clash", "other")).key).toBe("clash");
	});
});

// -- The tier's controls: a button, and nothing else --------------------------

// Every one of these tiers used to carry its own row of option controls, and the card therefore
// carried the move's list twice — the printed bullets with their "0/1 options selected", then a
// subset of those same bullets again under the result, with the two counts unable to see each
// other. The options are the printed list now, wherever the move prints them, and a tier adds
// exactly one thing to the card.
describe("what a hit tier puts on the card", () => {
	const ATTACKS = [
		["Clash", "basic"], ["Let Fly", "basic"], ["Ambush", "playbook"],
		["Call the Shot", "playbook"], ["The Hammer and the Book", "playbook"],
	];

	for (const [name, moveType] of ATTACKS) {
		it(`${name}: offers no options of its own, on any tier`, () => {
			const actions = buildTierActions(attackMoveFor(item(name, moveType)));
			for (const html of Object.values(actions)) {
				expect(html).not.toContain("<input");
				expect(html).not.toContain("stonetop-attack-pick");
			}
		});
	}

	it("names the action on every tier, because the options are elsewhere on the card", () => {
		// A bare "Confirm" is unclear on a card whose choice was made up in the move's own text.
		for (const [name, moveType] of ATTACKS) {
			const actions = buildTierActions(attackMoveFor(item(name, moveType)));
			expect(actions.success).toContain("Roll your damage");
			expect(actions.partial).toContain("Roll your damage");
		}
	});

	it("Clash: keeps the two counter-attacks its tiers state unconditionally", () => {
		// The 7-9 suffers the enemy's attack whatever the player picks, and the 6- does nothing
		// else at all. Those are the tier's own numbers, not a pick's — so they stay on the button.
		const clash = buildTierActions(attackMoveFor(item("Clash", "basic")));
		expect(clash.success).toContain('data-counter="0"');
		expect(clash.partial).toContain('data-counter="1"');
		expect(clash.failure).toContain('data-action="suffer"');
	});

	it("the other four have nothing to suffer, and no button on a miss", () => {
		for (const [name, moveType] of ATTACKS.slice(1)) {
			const actions = buildTierActions(attackMoveFor(item(name, moveType)));
			expect(actions.success).toContain('data-action="roll"');
			expect(actions.success).not.toContain('data-action="suffer"');
			// 6- is "the GM makes a move" (or, for Let Fly, nothing automatic): no button at all.
			expect(actions.failure).toBeUndefined();
		}
	});
});

// -- What ticking a printed bullet DOES ---------------------------------------

// Read against the SHIPPED bullets, never a retyped copy of them: PICK_EFFECTS is keyed by the
// move's own words, so a reword in the pack that left a stale key behind would show up here as an
// effect that stopped arriving — which is the whole reason to ask the question this way round.
describe("pickedEffects: the move's own bullets, and what each one is worth", () => {
	const effectsOfWholeList = (key, description) => pickedEffects(key, bulletsOf(description));

	it("Clash: strike-hard carries the 1d6 and the counter-attack; avoiding carries neither", () => {
		expect(pickedEffects("clash", [bulletsOf(CLASH.description)[0]]))
			.toEqual({ extraDice: [], counter: false, ignoresArmor: false, addons: [] });
		expect(pickedEffects("clash", [bulletsOf(CLASH.description)[1]]))
			.toEqual({ extraDice: ["1d6"], counter: true, ignoresArmor: false, addons: [] });
	});

	it("Ambush: one bullet of four changes a number, and the other three are fiction", () => {
		expect(effectsOfWholeList("ambush", AMBUSH.description))
			.toEqual({ extraDice: ["1d4"], counter: false, ignoresArmor: false, addons: [] });
	});

	it("Call the Shot: one bullet asks a question, one calls the roll off, two are fiction", () => {
		expect(effectsOfWholeList("call-the-shot", CALL.description))
			.toEqual({ extraDice: [], counter: false, ignoresArmor: false, addons: ["your-call", "no-harm"] });
	});

	it("Call the Shot's 'your call' is ONE pick, not two halves", () => {
		// Split into an ignore-armor option and a +1d4 option, a 7-9 "pick 1" could take both.
		// It carries no dice of its own; which half applies is asked when the box is ticked.
		const fx = pickedEffects("call-the-shot", [bulletsOf(CALL.description)[0]]);
		expect(fx.addons).toEqual(["your-call"]);
		expect(fx.extraDice).toEqual([]);
		expect(fx.ignoresArmor).toBe(false);
	});

	it("The Hammer and the Book: the dice on one bullet, the armor-ignoring on another", () => {
		expect(effectsOfWholeList("hammer-and-book", HAMMER.description))
			.toEqual({ extraDice: ["1d6"], counter: false, ignoresArmor: true, addons: [] });
	});

	it("Let Fly: only 'deplete your ammo' spends anything", () => {
		expect(effectsOfWholeList("let-fly", LET_FLY.description))
			.toEqual({ extraDice: [], counter: false, ignoresArmor: false, addons: ["deplete"] });
	});

	it("is not fooled by the apostrophe, whichever way each side spells it", () => {
		// The pack writes a typographic apostrophe and the table an ASCII one; a bullet read back
		// off rendered HTML carries a numeric entity. utils/chat.js#optionKey settles all three.
		expect(pickedEffects("hammer-and-book", ["Ignore the thing&#x27;s armor or other defenses"]).ignoresArmor).toBe(true);
		expect(pickedEffects("hammer-and-book", ["Ignore the thing’s armor or other defenses"]).ignoresArmor).toBe(true);
	});

	it("gives a reworded bullet nothing, rather than an effect its text no longer describes", () => {
		expect(pickedEffects("ambush", ["Deal +1d4 damage to everyone nearby"]).extraDice).toEqual([]);
		expect(pickedEffects("ambush", []).extraDice).toEqual([]);
	});

	it("gives a move with no table nothing at all", () => {
		expect(pickedEffects("defend", ["Deal +1d4 damage"]))
			.toEqual({ extraDice: [], counter: false, ignoresArmor: false, addons: [] });
	});
});

// -- The card body the move goes out on ---------------------------------------

// The gold standard is All is Illuminated: the ladder, the move's own bullets as boxes, the tally
// over them, the result. Every attack move reads that way now — the tier controls are one button,
// so nothing suppresses the printed list any more.
describe("the printed list stays on every attack card", () => {
	const CARDS = [
		["Clash", CLASH, { success: 1 }],
		["Let Fly", LET_FLY, { partial: 1 }],
		["Ambush", AMBUSH, { success: 2, partial: 1 }],
		["Call the Shot", CALL, { success: 2, partial: 1 }],
		["The Hammer and the Book", HAMMER, { success: 1, partial: 1 }],
	];

	for (const [name, move, caps] of CARDS) {
		it(`${name}: keeps its bullets tickable, with the count the prose states`, () => {
			const body = moveCardBody(move.description, move.moveResults, { pickable: true });
			expect(body).toContain("stonetop-picklist");
			for (const [tier, n] of Object.entries(caps)) {
				expect(body).toContain(`data-pick-max-${tier}="${n}"`);
			}
			// One list, so one set of boxes: as many as the move prints, and no more.
			expect(body.match(/stonetop-picklist-check/g)).toHaveLength(bulletsOf(move.description).length);
		});
	}

	it("Clash's 7-9 does not reach the list, so its boxes hide on a weak hit", () => {
		// "Your maneuver works, mostly (deal your damage), but you suffer your enemy's attack" —
		// no pick at all. utils/move-picks.js#pickTiersFrom is what says so.
		const body = moveCardBody(CLASH.description, CLASH.moveResults, { pickable: true });
		expect(body).toContain('data-pick-tiers="success"');
	});

	it("still hangs the list UNDER the ladder that sends the reader to it", () => {
		const body = moveCardBody(CLASH.description, CLASH.moveResults, { pickable: true });
		expect(body.indexOf("stonetop-move-tiers")).toBeLessThan(body.indexOf("Avoid, prevent"));
	});
});

// -- The card the roll goes out on --------------------------------------------

// A Dialog that answers with one named button and never renders. `promptUnrolledDamage` is the
// only window on the path below; the weapon prompt resolves without one when a single weapon fits.
// A name no button carries stands for the window being dismissed, which is the `close` handler —
// the same route a real Escape takes, and the only one that produces "cancel".
function stubDialog(answer) {
	const prior = globalThis.Dialog;
	globalThis.Dialog = class {
		constructor({ buttons, close }) { this._buttons = buttons; this._close = close; }
		render() {
			if (this._buttons[answer]) this._buttons[answer].callback?.();
			else this._close?.();
			return this;
		}
	};
	return () => { globalThis.Dialog = prior; };
}

let restoreDialog = null;
afterEach(() => { restoreDialog?.(); restoreDialog = null; });

// A Fox with one knife ticked: exactly one weapon fits Ambush, so the weapon prompt has nothing
// to ask and the flow runs through to the card without a second window.
const fox = (...moves) => ({
	uuid: "Actor.fox",
	items: moves.map(name => ({ type: "move", name, system: { moveType: "playbook" } })),
	getFlag: (_scope, key) => (key === "inventory.checked" ? { "knife-dagger": true } : {}),
});

describe("maybeBeginAttack: Ambush", () => {
	it("bakes the weapon, the targets and the move's key onto the roll card", async () => {
		restoreDialog = stubDialog("roll");

		const begun = await maybeBeginAttack(fox("Ambush"), item("Ambush"), { stat: "dex" });

		const attack = begun.messageFlags["stonetop-pwd"].attack;
		expect(attack.move).toBe("Ambush");
		// `moveKey` is what the Confirm reads back to know Cheap Shot rides this roll.
		expect(attack.moveKey).toBe("ambush");
		expect(attack.weapon.name).toBe("Knife or dagger");
		expect(attack.targets).toEqual([]);
		expect(begun.tierActions.success).toContain('data-action="roll"');
	});

	it("aborts when the deal-or-roll window is closed rather than answered", async () => {
		restoreDialog = stubDialog("nothing-was-clicked");

		// "cancel", not a card: closing the first question must not commit the Fox to an attack,
		// and the caller uses this answer to hold back the Readiness it would otherwise shed.
		expect(await maybeBeginAttack(fox("Ambush"), item("Ambush"), { stat: "dex" })).toBe("cancel");
	});
});
