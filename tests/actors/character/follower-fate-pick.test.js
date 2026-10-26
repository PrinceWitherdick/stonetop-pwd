// WHO PICKS A FALLEN FOLLOWER'S FATE (audit FOE-8). Book I p.469: "their fate is in your hands ... you pick 1"
// is the GM's; Loyal to the End (the companion's own move) and Sir, Permission to Die, Sir stay the player's;
// with no GM connected the player picks everything, as before.

import { describe, it, expect, vi } from "vitest";
import {
	FOLLOWER_FATE_OPEN_QUERY, FOLLOWER_FATE_SETTLE_QUERY, fateOpener, gmPicksFate, openFollowerFate, openGmFatePick,
	settleFatePick, settleHere, handleFollowerFateOpenQuery, handleFollowerFateSettleQuery, settlingPlayerId,
} from "../../../module/actors/character/follower-fate-pick.js";
import { FollowerFateDialog, fateVariant } from "../../../module/actors/character/dialogs/FollowerFateDialog.js";

const crewFate = { follower: "crew-member", slug: "", index: 2, name: "Glaw" };
const wolfFate = { follower: "animal-companion", slug: "", index: null, name: "Wolf" };
const character = (sheet = {}) => ({ uuid: "Actor.rhianna", type: "character", isOwner: true, sheet: { _openFollowerFate: vi.fn(), ...sheet }, testUserPermission: user => user?.id === "p1" });

describe("fateOpener", () => {
	it("is the GM's pick while a GM is connected, but never the companion's Loyal to the End", () => {
		const gm = { id: "gm" };
		expect(fateOpener(crewFate, { gm })).toBe("gm");
		expect(fateOpener(wolfFate, { gm })).toBe("player");
		expect(fateOpener(crewFate, { gm: null })).toBe("player");
		expect(gmPicksFate(null)).toBe(false);
	});

	it("settles a GM's pick on the character's own player, never a GM", () => {
		const owners = [{ id: "gm", isGM: true, active: true }, { id: "p1", isGM: false, active: true, assigned: true }];
		expect(settlingPlayerId(null, { owners })).toBe("p1");
		expect(settlingPlayerId(null, { owners: [owners[0]] })).toBeNull();
	});
});

describe("openFollowerFate", () => {
	it("with no GM, opens the player's own window, as before", async () => {
		const rhianna = character();
		expect(await openFollowerFate(rhianna, crewFate, { gm: null, me: { id: "p1" } })).toBe("player");
		expect(rhianna.sheet._openFollowerFate).toHaveBeenCalledWith(crewFate);
	});

	it("from a player's client, asks the GM's to open the pick", async () => {
		const rhianna = character();
		const ask = vi.fn(async () => true);
		expect(await openFollowerFate(rhianna, crewFate, { gm: { id: "gm" }, me: { id: "p1" }, ask })).toBe("gm");
		expect(ask).toHaveBeenCalledWith({ id: "gm" }, FOLLOWER_FATE_OPEN_QUERY, { characterUuid: "Actor.rhianna", fate: crewFate, userId: "p1" }, expect.anything());
		expect(rhianna.sheet._openFollowerFate).not.toHaveBeenCalled();
	});

	it("falls back to the player's window when the GM's client does not answer", async () => {
		const rhianna = character();
		expect(await openFollowerFate(rhianna, crewFate, { gm: { id: "gm" }, me: { id: "p1" }, ask: async () => null })).toBe("player");
		expect(rhianna.sheet._openFollowerFate).toHaveBeenCalledWith(crewFate);
	});

	it("on the GM's own client, opens the pick there; the companion still goes to the player", async () => {
		const rhianna = character();
		const openGm = vi.fn(() => ({}));
		expect(await openFollowerFate(rhianna, crewFate, { gm: { id: "gm" }, me: { id: "gm", isGM: true }, openGm })).toBe("gm");
		expect(openGm).toHaveBeenCalledWith(rhianna, crewFate);
		expect(await openFollowerFate(rhianna, wolfFate, { gm: { id: "gm" }, me: { id: "gm", isGM: true }, openGm })).toBe("player");
	});
});

describe("the GM's pick", () => {
	it("offers only the GM's three outcomes, and settles the one chosen", () => {
		let ctx = null, choose = null;
		class Dialog { constructor(_a, c, fn) { ctx = c; choose = fn; } render() { return this; } }
		const settle = vi.fn(async () => "player");
		openGmFatePick(character(), crewFate, { Dialog, settle });
		expect(fateVariant(ctx)).toBe("gmPick");
		expect(ctx).toMatchObject({ name: "Glaw" });
		choose("spare");
		expect(settle).not.toHaveBeenCalled();
		choose("deathsdoor");
		expect(settle).toHaveBeenCalledWith(expect.anything(), crewFate, "deathsdoor");
	});

	it("words the GM's Dead for a crew or group member as the player's window does", () => {
		const ctxs = [];
		class Dialog { constructor(_a, c) { ctxs.push(c); } render() { return this; } }
		openGmFatePick(character(), crewFate, { Dialog, settle: vi.fn() });
		openGmFatePick(character(), { ...crewFate, follower: "custom-member" }, { Dialog, settle: vi.fn() });
		openGmFatePick(character(), { ...crewFate, follower: "initiate" }, { Dialog, settle: vi.fn() });
		expect(ctxs.map(c => [!!c.isCrewMember, !!c.isGroupMember])).toEqual([[true, false], [false, true], [false, false]]);
	});

	it("is settled on the player's client when one is online, else here", async () => {
		const rhianna = character();
		const query = vi.fn(async () => true);
		const here = vi.fn(async () => true);
		const users = { get: id => (id === "p1" ? { id: "p1", query } : null) };
		expect(await settleFatePick(rhianna, crewFate, "dead", { users, me: { id: "gm" }, playerId: "p1", here })).toBe("player");
		expect(query).toHaveBeenCalledWith(FOLLOWER_FATE_SETTLE_QUERY,
			{ characterUuid: "Actor.rhianna", fate: crewFate, action: "dead", userId: "gm", askId: expect.any(String) }, expect.anything());
		expect(here).not.toHaveBeenCalled();
		expect(await settleFatePick(rhianna, crewFate, "dying", { users, me: { id: "gm" }, playerId: null, here })).toBe("here");
		expect(here).toHaveBeenCalledWith(rhianna, crewFate, "dying");
		expect(await settleFatePick(rhianna, crewFate, "spare", { users, me: { id: "gm" }, playerId: null, here })).toBeNull();
	});

	it("Dead goes through the Marshal's would-die window; the others through the sheet's own fate", async () => {
		const sheet = { _followerDoorDeath: vi.fn(async () => true), _resolveFollowerFate: vi.fn(async () => {}), _followerFateLoyalty: () => 1 };
		const rhianna = character(sheet);
		await settleHere(rhianna, crewFate, "dead");
		expect(sheet._followerDoorDeath).toHaveBeenCalledWith({ follower: "crew-member", slug: "", index: 2, name: "Glaw", gmDead: true });
		await settleHere(rhianna, crewFate, "deathsdoor");
		expect(sheet._resolveFollowerFate).toHaveBeenCalledWith("deathsdoor", { name: "Glaw", loyalty: 1, follower: "crew-member", slug: "", index: 2 });
	});
});

describe("the queries", () => {
	it("the GM opens a pick only for an owner of the character, and never the companion's", () => {
		const savedGame = globalThis.game;
		globalThis.game = { ...savedGame, user: { id: "gm", isGM: true }, users: { activeGM: { id: "gm" } } };
		try {
			const rhianna = character();
			const open = vi.fn(() => ({}));
			const resolve = () => rhianna;
			expect(handleFollowerFateOpenQuery({ characterUuid: "Actor.rhianna", fate: crewFate }, { user: { id: "p1" } }, { resolve, open })).toBe(true);
			expect(handleFollowerFateOpenQuery({ characterUuid: "Actor.rhianna", fate: crewFate }, { user: { id: "p9" } }, { resolve, open })).toBe(false);
			expect(handleFollowerFateOpenQuery({ characterUuid: "Actor.rhianna", fate: wolfFate }, { user: { id: "p1" } }, { resolve, open })).toBe(false);
			expect(open).toHaveBeenCalledTimes(1);
		} finally {
			globalThis.game = savedGame;
		}
	});

	it("a player settles only a GM's pick, for a character they own", async () => {
		const rhianna = character();
		const settle = vi.fn(async () => true);
		const resolve = () => rhianna;
		expect(await handleFollowerFateSettleQuery({ characterUuid: "x", fate: crewFate, action: "dead" }, { user: { id: "gm", isGM: true } }, { resolve, settle })).toBe(true);
		expect(await handleFollowerFateSettleQuery({ characterUuid: "x", fate: crewFate, action: "dead" }, { user: { id: "p2", isGM: false } }, { resolve, settle })).toBe(false);
		expect(await handleFollowerFateSettleQuery({ characterUuid: "x", fate: crewFate, action: "spare" }, { user: { id: "gm", isGM: true } }, { resolve, settle })).toBe(false);
		expect(settle).toHaveBeenCalledTimes(1);
	});

	// v13 names no sender, so a payload's GM id is only the sender's word: a player naming the GM must not push a
	// settle onto another player's client. The named GM's client is asked whether it sent the ask.
	it("on v13 a settle naming the GM counts only once that GM's client says it sent it", async () => {
		const savedGame = globalThis.game;
		globalThis.game = { ...savedGame, user: { id: "p1", isGM: false } };
		try {
			const rhianna = character();
			const settle = vi.fn(async () => true);
			const gmQuery = vi.fn(async () => false);
			const gm = { id: "gm", isGM: true, query: gmQuery };
			const users = { get: id => (id === "gm" ? gm : { id, isGM: false }) };
			const data = { characterUuid: "x", fate: crewFate, action: "dead", userId: "gm", askId: "forged" };
			// A player claiming the GM's id: the GM's client knows no such ask.
			expect(await handleFollowerFateSettleQuery(data, {}, { users, resolve: () => rhianna, settle })).toBe(false);
			expect(gmQuery).toHaveBeenCalledWith("stonetop.ownerAskVerify", { askId: "forged" }, expect.anything());
			// No askId at all is refused without asking.
			gmQuery.mockClear();
			expect(await handleFollowerFateSettleQuery({ ...data, askId: undefined }, {}, { users, resolve: () => rhianna, settle })).toBe(false);
			expect(gmQuery).not.toHaveBeenCalled();
			expect(settle).not.toHaveBeenCalled();
			// The GM's own ask, vouched for.
			gmQuery.mockResolvedValue(true);
			expect(await handleFollowerFateSettleQuery(data, {}, { users, resolve: () => rhianna, settle })).toBe(true);
			expect(settle).toHaveBeenCalledTimes(1);
		} finally {
			globalThis.game = savedGame;
		}
	});

	it("the GM's settle ask is vouched for while it is waited on, and not after", async () => {
		const { handleOwnerAskVerify } = await import("../../../module/utils/owner-ask.js");
		let sent = null, during = null;
		const query = vi.fn(async (_q, data) => { sent = data.askId; during = handleOwnerAskVerify({ askId: data.askId }); return true; });
		const users = { get: () => ({ id: "p1", query }) };
		expect(await settleFatePick(character(), crewFate, "dead", { users, me: { id: "gm" }, playerId: "p1", here: vi.fn() })).toBe("player");
		expect(during).toBe(true);
		expect(handleOwnerAskVerify({ askId: sent })).toBe(false);
	});
});

describe("FollowerFateDialog, the GM's pick and the would-die window", () => {
	it("the GM's pick offers none of the player's choices", () => {
		const data = new FollowerFateDialog({}, { name: "Glaw", loyalty: 2, gmPick: true, isAnimalCompanion: true, sir: { canSpare: true, letGo: true, presence: 1 } }, () => {}).getData();
		expect(data).toMatchObject({ variant: "gmPick", full: true, loyalToTheEnd: false, canSpare: false, canSparePresence: false, letGo: false });
	});

	it("after the GM's Dead, the player gets the spare and the let-go box, and closing lets them die", async () => {
		const chosen = [];
		const dialog = new FollowerFateDialog({}, { name: "Glaw", loyalty: 2, gmDead: true, sir: { canSpare: true, letGo: true } }, (action, opts) => chosen.push([action, opts]));
		expect(dialog.getData()).toMatchObject({ variant: "gmDead", full: false, canSpare: true, letGo: true, closeLabel: "Let them die" });
		dialog.element = { find: () => ({ prop: () => true }) };
		await dialog.close();
		expect(chosen).toEqual([["dead", { letGo: true }]]);
	});

	it("after the GM's Dead, Escape (which closes every window) leaves the window standing and writes no death", async () => {
		const chosen = [];
		const dismissed = vi.fn();
		const dialog = new FollowerFateDialog({}, { name: "Glaw", loyalty: 2, gmDead: true, sir: { canSpare: true, letGo: true }, onDismiss: dismissed }, (action, opts) => chosen.push([action, opts]));
		dialog.element = { find: () => ({ prop: () => true }) };
		await dialog.close({ closeKey: true });
		expect(chosen).toEqual([]);
		expect(dismissed).not.toHaveBeenCalled();
		// Any other window still closes on Escape as it always did.
		const pick = new FollowerFateDialog({}, { name: "Glaw", loyalty: 2, onDismiss: dismissed }, () => {});
		await pick.close({ closeKey: true });
		expect(dismissed).toHaveBeenCalledTimes(1);
	});

	it("reads one variant, from `variant` or from the older flags callers still pass", () => {
		expect(fateVariant({ variant: "door", gmPick: true })).toBe("door");
		expect(fateVariant({ variant: "nonsense" })).toBe("pick");
		expect(fateVariant({ gmPick: true, gmDead: true, door: true })).toBe("gmPick");
		expect(fateVariant({ isAnimalCompanion: true, door: true })).toBe("loyal");
		expect(fateVariant({ gmDead: true, door: true })).toBe("gmDead");
		expect(fateVariant({ gmDead: true })).toBe("gmDead");
		expect(fateVariant({ door: true })).toBe("door");
		expect(fateVariant({})).toBe("pick");
		expect(fateVariant(null)).toBe("pick");
	});

	it("each variant draws its own subtitle, note, close button and choices", async () => {
		const draw = async ctx => renderTemplate("systems/stonetop-pwd/templates/dialogs/follower-fate.hbs", new FollowerFateDialog({}, { name: "Glaw", ...ctx }, () => {}).getData());
		const pick = await draw({});
		expect(pick).toContain("Their fate is in your hands (p.469)");
		expect(pick).toContain("you roll for them");
		expect(pick).toContain("Not lethal / decide later");
		expect(pick).toMatch(/data-action="deathsdoor"[\s\S]*data-action="dying"[\s\S]*data-action="dead"/);
		const gm = await draw({ variant: "gmPick" });
		expect(gm).toContain("GM: their fate is in your hands (p.469)");
		expect(gm).toContain("their PC&#x27;s player rolls for them");
		expect(gm).toContain("once you pick Dead. If the blow wasn&#x27;t lethal");
		const door = await draw({ variant: "door" });
		expect(door).toContain("Death&#x27;s Door, 6-");
		expect(door).toContain("Decide later");
		expect(door).not.toMatch(/data-action="deathsdoor"|data-action="dying"/);
		expect(door).toMatch(/data-action="dead"/);
		const loyal = await draw({ variant: "loyal" });
		expect(loyal).toContain("Loyal to the End: roll for its fate (p.143)");
		expect(loyal).toMatch(/data-action="roll"/);
		expect(loyal).not.toMatch(/data-action="dead"/);
	});
});
