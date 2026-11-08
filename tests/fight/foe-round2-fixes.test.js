import { describe, it, expect, vi, afterEach } from "vitest";
import { SYSTEM_ID } from "../../module/system-id.js";
import {
	ORDER_COUNTERED_FLAG, ORDER_DAMAGE_FLAG, ORDER_FLAG, followerIsDown, orderCardFlags, reconcileOrderedClashCounter,
	rewriteOwesCounter, strikeOrderCounter,
} from "../../module/fight/follower-order-attack.js";
import { SHIFTS_KEPT, remapRosterRow, resolveRosterRef, rosterRef, rosterStamp, rowButtonData, rowFromButton, withRosterShift } from "../../module/actors/character/follower-roster-shifts.js";
import { crewMemberDeathUpdate, crewIndividualRemovalUpdate } from "../../module/actors/character/follower-fate.js";
import { doorUpRow } from "../../module/actors/character/follower-deaths-door.js";
import { rosterHitHolder, rosterHitNow } from "../../module/fight/group-hits.js";
import { monsterDamageNotes } from "../../module/data/monster-armor.js";
import { followerExtraBlows } from "../../module/fight/follower-fight.js";
import { groupPoolCard, groupPoolRow, groupTokensOn, loneGroupToken, poolMirrorFor } from "../../module/actors/character/follower-group-pool.js";
import { onUpdateActorFollowerNpc } from "../../module/fight/roster-fate.js";
import { fateReopenButton } from "../../module/actors/character/follower-fate-pick.js";
import { arcanaSummon } from "../../module/data/arcana-summons.js";
import { followerRefresh } from "../../module/migration/follower-refresh.js";
import { followerArmorGate } from "../../module/actors/character/move-armor.js";
import { handleFollowerLoyaltyQuery } from "../../module/actors/character/follower-bond.js";

const S = SYSTEM_ID;

/** A chat message whose flags live in a plain object, as Foundry's would. */
function card(flags = {}, { total = 7, rolled = null } = {}) {
	const store = { [S]: { ...flags } };
	return {
		id: "order1",
		rolls: [{ total }],
		getFlag: (scope, key) => store[scope]?.[key],
		setFlag: vi.fn(async (scope, key, value) => { store[scope][key] = value; }),
		store,
		rolled,
	};
}

// ── FOE-1: an ordered Clash's counter-blow, struck once per card ───────────────────────────────────────────────
describe("an ordered Clash's counter-blow (FOE-1, Book I p.215)", () => {
	it("a rewrite owes it on a 6-, and on a 7-9 only once the damage was dealt from a 10+; never twice", () => {
		expect(rewriteOwesCounter({ move: "clash", tier: "failure" })).toBe(true);
		expect(rewriteOwesCounter({ move: "clash", tier: "partial", pressed: true })).toBe(true);
		// A 7-9 not yet pressed strikes it from its own button.
		expect(rewriteOwesCounter({ move: "clash", tier: "partial", pressed: false })).toBe(false);
		expect(rewriteOwesCounter({ move: "clash", tier: "success", pressed: true })).toBe(false);
		expect(rewriteOwesCounter({ move: "clash", tier: "failure", countered: true })).toBe(false);
		expect(rewriteOwesCounter({ move: "let-fly", tier: "failure" })).toBe(false);
	});

	it("is latched on the card, so a second strike (a 6- lifted onto a 7-9 and pressed) does nothing", async () => {
		const suffers = vi.fn(async () => true);
		const marshal = { sheet: { _followerSuffersCounter: suffers } };
		const message = card();
		const order = { ftype: "crew", slug: "", name: "The Crew", member: "anon:2", memberName: "Crew member 4" };
		expect(await strikeOrderCounter(message, marshal, order)).toBe(true);
		expect(message.store[S][ORDER_COUNTERED_FLAG]).toBe(true);
		expect(suffers).toHaveBeenCalledWith({ ftype: "crew", slug: "" }, { member: "anon:2", name: "Crew member 4", counterOf: "order1" });
		expect(await strikeOrderCounter(message, marshal, order)).toBe(false);
		expect(suffers).toHaveBeenCalledTimes(1);
	});

	it("a card moved down onto a 6- strikes the blow it never took; one already countered strikes none", async () => {
		const suffers = vi.fn(async () => true);
		const marshal = { sheet: { _followerSuffersCounter: suffers } };
		const flags = orderCardFlags({ ftype: "custom", slug: "a1", name: "Andras" }, "clash")[S];
		const fresh = card(flags, { total: 5 });
		expect(await reconcileOrderedClashCounter(fresh, marshal, 5)).toBe(true);
		expect(await reconcileOrderedClashCounter(fresh, marshal, 5)).toBe(false);
		// A 10+ already pressed, moved down onto 7-9: "you deal your damage but suffer the enemy's attack".
		const pressed = card({ ...flags, [ORDER_DAMAGE_FLAG]: true }, { total: 8 });
		expect(await reconcileOrderedClashCounter(pressed, marshal, 8)).toBe(true);
		// Let Fly has no counter-blow; a card with no order flag is anybody's.
		expect(await reconcileOrderedClashCounter(card(orderCardFlags({ ftype: "crew" }, "let-fly")[S], { total: 5 }), marshal, 5)).toBe(false);
		expect(await reconcileOrderedClashCounter(card({}, { total: 5 }), marshal, 5)).toBe(false);
		expect(suffers).toHaveBeenCalledTimes(2);
	});

	it("the order card names who was ordered, member included, for Apply to land a member's counter on them", () => {
		expect(orderCardFlags({ ftype: "crew", slug: "", name: "Glaw", member: "named:0", memberName: "Glaw" }, "clash"))
			.toEqual({ [S]: { [ORDER_FLAG]: { move: "clash", ftype: "crew", slug: "", name: "Glaw", member: "named:0", memberName: "Glaw" } } });
	});
});

// ── FOE-3: ordering a follower who is down is said, never refused ───────────────────────────────────────────────
describe("followerIsDown (FOE-3, Book I p.469)", () => {
	it("a one-body follower at 0 HP, or a group with nobody standing; never a picked member", () => {
		expect(followerIsDown({ hp: { value: 0, max: 6 } })).toBe(true);
		expect(followerIsDown({ hp: { value: 3, max: 6 } })).toBe(false);
		// Unset HP is full.
		expect(followerIsDown({ hp: { value: undefined, max: 6 } })).toBe(false);
		expect(followerIsDown({ hp: { value: 4, max: 6 } }, { standing: 0, size: 5 })).toBe(true);
		expect(followerIsDown({ hp: { value: 0, max: 6 } }, { standing: 2, size: 5 })).toBe(false);
		expect(followerIsDown({ hp: { value: 0, max: 6 } }, null, { member: "anon:1" })).toBe(false);
	});
});

// ── FOE-2: a roster row remembered by index, read back through the cuts made since ──────────────────────────────
describe("roster shifts (FOE-2)", () => {
	const crewWith = shifts => ({ crew: { rosterShifts: shifts } });

	it("numbers each cut and keeps the last SHIFTS_KEPT", () => {
		let list = [];
		for (let i = 0; i < SHIFTS_KEPT + 5; i += 1) list = withRosterShift(list, "crew-member", 0);
		expect(list).toHaveLength(SHIFTS_KEPT);
		expect(list.at(-1).n).toBe(SHIFTS_KEPT + 5);
		expect(rosterStamp(crewWith(list), "crew-member")).toBe(SHIFTS_KEPT + 5);
		expect(rosterStamp({}, "crew-member")).toBe(0);
	});

	it("a member below the cut moves up; the cut member is gone; one above, or on the other list, stays", () => {
		const flags = crewWith(withRosterShift([], "crew-member", 2));
		expect(remapRosterRow(flags, { follower: "crew-member", index: 4 }, 0)).toEqual({ follower: "crew-member", index: 3 });
		expect(remapRosterRow(flags, { follower: "crew-member", index: 2 }, 0)).toBeNull();
		expect(remapRosterRow(flags, { follower: "crew-member", index: 1 }, 0)).toEqual({ follower: "crew-member", index: 1 });
		expect(remapRosterRow(flags, { follower: "crew-individual", index: 4 }, 0)).toEqual({ follower: "crew-individual", index: 4 });
		// Remembered after the cut: already right.
		expect(remapRosterRow(flags, { follower: "crew-member", index: 4 }, 1)).toEqual({ follower: "crew-member", index: 4 });
		// No stamp (a card from before this): as it was.
		expect(remapRosterRow(flags, { follower: "crew-member", index: 4 }, null)).toEqual({ follower: "crew-member", index: 4 });
	});

	it("a member named out of the tail is followed onto the named list", () => {
		const flags = crewWith(withRosterShift([], "crew-member", 1, { row: "crew-individual", index: 3 }));
		expect(remapRosterRow(flags, { follower: "crew-member", index: 1 }, 0)).toEqual({ follower: "crew-individual", index: 3 });
	});

	it("the fate's Dead and the Remove button log their cut", () => {
		const crew = { size: 6, individuals: [{ name: "Aled" }], individualsHp: { 0: 0 }, memberHp: [6, 0, 6, 0, 6] };
		expect(crewMemberDeathUpdate(crew, "crew-member", 1)[`flags.${S}.crew.rosterShifts`]).toEqual([{ n: 1, row: "crew-member", index: 1 }]);
		expect(crewIndividualRemovalUpdate(crew, 0)[`flags.${S}.crew.rosterShifts`]).toEqual([{ n: 1, row: "crew-individual", index: 0 }]);
	});

	it("Death's Door's 10+ never lowers a healthy member to 1: the card's row is read through the cut", () => {
		// #2 and #4 were down; #2 was struck off (cut 1), so #4 now sits at index 3 and the full-HP #5 at index 4.
		const flags = { crew: { memberHp: [6, 6, 0, null], rosterShifts: [{ n: 1, row: "crew-member", index: 2 }] } };
		const row = rowFromButton({ dataset: { follower: "crew-member", slug: "", index: "3", name: "Crew member 5", stamp: "0" } });
		// index 3 at stamp 0 is index 2 now, still down.
		expect(doorUpRow(flags, row)).toEqual(expect.objectContaining({ follower: "crew-member", index: 2 }));
		// The card for #2 itself: struck off, nothing written.
		expect(doorUpRow(flags, { follower: "crew-member", slug: "", index: 2, stamp: 0 })).toBeNull();
		// A row that is standing now (healed meanwhile) is not lowered.
		expect(doorUpRow(flags, { follower: "crew-member", slug: "", index: 0, stamp: 1 })).toBeNull();
	});

	it("the Door button carries the roster's number", () => {
		const html = rowButtonData({ follower: "crew-member", index: 3, name: "x", stamp: 7 });
		expect(html).toContain('data-stamp="7"');
		expect(rowButtonData({ follower: "custom", slug: "a" })).not.toContain("data-stamp");
	});

	it("a ref is a row with the roster's number now, read back through the cuts made since", () => {
		const flags = { crew: { rosterShifts: withRosterShift([], "crew-member", 0) } };
		const ref = rosterRef(flags, { follower: "crew-member", slug: "", index: 2, name: "Crew member 4" });
		expect(ref).toEqual({ follower: "crew-member", slug: "", index: 2, name: "Crew member 4", stamp: 1 });
		expect(resolveRosterRef(flags, ref)).toEqual({ follower: "crew-member", index: 2 });
		const later = { crew: { rosterShifts: withRosterShift(flags.crew.rosterShifts, "crew-member", 1) } };
		expect(resolveRosterRef(later, ref)).toEqual({ follower: "crew-member", index: 1 });
		// A row no cut can move comes back as it was, index and all.
		expect(resolveRosterRef(later, { follower: "beast", index: null, stamp: 0 })).toEqual({ follower: "beast", index: null });
		expect(resolveRosterRef(later, {})).toBeNull();
	});

	it("an unstamped damage card's \"Took it\" is refused once the row no longer holds that member as the blow left them", () => {
		const card = { ftype: "crew", slug: "" };
		const flags = { crew: { size: 4, individuals: [{ name: "Aled" }], individualsHp: { 0: 2 }, memberHp: [6, 1, 6] } };
		expect(rosterHitNow(flags, card, { key: "named:0", name: "Aled", newHp: 2 }, 6)).toBe("named:0");
		expect(rosterHitNow(flags, card, { key: "named:0", name: "Bryn", newHp: 2 }, 6)).toBeNull();
		expect(rosterHitNow(flags, card, { key: "anon:1", name: "Crew member 3", newHp: 1 }, 6)).toBe("anon:1");
		// Someone else moved into the slot (at full HP) after the hurt member was struck off.
		expect(rosterHitNow(flags, card, { key: "anon:0", name: "Crew member 2", newHp: 0 }, 6)).toBeNull();
	});

	it("a stamped damage card's \"Took it\" follows its member through the cuts made since", () => {
		const card = { ftype: "crew", slug: "" };
		// The hurt member was anon:2 at stamp 0; anon:0 was struck off since (cut 1), so they sit at anon:1 now.
		const flags = { crew: { size: 4, individuals: [], memberHp: [6, 1, 6], rosterShifts: withRosterShift([], "crew-member", 0) } };
		expect(rosterHitNow(flags, card, { key: "anon:2", name: "Crew member 3", newHp: 1, stamp: 0 }, 6)).toBe("anon:1");
		// The member who took it was the one struck off: gone.
		expect(rosterHitNow(flags, card, { key: "anon:0", name: "Crew member 1", newHp: 1, stamp: 0 }, 6)).toBeNull();
		// Found, but no longer as the blow left them (healed since).
		expect(rosterHitNow(flags, card, { key: "anon:2", name: "Crew member 3", newHp: 3, stamp: 0 }, 6)).toBeNull();
		// Named out of the tail since: followed onto the named list.
		const named = { crew: { size: 4, individuals: [{ name: "Cai" }], individualsHp: { 0: 1 }, memberHp: [6, 6],
			rosterShifts: withRosterShift([], "crew-member", 1, { row: "crew-individual", index: 0 }) } };
		expect(rosterHitNow(named, card, { key: "anon:1", name: "Crew member 2", newHp: 1, stamp: 0 }, 6)).toBe("named:0");
	});

	it("the \"Took it\" picker selects whoever has the blow now, not the row the card recorded", () => {
		const flags = { crew: { size: 4, individuals: [], memberHp: [6, 1, 6], rosterShifts: withRosterShift([], "crew-member", 0) } };
		const character = { flags: { [SYSTEM_ID]: flags } };
		const members = [{ key: "anon:0", name: "Crew member 1" }, { key: "anon:1", name: "Crew member 2" }, { key: "anon:2", name: "Crew member 3" }];
		const group = { character, ftype: "crew", slug: "", hpMax: 6, members };
		const roster = { key: "anon:2", name: "Crew member 3", newHp: 1, stamp: 0, ftype: "crew", slug: "", hpMax: 6 };
		expect(rosterHitHolder(roster, group)).toEqual({ key: "anon:1", name: "Crew member 2" });
		// Not found (healed since): the card's own record stands.
		expect(rosterHitHolder({ ...roster, newHp: 4 }, group)).toEqual({ key: "anon:2", name: "Crew member 3" });
		expect(rosterHitHolder(roster, null)).toEqual({ key: "anon:2", name: "Crew member 3" });
	});
});

// ── FOE-5: a fate window closed with nothing picked ──────────────────────────────────────────────────────────────
describe("the out-of-the-action card (FOE-5, Book I p.469)", () => {
	it("its button carries the fate it reopens, stamp included", () => {
		const html = fateReopenButton({ follower: "crew-member", slug: "", index: 2, name: "Glaw", stamp: 4 });
		expect(html).toContain("stonetop-follower-fate-reopen");
		const btn = { dataset: Object.fromEntries([...html.matchAll(/data-([a-z]+)="([^"]*)"/g)].map(m => [m[1], m[2]])) };
		expect(rowFromButton(btn)).toEqual({ follower: "crew-member", slug: "", index: 2, name: "Glaw", stamp: 4 });
	});
});

// ── FOE-6: damage-taken clauses printed inside a monster's move ──────────────────────────────────────────────────
describe("monsterDamageNotes from moves (FOE-6)", () => {
	it("says a move's harm-taken clause with the move it holds for, and never a move's own tags or harm dealt", () => {
		const notes = monsterDamageNotes({ qualities: "" }, { moves: [
			"Shape a hulking form from peat, soil, and mud (takes half damage from stabbing, slashing, or fire)",
			"Bite down and crush bone, shred muscle, tear apart (+messy, 3 piercing)",
			"Engulf a living being, charring both flesh and soul (advantage, debilities, harms even fireproof foes)",
		] });
		expect(notes).toEqual(["Takes half damage from stabbing, slashing, or fire (Shape a hulking form from peat, soil, and mud)"]);
		expect(monsterDamageNotes({ qualities: "" })).toEqual([]);
	});
});

// ── The summons' second blows ────────────────────────────────────────────────────────────────────────────────────
describe("followerExtraBlows", () => {
	const npc = (value, rollFormula, moves = []) => ({
		type: "npc", system: { attributes: { damage: { value, rollFormula } } },
		items: moves.map(name => ({ type: "npcMove", name })),
	});

	it("Halix's host's weapon, beside the touch the button already rolls", () => {
		const blows = followerExtraBlows(npc("ghostly touch d4 (hand, ignores armor) or host's weapon d6 (tags vary)", "d4"));
		expect(blows.map(b => b.formula)).toEqual(["d6"]);
		expect(blows[0].title).toMatch(/host's weapon/i);
	});

	it("the storm spirit's lightning, from its move; never a move that costs HP", () => {
		const blows = followerExtraBlows(npc("lashing wind, rain, debris d6 (near, area)", "d6", [
			"Fling lightning from a raging storm, d10+3 (far, forceful, reload)",
			"Leap a barrier (but lose 1d4 HP)",
			"Manifest a storm as it flies",
		]));
		expect(blows.map(b => b.formula)).toEqual(["d10+3"]);
		expect(followerExtraBlows({ type: "monster" })).toEqual([]);
	});
});

// ── The FGT-2 hand-off: a group's pool, on the card and on its token ─────────────────────────────────────────────
describe("a group's pool kept as one (FGT-2 hand-off)", () => {
	const marshal = { uuid: "Actor.m", flags: { [S]: { crew: { groupHp: 6 } } } };
	const tokenActor = (id, hp = 4) => ({ id, type: "npc", system: { attributes: { hp: { value: hp, max: 6 } } }, token: { parent: null } });

	it("maps the crew and a custom group to their pool rows, and back", () => {
		expect(groupPoolRow({ ftype: "crew" })).toEqual({ follower: "crew-group", slug: "" });
		expect(groupPoolRow({ ftype: "custom", slug: "b" }, { customFollowers: { b: { isGroup: true } } })).toEqual({ follower: "custom-group", slug: "b" });
		expect(groupPoolRow({ ftype: "custom", slug: "b" }, { customFollowers: { b: {} } })).toBeNull();
		expect(groupPoolCard({ follower: "crew-group" })).toEqual({ ftype: "crew", slug: "" });
	});

	it("the token's HP written: the card's box follows while the group has ONE token on the scene", () => {
		const one = tokenActor("t1");
		const cardFor = () => ({ character: marshal, ftype: "crew", slug: "" });
		one.token.parent = { tokens: [{ actor: one }] };
		expect(poolMirrorFor(one, 4, { cardFor })).toEqual({ character: marshal, path: "crew.groupHp", value: 4 });
		// Already the card's number: nothing.
		expect(poolMirrorFor(one, 6, { cardFor })).toBeNull();
		// Split into two tokens: each is its own pool, and the card's one number stands for neither.
		const two = tokenActor("t2");
		one.token.parent = { tokens: [{ actor: one }, { actor: two }] };
		expect(poolMirrorFor(one, 4, { cardFor })).toBeNull();
	});

	it("a client that does not answer for the character stops before walking the scene's tokens", () => {
		const one = tokenActor("t1");
		const tokens = { [Symbol.iterator]: vi.fn(function* () { yield { actor: one }; }) };
		one.token.parent = { tokens };
		const cardFor = () => ({ character: marshal, ftype: "crew", slug: "" });
		expect(poolMirrorFor(one, 4, { cardFor, answers: () => false })).toBeNull();
		expect(tokens[Symbol.iterator]).not.toHaveBeenCalled();
		expect(poolMirrorFor(one, 4, { cardFor, answers: () => true })).toEqual({ character: marshal, path: "crew.groupHp", value: 4 });
	});

	it("the scene walk skips a token stamped for another of the character's cards, and stops at a second match", () => {
		const crewToken = (id, origin) => ({ actor: { id, type: "npc", flags: origin ? { [S]: { followerOrigin: origin } } : {} } });
		const companion = crewToken("c", { characterUuid: marshal.uuid, ftype: "animal-companion", slug: "" });
		const tokens = [companion, crewToken("a"), crewToken("b"), crewToken("d")];
		const cardFor = vi.fn(() => ({ character: marshal, ftype: "crew", slug: "" }));
		expect(groupTokensOn(marshal, { ftype: "crew" }, { scene: { tokens }, cardFor }).map(a => a.id)).toEqual(["a", "b", "d"]);
		expect(cardFor.mock.calls.map(([a]) => a.id)).toEqual(["a", "b", "d"]);
		cardFor.mockClear();
		expect(loneGroupToken(marshal, { ftype: "crew" }, { scene: { tokens }, cardFor })).toBeNull();
		expect(cardFor.mock.calls.map(([a]) => a.id)).toEqual(["a", "b"]);
	});

	it("an NPC's HP write looks its card up once, for both mirrors", async () => {
		const one = tokenActor("t1");
		one.token.parent = { tokens: [{ actor: one }] };
		const update = vi.fn(async () => {});
		const character = { ...marshal, update };
		const cardFor = vi.fn(() => ({ character, ftype: "crew", slug: "" }));
		const acted = await onUpdateActorFollowerNpc(one, { system: { attributes: { hp: { value: 4 } } } }, {}, null, { cardFor, answers: () => true });
		expect(acted).toBe(true);
		expect(cardFor.mock.calls.filter(([, opts]) => opts === undefined)).toHaveLength(1);
		expect(update).toHaveBeenCalledWith({ [`flags.${S}.crew.groupHp`]: 4 }, {});
		expect(await onUpdateActorFollowerNpc(one, { name: "x" }, {}, null, { cardFor })).toBe(false);
	});
});

// ── EDG-12: the summoned chimera's and idol's "vs." armor ────────────────────────────────────────────────────────
describe("summons keep their printed armor clause (EDG-12)", () => {
	it("the chimera's 0 vs. bronze and Thistlewik's 2 vs. iron reach the damage card's box", () => {
		const chimera = arcanaSummon("rusty-cauldron").followers[0];
		const idol = arcanaSummon("stone-idol").followers[0];
		expect(followerArmorGate(chimera.armor)).toEqual({ conditional: 4, conditionalSource: "vs. bronze" });
		expect(followerArmorGate(idol.armor)).toEqual({ conditional: 4, conditionalSource: "vs. iron" });
	});

	it("a card summoned with the bare number is corrected; one a player edited is not", () => {
		expect(followerRefresh({ sourceUuid: "rusty-cauldron:unliving-chimera", armor: 4 })).toEqual({ armor: "4 (0 vs. bronze)" });
		expect(followerRefresh({ sourceUuid: "stone-idol:thistlewik", armor: 6 })).toEqual({ armor: "6 (2 vs. iron)" });
		expect(followerRefresh({ sourceUuid: "rusty-cauldron:unliving-chimera", armor: 5 })).toBeNull();
	});
});

// ── EDG-15: a Loyalty ask answered after the asker gave up ───────────────────────────────────────────────────────
describe("the Loyalty relay's late check (EDG-15)", () => {
	const realGame = globalThis.game;
	afterEach(() => { globalThis.game = realGame; });

	it("moves nothing for an ask the player's client no longer waits on", async () => {
		globalThis.game = { ...realGame, user: { id: "gm", isGM: true }, users: { activeGM: { id: "gm" }, get: id => ({ id, isGM: false }) } };
		const cadi = {
			id: "cadi", uuid: "Actor.cadi", type: "character", isOwner: true, flags: { [S]: { customFollowers: { abc: { loyalty: 2 } } } },
			update: vi.fn(async () => {}), testUserPermission: () => true,
		};
		const deps = { resolve: () => cadi, users: globalThis.game.users, actors: [cadi] };
		const data = { characterUuid: "Actor.cadi", ftype: "custom", slug: "abc", delta: -1, userId: "p2", askId: "x1" };
		expect(await handleFollowerLoyaltyQuery(data, {}, { ...deps, asking: async () => false })).toBeNull();
		expect(cadi.update).not.toHaveBeenCalled();
		expect(await handleFollowerLoyaltyQuery(data, {}, { ...deps, asking: async () => true })).toEqual({ from: 2, to: 1 });
	});
});
