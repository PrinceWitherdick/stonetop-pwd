import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
	attackMoveFor, buildTierActions, maybeBeginAttack,
} from "../../module/combat/attack-flow.js";
import { firstOptionList, tierActionsRestateOptions } from "../../module/utils/chat.js";

// The SHIPPED moves, not a paraphrase of them. Every label these controls print is one of the
// move's own printed bullets, word for word, so a test that retyped either side would keep
// passing after a reword had already left the card offering an option the move no longer has.
const packMove = (rel) => JSON.parse(
	fs.readFileSync(path.resolve("packs/src/stonetop-items", rel), "utf8")).system;

const AMBUSH   = packMove("playbook-moves/the-fox/ambush.json");
const CALL     = packMove("playbook-moves/the-ranger/call-the-shot.json");
const HAMMER   = packMove("playbook-moves/the-judge/the-hammer-and-the-book.json");

// The labels a tier's controls print, and the bullets the move prints — compared as text, the
// way the card itself compares them (utils/chat.js#tierActionsRestateOptions).
const labelsOf = (html) =>
	Array.from(String(html).matchAll(/<span class="stonetop-attack-pick-label">([\s\S]*?)<\/span>/g))
		.map(([, label]) => label.replace(/&#x27;/g, "'"));
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

describe("Ambush's tier controls", () => {
	const actions = buildTierActions(attackMoveFor(item("Ambush")), null);

	it("offers the one bullet that changes the number, on both hit tiers", () => {
		expect(labelsOf(actions.success)).toEqual(["Deal +1d4 damage"]);
		expect(labelsOf(actions.partial)).toEqual(["Deal +1d4 damage"]);
	});

	it("labels it with the move's own printed bullet, word for word", () => {
		expect(bulletsOf(AMBUSH.description)).toContain(labelsOf(actions.success)[0]);
	});

	it("carries the 1d4 into the damage roll", () => {
		expect(actions.success).toContain('data-extra-dice="1d4"');
	});

	it("rolls damage and nothing else — Ambush has no counter-attack to suffer", () => {
		expect(actions.success).toContain('data-action="roll"');
		expect(actions.success).not.toContain('data-action="suffer"');
		// 6- is "the GM makes a move": nothing for the player to enact, so no button at all.
		expect(actions.failure).toBeUndefined();
	});

	it("keeps the tickable list, because three of its four bullets are only printed there", () => {
		// "Slip away before they can react" has to stay tickable somewhere; the controls cover one
		// bullet of four, so the description's checklist is still the only place the rest live.
		expect(tierActionsRestateOptions(actions, AMBUSH.description)).toBe(false);
	});
});

describe("Call the Shot's tier controls", () => {
	const actions = buildTierActions(attackMoveFor(item("Call the Shot")), null);

	it("offers its one mechanical bullet as ONE box", () => {
		// Not two. The bullet is a single pick whose effect is "your call", and splitting it would
		// let a 7-9 "pick 1" quietly take both halves.
		expect(labelsOf(actions.success)).toEqual(["Ignore armor or deal +1d4 damage (your call)"]);
		expect(bulletsOf(CALL.description)).toContain(labelsOf(actions.success)[0]);
	});

	it("carries no dice of its own — which half applies is asked when the box is ticked", () => {
		expect(actions.success).not.toContain("data-extra-dice");
		expect(actions.success).toContain('data-addon="your-call"');
	});

	it("keeps the tickable list for the three bullets it doesn't restate", () => {
		expect(tierActionsRestateOptions(actions, CALL.description)).toBe(false);
	});
});

describe("The Hammer and the Book's tier controls", () => {
	const actions = buildTierActions(attackMoveFor(item("The Hammer and the Book")), null);

	it("offers both mechanical bullets, word for word", () => {
		expect(labelsOf(actions.success)).toEqual([
			"Deal +1d6 damage",
			"Ignore the thing's armor or other defenses",
		]);
		for (const label of labelsOf(actions.success)) {
			expect(bulletsOf(HAMMER.description)).toContain(label);
		}
	});

	it("makes them a radio pair, because the move says choose 1", () => {
		expect(actions.success.match(/type="radio"/g)).toHaveLength(2);
		expect(actions.success).toContain('name="hammer-pick"');
	});

	it("starts with neither selected, so a Judge taking a fictional pick gets plain damage", () => {
		// A pre-checked default would apply +1d6 to a Judge who chose "force it from its host".
		expect(actions.success).not.toContain(" checked");
	});

	it("puts the dice on one and the armor-ignoring on the other", () => {
		expect(actions.success).toContain('data-extra-dice="1d6"');
		expect(actions.success).toContain('data-ignores-armor="1"');
	});

	it("keeps the tickable list for the two bullets that are pure fiction", () => {
		expect(tierActionsRestateOptions(actions, HAMMER.description)).toBe(false);
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
		expect(begun.tierActions.success).toContain("Deal +1d4 damage");
	});

	it("aborts when the deal-or-roll window is closed rather than answered", async () => {
		restoreDialog = stubDialog("nothing-was-clicked");

		// "cancel", not a card: closing the first question must not commit the Fox to an attack,
		// and the caller uses this answer to hold back the Readiness it would otherwise shed.
		expect(await maybeBeginAttack(fox("Ambush"), item("Ambush"), { stat: "dex" })).toBe("cancel");
	});
});
