import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Window } from "happy-dom";
import {
	boostOffers, takeBoost, handleBoostQuery, boostNote, actsForHelper, isBoostableRoll, wireRollBoosts,
	deathsDoorAwaitsPlusOnes, deathsDoorPlusOnes, onUpdateActorDoorPlusOnes,
	blessingHeld, holdBlessing, shareBlessing, handleBlessingQuery,
	BOOSTS_FLAG, BLESSING_FLAG, BLESSING_QUERY, CHRONICLER, COMMUNE_WITH_ARATIS, MANY_HANDS, PIETY,
} from "../../../module/actors/character/roll-boosts.js";
import { ZERO_HP_MOVES } from "../../../module/actors/character/deaths-door.js";
import { rollCardRoute } from "../../../module/utils/roll-card-writer.js";
import { buildLiveCharacter, sourceMovesFor } from "../../fakes/LiveCharacter.js";
import { createStonetopCharacterSheetClass } from "../../../module/actors/character/StonetopCharacterSheet.js";

// +1 to a roll just made, from its card: Chronicler of Stonetop's Diligence (any PC's roll), the Prophet's
// Sanction (their own roll), Many Hands Make Light Work (another PC's roll, free), and Piety's Blessing
// (the holder's own roll). Once per roll for each helper and source.

// The people picker Piety asks "who worshipped with you?" with, answered by the test.
const picker = vi.hoisted(() => ({ pick: vi.fn(async () => null) }));
vi.mock("../../../module/dialogs/RelationshipLinkDialog.js", async (importOriginal) => ({
	...(await importOriginal()),
	pickPersonOnMap: picker.pick,
}));

const SCOPE = "stonetop-pwd";
const TRACKS = {
	[CHRONICLER]: { max: 3, title: "Diligence" },
	[COMMUNE_WITH_ARATIS]: { max: 2, title: "Sanction" },
	[PIETY]: { max: 1, title: "Blessing" },
};

function pc({ id, name, moves = [], held = {}, unlearned = [], flags = {}, owner = true }) {
	const tracks = { ...held };
	const store = { ...flags };
	return {
		id, uuid: `Actor.${id}`, name, type: "character", isOwner: owner,
		items: moves.map(move => ({
			type: "move", name: move,
			flags: unlearned.includes(move) ? { [SCOPE]: { learned: false } } : {},
			system: TRACKS[move] ? { resource: TRACKS[move] } : {},
		})),
		tracks, store,
		getFlag: (scope, key) => (scope === SCOPE ? store[key] : undefined),
		setFlag: vi.fn(async (scope, key, value) => { store[key] = value; }),
		unsetFlag: vi.fn(async (scope, key) => { delete store[key]; }),
		typedActor: { moveResources: {
			getMoveResources: () => tracks,
			setUses: vi.fn(async (move, value) => { tracks[move] = value; }),
		} },
		testUserPermission: vi.fn((user) => user.isGM || user.id === `u-${id}`),
	};
}

const MOVE_CARD = `<section class="pbta-chat-card stonetop-roll-card"><div class="stonetop-roll-result partial"><span class="stonetop-roll-result-label">Weak Hit</span></div></section>`;
const DAMAGE_CARD = `<section class="pbta-chat-card stonetop-roll-card stonetop-damage-roll-card"><span class="stonetop-roll-result-label"></span></section>`;

function card({ author = "u-fox", flavor = MOVE_CARD, boosts = [], rolls = [{ total: 8, formula: "2d6+1" }] } = {}) {
	const flags = { [SCOPE]: boosts.length ? { [BOOSTS_FLAG]: boosts } : {} };
	const message = {
		id: "msg1", flavor, rolls, flags,
		getFlag: (scope, key) => flags[scope]?.[key],
		canUserModify: user => !!user?.isGM || user?.id === author,
		update: vi.fn(async data => {
			if (data.flavor !== undefined) message.flavor = data.flavor;
			if (data.rolls) message.rolls = data.rolls;
			for (const [scope, values] of Object.entries(data.flags ?? {})) Object.assign(flags[scope] ??= {}, values);
		}),
	};
	return message;
}

const judge = (over = {}) => pc({ id: "judge", name: "Aeron", moves: [CHRONICLER, MANY_HANDS], held: { [CHRONICLER]: 2 }, ...over });
const fox = pc({ id: "fox", name: "Wren" });
const player = id => ({ id: `u-${id}`, isGM: false });
const GM = { id: "u-gm", isGM: true };
// The Judge's player and the GM own the Judge; whether the player is logged in is the test's to say.
const ownersOf = (online = true) => actor => [
	{ id: `u-${actor.id}`, isGM: false, active: online },
	{ id: "u-gm", isGM: true, active: true },
];
const offersFor = ({ message = card(), roller = fox, helpers = [judge()], user = player("judge"), online = true } = {}) =>
	boostOffers({ message, roller, helpers, user, ownersOf: ownersOf(online) }).map(o => `${o.source}:${o.helper.name}`);

describe("who sees which button", () => {
	it("offers the Judge's player Diligence and Many Hands on another PC's roll", () => {
		expect(offersFor()).toEqual(["diligence:Aeron", "manyHands:Aeron"]);
	});

	it("offers Diligence on the Judge's own roll, and never Many Hands there", () => {
		const aeron = judge();
		expect(offersFor({ roller: aeron, helpers: [aeron] })).toEqual(["diligence:Aeron"]);
	});

	it("offers no Diligence with none held, or with Chronicler switched off", () => {
		expect(offersFor({ helpers: [judge({ held: {} })] })).toEqual(["manyHands:Aeron"]);
		expect(offersFor({ helpers: [judge({ unlearned: [CHRONICLER] })] })).toEqual(["manyHands:Aeron"]);
	});

	it("offers Sanction on the Prophet's own roll only, while they hold some", () => {
		const prophet = pc({ id: "judge", name: "Aeron", moves: [COMMUNE_WITH_ARATIS], held: { [COMMUNE_WITH_ARATIS]: 1 } });
		expect(offersFor({ roller: prophet, helpers: [prophet] })).toEqual(["sanction:Aeron"]);
		expect(offersFor({ roller: fox, helpers: [prophet] })).toEqual([]);
		const dry = pc({ id: "judge", name: "Aeron", moves: [COMMUNE_WITH_ARATIS] });
		expect(offersFor({ roller: dry, helpers: [dry] })).toEqual([]);
	});

	it("offers nothing to someone who does not play the helper", () => {
		expect(offersFor({ user: player("fox") })).toEqual([]);
	});

	it("leaves the GM out while the Judge's player is online, and stands in when they are not", () => {
		expect(offersFor({ user: GM })).toEqual([]);
		expect(offersFor({ user: GM, online: false })).toEqual(["diligence:Aeron", "manyHands:Aeron"]);
		expect(actsForHelper(GM, [])).toBe(false);
	});

	it("offers nothing on a damage card, a card with no roll, or a roll that is not a character's", () => {
		expect(offersFor({ message: card({ flavor: DAMAGE_CARD }) })).toEqual([]);
		expect(offersFor({ message: card({ rolls: [] }) })).toEqual([]);
		expect(offersFor({ roller: { id: "goblin", type: "monster" } })).toEqual([]);
		expect(isBoostableRoll(card())).toBe(true);
	});

	// PB2-1 (the user's ruling): Death's Door is a roll like any other (Book I p.245), so its card takes the +1s
	// while its window still waits on the tier, which is exactly while the roller's marker names the card.
	describe("Death's Door's card", () => {
		let savedActors;
		let dying;
		const doorCard = () => {
			const message = card();
			message.flags[SCOPE].rolled = { move: ZERO_HP_MOVES.null.name };
			message.speaker = { actor: "fox" };
			message.logged = true;
			return message;
		};
		const marker = (over = {}) => ({ userId: "u-fox", nonce: "n1", messageId: "msg1", total: 8, tier: "partial", ...over });
		beforeEach(() => {
			dying = { ...fox, flags: { [SCOPE]: { deathsDoorRolling: marker() } } };
			savedActors = game.actors;
			game.actors = { get: id => (id === "fox" ? dying : null), contents: [dying] };
		});
		afterEach(() => { game.actors = savedActors; });

		it("takes Diligence and Many Hands while its window waits on the tier", () => {
			const message = doorCard();
			expect(deathsDoorAwaitsPlusOnes(message)).toBe(true);
			expect(isBoostableRoll(message)).toBe(true);
			expect(offersFor({ message, roller: dying })).toEqual(["diligence:Aeron", "manyHands:Aeron"]);
		});

		it("takes nothing once the tier has landed (no marker), on a 10+, or with the marker naming another card", () => {
			const message = doorCard();
			dying.flags[SCOPE] = {};
			expect(isBoostableRoll(message)).toBe(false);
			expect(offersFor({ message, roller: dying })).toEqual([]);
			dying.flags[SCOPE] = { deathsDoorRolling: marker({ tier: "success" }) };
			expect(isBoostableRoll(message)).toBe(false);
			dying.flags[SCOPE] = { deathsDoorRolling: marker({ messageId: "other" }) };
			expect(isBoostableRoll(message)).toBe(false);
			// The window's own word covers the moment before its marker names the card.
			expect(isBoostableRoll(message, SCOPE, { doorOpen: true })).toBe(true);
		});

		it("is open from the moment its card exists: the marker's nonce is the one the card is stamped with", () => {
			const message = doorCard();
			message.flags[SCOPE].deathsDoorRoll = "n1";
			// Claimed, the dice down, the card posted, but the marker not yet naming it.
			dying.flags[SCOPE] = { deathsDoorRolling: marker({ messageId: null, total: null, tier: null }) };
			expect(deathsDoorAwaitsPlusOnes(message)).toBe(true);
			// Another roll's nonce is another roll.
			dying.flags[SCOPE] = { deathsDoorRolling: marker({ messageId: null, nonce: "n2", tier: null }) };
			expect(deathsDoorAwaitsPlusOnes(message)).toBe(false);
		});

		it("is shut on a 10+ from the first, read off the card until the marker has the tier", () => {
			const message = doorCard();
			message.flags[SCOPE].deathsDoorRoll = "n1";
			message.rolls = [{ total: 11, formula: "2d6+2" }];
			dying.flags[SCOPE] = { deathsDoorRolling: marker({ messageId: null, total: null, tier: null }) };
			expect(deathsDoorAwaitsPlusOnes(message)).toBe(false);
		});

		it("keeps drawing the +1s it took once its tier has landed", () => {
			const message = doorCard();
			message.flags[SCOPE][BOOSTS_FLAG] = [{ source: "diligence", by: "Actor.judge", name: "Aeron" }];
			dying.flags[SCOPE] = {};   // landed: the marker is gone
			const html = new Window().document.createElement("div");
			// The card's own Conditions row is where the notes go (drawBoostNotes).
			html.innerHTML = MOVE_CARD.replace("</section>", `<div class="cell--chat"></div></section>`);
			wireRollBoosts(message, html, {}, { user: player("judge") });
			expect(html.querySelectorAll(".stonetop-roll-boost-note")).toHaveLength(1);
			expect(html.querySelector(".stonetop-roll-boost-btn")).toBeNull();
		});

		it("refuses a +1 pressed on a stale button once the tier has landed, and spends nothing", async () => {
			const aeron = judge();
			const message = doorCard();
			dying.flags[SCOPE] = {};
			const deps = { shiftRoll: vi.fn(), cardFlavor: vi.fn(f => f) };
			expect(await takeBoost(message, { source: "diligence", helper: aeron }, deps)).toBe(false);
			expect(aeron.tracks[CHRONICLER]).toBe(2);
			expect(deps.shiftRoll).not.toHaveBeenCalled();
		});

		it("tells the window whether ANYONE could still add one, and which this user presses", () => {
			const message = doorCard();
			dying.flags[SCOPE] = {};   // before the marker names it: the window's own word is enough
			const helpers = [judge()];
			const theirs = deathsDoorPlusOnes(message, dying, { user: player("fox"), helpers, ownersOf: ownersOf() });
			expect(theirs.any).toBe(true);
			expect(theirs.mine).toEqual([]);
			const mine = deathsDoorPlusOnes(message, dying, { user: player("judge"), helpers, ownersOf: ownersOf() });
			expect(mine.mine.map(o => o.source)).toEqual(["diligence", "manyHands"]);
			expect(deathsDoorPlusOnes(message, dying, { user: player("fox"), helpers: [], ownersOf: ownersOf() }).any).toBe(false);
		});

		// The window waits on a +1 only someone connected could press: the Judge's player, or a GM standing in.
		it("does not wait on a helper nobody online can press for", () => {
			const message = doorCard();
			const helpers = [judge()];
			const nobody = actor => [{ id: `u-${actor.id}`, isGM: false, active: false }, { id: "u-gm", isGM: true, active: false }];
			expect(deathsDoorPlusOnes(message, dying, { user: player("fox"), helpers, ownersOf: nobody }).any).toBe(false);
			// A GM online stands in for the absent player (actsForHelper), so the +1 can still be pressed.
			expect(deathsDoorPlusOnes(message, dying, { user: player("fox"), helpers, ownersOf: ownersOf(false) }).any).toBe(true);
		});

		it("redraws that character's Door cards when the marker moves, and nothing else", () => {
			const door = doorCard();
			const other = card();
			other.speaker = { actor: "fox" };
			other.logged = true;
			const undrawn = doorCard();
			undrawn.logged = false;
			const redraw = vi.fn();
			onUpdateActorDoorPlusOnes(dying, { flags: { [SCOPE]: { deathsDoorRolling: marker() } } }, { messages: [other, undrawn, door], redraw });
			expect(redraw.mock.calls.map(c => c[0])).toEqual([door]);
			redraw.mockClear();
			onUpdateActorDoorPlusOnes(dying, { flags: { [SCOPE]: { "-=deathsDoorRolling": null } } }, { messages: [door], redraw });
			expect(redraw).toHaveBeenCalledTimes(1);
			redraw.mockClear();
			onUpdateActorDoorPlusOnes(dying, { system: { attributes: { hp: { value: 0 } } } }, { messages: [door], redraw });
			expect(redraw).not.toHaveBeenCalled();
		});
	});

	// B9: Undying's and Dark Succor's windows apply the tier the dice gave, so a +1 on the card afterwards
	// would relabel it under costs already paid.
	it("offers nothing on an insert's 0-HP move card either", () => {
		for (const slug of ["revenant", "thrall"]) {
			const message = card();
			message.flags[SCOPE].rolled = { move: ZERO_HP_MOVES[slug].name };
			expect(isBoostableRoll(message), slug).toBe(false);
			expect(offersFor({ message }), slug).toEqual([]);
		}
	});

	// Struggle as One bars Many Hands inside it, and a Judge outside it is the GM's +1 on the row.
	it("offers no Many Hands on a Struggle as One roll, and the rest as usual", () => {
		const message = card();
		message.flags[SCOPE].struggleRoll = { id: "s1", row: "pc_fox" };
		expect(offersFor({ message })).toEqual(["diligence:Aeron"]);
	});

	it("hides a source once that helper has used it on this roll, and only that one", () => {
		const message = card({ boosts: [{ source: "diligence", by: "Actor.judge", name: "Aeron" }] });
		expect(offersFor({ message })).toEqual(["manyHands:Aeron"]);
		// A second Judge has their own Diligence to spend on the same roll.
		const other = judge({ id: "judge2", name: "Bryn" });
		expect(offersFor({ message, helpers: [judge(), other], user: player("judge2") })).toEqual(["diligence:Bryn", "manyHands:Bryn"]);
	});
});

describe("taking a +1", () => {
	const deps = () => ({
		shiftRoll: vi.fn(async roll => { roll.total += 1; roll.formula = `${roll.formula} + 1`; }),
		cardFlavor: vi.fn((flavor, total) => `${flavor}<!--${total}-->`),
		afterShift: vi.fn(async () => {}),
	});

	it("spends 1 Diligence, shifts the total by +1, redraws the card, and records who", async () => {
		const aeron = judge();
		const message = card();
		const d = deps();
		expect(await takeBoost(message, { source: "diligence", helper: aeron }, d)).toBe(true);
		expect(aeron.tracks[CHRONICLER]).toBe(1);
		expect(d.shiftRoll).toHaveBeenCalledWith(message.rolls[0], 1);
		expect(message.rolls[0].total).toBe(9);
		expect(message.flavor).toContain("<!--9-->");
		expect(message.getFlag(SCOPE, BOOSTS_FLAG)).toEqual([{ source: "diligence", by: "Actor.judge", name: "Aeron" }]);
		expect(d.afterShift).toHaveBeenCalledWith(message, 9);
		expect(boostNote(message.getFlag(SCOPE, BOOSTS_FLAG)[0])).toBe("+1 Diligence (Aeron)");
	});

	it("refuses a second Diligence from the same Judge on the same roll", async () => {
		const aeron = judge();
		const message = card();
		const d = deps();
		await takeBoost(message, { source: "diligence", helper: aeron }, d);
		expect(await takeBoost(message, { source: "diligence", helper: aeron }, d)).toBe(false);
		expect(aeron.tracks[CHRONICLER]).toBe(1);
		expect(message.rolls[0].total).toBe(9);
	});

	// The pip is spent before the card is written; a write that never lands pays it back.
	it("pays the Diligence back when the +1 never reaches the card", async () => {
		const aeron = judge();
		const message = card();
		message.update = vi.fn(async () => { throw new Error("the card is gone"); });
		await expect(takeBoost(message, { source: "diligence", helper: aeron }, deps())).rejects.toThrow("the card is gone");
		expect(aeron.tracks[CHRONICLER]).toBe(2);
	});

	// But a +1 that landed keeps its spend, though something after the write (the tier effects) threw.
	it("keeps the spend when the +1 landed and what follows it throws", async () => {
		const aeron = judge();
		const message = card();
		const d = { ...deps(), afterShift: vi.fn(async () => { throw new Error("tier effects"); }) };
		await expect(takeBoost(message, { source: "diligence", helper: aeron }, d)).rejects.toThrow("tier effects");
		expect(aeron.tracks[CHRONICLER]).toBe(1);
		expect(message.rolls[0].total).toBe(9);
	});

	it("adds Many Hands for free, and refuses Diligence from an empty track", async () => {
		const aeron = judge({ held: {} });
		const message = card();
		const d = deps();
		expect(await takeBoost(message, { source: "diligence", helper: aeron }, d)).toBe(false);
		expect(await takeBoost(message, { source: "manyHands", helper: aeron }, d)).toBe(true);
		expect(aeron.typedActor.moveResources.setUses).not.toHaveBeenCalled();
		expect(message.rolls[0].total).toBe(9);
		expect(boostNote(message.getFlag(SCOPE, BOOSTS_FLAG)[0])).toBe("+1 Many Hands (Aeron)");
	});
});

describe("whose client writes it", () => {
	// Every player's press goes to the GM's client while a GM is online, their own card's too: two clients
	// writing the same card's `rolls` and list from their own copies would keep only the second +1.
	it("asks the GM for every player's press while a GM is online, and writes its own card with none", () => {
		expect(rollCardRoute(card({ author: "u-judge" }), player("judge"), GM)).toBe("relay");
		expect(rollCardRoute(card({ author: "u-fox" }), player("judge"), GM)).toBe("relay");
		expect(rollCardRoute(card({ author: "u-judge" }), player("judge"), null)).toBe("local");
		expect(rollCardRoute(card({ author: "u-fox" }), player("judge"), null)).toBeNull();
		expect(rollCardRoute(card({ author: "u-fox" }), GM, GM)).toBe("local");
	});

	describe("the GM's side of a relayed press", () => {
		let saved;
		beforeEach(() => {
			saved = { user: globalThis.game.user, users: globalThis.game.users };
			globalThis.game.user = GM;
			globalThis.game.users = { activeGM: GM, get: id => [player("judge"), player("fox")].find(u => u.id === id) ?? null };
		});
		afterEach(() => {
			globalThis.game.user = saved.user;
			globalThis.game.users = saved.users;
		});

		const ask = (message, aeron, userId, source = "diligence") => handleBoostQuery(
			{ messageId: message.id, source, helperUuid: aeron.uuid, userId }, {},
			{
				messages: { get: id => (id === message.id ? message : null) },
				resolve: uuid => (uuid === aeron.uuid ? aeron : null),
				rollerOf: () => fox,
				ownersOf: ownersOf(true),
				shiftRoll: async roll => { roll.total += 1; },
				cardFlavor: flavor => flavor,
			},
		);

		it("adds the +1 for the Judge's player, on the Fox's card", async () => {
			const aeron = judge();
			const message = card({ author: "u-fox" });
			expect(await ask(message, aeron, "u-judge")).toBe(true);
			expect(aeron.tracks[CHRONICLER]).toBe(1);
			expect(message.rolls[0].total).toBe(9);
		});

		it("refuses someone who does not play the Judge, and a source already used", async () => {
			const aeron = judge();
			const message = card({ author: "u-fox" });
			expect(await ask(message, aeron, "u-fox")).toBe(false);
			expect(aeron.tracks[CHRONICLER]).toBe(2);
			expect(await ask(message, aeron, "u-judge")).toBe(true);
			expect(await ask(message, aeron, "u-judge")).toBe(false);
			expect(message.rolls[0].total).toBe(9);
		});
	});
});

// Piety (Lightbearer, Book I p.123): "hold 1 Blessing. Other faithful PCs who partake in this worship also
// hold 1 Blessing. At any time, you can spend 1 Blessing to add +1 to a roll you just made in pursuit of a
// righteous cause." The Lightbearer's is Piety's pip; everyone else's is the `blessing` flag.
describe("Piety's Blessing on a roll card", () => {
	const lightbearer = (over = {}) => pc({ id: "lb", name: "Sol", moves: [PIETY], held: { [PIETY]: 1 }, ...over });
	const blessedFox = (over = {}) => pc({ id: "fox", name: "Wren", flags: { [BLESSING_FLAG]: true }, ...over });
	const deps = () => ({
		shiftRoll: vi.fn(async roll => { roll.total += 1; }),
		cardFlavor: vi.fn(flavor => flavor),
	});

	it("offers the holder's player a Blessing on their own roll, and on nobody else's", () => {
		const wren = blessedFox();
		expect(offersFor({ roller: wren, helpers: [wren], user: player("fox") })).toEqual(["blessing:Wren"]);
		expect(offersFor({ roller: judge(), helpers: [wren], user: player("fox") })).toEqual([]);
		const sol = lightbearer();
		expect(offersFor({ roller: sol, helpers: [sol], user: player("lb") })).toEqual(["blessing:Sol"]);
	});

	it("offers nothing to a PC holding no Blessing, or to a Lightbearer whose Piety is switched off", () => {
		const plain = pc({ id: "fox", name: "Wren" });
		expect(offersFor({ roller: plain, helpers: [plain], user: player("fox") })).toEqual([]);
		const empty = lightbearer({ held: {} });
		expect(offersFor({ roller: empty, helpers: [empty], user: player("lb") })).toEqual([]);
		const off = lightbearer({ unlearned: [PIETY] });
		expect(offersFor({ roller: off, helpers: [off], user: player("lb") })).toEqual([]);
	});

	it("adds +1 and spends the flag, names it on the card, and is gone after", async () => {
		const wren = blessedFox();
		const message = card();
		expect(await takeBoost(message, { source: "blessing", helper: wren }, deps())).toBe(true);
		expect(message.rolls[0].total).toBe(9);
		expect(blessingHeld(wren, SCOPE)).toBe(0);
		expect(wren.unsetFlag).toHaveBeenCalledWith(SCOPE, BLESSING_FLAG);
		expect(boostNote(message.getFlag(SCOPE, BOOSTS_FLAG)[0])).toBe("+1 Blessing (Wren)");
		// Spent: not on this card, and not on the next one either.
		expect(offersFor({ message, roller: wren, helpers: [wren], user: player("fox") })).toEqual([]);
		expect(offersFor({ roller: wren, helpers: [wren], user: player("fox") })).toEqual([]);
		expect(await takeBoost(card(), { source: "blessing", helper: wren }, deps())).toBe(false);
	});

	it("gives the Blessing back when the +1 never reaches the card", async () => {
		const wren = blessedFox();
		const message = card();
		message.update = vi.fn(async () => { throw new Error("the card is gone"); });
		await expect(takeBoost(message, { source: "blessing", helper: wren }, deps())).rejects.toThrow("the card is gone");
		expect(blessingHeld(wren, SCOPE)).toBe(1);
	});

	it("spends the Lightbearer's own Blessing off Piety's pip", async () => {
		const sol = lightbearer();
		expect(await takeBoost(card(), { source: "blessing", helper: sol }, deps())).toBe(true);
		expect(sol.tracks[PIETY]).toBe(0);
	});

	it("never stacks: a second worship holds 1, on the pip or on the flag", async () => {
		const wren = pc({ id: "fox", name: "Wren" });
		expect(await holdBlessing(wren, SCOPE)).toBe(true);
		expect(await holdBlessing(wren, SCOPE)).toBe(false);
		expect(wren.store[BLESSING_FLAG]).toBe(true);
		expect(blessingHeld(wren, SCOPE)).toBe(1);

		const sol = lightbearer({ held: {} });
		expect(await holdBlessing(sol, SCOPE)).toBe(true);
		expect(await holdBlessing(sol, SCOPE)).toBe(false);
		expect(sol.tracks[PIETY]).toBe(1);
		expect(sol.store[BLESSING_FLAG]).toBeUndefined();
	});

	it("writes a Blessing on a PC this client owns, and asks the GM for anyone else", async () => {
		const sol = lightbearer();
		const wren = pc({ id: "fox", name: "Wren" });
		const bryn = pc({ id: "bryn", name: "Bryn", owner: false });
		const gm = { query: vi.fn(async () => ["Actor.bryn"]) };
		const { blessed, missed } = await shareBlessing(sol, [wren, bryn], { scope: SCOPE, gm, userId: "u-lb" });
		expect(wren.store[BLESSING_FLAG]).toBe(true);
		expect(gm.query).toHaveBeenCalledWith(BLESSING_QUERY,
			{ lightbearerUuid: "Actor.lb", targetUuids: ["Actor.bryn"], userId: "u-lb" }, { timeout: 10000 });
		expect(blessed.map(a => a.name)).toEqual(["Wren", "Bryn"]);
		expect(missed).toEqual([]);

		// With no GM online, the unowned character is named as missed and nothing is written.
		const out = await shareBlessing(sol, [bryn], { scope: SCOPE, gm: null });
		expect(out.missed.map(a => a.name)).toEqual(["Bryn"]);
		expect(bryn.setFlag).not.toHaveBeenCalled();
	});

	describe("the GM's side of a relayed Blessing", () => {
		let saved;
		beforeEach(() => {
			saved = { user: globalThis.game.user, users: globalThis.game.users };
			globalThis.game.user = GM;
			globalThis.game.users = { activeGM: GM, get: id => [player("lb"), player("fox")].find(u => u.id === id) ?? null };
		});
		afterEach(() => {
			globalThis.game.user = saved.user;
			globalThis.game.users = saved.users;
		});

		const ask = (sol, targets, userId) => handleBlessingQuery(
			{ lightbearerUuid: sol.uuid, targetUuids: targets.map(t => t.uuid), userId }, {},
			{ resolve: uuid => [sol, ...targets].find(a => a.uuid === uuid) ?? null, scope: SCOPE },
		);

		it("blesses each named PC for the Lightbearer's player, and for nobody else", async () => {
			const sol = lightbearer();
			const bryn = pc({ id: "bryn", name: "Bryn", owner: false });
			expect(await ask(sol, [bryn], "u-fox")).toEqual([]);
			expect(bryn.store[BLESSING_FLAG]).toBeUndefined();
			expect(await ask(sol, [bryn], "u-lb")).toEqual(["Actor.bryn"]);
			expect(bryn.store[BLESSING_FLAG]).toBe(true);
		});

		it("refuses a Lightbearer whose Piety is switched off", async () => {
			const bryn = pc({ id: "bryn", name: "Bryn", owner: false });
			expect(await ask(lightbearer({ unlearned: [PIETY] }), [bryn], "u-lb")).toEqual([]);
			expect(bryn.store[BLESSING_FLAG]).toBeUndefined();
		});
	});
});

// Using Piety from the sheet, through a real StonetopCharacter with the move as the pack ships it.
describe("using Piety", () => {
	let saved;
	beforeEach(() => {
		saved = { actors: globalThis.game.actors, users: globalThis.game.users };
		picker.pick.mockReset();
	});
	afterEach(() => {
		globalThis.game.actors = saved.actors;
		globalThis.game.users = saved.users;
	});

	async function lightbearerSheet({ learned = true } = {}) {
		const { char, actor } = buildLiveCharacter({ slug: "the-lightbearer", name: "The Lightbearer", seedStartingMoves: false });
		Object.assign(actor, { id: "lb", uuid: "Actor.lb" });
		await char.addMove(sourceMovesFor("The Lightbearer").find(d => d.name === PIETY)._id);
		if (!learned) actor.items.find(i => i.name === PIETY).flags = { [SCOPE]: { learned: false } };
		actor.typedActor = char;
		const Base = class {
			get actor() { return actor; }
			get isEditable() { return true; }
			async getData() { return {}; }
			activateListeners() {}
			render = vi.fn();
		};
		const sheet = new (createStonetopCharacterSheetClass(Base))();
		return { sheet, actor, char };
	}
	const pietyItem = actor => actor.items.find(i => i.name === PIETY);

	it("holds the Lightbearer's Blessing on the pip, and one for each PC picked as taking part", async () => {
		const { sheet, actor, char } = await lightbearerSheet();
		expect(pietyItem(actor).system.resource).toEqual({ max: 1, title: "Blessing" });
		const wren = pc({ id: "fox", name: "Wren" });
		const bryn = pc({ id: "bryn", name: "Bryn", owner: false });
		const aeron = pc({ id: "judge", name: "Aeron" });
		globalThis.game.actors = { contents: [actor, wren, bryn, aeron].map(a => Object.assign(a, { hasPlayerOwner: true })) };
		const gm = { query: vi.fn(async (_q, data) => data.targetUuids) };
		globalThis.game.users = { activeGM: gm };
		picker.pick.mockResolvedValue(["fox", "bryn"]);

		await sheet._onDescriptionMoveUsed(pietyItem(actor));

		expect(char.moveResources.getMoveResources()[PIETY]).toBe(1);
		const asked = picker.pick.mock.calls[0][0];
		expect(asked.multiple).toBe(true);
		expect(asked.options.map(o => o.id)).toEqual(["fox", "bryn", "judge"]);
		expect(wren.store[BLESSING_FLAG]).toBe(true);
		expect(gm.query).toHaveBeenCalledWith(BLESSING_QUERY, expect.objectContaining({ targetUuids: ["Actor.bryn"] }), expect.anything());
		expect(aeron.store[BLESSING_FLAG]).toBeUndefined();
	});

	it("closing the picker blesses nobody else", async () => {
		const { sheet, actor, char } = await lightbearerSheet();
		const wren = pc({ id: "fox", name: "Wren" });
		globalThis.game.actors = { contents: [actor, wren] };
		picker.pick.mockResolvedValue(null);
		await sheet._onDescriptionMoveUsed(pietyItem(actor));
		expect(char.moveResources.getMoveResources()[PIETY]).toBe(1);
		expect(wren.store[BLESSING_FLAG]).toBeUndefined();
	});

	it("does nothing while Piety is switched off", async () => {
		const { sheet, actor, char } = await lightbearerSheet({ learned: false });
		globalThis.game.actors = { contents: [actor, pc({ id: "fox", name: "Wren" })] };
		await sheet._onDescriptionMoveUsed(pietyItem(actor));
		expect(char.moveResources.getMoveResources()[PIETY] ?? 0).toBe(0);
		expect(picker.pick).not.toHaveBeenCalled();
	});
});
