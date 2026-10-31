// The Ghost's BODYSNATCHER (Book I p.149), the user's ruling R1 (2026-10-27): Possess records the host,
// the damage the host takes is lost by the Ghost as HP, automatically, and the record goes on End possession,
// on the 6- ("they force you from their body and you mark a consequence"), at 0 HP, and once the possession
// can no longer stand (the Consequence cleared, the insert swapped). module/actors/character/bodysnatcher.js
// and its buttons in post-death-actions.js.

import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import {
	HOST_FLAG, HOST_HP_LOST_OPTION, bodysnatcherRollOptions, hostHpLost, onPreUpdateHost, onUpdateGhost, onUpdateHost,
	possessedHost, possessorsOf,
} from "../../../module/actors/character/bodysnatcher.js";
import { BODYSNATCHER, loseHp, moveActionsFor, pressCardButton, runPostDeathAction } from "../../../module/actors/character/post-death-actions.js";
import { loseHpForStock } from "../../../module/actors/character/provisions.js";
import { moveRollOptions } from "../../../module/actors/character/move-roll-options.js";
import { loreMoveItemData } from "../../../module/actors/character/post-death-moves.js";
import { HP_CEILING_OPTION, HP_LOSS_OPTION } from "../../../module/actors/character/StonetopFlags.js";
import { MoveDefinition } from "../../../module/model/MoveDefinition.js";
import { makeLiveActor, makeLiveItem } from "../../fakes/LiveCharacter.js";
import { FakeRepositoryFactory } from "../../fakes/FakeRepositoryFactory.js";
import { FakePostDeathInsertRepository } from "../../fakes/FakePostDeathInsertRepository.js";
import { StonetopCharacter } from "../../../module/actors/character/StonetopCharacter.js";
import { stubAsk } from "../../fakes/confirm.js";

const SRC = path.resolve("packs/src/stonetop-items");
const read = file => JSON.parse(fs.readFileSync(path.join(SRC, file), "utf8"));
const INSERTS = ["revenant", "ghost", "thrall"].map(slug => read(`post-death-inserts/${slug}.json`));
const bodysnatcherItem = () => makeLiveItem(loreMoveItemData(new MoveDefinition(read("post-death-moves/ghost/bodysnatcher.json"))));

let rolls;
let posted;
let savedUser;
beforeEach(() => {
	rolls = [];
	posted = [];
	savedUser = globalThis.game.user;
	globalThis.Roll = class {
		constructor(formula) { this.formula = formula; }
		async evaluate() { this.total = /^\d+$/.test(this.formula) ? Number(this.formula) : rolls.shift() ?? 3; this.dice = []; return this; }
		async toMessage(data) { posted.push({ formula: this.formula, ...data }); return data; }
	};
	globalThis.ChatMessage = {
		create: vi.fn(async data => { posted.push(data); return data; }),
		getSpeaker: () => ({ alias: "Wisp" }),
	};
});
afterEach(() => {
	delete globalThis.Roll;
	delete globalThis.ChatMessage;
	globalThis.game.user = savedUser;
});

/** A Ghost holding BODYSNATCHER (unless told otherwise), with `host` recorded if given. */
function ghost({ hp = 8, counts = { "consequences:bodysnatcher": 1 }, slug = "ghost", host = null } = {}) {
	const actor = makeLiveActor({
		name: "Wisp",
		items: [bodysnatcherItem()],
		flags: { postDeathInsert: { slug }, postDeathLore: { counts }, ...(host ? { [HOST_FLAG]: host } : {}) },
	});
	actor.uuid = "Actor.wisp";
	actor.system.attributes.hp.value = hp;
	actor.isOwner = true;
	const char = new StonetopCharacter(actor, new FakeRepositoryFactory({
		postDeathInsert: new FakePostDeathInsertRepository(INSERTS),
		moves: { getPostDeathMoves: async () => [] },
	}));
	actor.typedActor = char;
	return { actor, char };
}
const hostOf = actor => actor.flags["stonetop-pwd"][HOST_FLAG];
const villager = (hp = 10) => ({ uuid: "Scene.s.Token.t.Actor.v", name: "Villager", type: "npc", system: { attributes: { hp: { value: hp } } } });
const ALDRIC = { uuid: "Scene.s.Token.t.Actor.v", name: "Aldric" };
const target = (name, uuid) => ({ name, actor: { uuid } });

describe("Possess records the host", () => {
	it("takes the one token targeted, in the same write as its 1d4", async () => {
		const { actor } = ghost();
		globalThis.game.user = { id: "u1", targets: new Set([target("Aldric", ALDRIC.uuid)]) };
		rolls.push(2);
		actor.update.mockClear();
		expect(await runPostDeathAction(actor, "possess")).toBe(true);
		expect(actor.update).toHaveBeenCalledTimes(1);
		expect(actor.system.attributes.hp.value).toBe(6);
		expect(hostOf(actor)).toEqual(ALDRIC);
		expect(posted.at(-1).flavor).toContain("Possesses Aldric");
	});

	it("asks which, when several are targeted, and never offers the Ghost itself", async () => {
		const { actor } = ghost();
		globalThis.game.user = { id: "u1", targets: new Set([target("Wisp", "Actor.wisp"), target("Aldric", ALDRIC.uuid), target("Bryn", "Actor.bryn")]) };
		const wait = stubAsk("host-1");
		await runPostDeathAction(actor, "possess");
		expect(wait.mock.calls[0][0].buttons.map(b => b.label)).toEqual(["Aldric", "Bryn", "Not yet"]);
		expect(hostOf(actor)).toEqual({ uuid: "Actor.bryn", name: "Bryn" });
	});

	it("with nobody targeted, asks first: not yet writes nothing, anyway bills the 1d4 and records nobody", async () => {
		const { actor } = ghost({ host: ALDRIC });
		globalThis.game.user = { id: "u1", targets: new Set() };
		stubAsk("cancel");
		expect(await runPostDeathAction(actor, "possess")).toBe(false);
		expect(actor.system.attributes.hp.value).toBe(8);

		stubAsk("untracked");
		rolls.push(1);
		expect(await runPostDeathAction(actor, "possess")).toBe(true);
		expect(actor.system.attributes.hp.value).toBe(7);
		// A new body ends the old possession.
		expect(hostOf(actor)).toBeUndefined();
	});
});

describe("the possession's line and its end", () => {
	it("names the host on an End possession button only while one is recorded", async () => {
		expect(moveActionsFor(ghost().actor)[BODYSNATCHER].map(a => a.action)).toEqual(["possess"]);
		const { actor } = ghost({ host: ALDRIC });
		const [, end] = moveActionsFor(actor)[BODYSNATCHER];
		expect(end).toMatchObject({ action: "endPossession", label: "End possession of Aldric" });
		expect(end.tooltip).toContain("You are possessing Aldric");

		expect(await runPostDeathAction(actor, "endPossession")).toBe(true);
		expect(hostOf(actor)).toBeUndefined();
		// The note is escaped (utils/chat.js#postMoveNote), so the apostrophe is an entity.
		expect(posted.at(-1).content).toContain("Wisp leaves Aldric");
	});

	it("speaks only for a Ghost still holding BODYSNATCHER and in play", () => {
		expect(possessedHost(ghost({ host: ALDRIC }).actor)).toEqual(ALDRIC);
		expect(possessedHost(ghost({ host: ALDRIC, counts: {} }).actor)).toBeNull();
		expect(possessedHost(ghost({ host: ALDRIC, slug: "revenant" }).actor)).toBeNull();
	});
});

describe("When your host takes damage, you lose an equal amount of HP", () => {
	it("reads the HP the write takes off the host, floored at 0, and nothing for a heal or a fall in max", () => {
		const { actor } = ghost({ host: ALDRIC });
		const actors = [actor];
		const host = villager(10);
		const options = {};
		onPreUpdateHost(host, { system: { attributes: { hp: { value: 4 } } } }, options, { actors });
		expect(options[HOST_HP_LOST_OPTION]).toBe(6);

		const heal = {};
		onPreUpdateHost(host, { system: { attributes: { hp: { value: 12 } } } }, heal, { actors });
		expect(heal[HOST_HP_LOST_OPTION]).toBeUndefined();

		const ceiling = { [HP_CEILING_OPTION]: true };
		onPreUpdateHost(host, { system: { attributes: { hp: { value: 4 } } } }, ceiling, { actors });
		expect(ceiling[HOST_HP_LOST_OPTION]).toBeUndefined();

		const stranger = {};
		onPreUpdateHost({ ...villager(10), uuid: "Actor.other" }, { system: { attributes: { hp: { value: 4 } } } }, stranger, { actors });
		expect(stranger[HOST_HP_LOST_OPTION]).toBeUndefined();

		expect(hostHpLost(3, -2)).toBe(3);
	});

	it("loses it as HP on the one client that answers for the Ghost", async () => {
		const { actor } = ghost({ host: ALDRIC });
		const loseHp = vi.fn(async () => ({}));
		const options = { [HOST_HP_LOST_OPTION]: 5 };
		const paid = await onUpdateHost(villager(5), {}, options, "gm", { actors: [actor], loseHp, answersFor: () => true });
		expect(paid).toEqual([actor]);
		expect(loseHp).toHaveBeenCalledWith(actor, "5", expect.objectContaining({ moveName: BODYSNATCHER }));
		expect(loseHp.mock.calls[0][2].detail).toContain("Aldric took 5 damage while possessed");

		loseHp.mockClear();
		await onUpdateHost(villager(5), {}, options, "gm", { actors: [actor], loseHp, answersFor: () => false });
		expect(loseHp).not.toHaveBeenCalled();
	});

	it("loses nothing once the possession has lapsed", async () => {
		const { actor } = ghost({ host: ALDRIC, counts: {} });
		const loseHp = vi.fn();
		expect(possessorsOf(villager(), [actor])).toEqual([]);
		await onUpdateHost(villager(5), {}, { [HOST_HP_LOST_OPTION]: 5 }, "gm", { actors: [actor], loseHp, answersFor: () => true });
		expect(loseHp).not.toHaveBeenCalled();
	});

	it("goes through the plain HP writer, so nothing a blow meets stands in the way", async () => {
		const { actor } = ghost({ host: ALDRIC, hp: 8 });
		await onUpdateHost(villager(5), {}, { [HOST_HP_LOST_OPTION]: 3 }, "gm", { actors: [actor], answersFor: () => true });
		expect(actor.system.attributes.hp.value).toBe(5);
		expect(posted.at(-1).formula).toBe("3");
	});

	// The user's ruling, 2026-10-28 (review VG-1): "When your host takes damage" is DAMAGE only. HP the host
	// LOSES is no blow, and the HP-loss writers say so on the write; a GM typing the HP down still counts.
	it("bills damage only: not the host's own HP loss, but a hand edit down still", async () => {
		const { actor } = ghost({ host: ALDRIC });
		const actors = [actor];
		const host = villager(10);
		const seen = [];
		host.update = vi.fn(async (changes, options = {}) => {
			const nested = { system: { attributes: { hp: { value: changes["system.attributes.hp.value"] } } } };
			onPreUpdateHost(host, nested, options, { actors });
			seen.push(options[HOST_HP_LOST_OPTION]);
			host.system.attributes.hp.value = changes["system.attributes.hp.value"];
		});

		// A possessed host's own "lose 1d4 HP" (post-death-actions.js#loseHp) and the Vessel's 2d4 for Stock.
		rolls.push(3);
		await loseHp(host, "1d4", { moveName: "Implacable" });
		rolls.push(4);
		await loseHpForStock(host, { amount: 1, moveName: "Vessel" });
		expect(host.system.attributes.hp.value).toBe(3);
		expect(seen).toEqual([undefined, undefined]);

		// The option alone is what stands it aside.
		const marked = { [HP_LOSS_OPTION]: true };
		onPreUpdateHost(villager(10), { system: { attributes: { hp: { value: 4 } } } }, marked, { actors });
		expect(marked[HOST_HP_LOST_OPTION]).toBeUndefined();

		// A GM typing the number down: damage applied by hand, billed.
		await host.update({ "system.attributes.hp.value": 1 }, {});
		expect(seen.at(-1)).toBe(2);
	});
});

describe("the record goes when the possession ends", () => {
	beforeEach(() => { globalThis.game.user = { id: "me" }; });

	it("at 0 HP: their essence disperses, and the card says they were forced out", async () => {
		const { actor } = ghost({ host: ALDRIC, hp: 0 });
		const postMoveNote = vi.fn(async () => {});
		expect(await onUpdateGhost(actor, { system: { attributes: { hp: { value: 0 } } } }, {}, "me", { postMoveNote })).toBe(true);
		expect(hostOf(actor)).toBeUndefined();
		expect(postMoveNote.mock.calls[0][2]).toContain("forced from Aldric's body");
	});

	it("quietly, once BODYSNATCHER or the Ghost insert is no longer theirs", async () => {
		const { actor } = ghost({ host: ALDRIC, slug: "thrall" });
		const postMoveNote = vi.fn(async () => {});
		expect(await onUpdateGhost(actor, { flags: {} }, {}, "me", { postMoveNote })).toBe(true);
		expect(hostOf(actor)).toBeUndefined();
		expect(postMoveNote).not.toHaveBeenCalled();
	});

	it("not while it stands, and not on another client's write", async () => {
		const standing = ghost({ host: ALDRIC, hp: 5 });
		expect(await onUpdateGhost(standing.actor, { system: { attributes: { hp: { value: 5 } } } }, {}, "me")).toBe(false);
		const elsewhere = ghost({ host: ALDRIC, hp: 0 });
		expect(await onUpdateGhost(elsewhere.actor, { system: { attributes: { hp: { value: 0 } } } }, {}, "someone-else")).toBe(false);
		expect(hostOf(elsewhere.actor)).toEqual(ALDRIC);
	});
});

describe("the 6-: they force you from their body and you mark a consequence", () => {
	function card() {
		const flags = {};
		return {
			flags,
			getFlag: (_s, key) => key.split(".").reduce((v, k) => v?.[k], flags),
			setFlag: vi.fn(async (_s, key, value) => {
				const parts = key.split(".");
				let node = flags;
				for (const part of parts.slice(0, -1)) node = node[part] ??= {};
				node[parts.at(-1)] = value;
			}),
			unsetFlag: vi.fn(async (_s, key) => { delete flags[key.split(".")[0]]?.[key.split(".")[1]]; }),
		};
	}
	const forcedOutButton = () => ({ classList: { contains: c => c === "stonetop-pd-forced-out" }, dataset: { key: "forced-out", move: BODYSNATCHER }, disabled: false });

	it("puts the button on Bodysnatcher's own 6- row, for a Ghost holding it", () => {
		const { actor } = ghost();
		expect(bodysnatcherRollOptions(actor).tierActions.failure).toContain("stonetop-pd-forced-out");
		expect(moveRollOptions("Bodysnatcher", actor).tierActions.failure).toContain("Forced out: mark a consequence");
		expect(bodysnatcherRollOptions(ghost({ counts: {} }).actor)).toBeNull();
	});

	it("marks the consequence picked and ends the possession in one write, never offering the Final Consequence", async () => {
		const { actor } = ghost({ host: ALDRIC });
		const wait = stubAsk("c-quarry");
		actor.update.mockClear();
		expect(await pressCardButton(card(), actor, forcedOutButton())).toBe(true);
		const labels = wait.mock.calls[0][0].buttons.map(b => b.label);
		expect(labels).toContain("Mark QUARRY");
		expect(labels.some(l => /FINAL/.test(l))).toBe(false);
		expect(actor.update).toHaveBeenCalledTimes(1);
		expect(actor.flags["stonetop-pwd"].postDeathLore.counts["consequences:quarry"]).toBe(1);
		expect(hostOf(actor)).toBeUndefined();
		expect(posted.at(-1).content).toContain("can never possess Aldric again");
	});

	it("writes nothing and gives the button back when the picker is closed", async () => {
		const { actor } = ghost({ host: ALDRIC });
		stubAsk(null);
		const message = card();
		actor.update.mockClear();
		expect(await pressCardButton(message, actor, forcedOutButton())).toBe(false);
		expect(actor.update).not.toHaveBeenCalled();
		expect(hostOf(actor)).toEqual(ALDRIC);
		expect(message.unsetFlag).toHaveBeenCalled();
	});
});
