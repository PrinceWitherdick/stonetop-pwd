import { describe, it, expect, vi } from "vitest";
import { StonetopCharacter } from "../../../module/actors/character/StonetopCharacter.js";
import { DEATHS_DOOR_STATE } from "../../../module/actors/character/deaths-door.js";
import { FakeActorBuilder } from "../../fakes/FakeActorBuilder.js";
import { FakeRepositoryFactory } from "../../fakes/FakeRepositoryFactory.js";
import { FakePostDeathInsertRepository } from "../../fakes/FakePostDeathInsertRepository.js";
import { FakeMoveRepository } from "../../fakes/FakeMoveRepository.js";
import { readFileSync } from "node:fs";

const SLUG_PATH  = "flags.stonetop-pwd.postDeathInsert.slug";
const STATE_PATH = "flags.stonetop-pwd.deathsDoor";
const TAB_PATH   = "flags.stonetop-pwd.postDeathInsert.tabOpen";

// At 0 HP unless a case says otherwise: every brush with death these cases take an insert from is one.
function makeCharacter(flags = {}, { hp = 0 } = {}) {
	const actor = new FakeActorBuilder().withFlags(flags).withHp(hp, 8).build();
	actor.items = [];
	actor.update = vi.fn(async () => {});
	actor.createEmbeddedDocuments = vi.fn(async () => []);
	actor.deleteEmbeddedDocuments = vi.fn(async () => []);
	return { actor, character: new StonetopCharacter(actor, new FakeRepositoryFactory()) };
}

/** The swap's repair marker (review VG-3), which rides on the slug's write and has a block of its own below. */
const PENDING_PATH = "flags.stonetop-pwd.insertMovesPending";
const isPendingKey = key => key === PENDING_PATH || key === "flags.stonetop-pwd.-=insertMovesPending";

/** The update that carried the slug, whichever call it was, without the repair marker. */
function slugWrite(actor) {
	const data = actor.update.mock.calls.map(([d]) => d).find(d => SLUG_PATH in d);
	return data ? Object.fromEntries(Object.entries(data).filter(([key]) => !isPendingKey(key))) : null;
}

/** The writes that carried anything but the repair marker: the swap's own, which must stay one. */
const swapWrites = actor => actor.update.mock.calls.filter(([d]) => Object.keys(d).some(key => !isPendingKey(key)));

/**
 * Taking an insert used to be two writes: the slug, then the Death's Door state. A reload landing
 * between them (2026-08-08, in play) left a character wearing a Ghost and still flagged
 * `fate-pending`, which told every reader that Death's Door was owed by someone who had just
 * answered it. One update can't be torn in half.
 */
describe("setPostDeathInsert — the insert and the end of dying are one write", () => {
	// Ending the brush with death is not getting up (the user's ruling, 2026-09-27): taken at the
	// Door, the insert returns them OUT OF THE ACTION, in the same update as the slug.
	it("returns them out of the action in the same update as the slug", async () => {
		const { actor, character } = makeCharacter({ deathsDoor: DEATHS_DOOR_STATE.FATE_PENDING });

		await character.setPostDeathInsert("ghost");

		// Taking one shows the tab on its own merits, so there is no request to record and
		// none stored to drop: the fragment is empty and adds nothing to the write. The fake
		// actor is at 0 HP already, so no hit points ride along.
		expect(slugWrite(actor)).toEqual({ [SLUG_PATH]: "ghost", [STATE_PATH]: DEATHS_DOOR_STATE.OUT_OF_ACTION });
	});

	// Healed while the fate was still owed: the insert still returns them at 0 HP, out of the action,
	// and "Back on your feet" is what brings the hit points back.
	it("puts the hit points to 0 in the same write when they were healed meanwhile", async () => {
		const { actor, character } = makeCharacter({ deathsDoor: DEATHS_DOOR_STATE.FATE_PENDING }, { hp: 5 });

		await character.setPostDeathInsert("revenant");

		expect(slugWrite(actor)).toEqual({
			[SLUG_PATH]: "revenant",
			[STATE_PATH]: DEATHS_DOOR_STATE.OUT_OF_ACTION,
			"system.attributes.hp.value": 0,
		});
	});

	// Undying's 6- gives the Revenant up for the Ghost while they are DYING: the same one write.
	it("returns a dying Revenant who becomes a Ghost out of the action, in the slug's write", async () => {
		const { actor, character } = makeCharacter({ deathsDoor: DEATHS_DOOR_STATE.DYING, postDeathInsert: { slug: "revenant" } });

		await character.setPostDeathInsert("ghost");

		expect(swapWrites(actor)).toHaveLength(1);
		expect(slugWrite(actor)).toEqual({ [SLUG_PATH]: "ghost", [STATE_PATH]: DEATHS_DOOR_STATE.OUT_OF_ACTION });
	});

	// Away from any brush with death (a GM handing a living character an insert) nothing is returned
	// from, and someone already out of the action stays there.
	it("leaves the living up and the out-of-action down", async () => {
		const up = makeCharacter({}, { hp: 6 });
		await up.character.setPostDeathInsert("thrall");
		expect(slugWrite(up.actor)).toEqual({ [SLUG_PATH]: "thrall", [STATE_PATH]: null });

		const down = makeCharacter({ deathsDoor: DEATHS_DOOR_STATE.OUT_OF_ACTION });
		await down.character.setPostDeathInsert("thrall");
		expect(slugWrite(down.actor)).toEqual({ [SLUG_PATH]: "thrall", [STATE_PATH]: DEATHS_DOOR_STATE.OUT_OF_ACTION });
	});

	// B11: the same insert dropped again used to wipe the state (a dispersed Ghost stood up, a Ghost
	// lost to the Final Consequence brought back) and delete and remake its three moves.
	it("does nothing at all when the insert they already wear is taken again", async () => {
		const { actor, character } = makeCharacter({
			deathsDoor: DEATHS_DOOR_STATE.DEAD,
			postDeathInsert: { slug: "ghost" },
		});
		actor.items = [{ _id: "m1", type: "move", system: { moveType: "post-death" } }];

		expect(await character.setPostDeathInsert("ghost")).toBe(false);

		expect(actor.update).not.toHaveBeenCalled();
		expect(actor.deleteEmbeddedDocuments).not.toHaveBeenCalled();
		expect(actor.createEmbeddedDocuments).not.toHaveBeenCalled();
	});

	// Removing one is an edit-mode undo, not a brush with death ending, so there is no state to
	// clear — and clearing it would quietly discard a `dying` or `fate-pending` that is still true.
	// The tab request rides along rather than following as a second write, for the same
	// can't-be-torn-in-half reason the state clear does.
	it("leaves the state alone when an insert is removed, and holds the tab open in the same write", async () => {
		const { actor, character } = makeCharacter({ deathsDoor: DEATHS_DOOR_STATE.DYING });

		await character.setPostDeathInsert(null);

		expect(slugWrite(actor)).toEqual({ [SLUG_PATH]: null, [TAB_PATH]: true });
	});

	// One document write, not two — the whole point of the fragment form.
	it("writes once", async () => {
		const { actor, character } = makeCharacter({ deathsDoor: DEATHS_DOOR_STATE.DYING });

		await character.setPostDeathInsert(null);

		expect(actor.update).toHaveBeenCalledTimes(1);
	});
});

/**
 * And the reader that heals the sheets it already happened on. `deathsDoorState` is what every
 * surface asks (the Death's Door card, the walkthrough's resume, the routing table), so the rule
 * lands in one place rather than at each of them.
 */
describe("deathsDoorState — an insert is the fate, whatever the flag still says", () => {
	it("reports no state for a Ghost left flagged fate-pending", () => {
		const { character } = makeCharacter({
			deathsDoor: DEATHS_DOOR_STATE.FATE_PENDING,
			postDeathInsert: { slug: "ghost" },
		});

		expect(character.deathsDoorState).toBe(null);
		// Which is what puts Tethered back in front of them instead of the fate fork.
		expect(character.zeroHpMove.name).toBe("Tethered");
	});

	it("still reports a fate-pending that no insert has answered", () => {
		const { character } = makeCharacter({ deathsDoor: DEATHS_DOOR_STATE.FATE_PENDING });

		expect(character.deathsDoorState).toBe(DEATHS_DOOR_STATE.FATE_PENDING);
	});

	// A dispersed Ghost is out of the action, and wearing an insert doesn't make that untrue.
	it("passes the other states through for a character with an insert", () => {
		const { character } = makeCharacter({
			deathsDoor: DEATHS_DOOR_STATE.OUT_OF_ACTION,
			postDeathInsert: { slug: "ghost" },
		});

		expect(character.deathsDoorState).toBe(DEATHS_DOOR_STATE.OUT_OF_ACTION);
	});
});

/**
 * Audit RV-6 (2026-10-26): a swap was four writes (the prune, the old moves gone, the slug, the new moves
 * made), and a reload between two of them left a Revenant still wearing the Revenant with every
 * Revenant-only Consequence already deleted, or a Ghost with no insert moves that retaking the same insert
 * (a no-op) could never give back.
 */
describe("setPostDeathInsert, torn by a reload", () => {
	const readPack = name => JSON.parse(readFileSync(new URL(`../../../packs/src/stonetop-items/post-death-inserts/${name}.json`, import.meta.url), "utf8"));
	const ghostMoves = ["Unliving", "Disembodied", "Tethered"].map(name => ({ name, type: "move", system: { moveType: "post-death" } }));

	function swapCharacter(flags, { owned = [] } = {}) {
		const actor = new FakeActorBuilder().withFlags(flags).withHp(0, 8).build();
		actor.items = owned;
		actor.update = vi.fn(async () => {});
		actor.createEmbeddedDocuments = vi.fn(async () => []);
		actor.deleteEmbeddedDocuments = vi.fn(async () => []);
		const repos = new FakeRepositoryFactory({
			postDeathInsert: new FakePostDeathInsertRepository([readPack("ghost"), readPack("revenant")]),
			moves: new FakeMoveRepository([], [], ghostMoves),
		});
		return { actor, character: new StonetopCharacter(actor, repos) };
	}

	it("prunes what the Ghost can't hold in the slug's own write, keeping what both inserts print", async () => {
		const { actor, character } = swapCharacter({
			deathsDoor: DEATHS_DOOR_STATE.DYING,
			postDeathInsert: { slug: "revenant" },
			postDeathLore: { counts: { "consequences:carrion-stench": 1, "consequences:breakdown": 1 } },
		}, { owned: [{ _id: "r1", name: "Undying", type: "move", system: { moveType: "post-death" } }] });

		await character.setPostDeathInsert("ghost");

		expect(swapWrites(actor)).toHaveLength(1);
		const write = slugWrite(actor);
		expect(write[SLUG_PATH]).toBe("ghost");
		const keys = Object.keys(write);
		expect(keys.some(k => k.includes("postDeathLore.counts") && k.endsWith("consequences:carrion-stench"))).toBe(true);
		expect(keys.some(k => k.endsWith("consequences:breakdown"))).toBe(false);
		// The old moves went before that write, and the new ones came after it.
		const slugCall = actor.update.mock.calls.findIndex(([d]) => SLUG_PATH in d);
		expect(actor.deleteEmbeddedDocuments.mock.invocationCallOrder[0]).toBeLessThan(actor.update.mock.invocationCallOrder[slugCall]);
		expect(actor.createEmbeddedDocuments.mock.invocationCallOrder[0]).toBeGreaterThan(actor.update.mock.invocationCallOrder[slugCall]);
	});

	it("makes the worn insert's own moves that are missing, and only those, while a swap's marker stands", async () => {
		const { actor, character } = swapCharacter({ postDeathInsert: { slug: "ghost" }, insertMovesPending: true }, {
			owned: [{ _id: "u1", name: "Unliving", type: "move", system: { moveType: "post-death" } }],
		});

		expect(await character.syncPostDeathInsertMoves()).toBe(2);

		const made = actor.createEmbeddedDocuments.mock.calls[0][1].map(d => d.name);
		expect(made).toEqual(["Disembodied", "Tethered"]);
		// And the marker is lifted, so the next load does nothing.
		expect(Object.keys(actor.update.mock.calls.at(-1)[0])).toEqual(["flags.stonetop-pwd.-=insertMovesPending"]);
	});

	it("makes nothing for a character wearing no insert, or holding every move", async () => {
		const none = swapCharacter({ insertMovesPending: true });
		expect(await none.character.syncPostDeathInsertMoves()).toBe(0);
		const whole = swapCharacter({ postDeathInsert: { slug: "ghost" }, insertMovesPending: true }, {
			owned: ghostMoves.map((m, i) => ({ _id: `m${i}`, ...m })),
		});
		expect(await whole.character.syncPostDeathInsertMoves()).toBe(0);
		expect(whole.actor.createEmbeddedDocuments).not.toHaveBeenCalled();
	});
});

/**
 * The user's ruling, 2026-10-28 (review VG-3): "Repair only after a swap". The load-time repair puts back an
 * insert's own moves only while the swap's marker says one was under way, so a move a GM deleted by hand
 * later (a house rule taking Tethered away) stays deleted, and a character from before the marker is left alone.
 */
describe("the load-time repair answers only a swap cut short", () => {
	const ghostMoves = ["Unliving", "Disembodied", "Tethered"].map(name => ({ name, type: "move", system: { moveType: "post-death" } }));
	function wearing(flags, owned = []) {
		const actor = new FakeActorBuilder().withFlags(flags).withHp(0, 8).build();
		actor.items = owned;
		actor.update = vi.fn(async () => {});
		actor.createEmbeddedDocuments = vi.fn(async () => []);
		actor.deleteEmbeddedDocuments = vi.fn(async () => []);
		const repos = new FakeRepositoryFactory({ moves: new FakeMoveRepository([], [], ghostMoves) });
		return { actor, character: new StonetopCharacter(actor, repos) };
	}

	// Review 10-28: a pack not readable yet reads as no moves at all, which is not a swap made whole.
	it("keeps the marker when the insert's moves could not be read", async () => {
		const actor = new FakeActorBuilder().withFlags({ postDeathInsert: { slug: "ghost" }, insertMovesPending: true }).withHp(0, 8).build();
		actor.items = [];
		actor.update = vi.fn(async () => {});
		actor.createEmbeddedDocuments = vi.fn(async () => []);
		const repos = new FakeRepositoryFactory({ moves: new FakeMoveRepository([], [], []) });
		const character = new StonetopCharacter(actor, repos);
		expect(await character.syncPostDeathInsertMoves()).toBe(0);
		expect(actor.update).not.toHaveBeenCalled();
	});

	// Review 10-28: a load-time repair landing mid-swap may already have made some of them.
	it("makes only the moves still missing when the swap gets to them", async () => {
		const { actor, character } = wearing({ postDeathInsert: { slug: "revenant" } }, [
			{ _id: "r1", name: "Undying", type: "move", system: { moveType: "post-death" } },
		]);
		actor.deleteEmbeddedDocuments = vi.fn(async () => {
			actor.items = [{ _id: "u9", name: "Unliving", type: "move", system: { moveType: "post-death" } }];
			return [];
		});
		await character.setPostDeathInsert("ghost");
		expect(actor.createEmbeddedDocuments.mock.calls[0][1].map(d => d.name)).toEqual(["Disembodied", "Tethered"]);
	});

	it("never puts back a move deleted after the swap was whole", async () => {
		const { actor, character } = wearing({ postDeathInsert: { slug: "ghost" } }, [
			{ _id: "u1", name: "Unliving", type: "move", system: { moveType: "post-death" } },
			{ _id: "d1", name: "Disembodied", type: "move", system: { moveType: "post-death" } },
		]);
		expect(await character.syncPostDeathInsertMoves()).toBe(0);
		expect(actor.createEmbeddedDocuments).not.toHaveBeenCalled();
		expect(actor.update).not.toHaveBeenCalled();
	});

	it("raises the marker before the old moves go, keeps it on the slug's write, and lifts it once the new ones are made", async () => {
		const { actor, character } = wearing({ postDeathInsert: { slug: "revenant" } }, [
			{ _id: "r1", name: "Undying", type: "move", system: { moveType: "post-death" } },
		]);
		await character.setPostDeathInsert("ghost");

		const calls = actor.update.mock.calls.map(([d]) => d);
		const order = actor.update.mock.invocationCallOrder;
		expect(calls[0]).toEqual({ [PENDING_PATH]: true });
		expect(order[0]).toBeLessThan(actor.deleteEmbeddedDocuments.mock.invocationCallOrder[0]);
		const slugCall = calls.findIndex(d => SLUG_PATH in d);
		expect(calls[slugCall][PENDING_PATH]).toBe(true);
		expect(calls.at(-1)).toEqual({ "flags.stonetop-pwd.-=insertMovesPending": null });
		expect(order.at(-1)).toBeGreaterThan(actor.createEmbeddedDocuments.mock.invocationCallOrder[0]);
	});

	it("takes the marker with it when an insert is removed, and adds nothing when none stands", async () => {
		const swap = wearing({ postDeathInsert: { slug: "ghost" } }, [{ _id: "u1", name: "Unliving", type: "move", system: { moveType: "post-death" } }]);
		await swap.character.setPostDeathInsert(null);
		const write = swap.actor.update.mock.calls.map(([d]) => d).find(d => SLUG_PATH in d);
		expect(write).toHaveProperty(["flags.stonetop-pwd.-=insertMovesPending"], null);

		const bare = wearing({});
		await bare.character.setPostDeathInsert(null);
		expect(Object.keys(bare.actor.update.mock.calls[0][0]).some(isPendingKey)).toBe(false);
	});
});

/**
 * Audit LC-2: the old insert's 0-HP move is over once an insert is taken or removed, so Undying's kept-HP stamp
 * and an Undeath roll in progress go in the slug's own write. A Death's Door roll's marker is left alone.
 */
describe("setPostDeathInsert lifts what Undying left behind (audit LC-2)", () => {
	const KEPT = "flags.stonetop-pwd.-=undeathKeptHp";
	const ROLLING = "flags.stonetop-pwd.-=deathsDoorRolling";
	const undeathMarker = { userId: "u", nonce: "undeath:abc", tier: "failure" };

	it("on removal: the stamp and the Undeath marker, in the slug's write", async () => {
		const { actor, character } = makeCharacter({
			postDeathInsert: { slug: "revenant" }, deathsDoor: DEATHS_DOOR_STATE.OUT_OF_ACTION,
			undeathKeptHp: true, deathsDoorRolling: undeathMarker,
		});
		await character.setPostDeathInsert(null);
		const write = actor.update.mock.calls.map(([d]) => d).find(d => SLUG_PATH in d);
		expect(write).toHaveProperty([KEPT], null);
		expect(write).toHaveProperty([ROLLING], null);
	});

	it("on a take: the same, in the slug's write", async () => {
		const { actor, character } = makeCharacter({
			postDeathInsert: { slug: "revenant" }, deathsDoor: DEATHS_DOOR_STATE.DYING,
			undeathKeptHp: true, deathsDoorRolling: undeathMarker,
		});
		await character.setPostDeathInsert("thrall");
		const write = actor.update.mock.calls.map(([d]) => d).find(d => SLUG_PATH in d);
		expect(write).toHaveProperty([KEPT], null);
		expect(write).toHaveProperty([ROLLING], null);
	});

	it("leaves a Death's Door roll's marker, and adds nothing when neither stands", async () => {
		const door = makeCharacter({ deathsDoor: DEATHS_DOOR_STATE.FATE_PENDING, deathsDoorRolling: { userId: "u", nonce: "abc" } });
		await door.character.setPostDeathInsert("ghost");
		const write = door.actor.update.mock.calls.map(([d]) => d).find(d => SLUG_PATH in d);
		expect(write).not.toHaveProperty([ROLLING]);
		expect(write).not.toHaveProperty([KEPT]);
	});
});
