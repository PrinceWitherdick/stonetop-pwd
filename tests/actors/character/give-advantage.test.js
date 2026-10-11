// Seeker audit A13 (the user's ruling of 2026-09-26): "you or an ally gain advantage on your next roll"
// (Countermeasures, Everything Burns 10+, Work With What You've Got's opportunity, Sage Advice) is a
// "Give advantage to..." button that holds advantage on the chosen character's next roll through the
// held-advantage store, named for the move, once per card, pressed only by the move's owner or the GM.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Window } from "happy-dom";
import {
	GIVE_ADVANTAGE_MOVES, giveAdvantageRollOptions, giveAdvantageCardHtml, givenSource, advantageRecipients, SEEK_INSIGHT_QUESTIONS,
} from "../../../module/actors/character/give-advantage.js";
import {
	giveAdvantage, handleGiveAdvantageQuery, offerAdvantage, reconcileGivenAdvantage, wireGiveAdvantage, GIVE_ADVANTAGE_QUERY, GIVEN_FLAG, GIVING_FLAG,
} from "../../../module/actors/character/give-advantage-flow.js";
import { reconcileTierEffects } from "../../../module/actors/character/tier-effects.js";
import { ROLLED_FLAG, rolledRecord } from "../../../module/utils/counted-tier.js";
import { moveRollOptions } from "../../../module/actors/character/move-roll-options.js";
import { buildLiveCharacter, makeLiveItem, sourceMovesFor } from "../../fakes/LiveCharacter.js";
import { readRepo } from "../../fakes/css.js";

const SCOPE = "stonetop-pwd";

function pc({ id, name = id, moves = [], unlearned = [], owner = true } = {}) {
	const actor = {
		id, uuid: `Actor.${id}`, name, type: "character", isOwner: owner,
		items: moves.map(move => ({ type: "move", name: move, flags: unlearned.includes(move) ? { [SCOPE]: { learned: false } } : {} })),
		testUserPermission: vi.fn(user => !!user?.isGM || user?.id === `u-${id}`),
	};
	actor.typedActor = { holdAdvantage: vi.fn(async () => {}) };
	return actor;
}

function message({ flags = {} } = {}) {
	const data = { [SCOPE]: { ...flags } };
	return {
		id: "msg1", flags: data,
		getFlag: (scope, key) => data[scope]?.[key],
		setFlag: vi.fn(async (scope, key, value) => { (data[scope] ??= {})[key] = value; }),
		unsetFlag: vi.fn(async (scope, key) => { delete data[scope]?.[key]; }),
	};
}

const player = id => ({ id: `u-${id}`, isGM: false });
const GM = { id: "u-gm", isGM: true };

let saved;
beforeEach(() => { saved = { user: globalThis.game.user, users: globalThis.game.users }; });
afterEach(() => { globalThis.game.user = saved.user; globalThis.game.users = saved.users; });

describe("where the button is", () => {
	it("is on Everything Burns' 10+ only, and on Work With What You've Got's 7+", () => {
		const seeker = pc({ id: "s", moves: ["Everything Burns", "Work With What You've Got"] });
		expect(Object.keys(moveRollOptions("Everything Burns", seeker).tierActions)).toEqual(["success"]);
		expect(Object.keys(moveRollOptions("Work With What You've Got", seeker).tierActions)).toEqual(["success", "partial"]);
		expect(moveRollOptions("Everything Burns", seeker).tierActions.success).toContain('data-move="Everything Burns"');
	});

	it("is not there for a move not held learned", () => {
		expect(giveAdvantageRollOptions("Everything Burns")(pc({ id: "s", moves: ["Everything Burns"], unlearned: ["Everything Burns"] }))).toBeNull();
		expect(moveRollOptions("Everything Burns", pc({ id: "s" }))).toBeNull();
	});

	it("is on the posted card of Countermeasures and Sage Advice, and of no rolling move", () => {
		const seeker = pc({ id: "s", moves: ["Countermeasures", "Sage Advice", "Everything Burns"] });
		expect(giveAdvantageCardHtml(seeker, "Countermeasures")).toContain("Give advantage to...");
		expect(giveAdvantageCardHtml(seeker, "Sage Advice")).toContain("Give advantage to another PC...");
		expect(giveAdvantageCardHtml(seeker, "Everything Burns")).toBe("");
		expect(giveAdvantageCardHtml(pc({ id: "x" }), "Countermeasures")).toBe("");
	});

	// GUARD (wave 4): a move a player wrote under the book's name acts as itself (owns-move.js#bookMoveName).
	it("is not on a player's own move of that name, nor earned by one held learned", () => {
		const seeker = pc({ id: "s", moves: ["Countermeasures"] });
		const homebrew = { type: "move", name: "Countermeasures", flags: { [SCOPE]: { custom: true } } };
		expect(giveAdvantageCardHtml(seeker, "Countermeasures", seeker.items[0])).toContain("Give advantage to...");
		expect(giveAdvantageCardHtml(seeker, "Countermeasures", homebrew)).toBe("");
		const writer = pc({ id: "w" });
		writer.items = [homebrew];
		expect(giveAdvantageCardHtml(writer, "Countermeasures")).toBe("");
		expect(giveAdvantageRollOptions("Everything Burns")({ ...writer, items: [{ ...homebrew, name: "Everything Burns" }] })).toBeNull();
		// Both sheet posts hand over the move they post.
		const sheet = readRepo("module/actors/character/StonetopCharacterSheet.js");
		expect(sheet).toContain("giveAdvantageCardHtml(this.actor, name, item)");
		expect(sheet).toContain("giveAdvantageCardHtml(this.actor, item.name, item)");
	});

	it("is put on both of the sheet's description-only posts (the Moves tab and the hotbar)", () => {
		const sheet = readRepo("module/actors/character/StonetopCharacterSheet.js");
		expect(sheet.match(/giveAdvantageCardHtml\(this\.actor, /g)).toHaveLength(2);
		const main = readRepo("stonetop.js");
		expect(main).toContain("wireGiveAdvantage(message, html);");
		expect(main).toContain("CONFIG.queries[GIVE_ADVANTAGE_QUERY]");
	});
});

describe("who can be given it, and what it is called", () => {
	it("is the giver or another PC, except for Sage Advice (another PC only)", () => {
		const s = pc({ id: "s" });
		const b = pc({ id: "b" });
		expect(advantageRecipients(s, "Countermeasures", [s, b]).map(a => a.id)).toEqual(["s", "b"]);
		expect(advantageRecipients(s, "Sage Advice", [s, b]).map(a => a.id)).toEqual(["b"]);
		expect(GIVE_ADVANTAGE_MOVES["Sage Advice"].othersOnly).toBe(true);
	});

	it("names the move, and whose it was when given to someone else", () => {
		const s = pc({ id: "s", name: "Maelis" });
		expect(givenSource("Countermeasures", s, s)).toBe("Countermeasures");
		expect(givenSource("Countermeasures", s, pc({ id: "b" }))).toBe("Maelis's Countermeasures");
	});
});

describe("giving it", () => {
	it("holds advantage on a character this client owns", async () => {
		const s = pc({ id: "s", name: "Maelis" });
		const b = pc({ id: "b" });
		expect(await giveAdvantage(s, b, "Work With What You've Got")).toBe(true);
		expect(b.typedActor.holdAdvantage).toHaveBeenCalledWith("Maelis's Work With What You've Got");
		expect(await giveAdvantage(s, s, "Sage Advice")).toBe(false);
	});

	it("asks the GM's client for a character it does not own", async () => {
		const s = pc({ id: "s" });
		const b = pc({ id: "b", owner: false });
		const gm = { query: vi.fn(async () => true) };
		expect(await giveAdvantage(s, b, "Sage Advice", { gm, userId: "u-s" })).toBe(true);
		expect(gm.query).toHaveBeenCalledWith(GIVE_ADVANTAGE_QUERY,
			{ giverUuid: "Actor.s", targetUuid: "Actor.b", moveName: "Sage Advice", userId: "u-s" }, { timeout: 10000 });
		expect(b.typedActor.holdAdvantage).not.toHaveBeenCalled();
		expect(await giveAdvantage(s, b, "Sage Advice", { gm: null })).toBe(false);
	});

	it("the GM's side writes it for the giver's player, with the move learned, and for nobody else", async () => {
		globalThis.game.user = GM;
		globalThis.game.users = { activeGM: GM, get: id => [player("s"), player("b")].find(u => u.id === id) ?? null };
		const s = pc({ id: "s", name: "Maelis", moves: ["Countermeasures"] });
		const b = pc({ id: "b", owner: false });
		const ask = (giver, userId, moveName = "Countermeasures") => handleGiveAdvantageQuery(
			{ giverUuid: giver.uuid, targetUuid: b.uuid, moveName, userId }, {},
			{ resolve: uuid => [giver, b].find(a => a.uuid === uuid) ?? null });
		expect(await ask(s, "u-b")).toBe(false);
		expect(await ask(pc({ id: "s", moves: ["Countermeasures"], unlearned: ["Countermeasures"] }), "u-s")).toBe(false);
		expect(await ask(s, "u-s", "Hack and Slash")).toBe(false);
		expect(b.typedActor.holdAdvantage).not.toHaveBeenCalled();
		expect(await ask(s, "u-s")).toBe(true);
		expect(b.typedActor.holdAdvantage).toHaveBeenCalledWith("Maelis's Countermeasures");
	});

	it("asks who, gives it, and writes it on the card", async () => {
		const s = pc({ id: "s" });
		const b = pc({ id: "b" });
		const card = message();
		const pick = vi.fn(async () => "b");
		expect(await offerAdvantage(card, s, "Countermeasures", { pick, party: () => [b] })).toBe(true);
		expect(pick.mock.calls[0][0].options.map(o => o.id)).toEqual(["s", "b"]);
		expect(b.typedActor.holdAdvantage).toHaveBeenCalledWith("s's Countermeasures");
		expect(card.getFlag(SCOPE, GIVEN_FLAG)).toEqual({ name: "b", move: "Countermeasures", uuid: "Actor.b", source: "s's Countermeasures" });
	});

	it("gives nothing when another client's press took the card while this one chose", async () => {
		const s = pc({ id: "s" });
		const b = pc({ id: "b" });
		const card = message();
		const give = vi.fn(async () => true);
		expect(await offerAdvantage(card, s, "Countermeasures", { pick: async () => "b", party: () => [b], give, stillMine: () => false })).toBe(true);
		expect(give).not.toHaveBeenCalled();
		expect(card.getFlag(SCOPE, GIVEN_FLAG)).toBeUndefined();
	});

	it("gives nothing when the picker is closed", async () => {
		const s = pc({ id: "s" });
		const card = message();
		expect(await offerAdvantage(card, s, "Countermeasures", { pick: async () => null, party: () => [] })).toBe(false);
		expect(s.typedActor.holdAdvantage).not.toHaveBeenCalled();
		expect(card.setFlag).not.toHaveBeenCalled();
	});

	it("lands in the real held-advantage store, spent by the next roll", async () => {
		const everythingBurns = sourceMovesFor("The Seeker").find(d => d.name === "Everything Burns");
		const { char, actor } = buildLiveCharacter({ slug: "the-seeker", name: "The Seeker",
			items: [makeLiveItem({ name: "Everything Burns", type: "move", system: structuredClone(everythingBurns.system) })] });
		actor.id = "s"; actor.uuid = "Actor.s"; actor.isOwner = true; actor.typedActor = char;
		expect(await giveAdvantage(actor, actor, "Everything Burns")).toBe(true);
		expect(char.heldAdvantage()).toMatchObject({ source: "Everything Burns" });
	});
});

describe("the card's button", () => {
	function rendered(flags = {}) {
		const root = new Window().document.createElement("div");
		root.innerHTML = giveAdvantageCardHtml(pc({ id: "s", moves: ["Countermeasures"] }), "Countermeasures");
		return { root, card: message({ flags }), button: () => root.querySelector(".stonetop-give-advantage") };
	}

	it("is taken off for anyone who cannot write the card and the giver", () => {
		const { root, card, button } = rendered();
		wireGiveAdvantage(card, root, { giver: pc({ id: "s" }), usable: false });
		expect(button()).toBeNull();
	});

	it("is live for the giver's player, and says who has it once given", () => {
		const live = rendered();
		wireGiveAdvantage(live.card, live.root, { giver: pc({ id: "s" }), usable: true });
		expect(live.button().disabled).toBe(false);
		const done = rendered({ [GIVEN_FLAG]: { name: "Bram", move: "Countermeasures" } });
		wireGiveAdvantage(done.card, done.root, { giver: pc({ id: "s" }), usable: true });
		expect(done.button()).toBeNull();
		expect(done.root.querySelector(".stonetop-give-advantage-readout").textContent).toContain("Bram has advantage");
	});

	it("latches the card before the picker opens, and gives the card back when the picker is closed", async () => {
		const { root, card, button } = rendered();
		let latchedAtPick = null;
		const pick = vi.fn(async () => { latchedAtPick = card.getFlag(SCOPE, GIVING_FLAG); return null; });
		wireGiveAdvantage(card, root, { giver: pc({ id: "s" }), usable: true, userId: "u-s", pick, party: () => [pc({ id: "b" })] });
		button().click();
		await vi.waitFor(() => expect(pick).toHaveBeenCalled());
		await vi.waitFor(() => expect(card.unsetFlag).toHaveBeenCalled());
		expect(latchedAtPick).toBe("u-s");
		expect(card.getFlag(SCOPE, GIVING_FLAG)).toBeUndefined();
		expect(button().disabled).toBe(false);
	});

	it("is disabled while another user is choosing, and live for the user whose latch it is", () => {
		const other = rendered({ [GIVING_FLAG]: "u-gm" });
		wireGiveAdvantage(other.card, other.root, { giver: pc({ id: "s" }), usable: true, userId: "u-s" });
		expect(other.button().disabled).toBe(true);
		const mine = rendered({ [GIVING_FLAG]: "u-s" });
		wireGiveAdvantage(mine.card, mine.root, { giver: pc({ id: "s" }), usable: true, userId: "u-s" });
		expect(mine.button().disabled).toBe(false);
	});
});

// Would-Be Hero audit (2026-09-27): Voice of Experience's advice ("they have advantage on their first roll to
// follow your advice"), Inquiring Minds ("gain advantage on your next roll to follow that advice") and
// Resourceful ("When you Defy Danger and roll a 6-, ask the GM a question from Seek Insight ... Gain
// advantage on your next roll to act on the answer") held nothing. The two "you gain" moves are `selfOnly`:
// no picker, the hero holds it.
describe("the Would-Be Hero's advice and Resourceful", () => {
	it("gives Voice of Experience's advantage to another PC only, from its posted card", () => {
		const hero = pc({ id: "h", moves: ["Voice of Experience"] });
		expect(giveAdvantageCardHtml(hero, "Voice of Experience")).toContain("Give advantage to another PC...");
		expect(advantageRecipients(hero, "Voice of Experience", [hero, pc({ id: "b" })]).map(a => a.id)).toEqual(["b"]);
		expect(giveAdvantageCardHtml(pc({ id: "h", moves: ["Voice of Experience"], unlearned: ["Voice of Experience"] }), "Voice of Experience")).toBe("");
	});

	// The asterisk (the user's ruling): Voice of Experience's advice given is a use of the starred move, and
	// the first crosses off "Would-be". A picker closed, or another client's press, gives nothing and crosses
	// nothing off.
	it("giving Voice of Experience's advantage crosses off \"Would-be\", the first time", async () => {
		const savedChat = globalThis.ChatMessage;
		globalThis.ChatMessage = { create: vi.fn(async () => ({})), getSpeaker: () => ({}) };
		try {
			const wbh = () => {
				const flags = {};
				return Object.assign(pc({ id: "h", name: "Wren", moves: ["Voice of Experience"] }), {
					system: { playbook: { name: "The Would-Be Hero", slug: "the-would-be-hero" } },
					getFlag: (_s, key) => flags[key],
					setFlag: vi.fn(async (_s, key, value) => { flags[key] = value; }),
				});
			};
			const hero = wbh();
			const b = pc({ id: "b" });
			expect(await offerAdvantage(message(), hero, "Voice of Experience", { pick: async () => null, party: () => [b] })).toBe(false);
			expect(await offerAdvantage(message(), hero, "Voice of Experience", { pick: async () => "b", party: () => [b], stillMine: () => false })).toBe(true);
			expect(hero.setFlag).not.toHaveBeenCalled();

			expect(await offerAdvantage(message(), hero, "Voice of Experience", { pick: async () => "b", party: () => [b] })).toBe(true);
			expect(hero.setFlag).toHaveBeenCalledWith(SCOPE, "wbhBecameHero", true);
			expect(globalThis.ChatMessage.create).toHaveBeenCalledTimes(1);
			await offerAdvantage(message(), hero, "Voice of Experience", { pick: async () => "b", party: () => [b] });
			expect(globalThis.ChatMessage.create).toHaveBeenCalledTimes(1);

			// Another move's gift crosses nothing off.
			const seeker = Object.assign(wbh(), { items: [{ type: "move", name: "Countermeasures", flags: {} }] });
			await offerAdvantage(message(), seeker, "Countermeasures", { pick: async () => "b", party: () => [b] });
			expect(seeker.setFlag).not.toHaveBeenCalled();
		} finally {
			globalThis.ChatMessage = savedChat;
		}
	});

	it("holds Inquiring Minds' advantage for the hero alone, from its posted card", async () => {
		const hero = pc({ id: "h", name: "Wren", moves: ["Inquiring Minds"] });
		const html = giveAdvantageCardHtml(hero, "Inquiring Minds");
		expect(html).toContain("Hold advantage (Inquiring Minds)");
		expect(advantageRecipients(hero, "Inquiring Minds", [pc({ id: "b" })]).map(a => a.id)).toEqual(["h"]);
		expect(await giveAdvantage(hero, pc({ id: "b" }), "Inquiring Minds")).toBe(false);
		expect(await giveAdvantage(hero, hero, "Inquiring Minds")).toBe(true);
		expect(hero.typedActor.holdAdvantage).toHaveBeenCalledWith("Inquiring Minds");
	});

	it("asks nobody for a selfOnly move: the hero holds it and the card says so", async () => {
		const hero = pc({ id: "h", name: "Wren", moves: ["Inquiring Minds"] });
		const card = message();
		const pick = vi.fn();
		const party = vi.fn(() => [pc({ id: "b" })]);
		expect(await offerAdvantage(card, hero, "Inquiring Minds", { pick, party })).toBe(true);
		expect(pick).not.toHaveBeenCalled();
		expect(hero.typedActor.holdAdvantage).toHaveBeenCalledWith("Inquiring Minds");
		expect(card.getFlag(SCOPE, GIVEN_FLAG)).toEqual({ name: "Wren", move: "Inquiring Minds", uuid: "Actor.h", source: "Inquiring Minds" });
	});

	it("puts Resourceful's Seek Insight line and hold on Defy Danger's 6- alone, for a learned owner", () => {
		const hero = pc({ id: "h", moves: ["Resourceful"] });
		const options = moveRollOptions("Defy Danger", hero);
		expect(Object.keys(options.tierActions)).toEqual(["failure"]);
		expect(options.tierActions.failure).toContain("Hold advantage (Resourceful)");
		expect(options.tierActions.failure).toContain('data-move="Resourceful"');
		for (const question of SEEK_INSIGHT_QUESTIONS) expect(options.tierActions.failure).toContain(question);
		expect(moveRollOptions("Resourceful", hero)).toBeNull();
		expect(moveRollOptions("Defy Danger", pc({ id: "h", moves: ["Resourceful"], unlearned: ["Resourceful"] }))).toBeNull();
	});

	it("quotes Seek Insight's questions as the pack prints them", () => {
		const seek = readRepo("packs/src/stonetop-items/basic-moves/seek-insight.json");
		for (const question of SEEK_INSIGHT_QUESTIONS) expect(seek).toContain(`<li>${question}</li>`);
	});

	it("the GM's side holds a selfOnly move for the giver and refuses anyone else", async () => {
		globalThis.game.user = GM;
		globalThis.game.users = { activeGM: GM, get: id => [player("h")].find(u => u.id === id) ?? null };
		const hero = pc({ id: "h", moves: ["Resourceful"] });
		const other = pc({ id: "b" });
		const ask = target => handleGiveAdvantageQuery({ giverUuid: hero.uuid, targetUuid: target.uuid, moveName: "Resourceful", userId: "u-h" }, {},
			{ resolve: uuid => [hero, other].find(a => a.uuid === uuid) ?? null });
		expect(await ask(other)).toBe(false);
		expect(await ask(hero)).toBe(true);
		expect(hero.typedActor.holdAdvantage).toHaveBeenCalledWith("Resourceful");
	});
});

// A gift a roll card's TIER gave (Everything Burns' 10+, Work With What You've Got's 7+) is taken back when the
// card is moved off that tier, as Sanction and Surprise are (tier-effects.js), and the card forgets it gave
// anything so its button is back should the card return.
describe("a gift whose roll card moves off its tier", () => {
	function givenCard(move = "Everything Burns", given = {}) {
		const card = message({ flags: {
			[ROLLED_FLAG]: rolledRecord("int", { moveName: move }),
			[GIVEN_FLAG]: { name: "b", move, uuid: "Actor.b", source: `s's ${move}`, ...given },
			[GIVING_FLAG]: "u-s",
		} });
		card.update = vi.fn(async update => {
			for (const key of Object.keys(update)) delete card.flags[SCOPE][key.split(".").pop().replace(/^-=/, "")];
		});
		return card;
	}
	function holder({ owner = true } = {}) {
		const b = pc({ id: "b", owner });
		b.typedActor.releaseHeldAdvantage = vi.fn(async () => true);
		return b;
	}

	it("takes it back from the one who holds it when shifted down off the 10+, and lets the card give again", async () => {
		const b = holder();
		const card = givenCard();
		expect(await reconcileGivenAdvantage(card, 9, { resolve: () => b })).toBe(true);
		expect(b.typedActor.releaseHeldAdvantage).toHaveBeenCalledWith("s's Everything Burns");
		expect(card.getFlag(SCOPE, GIVEN_FLAG)).toBeUndefined();
		expect(card.getFlag(SCOPE, GIVING_FLAG)).toBeUndefined();
	});

	it("keeps it while the card still stands on a tier that gives it", async () => {
		const b = holder();
		expect(await reconcileGivenAdvantage(givenCard(), 12, { resolve: () => b })).toBe(false);
		expect(await reconcileGivenAdvantage(givenCard("Work With What You've Got"), 8, { resolve: () => b })).toBe(false);
		expect(b.typedActor.releaseHeldAdvantage).not.toHaveBeenCalled();
	});

	it("keeps it, and the card's record of it, when this client cannot write the one who holds it", async () => {
		const b = holder({ owner: false });
		const card = givenCard();
		vi.spyOn(console, "warn").mockImplementation(() => {});
		expect(await reconcileGivenAdvantage(card, 9, { resolve: () => b })).toBe(false);
		expect(b.typedActor.releaseHeldAdvantage).not.toHaveBeenCalled();
		expect(card.getFlag(SCOPE, GIVEN_FLAG)).toMatchObject({ name: "b" });
	});

	// Wave 3 RAW re-check RA-1: one roll, one advantage. A gift already used on a roll since cannot be taken back,
	// and a card that forgot it would offer the same roll's advantage a second time once moved back onto the tier.
	it("keeps the record, marked spent, when the advantage was already used, so the card never gives it again", async () => {
		const b = holder();
		b.typedActor.releaseHeldAdvantage = vi.fn(async () => false);
		const card = givenCard();
		expect(await reconcileGivenAdvantage(card, 9, { resolve: () => b })).toBe(false);
		expect(card.getFlag(SCOPE, GIVEN_FLAG)).toMatchObject({ name: "b", move: "Everything Burns", spent: true });
		expect(card.update).not.toHaveBeenCalled();
		// Back on the 10+ and off it again: nothing more is asked of the holder.
		expect(await reconcileGivenAdvantage(card, 11, { resolve: () => b })).toBe(false);
		expect(await reconcileGivenAdvantage(card, 8, { resolve: () => b })).toBe(false);
		expect(b.typedActor.releaseHeldAdvantage).toHaveBeenCalledTimes(1);

		const root = new Window().document.createElement("div");
		root.innerHTML = giveAdvantageRollOptions("Everything Burns")(pc({ id: "s", moves: ["Everything Burns"] })).tierActions.success;
		wireGiveAdvantage(card, root, { giver: pc({ id: "s" }), usable: true });
		expect(root.querySelector(".stonetop-give-advantage")).toBeNull();
		expect(root.querySelector(".stonetop-give-advantage-readout").textContent).toBe("b already used the advantage this roll gave.");
	});

	it("keeps the record, marked spent, when the one who held it is gone", async () => {
		const card = givenCard();
		expect(await reconcileGivenAdvantage(card, 9, { resolve: () => null })).toBe(false);
		expect(card.getFlag(SCOPE, GIVEN_FLAG)).toMatchObject({ spent: true });
	});

	it("is brought along by the one seam every rewrite of a card's total reaches", async () => {
		const b = holder();
		const was = globalThis.fromUuidSync;
		globalThis.fromUuidSync = vi.fn(uuid => (uuid === "Actor.b" ? b : null));
		try {
			await reconcileTierEffects(givenCard(), 9, { actor: null });
		} finally {
			globalThis.fromUuidSync = was;
		}
		expect(b.typedActor.releaseHeldAdvantage).toHaveBeenCalledWith("s's Everything Burns");
	});
});
