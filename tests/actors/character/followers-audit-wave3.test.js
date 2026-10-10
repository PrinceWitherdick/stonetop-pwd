// The followers-core audit's fixes (wave 3, 2026-10-09), each pinned by the rule it follows. Book I,
// NPCs & Followers: p.464 (Strengthen Your Bond, a follower of the party as a whole), p.469 (Followers at
// 0 HP), p.480 (handing a follower to another PC), p.244 (Death's Door), p.143 (Loyal to the End).

import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SYSTEM_ID } from "../../../module/system-id.js";
import { buildLiveCharacter } from "../../fakes/LiveCharacter.js";
import { loadPlaybookDefs } from "../../fakes/sourcePack.js";
import { createStonetopCharacterSheetClass } from "../../../module/actors/character/StonetopCharacterSheet.js";
import { followerHpMirror, onUpdateActorFollowerHp } from "../../../module/fight/roster-fate.js";
import { followerHpWriteUpdate, linkedFollowerNpc } from "../../../module/actors/character/follower-fate.js";
import { setFollowerHp } from "../../../module/actors/character/follower-hp.js";
import { followerCardFor } from "../../../module/actors/character/follower-masters.js";
import {
	handOffPlan, handOffTargets, handleFollowerHandoffQuery, performHandOff, unlinkRemovedFollower,
} from "../../../module/actors/character/follower-handoff.js";
import {
	followerDoorCardHtml, followerDoorRollOptions, followerDoorUp,
} from "../../../module/actors/character/follower-deaths-door.js";
import { reconcileTierEffects, settleFollowerReadiness } from "../../../module/actors/character/tier-effects.js";
import { followerWholePartyPath, followsPartyAsWhole } from "../../../module/actors/character/follower-party.js";
import {
	FOLLOWER_LOYALTY_QUERY, changeFollowerLoyalty, handleFollowerLoyaltyQuery, loyaltyStep, strengthenBond,
} from "../../../module/actors/character/follower-bond.js";
import { followerOrderInfo } from "../../../module/fight/follower-fight.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const read = rel => readFileSync(resolve(HERE, "../../..", rel), "utf8");
const BLESSED = loadPlaybookDefs().byName.get("The Blessed");
const S = SYSTEM_ID;

const realGame = globalThis.game;
afterEach(() => {
	globalThis.game = realGame;
	delete globalThis.ChatMessage;
	delete globalThis.fromUuidSync;
});

/** A character as the pure helpers read one: flags, an update spy, a sheet with the fate dialog. */
function pc(id, flags = {}, { owner = true } = {}) {
	const a = {
		id, uuid: `Actor.${id}`, name: id, type: "character", isOwner: owner, ownership: { default: 0, [`user-${id}`]: 3 },
		flags: { [S]: flags },
		update: vi.fn(async () => {}),
		testUserPermission: (user) => owner || user?.owns === id,
		sheet: { _openFollowerFate: vi.fn(), _resolveFollowerFate: vi.fn(async () => {}) },
	};
	return a;
}
const npc = (id, { hp = 6, max = 6, origin = null, owner = true } = {}) => ({
	id, uuid: `Actor.${id}`, name: id, type: "npc", documentName: "Actor", isOwner: owner,
	system: { attributes: { hp: { value: hp, max } } },
	flags: { [S]: origin ? { followerOrigin: origin } : {} },
	update: vi.fn(async () => {}),
});

function sheetFor(char, actor) {
	actor.typedActor = char;
	const Base = class {
		constructor() { this._actor = actor; }
		get actor() { return this._actor; }
		get isEditable() { return true; }
		async getData() { return {}; }
		activateListeners() {}
		render = vi.fn();
	};
	return new (createStonetopCharacterSheetClass(Base))();
}
const blessed = (flags = {}) => buildLiveCharacter({ slug: "the-blessed", name: "The Blessed", flags });

// ── FOL-1: a one-body follower's NPC holds their HP; the card mirrors it, and a drop to 0 asks their fate ──
describe("a one-body follower's NPC and their card (FOL-1)", () => {
	const companionCard = { ftype: "animal-companion", slug: "" };

	it("mirrors the NPC's HP onto the card box and asks the fate on a drop to 0 from standing", () => {
		const ranger = pc("ranger", { animalCompanion: { hpCurrent: 4 } });
		const wolf = npc("wolf", { hp: 0 });
		const plan = followerHpMirror(wolf, { system: { attributes: { hp: { value: 0 } } } }, { cardFor: () => ({ character: ranger, ...companionCard }) });
		expect(plan.update).toEqual({ [`flags.${S}.animalCompanion.hpCurrent`]: 0 });
		expect(plan.fate).toEqual({ follower: "animal-companion", slug: "", index: null, name: "wolf" });
	});

	it("asks nothing when the card already reads 0, mirrors any other value, and ignores a non-HP write", () => {
		const ranger = pc("ranger", { animalCompanion: { hpCurrent: 0 } });
		const cardFor = () => ({ character: ranger, ...companionCard });
		expect(followerHpMirror(npc("w"), { "system.attributes.hp.value": 0 }, { cardFor }).fate).toBeNull();
		expect(followerHpMirror(npc("w"), { "system.attributes.hp.value": 3 }, { cardFor }).update)
			.toEqual({ [`flags.${S}.animalCompanion.hpCurrent`]: 3 });
		expect(followerHpMirror(npc("w"), { name: "Rex" }, { cardFor })).toBeNull();
	});

	it("leaves a group follower's token and the crew to their roster", () => {
		const cadi = pc("cadi", { customFollowers: { band: { isGroup: true } } });
		expect(followerHpMirror(npc("b"), { "system.attributes.hp.value": 0 }, { cardFor: () => ({ character: cadi, ftype: "custom", slug: "band" }) })).toBeNull();
		expect(followerHpMirror(npc("c"), { "system.attributes.hp.value": 0 }, { cardFor: () => ({ character: cadi, ftype: "crew", slug: "" }) })).toBeNull();
	});

	it("revives a custom follower marked Dead when their NPC is healed", () => {
		const cadi = pc("cadi", { customFollowers: { abc: { dead: true, hpCurrent: 0 } } });
		const plan = followerHpMirror(npc("m"), { "system.attributes.hp.value": 2 }, { cardFor: () => ({ character: cadi, ftype: "custom", slug: "abc" }) });
		expect(plan.update).toEqual({ [`flags.${S}.customFollowers.abc.hpCurrent`]: 2, [`flags.${S}.customFollowers.abc.dead`]: false });
	});

	it("acts only on the client that answers for the character, writing the card and opening the dialog once", async () => {
		const ranger = pc("ranger", { animalCompanion: {} });
		const cardFor = () => ({ character: ranger, ...companionCard });
		const changes = { system: { attributes: { hp: { value: 0 } } } };
		expect(await onUpdateActorFollowerHp(npc("w"), changes, {}, null, { answers: () => false, cardFor })).toBe(false);
		expect(ranger.update).not.toHaveBeenCalled();
		expect(await onUpdateActorFollowerHp(npc("w"), changes, { stonetopMove: "Clash" }, null, { answers: () => true, cardFor })).toBe(true);
		expect(ranger.update).toHaveBeenCalledWith({ [`flags.${S}.animalCompanion.hpCurrent`]: 0 }, { stonetopMove: "Clash" });
		expect(ranger.sheet._openFollowerFate).toHaveBeenCalledTimes(1);
	});

	it("finds the NPC standing for a one-body card, never a group's", () => {
		const link = vi.fn(({ actorUuid }) => (actorUuid ? { uuid: actorUuid } : null));
		expect(linkedFollowerNpc({ customFollowers: { abc: { actorUuid: "Actor.m" } } }, "custom", "abc", link)).toEqual({ uuid: "Actor.m" });
		expect(linkedFollowerNpc({ animalCompanion: { details: { actorUuid: "Actor.w" } } }, "animal-companion", "", link)).toEqual({ uuid: "Actor.w" });
		expect(linkedFollowerNpc({ customFollowers: { band: { isGroup: true, actorUuid: "Actor.b" } } }, "custom", "band", link)).toBeNull();
		expect(linkedFollowerNpc({}, "crew-member", "", link)).toBeNull();
	});

	it("writes the sheet's HP box to the follower's NPC, so the box's own fate path never fires for them", async () => {
		const { actor } = blessed({ "customFollowers.abc": { name: "Maeve", hpMax: 6, actorUuid: "Actor.maeve" } });
		const maeve = npc("maeve", { hp: 4 });
		globalThis.fromUuidSync = uuid => (uuid === "Actor.maeve" ? maeve : null);
		const row = { follower: "custom", slug: "abc" };
		expect(await setFollowerHp(actor, row, 0)).toBe("npc");
		expect(maeve.update).toHaveBeenCalledWith({ "system.attributes.hp.value": 0 });
		// The NPC already holds it: nothing would fire to mirror it, so the box writes itself.
		maeve.system.attributes.hp.value = 0;
		expect(await setFollowerHp(actor, row, 0)).toBe("box");
		// The sheet's HP input writes through it, and keeps no writer of its own.
		const sheetSrc = read("module/actors/character/StonetopCharacterSheet.js");
		expect(sheetSrc).toContain("await setFollowerHp(this.actor, { follower, slug, index }, val)");
		expect(sheetSrc).not.toMatch(/_followerHpUpdate|_writeFollowerNpcHp/);
	});
});

// ── FOL-3: a removed or handed-off card takes its NPC's link with it ──
describe("an NPC whose card is gone (FOL-3)", () => {
	it("is nobody's follower once the custom card it is stamped with has been removed", () => {
		const cadi = pc("cadi", { customFollowers: { abc: { name: "Maeve" } } });
		const origin = { characterUuid: "Actor.cadi", ftype: "custom", slug: "abc" };
		expect(followerCardFor(npc("m", { origin }), { characters: [cadi], resolve: () => cadi })).toMatchObject({ ftype: "custom", slug: "abc" });
		cadi.flags[S].customFollowers = {};
		expect(followerCardFor(npc("m", { origin }), { characters: [cadi], resolve: () => cadi })).toBeNull();
	});

	it("unstamps the NPC of a removed card", () => {
		const cadi = pc("cadi", { customFollowers: { abc: { actorUuid: "Actor.m" } } });
		const m = npc("m", { origin: { characterUuid: "Actor.cadi", ftype: "custom", slug: "abc" } });
		const unlink = unlinkRemovedFollower(cadi, "abc", () => m);
		expect(unlink.npc).toBe(m);
		expect(Object.keys(unlink.update)).toEqual([`flags.${S}.-=followerOrigin`]);
		// A recruited NPC carries no stamp, so there is nothing to take off it.
		expect(unlinkRemovedFollower(cadi, "abc", () => npc("plain"))).toBeNull();
	});

	it("hands the card, the NPC's stamp and its owners to the new leader", async () => {
		const cadi = pc("cadi", { customFollowers: { abc: { name: "Maeve", loyalty: 2, actorUuid: "Actor.m" } } });
		const bram = pc("bram", {});
		const m = npc("m", { origin: { characterUuid: "Actor.cadi", ftype: "custom", slug: "abc" } });
		const done = await performHandOff(cadi, bram, "abc", { newId: "new1", withOwnership: true, resolve: () => m });
		expect(done).toEqual({ newId: "new1", npcOwnership: true });
		expect(bram.update.mock.calls[0][0][`flags.${S}.customFollowers.new1`]).toMatchObject({ name: "Maeve", loyalty: 2, actorUuid: "Actor.m" });
		expect(m.update).toHaveBeenCalledWith({
			[`flags.${S}.followerOrigin`]: { characterUuid: "Actor.bram", ftype: "custom", slug: "new1" },
			ownership: bram.ownership,
		}, { stonetopLedger: true });
		expect(Object.keys(cadi.update.mock.calls[0][0])).toEqual([`flags.${S}.customFollowers.-=abc`]);
		expect(handOffPlan({ from: cadi, to: bram, slug: "abc", newId: "x", record: {}, withOwnership: false }).npc).not.toHaveProperty("ownership");
	});
});

// ── FOL-7: any other PC, through the GM when the clicker cannot write them ──
describe("handing a follower to another PC (FOL-7)", () => {
	it("offers every other character, not only the ones this player owns", () => {
		const cadi = pc("cadi");
		const others = [pc("bram", {}, { owner: false }), pc("dewi", {}, { owner: true }), npc("x")];
		expect(handOffTargets(cadi, [cadi, ...others]).map(a => a.id)).toEqual(["bram", "dewi"]);
	});

	it("is done by the GM's client for a player who owns the follower's leader, and refused for anyone else", async () => {
		globalThis.game = { ...realGame, user: { id: "gm", isGM: true }, users: { activeGM: { id: "gm" }, get: id => ({ id, isGM: false, owns: id === "p1" ? "cadi" : null }) } };
		const cadi = pc("cadi", { customFollowers: { abc: { name: "Maeve" } } }, { owner: false });
		const bram = pc("bram", {}, { owner: false });
		const resolve = uuid => ({ "Actor.cadi": cadi, "Actor.bram": bram })[uuid];
		const data = { fromUuid: "Actor.cadi", toUuid: "Actor.bram", slug: "abc" };
		expect(await handleFollowerHandoffQuery({ ...data, userId: "p2" }, {}, { resolve })).toBeNull();
		expect(await handleFollowerHandoffQuery({ ...data, userId: "p1" }, {}, { resolve, newId: "n" })).toMatchObject({ newId: "n" });
		expect(bram.update).toHaveBeenCalled();
	});
});

// ── FOL-4: a follower's Death's Door is rolled, +nothing, with the book's three outcomes ──
describe("a follower at Death's Door (FOL-4)", () => {
	const row = { follower: "custom", slug: "abc", index: null, name: "Maeve" };

	it("posts a card with the roll on it for the leader's player", () => {
		const html = followerDoorCardHtml(row, "Cadi");
		expect(html).toContain('class="stonetop-follower-door-roll"');
		expect(html).toContain('data-follower="custom"');
		expect(html).toContain("Cadi's player rolls for them");
	});

	it("rolls +nothing with no XP on a miss, 10+ back to 1 HP, 6- a last move then dead, and no insert", () => {
		const opts = followerDoorRollOptions(row);
		expect(opts).toMatchObject({ statValue: 0, noXpOnMiss: true, moveName: "Maeve: Death's Door" });
		expect(opts.moveResults.success.value).toContain("back to 1 HP");
		expect(opts.moveResults.partial.value).toContain("out of the action");
		expect(opts.moveResults.failure.value).toContain("one last move as if they rolled a 12+");
		expect(JSON.stringify(opts)).not.toMatch(/Revenant|Ghost|Thrall/);
		expect(opts.tierActions.success).toContain("stonetop-follower-door-up");
		expect(opts.tierActions.failure).toContain("stonetop-follower-door-dead");
		expect(opts.tierActions.partial).toBeUndefined();
	});

	it("puts a 10+ back on 1 HP, a custom follower's box or a roster row's slot", async () => {
		const cadi = pc("cadi", { customFollowers: { abc: { hpCurrent: 0 } } });
		expect(await followerDoorUp(cadi, row, { link: () => null })).toBe(true);
		expect(cadi.update).toHaveBeenCalledWith({ [`flags.${S}.customFollowers.abc.hpCurrent`]: 1 }, { stonetopMove: "Death's Door" });
		expect(followerHpWriteUpdate({ crew: { memberHp: [null, 0] } }, "crew-member", "", 1, 1))
			.toEqual({ [`flags.${S}.crew.memberHp`]: [null, 1] });
	});

	it("puts a follower with an NPC back on 1 HP on the NPC alone, the card following it", async () => {
		const cadi = pc("cadi", { customFollowers: { abc: { hpCurrent: 0, actorUuid: "Actor.m" } } });
		const maeve = npc("m", { hp: 0 });
		expect(await followerDoorUp(cadi, row, { link: () => maeve })).toBe(true);
		expect(maeve.update).toHaveBeenCalledWith({ "system.attributes.hp.value": 1 }, { stonetopMove: "Death's Door" });
		expect(cadi.update).not.toHaveBeenCalled();
	});
});

// ── FOL-5: a follower ordered to Defend keeps the Readiness of the card's tier as it moves ──
describe("a follower's Defend Readiness through a moved card (FOL-5)", () => {
	const path = "customFollowers.abc.readiness";

	it("holds by tier and follows the card when it is shifted", async () => {
		const cadi = pc("cadi", { customFollowers: { abc: {} } });
		const record = await settleFollowerReadiness(cadi, "failure", { path, prior: 0, set: 0, name: "Maeve" });
		expect(record).toMatchObject({ prior: 0, set: 0 });
		expect(cadi.update).not.toHaveBeenCalled();
		// The GM shifts the 6- up to a 7-9: the card's record finds the follower's track.
		const flags = { tierEffects: { followerReadiness: record }, move: "Maeve: Defend" };
		const message = { getFlag: (_s, key) => flags[key], setFlag: vi.fn(async () => {}) };
		globalThis.ChatMessage = { create: vi.fn(), getSpeaker: () => ({}) };
		await reconcileTierEffects(message, 8, { actor: cadi });
		expect(cadi.update).toHaveBeenCalledWith({ [`flags.${S}.${path}`]: 1 }, { stonetopMove: "Defend" });
		expect(message.setFlag).toHaveBeenCalledWith(S, "tierEffects", { followerReadiness: { ...record, set: 1 } });
	});

	it("gives back what a 10+ raised when it is shifted down, and keeps Readiness spent since", async () => {
		const cadi = pc("cadi", { customFollowers: { abc: { readiness: 2 } } });
		// The 10+ raised 0 to 3, and one has been spent since.
		const record = await settleFollowerReadiness(cadi, "partial", { path, prior: 0, set: 3, name: "Maeve" });
		expect(cadi.update).toHaveBeenCalledWith({ [`flags.${S}.${path}`]: 0 }, { stonetopMove: "Defend" });
		expect(record.set).toBe(1);
	});
});

// ── FOL-6: travelling with the party and following it as a whole are two switches ──
describe("the two party switches (FOL-6)", () => {
	it("reads following the party as a whole off its own flag, on custom followers only", () => {
		expect(followerWholePartyPath("custom", "abc")).toBe("customFollowers.abc.wholeParty");
		expect(followerWholePartyPath("crew", "")).toBeNull();
		expect(followsPartyAsWhole({ customFollowers: { abc: { party: true } } }, "custom", "abc")).toBe(false);
		expect(followsPartyAsWhole({ customFollowers: { abc: { wholeParty: true } } }, "custom", "abc")).toBe(true);
	});

	it("draws both switches on the custom card, the travel one worded as travel", () => {
		const hbs = read("templates/actor/partials/tab-followers.hbs");
		expect(hbs).toContain('data-switch="wholeParty" data-ftype="custom" data-slug="{{slug}}"');
		expect(hbs).not.toContain("(any PC pays/spends its Loyalty)");
		expect(hbs).toContain("{{#if wholeParty}}{{#unless edit.card}}");
	});

	it("writes the second switch where it lives, and the card reads it", async () => {
		const { char, actor } = blessed({ "customFollowers.abc": { name: "Guide", hpMax: 6 } });
		const sheet = sheetFor(char, actor);
		await sheet._onFollowerPartyToggle({ currentTarget: { dataset: { switch: "wholeParty", ftype: "custom", slug: "abc" }, checked: true } });
		expect(actor.update).toHaveBeenLastCalledWith({ [`flags.${S}.customFollowers.abc.wholeParty`]: true });
		const card = sheet._buildFollowersData(BLESSED).custom.find(c => c.slug === "abc");
		expect(card).toMatchObject({ wholeParty: true, party: false });
	});
});

// ── FOL-8: Strengthen Your Bond, +1 Loyalty to 3, named on its card and in the ledger ──
describe("Strengthen Your Bond (FOL-8)", () => {
	it("steps Loyalty within 0 to 3, and not at all at a bound", () => {
		expect(loyaltyStep(0, 1)).toEqual({ from: 0, to: 1 });
		expect(loyaltyStep(3, 1)).toBeNull();
		expect(loyaltyStep(0, -1)).toBeNull();
		expect(loyaltyStep(5, -1)).toEqual({ from: 3, to: 2 });
	});

	it("raises Loyalty by 1 named for the move, posts a card naming it, and does nothing at 3", async () => {
		globalThis.ChatMessage = { create: vi.fn(), getSpeaker: () => ({ alias: "Cadi" }) };
		const cadi = pc("cadi", { customFollowers: { abc: { loyalty: 1 } } });
		expect(await strengthenBond(cadi, { ftype: "custom", slug: "abc", name: "Maeve", cost: "recognition" })).toEqual({ from: 1, to: 2 });
		expect(cadi.update).toHaveBeenCalledWith({ [`flags.${S}.customFollowers.abc.loyalty`]: 2 }, { stonetopMove: "Strengthen Your Bond" });
		expect(ChatMessage.create.mock.calls[0][0].content).toContain("Strengthen Your Bond");
		const full = pc("full", { customFollowers: { abc: { loyalty: 3 } } });
		expect(await strengthenBond(full, { ftype: "custom", slug: "abc" })).toBeNull();
		expect(full.update).not.toHaveBeenCalled();
	});

	it("draws a Pay cost button greyed at 3, and the card knows when it is", () => {
		expect(read("templates/actor/partials/tab-followers.hbs")).toMatch(/class="stonetop-pay-cost[\s\S]*\{\{#if loyaltyAtMax\}\}disabled/);
		const { char, actor } = blessed({ "customFollowers.abc": { name: "Maeve", hpMax: 6, loyalty: 3 } });
		expect(sheetFor(char, actor)._buildFollowersData(BLESSED).custom.find(c => c.slug === "abc").loyaltyAtMax).toBe(true);
	});

	// p.464: "if an NPC follows the party as a whole, then any PC can generate or spend that follower's Loyalty".
	it("lets any PC move the Loyalty of a follower of the party as a whole, through the GM, and no one else's", async () => {
		const query = vi.fn(async () => ({ from: 1, to: 2 }));
		const gm = { query };
		const user = { id: "p2", owns: "dewi" };
		globalThis.game = { ...realGame, actors: [pc("dewi", {}, { owner: false })] };
		const tied = pc("cadi", { customFollowers: { abc: { loyalty: 1 } } }, { owner: false });
		expect(await changeFollowerLoyalty(tied, { ftype: "custom", slug: "abc", delta: 1 }, { gm, user })).toBeNull();
		expect(query).not.toHaveBeenCalled();
		const shared = pc("cadi", { customFollowers: { abc: { loyalty: 1, wholeParty: true } } }, { owner: false });
		expect(await changeFollowerLoyalty(shared, { ftype: "custom", slug: "abc", delta: 1 }, { gm, user })).toEqual({ from: 1, to: 2 });
		expect(query.mock.calls[0][0]).toBe(FOLLOWER_LOYALTY_QUERY);
	});

	it("is moved by the GM's client only for an asker the rule allows", async () => {
		const shared = pc("cadi", { customFollowers: { abc: { loyalty: 1, wholeParty: true } } }, { owner: false });
		const tied = pc("tied", { customFollowers: { abc: { loyalty: 1 } } }, { owner: false });
		globalThis.game = { ...realGame, user: { id: "gm", isGM: true }, users: { activeGM: { id: "gm" }, get: id => ({ id, isGM: false, owns: "dewi" }) } };
		const deps = { resolve: uuid => ({ "Actor.cadi": shared, "Actor.tied": tied })[uuid], actors: [pc("dewi", {}, { owner: false })] };
		expect(await handleFollowerLoyaltyQuery({ characterUuid: "Actor.tied", ftype: "custom", slug: "abc", delta: 1, userId: "p2" }, {}, deps)).toBeNull();
		expect(await handleFollowerLoyaltyQuery({ characterUuid: "Actor.cadi", ftype: "custom", slug: "abc", delta: -1, userId: "p2" }, {}, deps)).toEqual({ from: 1, to: 0 });
		expect(shared.update).toHaveBeenCalledWith({ [`flags.${S}.customFollowers.abc.loyalty`]: 0 }, { stonetopMove: "Spend Loyalty" });
	});
});

// ── FOL-9: the fallen take no orders ──
describe("a fallen follower's card (FOL-9)", () => {
	it("offers no Order, on the sheet or from the map", () => {
		const { char, actor } = blessed({
			"customFollowers.dead": { name: "Garet", hpMax: 6, dead: true },
			"customFollowers.live": { name: "Eira", hpMax: 6 },
		});
		const cards = sheetFor(char, actor)._buildFollowersData(BLESSED).custom;
		expect(cards.find(c => c.slug === "dead").canOrder).toBe(false);
		expect(cards.find(c => c.slug === "live").canOrder).toBe(true);
		const cadi = pc("cadi", { customFollowers: { dead: { dead: true } } });
		expect(followerOrderInfo(npc("g"), { character: cadi, ftype: "custom", slug: "dead" })).toBeNull();
	});

	it("greys Spend Loyalty on a fallen card", () => {
		expect(read("templates/actor/partials/tab-followers.hbs"))
			.toMatch(/class="stonetop-spend-loyalty[\s\S]{0,400}\{\{#if dead\}\}disabled/);
	});
});

// ── FOL-11: the rule a fed follower heals by is on p.240 ──
describe("the camp heal's citation (FOL-11)", () => {
	it("cites p.240 for \"A PC or follower regains HP when\"", () => {
		expect(read("module/camp/camp-followers.js").split("\n")[0]).toContain("Book I p.240");
		expect(read("module/actors/character/follower-party.js")).not.toContain("p.248");
	});
});

// ── The RAW re-check of these fixes (2026-10-09): FO-1 to FO-4 ──
const door = await import("../../../module/actors/character/follower-deaths-door.js");
const { isDeathsDoorCard } = await import("../../../module/actors/character/deaths-door.js");
const { customFollowerOutOfOrders } = await import("../../../module/fight/follower-fight.js");
const { FakeActorBuilder } = await import("../../fakes/FakeActorBuilder.js");

const SIR = "Sir, Permission to Die, Sir";
function doorSheet({ flags = {}, items = [] } = {}) {
	const actor = new FakeActorBuilder().withName("Rhianna").withFlags(flags).withItems(items).build();
	actor.id = "marshal-1";
	actor.uuid = "Actor.marshal-1";
	actor.isOwner = true;
	const Base = class {
		constructor() { this._actor = actor; }
		get actor() { return this._actor; }
		get isEditable() { return true; }
		async getData() { return {}; }
		activateListeners() {}
		render = vi.fn();
	};
	return { sheet: new (createStonetopCharacterSheetClass(Base))(), actor };
}

// FO-1. The Marshal: "When one of your followers would die, you can spend 1 of their Loyalty to have them
// survive (out of the action, but alive). If you let them go, mark XP." A Door 6- is "would die".
describe("a follower's Death's Door 6- and SIR, PERMISSION TO DIE, SIR (FO-1)", () => {
	const row = { follower: "custom", slug: "abc", index: null, name: "Maeve" };
	const flags = { customFollowers: { abc: { name: "Maeve", hpMax: 6, hpCurrent: 0, loyalty: 2 } } };

	it("writes the fate dialog's Dead straight away for a leader without the move", async () => {
		const { sheet } = doorSheet({ flags });
		sheet._resolveFollowerFate = vi.fn(async () => {});
		sheet._openFollowerFate = vi.fn();
		expect(await sheet._followerDoorDeath(row)).toBe(true);
		expect(sheet._resolveFollowerFate).toHaveBeenCalledWith("dead", expect.objectContaining({ follower: "custom", slug: "abc", name: "Maeve" }));
		expect(sheet._openFollowerFate).not.toHaveBeenCalled();
	});

	it("with the move, opens Dead and the spare with the let-go box ticked, and settles on the choice", async () => {
		const { sheet } = doorSheet({ flags, items: [{ type: "move", name: SIR, flags: {} }] });
		const open = sheet._openFollowerFate.bind(sheet);
		let dialog = null;
		sheet._openFollowerFate = opts => (dialog = open(opts));
		sheet._resolveFollowerFate = vi.fn(async () => {});
		const settled = sheet._followerDoorDeath(row);
		const data = dialog.getData();
		expect(data).toMatchObject({ door: true, canSpare: true, letGo: true });
		const html = await renderTemplate("systems/stonetop-pwd/templates/dialogs/follower-fate.hbs", data);
		expect(html).toMatch(/data-action="dead"/);
		expect(html).toMatch(/data-action="spare"/);
		expect(html).toMatch(/<input type="checkbox" class="stonetop-ff-let-go" checked>/);
		expect(html).not.toMatch(/data-action="deathsdoor"|data-action="dying"/);
		dialog._chosen = true;
		await dialog._onChoose("dead", { letGo: true });
		expect(await settled).toBe(true);
		expect(sheet._resolveFollowerFate).toHaveBeenCalledWith("dead", expect.objectContaining({ slug: "abc", letGo: true, loyalty: 2 }));
	});

	it("gives the card its button back when the window closes with nothing chosen", async () => {
		const { sheet } = doorSheet({ flags, items: [{ type: "move", name: SIR, flags: {} }] });
		const open = sheet._openFollowerFate.bind(sheet);
		let dialog = null;
		sheet._openFollowerFate = opts => (dialog = open(opts));
		const settled = sheet._followerDoorDeath(row);
		await dialog.close();
		expect(await settled).toBe(false);
	});
});

// FO-2. p.244 "they're Aiding the Death's Door roll"; p.212 Aid: "they gain advantage on their roll".
describe("a follower's Death's Door roll is the follower's (FO-2)", () => {
	const row = { follower: "custom", slug: "abc", index: null, name: "Maeve" };
	const leader = (source) => {
		const a = pc("cadi");
		a.typedActor = {
			heldAdvantage: () => (source ? { sources: source.split(" & "), source } : null),
			releaseHeldAdvantage: vi.fn(async () => true),
			holdAdvantage: vi.fn(async () => {}),
		};
		return a;
	};

	it("is named for the follower, so it is not read as the leader's own Door card", () => {
		const opts = door.followerDoorRollOptions(row);
		expect(opts.moveName).toBe("Maeve: Death's Door");
		expect(isDeathsDoorCard({ getFlag: () => ({ move: opts.moveName }) })).toBe(false);
	});

	it("picks out only an Aid's part of what the leader holds", () => {
		expect(door.aidAdvantageSources({ sources: ["A peaceful night's rest", "Dewi's Aid"] })).toEqual(["Dewi's Aid"]);
		expect(door.aidAdvantageSources({ sources: ["A peaceful night's rest"] })).toEqual([]);
		// Read from the list, never cut out of the joined line: a name with its own " & " stays whole.
		expect(door.aidAdvantageSources({ sources: ["Rhys & Dewi's Aid", "A peaceful night's rest"] })).toEqual(["Rhys & Dewi's Aid"]);
		expect(door.aidAdvantageSources(null)).toEqual([]);
	});

	it("rolls +nothing as a follower, with the Aid's advantage when its ticked line is kept, spending only that", async () => {
		const cadi = leader("A peaceful night's rest & Dewi's Aid");
		const prompt = vi.fn(async () => ({ situational: 0, takenOffers: ["aid"] }));
		const roll = vi.fn(async () => ({ total: 9 }));
		await door.rollFollowerDeathsDoor(cadi, row, { roll, prompt });
		expect(prompt.mock.calls[0][0].offers).toEqual([expect.objectContaining({ key: "aid", applied: true })]);
		expect(roll).toHaveBeenCalledWith("follower", cadi, expect.objectContaining({
			statValue: 0, modifier: 0, noXpOnMiss: true, rollMode: "adv", conditionNotes: ["Dewi's Aid"],
		}));
		expect(cadi.typedActor.releaseHeldAdvantage).toHaveBeenCalledTimes(1);
		expect(cadi.typedActor.releaseHeldAdvantage).toHaveBeenCalledWith("Dewi's Aid");
	});

	it("leaves the leader's own promises alone, takes the window's mode, and gives an Aid back when no dice are thrown", async () => {
		const own = leader("A peaceful night's rest");
		const roll = vi.fn(async () => ({ total: 4 }));
		await door.rollFollowerDeathsDoor(own, row, { roll, prompt: vi.fn(async () => ({ rollMode: "dis", situational: 0 })) });
		expect(roll.mock.calls[0][2].rollMode).toBe("dis");
		expect(own.typedActor.releaseHeldAdvantage).not.toHaveBeenCalled();

		const aided = leader("Dewi's Aid");
		await door.rollFollowerDeathsDoor(aided, row, { roll: vi.fn(async () => null), prompt: vi.fn(async () => ({ situational: 0, takenOffers: ["aid"] })) });
		expect(aided.typedActor.holdAdvantage).toHaveBeenCalledWith(["Dewi's Aid"]);

		const closed = vi.fn();
		expect(await door.rollFollowerDeathsDoor(aided, row, { roll: closed, prompt: vi.fn(async () => null) })).toBeNull();
		expect(closed).not.toHaveBeenCalled();
	});

	it("reads the tier its buttons act on off the card as it is now", () => {
		const card = total => ({ rolls: [{ total }], getFlag: () => null });
		expect(door.followerDoorCardTier(card(11))).toBe("success");
		expect(door.followerDoorCardTier(card(5))).toBe("failure");
		expect(door.followerDoorCardTier({ rolls: [] })).toBeNull();
	});
});

// FO-3. Book II p.561: "this batch breaks free of your control and are no longer followers".
describe("a Servant batch that broke free takes no orders (FO-3)", () => {
	it("is out of orders like the fallen, on the map and on the sheet", () => {
		expect(customFollowerOutOfOrders({ customFollowers: { b: { brokenFree: true } } }, "custom", "b")).toBe(true);
		expect(customFollowerOutOfOrders({ customFollowers: { b: { dead: true } } }, "custom", "b")).toBe(true);
		expect(customFollowerOutOfOrders({ customFollowers: { b: {} } }, "custom", "b")).toBe(false);
		const cadi = pc("cadi", { customFollowers: { b: { brokenFree: true } } });
		expect(followerOrderInfo(npc("s"), { character: cadi, ftype: "custom", slug: "b" })).toBeNull();
		const { char, actor } = blessed({ "customFollowers.b": { name: "Servants", hpMax: 6, brokenFree: true } });
		expect(sheetFor(char, actor)._buildFollowersData(BLESSED).custom.find(c => c.slug === "b").canOrder).toBeFalsy();
	});
});

// FO-4. Book II p.560: the servants print no cost, only "sharing a pool of Loyalty with the Ring itself".
describe("no Pay cost on a Servant of Daagon batch (FO-4)", () => {
	it("draws Pay cost only on a card that is not a Servant batch, and keeps Spend", () => {
		const hbs = read("templates/actor/partials/tab-followers.hbs");
		expect(hbs).toMatch(/\{\{#unless isServant\}\}\s*<button type="button" class="stonetop-pay-cost/);
		expect(hbs).toMatch(/stonetop-pay-cost[\s\S]*?<\/button>\s*\{\{\/unless\}\}\s*\{\{!-- Spend Loyalty/);
	});
});
