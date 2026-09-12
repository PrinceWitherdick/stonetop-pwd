import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { readOptionDamage } from "../../module/utils/damage.js";
import { rollOptionDamage, wireApplyDamage } from "../../module/combat/attack-flow.js";
import { firstOptionList } from "../../module/utils/chat.js";

// The SHIPPED moves, not a paraphrase of them. Everything this feature does is decided by a
// move's own printed words, so a test that retyped either side would keep passing after a
// reword had already left a bullet with no button (or a button on a bullet that never asked
// for one). Same rule, and the same reader, as tests/combat/attack-damage-moves.test.js.
const packDescription = (rel) => JSON.parse(
	fs.readFileSync(path.resolve("packs/src", rel), "utf8")).system.description;

const bulletsOf = (description) => firstOptionList(description)?.items ?? [];

const DANUS_GRASP = packDescription("stonetop-items/playbook-moves/the-blessed/danus-grasp.json");
const CLASH       = packDescription("stonetop-items/basic-moves/clash.json");
const LET_FLY     = packDescription("stonetop-items/basic-moves/let-fly.json");
const AMBUSH      = packDescription("stonetop-items/playbook-moves/the-fox/ambush.json");
const CALL        = packDescription("stonetop-items/playbook-moves/the-ranger/call-the-shot.json");
const HAMMER      = packDescription("stonetop-items/playbook-moves/the-judge/the-hammer-and-the-book.json");
const FORAGE      = packDescription("stonetop-items/expedition-moves/forage.json");

describe("readOptionDamage: the bullets that owe a damage roll", () => {
	it("reads Danu's Grasp's own second bullet, armor clause and all", () => {
		const bullets = bulletsOf(DANUS_GRASP).map(readOptionDamage);
		// The first is "they're restrained": fiction, no number, no button.
		expect(bullets[0]).toBeNull();
		expect(bullets[1]).toMatchObject({ formula: "2d4", isRoll: true, ignoresArmor: true, self: false });
	});

	it("leaves every attack move's bullets alone, because the Confirm already folds them in", () => {
		// Clash's "1d6 extra damage", Ambush's and Call the Shot's "+1d4", the Hammer and the
		// Book's "+1d6": every one of those rides the damage roll the card's one button makes
		// (attack-flow.js#PICK_EFFECTS). A second button beside the bullet would be the same
		// choice acted on twice, which is the miscount the one-list rule exists to prevent.
		for (const description of [CLASH, LET_FLY, AMBUSH, CALL, HAMMER]) {
			const bullets = bulletsOf(description);
			expect(bullets.length).toBeGreaterThan(0);
			expect(bullets.map(readOptionDamage)).toEqual(bullets.map(() => null));
		}
	});

	it("leaves Forage's provisions alone: a different button already owes that die", () => {
		expect(bulletsOf(FORAGE).map(readOptionDamage).filter(Boolean)).toEqual([]);
	});

	it("refuses a stat line that merely names a damage die", () => {
		// The Ring of Daagon's summoning table. Nobody is striking anybody here, and a button
		// offering to roll the horde's d6 would be this card acting for a monster.
		expect(readOptionDamage("No. Appearing: 1 = horde (2d6, HP 3, d6 damage); 4 = solitary (HP 12, d10 damage)")).toBeNull();
		expect(readOptionDamage("Size: 1 = small (-2 HP, -2 damage, hand); 4 = large (+4 HP, +1 damage, close, reach)")).toBeNull();
		expect(readOptionDamage("Replace the slow tag with the warrior tag, and its damage becomes 1d10+5")).toBeNull();
	});

	it("tells who takes it apart from who deals it", () => {
		expect(readOptionDamage("They take 2d4 damage (ignores armor)").self).toBe(false);
		expect(readOptionDamage("Hurt yourself (1d4 damage, ignores armor) and immediately regain control").self).toBe(true);
		// A "they" beats a "you" in the same sentence: a move's trigger is written at the reader,
		// and the bullet is still aimed at the foe.
		expect(readOptionDamage("You bind them and they take 2d4 damage").self).toBe(false);
	});

	it("carries the armor and fiction clauses the books print beside the number", () => {
		const lava = readOptionDamage("They take d10+2 damage (grabby, messy, 3 piercing)");
		expect(lava).toMatchObject({ formula: "1d10+2", piercing: 3, ignoresArmor: false });
		// Every fiction tag on the line, not just the two the damage card used to remind about:
		// being grabbed is as much a consequence of this blow as being torn up by it, and the
		// card prints both (combat/attack-flow.js#tagNoticesHtml). `3 piercing` is NOT among
		// them — it rides the number and the card's fine print already says it.
		//
		// In FICTION_DAMAGE_TAGS order rather than the line's, which is what makes a move's
		// printed bullet and a stat block's damage line grow the same notes in the same sequence:
		// both are read by utils/damage.js#fictionTagsIn, and this line prints them the other way
		// round from the way that list declares them.
		expect(lava.tags).toEqual(["messy", "grabby"]);
	});

	// FOUR OF THE SIX ARE ORDINARY ENGLISH WORDS, which is new: the scan was `messy|forceful` and
	// could afford a whole sentence, and `crude`, `reload`, `dangerous` and `grabby` cannot. A
	// bullet is prose, so the tags are read only where a tag is SAID — inside the parenthetical,
	// the same place a stat block prints them.
	it("reads the tags off the parenthetical, not off the sentence around it", () => {
		const said = readOptionDamage("They take 2d4 damage (messy, dangerous)");
		expect(said.tags).toEqual(["messy", "dangerous"]);

		const merelyUsed = readOptionDamage("They take 2d4 damage and are left in a dangerous position");
		expect(merelyUsed.tags).toEqual([]);
	});

	it("does not read a treasure's own tags onto the damage its description rolls", () => {
		// Bright-sticks in shape: the ITEM is tagged `fragile, dangerous, Value 1`, and the flare
		// it describes deals `d8 damage (messy)`. Only the blast's tag belongs on the damage card
		// — the item's `dangerous` describes carrying the box, not being burned by one.
		const brightSticks = readOptionDamage(
			"Bright-sticks (fragile, dangerous, Value 1): snap one and whoever holds it takes d8 damage (messy).");
		expect(brightSticks.tags).toEqual(["messy"]);
	});

	it("says when there is no die to throw", () => {
		expect(readOptionDamage("They take 3 damage")).toMatchObject({ formula: "3", isRoll: false });
		expect(readOptionDamage("")).toBeNull();
		expect(readOptionDamage(null)).toBeNull();
	});
});

// -- Rolling it onto the shared damage card -----------------------------------

const SCOPE = "stonetop-pwd";

let created;
const actor = { name: "Pim", id: "pim", uuid: "Actor.pim", type: "character", system: {} };

beforeEach(() => {
	created = [];
	globalThis.Roll = class {
		constructor(formula) { this.formula = formula; }
		async evaluate() { this.total = 6; this.dice = []; return this; }
		async toMessage(data) { created.push({ ...data, content: data.flavor }); return data; }
	};
	globalThis.CONST = { TOKEN_DISPOSITIONS: { FRIENDLY: 1, NEUTRAL: 0, HOSTILE: -1 } };
	globalThis.ChatMessage = {
		create: vi.fn(async (data) => { created.push(data); return data; }),
		getSpeaker: () => ({ alias: "Pim" }),
	};
	globalThis.game = { ...globalThis.game, user: { isGM: false, targets: new Set() }, settings: { get: () => "roll" } };
});

afterEach(() => {
	delete globalThis.Roll;
	delete globalThis.ChatMessage;
	delete globalThis.CONST;
});

const cardFlag = () => created.at(-1)?.flags?.[SCOPE]?.damage;

describe("rollOptionDamage: the card a printed option's damage lands on", () => {
	it("aims a they-take option at the targeted foes and offers the GM's Apply", async () => {
		globalThis.game.user.targets = new Set([
			{ document: { uuid: "Scene.s.Token.t", disposition: -1 }, actor: { name: "Coedwaig", id: "c" }, name: "Coedwaig" },
		]);
		const results = await rollOptionDamage(actor, {
			move: "Danu's Grasp",
			damage: readOptionDamage("They take 2d4 damage (ignores armor)"),
		});

		expect(results.map(r => r.raw)).toEqual([6]);
		const flag = cardFlag();
		expect(flag.results[0]).toMatchObject({ uuid: "Scene.s.Token.t", name: "Coedwaig", raw: 6 });
		// The armor clause travels ON the weapon record, because that is the one thing Apply reads.
		expect(flag.weapon).toMatchObject({ ignoresArmor: true });
		expect(flag.selfHarm).toBe(false);
		expect(created.at(-1).content).toContain("Apply damage");
	});

	it("aims a take-2d4 option at the character who picked it, and names the button for them", async () => {
		const results = await rollOptionDamage(actor, {
			move: "A cracked femur",
			damage: readOptionDamage("Endure as the spirit sucks away your heat, take 2d4 damage (ignores armor) and mark weakened"),
		});

		expect(results.map(r => r.raw)).toEqual([6]);
		const flag = cardFlag();
		expect(flag.results[0]).toMatchObject({ uuid: "Actor.pim", name: "Pim" });
		expect(flag.selfHarm).toBe(true);
		// "Apply damage" on a card aimed at your own character reads as work waiting on the GM.
		expect(created.at(-1).content).toContain("Take this damage");
		expect(created.at(-1).content).not.toContain("Apply damage");
	});

	it("asks no damage window: a move's printed 2d4 is the move's number, not your die", async () => {
		await rollOptionDamage(actor, { move: "Danu's Grasp", damage: readOptionDamage("They take 2d4 damage") });
		// The conditions row is what a window's answer paints. Nothing was added, so it is empty
		// and the formula chip says exactly what the bullet says.
		expect(created.at(-1).content).toContain("2d4");
		expect(created.at(-1).content).not.toContain("stonetop-roll-conditions");
	});
});

// -- Who may press Apply ------------------------------------------------------

function fakeCard({ selfHarm, results, canUserModify }) {
	const flags = { [SCOPE]: { damage: { move: "Danu's Grasp", results, applied: [], selfHarm, weapon: null } } };
	return {
		isOwner: true,
		getFlag: (scope, key) => flags[scope]?.[key],
		setFlag: vi.fn(async () => {}),
		...(canUserModify ? { canUserModify } : {}),
	};
}

function fakeButton() {
	const btn = { disabled: false, style: {}, title: "", innerHTML: "", listeners: [] };
	btn.addEventListener = (_, fn) => btn.listeners.push(fn);
	return { btn, root: { querySelector: () => btn } };
}

describe("wireApplyDamage: a player may take damage aimed at their own character", () => {
	afterEach(() => { delete globalThis.fromUuidSync; });

	it("shows the button to the owner of every pending target", () => {
		globalThis.fromUuidSync = () => ({ documentName: "Actor", isOwner: true });
		const { btn, root } = fakeButton();
		wireApplyDamage(fakeCard({ selfHarm: true, results: [{ uuid: "Actor.pim", name: "Pim", raw: 6 }] }), root);

		expect(btn.style.display).toBeUndefined();
		expect(btn.disabled).toBe(false);
	});

	it("hides it from a player who owns none of them", () => {
		// A monster token: applying its HP is a GM action and stays one.
		globalThis.fromUuidSync = () => ({ actor: { isOwner: false } });
		const { btn, root } = fakeButton();
		wireApplyDamage(fakeCard({ selfHarm: false, results: [{ uuid: "Scene.s.Token.t", name: "Coedwaig", raw: 6 }] }), root);

		expect(btn.style.display).toBe("none");
	});

	it("hides it when only SOME of the targets are theirs", () => {
		// Half a card applied reads as damage dealt when it was not.
		let n = 0;
		globalThis.fromUuidSync = () => (n++ === 0 ? { documentName: "Actor", isOwner: true } : { actor: { isOwner: false } });
		const { btn, root } = fakeButton();
		wireApplyDamage(fakeCard({ selfHarm: false, results: [
			{ uuid: "Actor.pim", name: "Pim", raw: 6 }, { uuid: "Scene.s.Token.t", name: "Coedwaig", raw: 4 },
		] }), root);

		expect(btn.style.display).toBe("none");
	});

	it("survives a uuid whose document is gone", () => {
		globalThis.fromUuidSync = () => { throw new Error("no such document"); };
		const { btn, root } = fakeButton();
		expect(() => wireApplyDamage(
			fakeCard({ selfHarm: true, results: [{ uuid: "Actor.gone", name: "Pim", raw: 6 }] }), root)).not.toThrow();
		expect(btn.style.display).toBe("none");
	});
});

// -- ...and which ONE of them presses it ---------------------------------------
//
// A self-harm card is live for the player whose character is taking it AND for the primary GM,
// who owns every actor in the world. The `applied` latch does not separate them: it is written
// after the HP writes, so two clicks a round trip apart both read it empty and both subtract.
// Exactly one button may be enabled, and these pin which.

/** A users collection with the three members `electedApplier` and `isPrimaryGM` reach for. */
function fakeUsers(list) {
	const users = list.slice();
	users.players = list.filter(u => !u.isGM);
	users.get = (id) => list.find(u => u.id === id) ?? null;
	users.activeGM = list.find(u => u.isGM && u.active) ?? null;
	return users;
}

/** One damage row aimed at an actor owned by the named users. */
function ownedBy(...userIds) {
	globalThis.fromUuidSync = () => ({
		documentName: "Actor",
		isOwner: true,
		testUserPermission: (user) => userIds.includes(user.id),
	});
	return [{ uuid: "Actor.pim", name: "Pim", raw: 6 }];
}

describe("wireApplyDamage: exactly one live button per card", () => {
	const GM   = { id: "gm",   name: "Vora", isGM: true,  active: true };
	const PIM  = { id: "pim",  name: "Pim",  isGM: false, active: true };
	const ALYS = { id: "alys", name: "Alys", isGM: false, active: true };

	afterEach(() => { delete globalThis.fromUuidSync; });

	it("stands the GM's copy down on a card the owning player is there to take", () => {
		const results = ownedBy("pim");
		globalThis.game = { ...globalThis.game, user: GM, users: fakeUsers([GM, PIM]) };
		const { btn, root } = fakeButton();
		wireApplyDamage(fakeCard({ selfHarm: true, results }), root);

		expect(btn.disabled).toBe(true);
		expect(btn.title).toContain("Pim");
	});

	it("leaves that same card live for the player it belongs to", () => {
		const results = ownedBy("pim");
		globalThis.game = { ...globalThis.game, user: PIM, users: fakeUsers([GM, PIM]) };
		const { btn, root } = fakeButton();
		wireApplyDamage(fakeCard({ selfHarm: true, results }), root);

		expect(btn.disabled).toBe(false);
		expect(btn.style.display).toBeUndefined();
	});

	// A co-owned character: both players own every row, so both buttons would subtract. The
	// lowest user id wins, and every client works that out without talking to any other.
	it("picks one of two co-owners, and the same one on both their screens", () => {
		const results = ownedBy("pim", "alys");
		globalThis.game = { ...globalThis.game, user: PIM, users: fakeUsers([GM, PIM, ALYS]) };
		const forPim = fakeButton();
		wireApplyDamage(fakeCard({ selfHarm: true, results }), forPim.root);

		globalThis.game = { ...globalThis.game, user: ALYS, users: fakeUsers([GM, PIM, ALYS]) };
		const forAlys = fakeButton();
		wireApplyDamage(fakeCard({ selfHarm: true, results }), forAlys.root);

		expect(forPim.btn.disabled).toBe(true);
		expect(forPim.btn.title).toBe("Another player will take this damage");
		expect(forAlys.btn.disabled).toBe(false);
	});

	it("hands the card back to the GM when its player has logged off", () => {
		const results = ownedBy("pim");
		globalThis.game = { ...globalThis.game, user: GM, users: fakeUsers([GM, { ...PIM, active: false }]) };
		const { btn, root } = fakeButton();
		wireApplyDamage(fakeCard({ selfHarm: true, results }), root);

		expect(btn.disabled).toBe(false);
	});

	// A card the GM authored and a character the PLAYER owns: the incoming attack a "Which
	// attack?" pick posts. Electing the player on ownership alone disabled the GM's button AND
	// handed the live one to somebody whose latch the message would refuse — two dead buttons on
	// a card somebody has to press.
	it("keeps a GM-authored card the GM's, even when the player owns the character", () => {
		const results = ownedBy("pim");
		globalThis.game = { ...globalThis.game, user: GM, users: fakeUsers([GM, PIM]) };
		const { btn, root } = fakeButton();
		wireApplyDamage(fakeCard({
			selfHarm: true, results, canUserModify: (user) => user.isGM === true,
		}), root);

		expect(btn.disabled).toBe(false);
	});

	it("leaves damage dealt to a foe the GM's, as it always was", () => {
		globalThis.fromUuidSync = () => ({ actor: { isOwner: false, testUserPermission: () => false } });
		globalThis.game = { ...globalThis.game, user: GM, users: fakeUsers([GM, PIM]) };
		const { btn, root } = fakeButton();
		wireApplyDamage(fakeCard({
			selfHarm: false, results: [{ uuid: "Scene.s.Token.t", name: "Coedwaig", raw: 6 }],
		}), root);

		expect(btn.disabled).toBe(false);
	});
});
