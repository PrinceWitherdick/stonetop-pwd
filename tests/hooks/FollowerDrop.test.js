import { describe, it, expect, vi, beforeEach } from "vitest";
import { FOLLOWER_DRAG_TYPE } from "../../module/data/follower-actor.js";
import { SYSTEM_ID } from "../../module/system-id.js";
import { onDropFollower, placeFollowerToken, oneBodyFollowerCard, linkFollowerTokenOnCreate } from "../../module/hooks/FollowerDrop.js";

// Dragging a follower card onto the canvas: the card becomes (or re-uses) an Actor, and
// core places its token. See module/hooks/FollowerDrop.js for the resolution order.

const DROP = {
	type: FOLLOWER_DRAG_TYPE,
	x: 100,
	y: 200,
	characterUuid: "Actor.pc1",
	characterName: "Hafr",
	ftype: "custom",
	slug: "f1",
	detailBase: "customFollowers.f1",
	follower: { name: "Old Bess", hp: { value: 4, max: 6 }, tags: ["stubborn"] },
};

let uuids, layer, scene, character, created;

function makeCanvas() {
	return { scene, tokens: layer };
}

beforeEach(() => {
	created = [];
	uuids = new Map();
	layer = { _onDropActorData: vi.fn(async () => ({})) };
	scene = { name: "The Steplands" };
	character = { isOwner: true, update: vi.fn(async () => {}) };
	uuids.set("Actor.pc1", character);

	globalThis.CONST = { TOKEN_DISPLAY_MODES: { HOVER: 30 }, TOKEN_DISPOSITIONS: { FRIENDLY: 1 } };
	globalThis.game = {
		user: { can: vi.fn(() => true) },
		folders: [{ type: "Actor", name: "Followers", id: "fold1" }],
	};
	globalThis.ui = { notifications: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } };
	globalThis.fromUuid = vi.fn(async (uuid) => uuids.get(uuid) ?? null);
	globalThis.Folder = { canUserCreate: vi.fn(() => true), create: vi.fn(async () => ({ id: "fold1" })) };
	globalThis.Actor = {
		canUserCreate: vi.fn(() => true),
		create: vi.fn(async (data) => {
			const actor = { ...data, documentName: "Actor", uuid: `Actor.new${created.length}` };
			created.push(actor);
			return actor;
		}),
	};
});

describe("onDropFollower", () => {
	it("claims a follower payload", () => {
		expect(onDropFollower(makeCanvas(), { ...DROP }, {})).toBe(false);
	});

	it("leaves every other canvas drop to core", () => {
		expect(onDropFollower(makeCanvas(), { type: "Actor", uuid: "Actor.x" }, {})).toBeUndefined();
		expect(layer._onDropActorData).not.toHaveBeenCalled();
	});
});

describe("placeFollowerToken", () => {
	it("creates an npc from the card, files it, and hands it to core to place", async () => {
		const event = {};
		await placeFollowerToken(makeCanvas(), DROP, event);

		expect(globalThis.Actor.create).toHaveBeenCalledTimes(1);
		const data = globalThis.Actor.create.mock.calls[0][0];
		expect(data.type).toBe("npc");
		expect(data.name).toBe("Old Bess");
		expect(data.folder).toBe("fold1");
		expect(data.flags["stonetop-pwd"].followerOrigin)
			.toEqual({ characterUuid: "Actor.pc1", ftype: "custom", slug: "f1" });
		expect(layer._onDropActorData).toHaveBeenCalledWith(event, {
			type: "Actor", uuid: "Actor.new0", x: 100, y: 200,
		});
	});

	it("remembers the new actor on the follower card, so a second drop re-uses it", async () => {
		await placeFollowerToken(makeCanvas(), DROP, {});

		expect(character.update).toHaveBeenCalledWith({
			"flags.stonetop-pwd.customFollowers.f1.actorUuid": "Actor.new0",
		});
	});

	it("re-uses the actor a previous drop made instead of cloning the follower", async () => {
		uuids.set("Actor.old", { documentName: "Actor", type: "npc", uuid: "Actor.old" });
		const data = { ...DROP, follower: { ...DROP.follower, actorUuid: "Actor.old" } };

		await placeFollowerToken(makeCanvas(), data, {});

		expect(globalThis.Actor.create).not.toHaveBeenCalled();
		expect(layer._onDropActorData).toHaveBeenCalledWith({}, expect.objectContaining({ uuid: "Actor.old" }));
	});

	it("places the NPC a follower was recruited from — that person already exists", async () => {
		uuids.set("Actor.elios", { documentName: "Actor", type: "npc", uuid: "Actor.elios" });
		const data = { ...DROP, follower: { ...DROP.follower, sourceUuid: "Actor.elios" } };

		await placeFollowerToken(makeCanvas(), data, {});

		expect(globalThis.Actor.create).not.toHaveBeenCalled();
		expect(layer._onDropActorData).toHaveBeenCalledWith({}, expect.objectContaining({ uuid: "Actor.elios" }));
	});

	// FOE-2: an unlinked token of a one-body follower kept its own HP, and a heal never reached it.
	it("links a recruited NPC's prototype token before placing them, when they are one person", async () => {
		const elios = { documentName: "Actor", type: "npc", uuid: "Actor.elios", isOwner: true, prototypeToken: { actorLink: false }, update: vi.fn(async () => {}) };
		uuids.set("Actor.elios", elios);
		await placeFollowerToken(makeCanvas(), { ...DROP, follower: { ...DROP.follower, sourceUuid: "Actor.elios" } }, {});
		expect(elios.update).toHaveBeenCalledWith({ "prototypeToken.actorLink": true });
		const order = [elios.update.mock.invocationCallOrder[0], layer._onDropActorData.mock.invocationCallOrder[0]];
		expect(order[0]).toBeLessThan(order[1]);
	});

	it("leaves a group's prototype unlinked, and one nobody here may write", async () => {
		const band = { documentName: "Actor", type: "npc", uuid: "Actor.band", isOwner: true, prototypeToken: { actorLink: false }, update: vi.fn(async () => {}) };
		uuids.set("Actor.band", band);
		await placeFollowerToken(makeCanvas(), { ...DROP, follower: { ...DROP.follower, sourceUuid: "Actor.band", isGroup: true } }, {});
		expect(band.update).not.toHaveBeenCalled();
		const theirs = { ...band, uuid: "Actor.theirs", isOwner: false, update: vi.fn(async () => {}) };
		uuids.set("Actor.theirs", theirs);
		await placeFollowerToken(makeCanvas(), { ...DROP, follower: { ...DROP.follower, sourceUuid: "Actor.theirs" } }, {});
		expect(theirs.update).not.toHaveBeenCalled();
		expect(layer._onDropActorData).toHaveBeenCalledTimes(2);
	});

	it("builds its own actor for a follower converted from a bestiary monster", async () => {
		// The monster entry is a template for its kind; this follower is one individual.
		uuids.set("Actor.wolf", { documentName: "Actor", type: "monster", uuid: "Actor.wolf" });
		const data = { ...DROP, follower: { ...DROP.follower, sourceUuid: "Actor.wolf" } };

		await placeFollowerToken(makeCanvas(), data, {});

		expect(globalThis.Actor.create).toHaveBeenCalledTimes(1);
		expect(layer._onDropActorData).toHaveBeenCalledWith({}, expect.objectContaining({ uuid: "Actor.new0" }));
	});

	it("ignores a stale actorUuid rather than failing the drop, and re-links the card", async () => {
		// Deleting a follower's NPC is a decision, so the sheet's own sweep leaves that card
		// alone forever after (follower-actors.js#answeredFor). THIS is the way back: a drop is
		// an explicit "put them on the map", so it makes a fresh actor and points the card at
		// it — which restores the card's Tokenizer pip and stops the next drop making a third.
		const data = { ...DROP, follower: { ...DROP.follower, actorUuid: "Actor.deleted" } };

		await placeFollowerToken(makeCanvas(), data, {});

		expect(globalThis.Actor.create).toHaveBeenCalledTimes(1);
		expect(layer._onDropActorData).toHaveBeenCalledWith({}, expect.objectContaining({ uuid: "Actor.new0" }));
		expect(character.update).toHaveBeenCalledWith({
			"flags.stonetop-pwd.customFollowers.f1.actorUuid": "Actor.new0",
		});
	});

	it("rebuilds a recruited NPC who has since been deleted, rather than refusing the drop", async () => {
		// The person they were recruited from IS them, but only while they exist. Once that NPC
		// is gone the follower is still on the sheet and still has to be placeable.
		const data = { ...DROP, follower: { ...DROP.follower, sourceUuid: "Actor.elios" } };

		await placeFollowerToken(makeCanvas(), data, {});

		expect(globalThis.Actor.create).toHaveBeenCalledTimes(1);
		expect(character.update).toHaveBeenCalledWith({
			"flags.stonetop-pwd.customFollowers.f1.actorUuid": "Actor.new0",
		});
	});

	it("warns instead of placing when the user can't create tokens here", async () => {
		globalThis.game.user.can = vi.fn(() => false);

		await placeFollowerToken(makeCanvas(), DROP, {});

		expect(globalThis.ui.notifications.warn).toHaveBeenCalled();
		expect(globalThis.Actor.create).not.toHaveBeenCalled();
		expect(layer._onDropActorData).not.toHaveBeenCalled();
	});

	// Core's own drop path refuses a point outside the scene rect before it so much as
	// looks at the actor, so the same check has to happen ahead of resolving one here —
	// resolving CREATES. Without it a drop in the padding around a scene left a new NPC
	// in the sidebar, an actorUuid written back onto the card claiming they were placed,
	// and no token anywhere.
	const rectCanvas = (contains) => ({
		scene, tokens: layer, dimensions: { rect: { contains: () => contains } },
	});

	it("refuses a drop outside the scene rect rather than leaving an orphan actor", async () => {
		await placeFollowerToken(rectCanvas(false), DROP, {});

		expect(globalThis.Actor.create).not.toHaveBeenCalled();
		expect(character.update).not.toHaveBeenCalled();
		expect(layer._onDropActorData).not.toHaveBeenCalled();
	});

	it("places as usual when the drop lands inside the scene rect", async () => {
		await placeFollowerToken(rectCanvas(true), DROP, {});

		expect(globalThis.Actor.create).toHaveBeenCalledTimes(1);
		expect(layer._onDropActorData).toHaveBeenCalled();
	});

	it("warns instead of placing when the user can't create actors", async () => {
		globalThis.Actor.canUserCreate = vi.fn(() => false);

		await placeFollowerToken(makeCanvas(), DROP, {});

		expect(globalThis.ui.notifications.warn).toHaveBeenCalled();
		expect(layer._onDropActorData).not.toHaveBeenCalled();
	});

	it("still places the follower when it can't be linked back to the card", async () => {
		character.isOwner = false;

		await placeFollowerToken(makeCanvas(), DROP, {});

		expect(character.update).not.toHaveBeenCalled();
		expect(layer._onDropActorData).toHaveBeenCalled();
	});

	it("falls back to placing the token itself if core's drop path is gone", async () => {
		const create = vi.fn(async () => ({}));
		const token = { constructor: { create } };
		uuids.set("Actor.old", {
			documentName: "Actor", type: "npc", uuid: "Actor.old",
			getTokenDocument: vi.fn(async () => token),
		});
		layer = {};   // no _onDropActorData

		await placeFollowerToken(makeCanvas(), { ...DROP, follower: { ...DROP.follower, actorUuid: "Actor.old" } }, {});

		expect(create).toHaveBeenCalledWith(token, { parent: scene });
	});
});

// FOE-2: a one-body follower's NPC walks the map LINKED however its token is made, so HP written to the NPC is
// the HP on the map (follower-hp.js writes the NPC alone).
describe("a one-body follower's tokens are linked", () => {
	const wolf = { type: "npc", uuid: "Actor.wolf", id: "wolf" };
	const leader = { type: "character", flags: { [SYSTEM_ID]: { animalCompanion: { details: { actorUuid: "Actor.wolf" } }, customFollowers: { band: { isGroup: true, sourceUuid: "Actor.band" } } } } };
	const deps = { cardFor: a => ({ wolf: { character: leader, ftype: "animal-companion", slug: "" }, band: { character: leader, ftype: "custom", slug: "band" } })[a.id] ?? null, link: ({ actorUuid, sourceUuid }) => ({ "Actor.wolf": wolf, "Actor.band": { type: "npc", uuid: "Actor.band" } })[actorUuid ?? sourceUuid] ?? null };

	it("knows a one-body follower's NPC from a group's, a monster or a stranger", () => {
		expect(oneBodyFollowerCard(wolf, deps)).toMatchObject({ ftype: "animal-companion" });
		expect(oneBodyFollowerCard({ type: "npc", uuid: "Actor.band", id: "band" }, deps)).toBeNull();
		expect(oneBodyFollowerCard({ type: "npc", uuid: "Actor.x", id: "x" }, deps)).toBeNull();
		expect(oneBodyFollowerCard({ type: "monster", uuid: "Actor.wolf", id: "wolf" }, deps)).toBeNull();
	});

	it("links a new token of one before it is written, and leaves every other token alone", () => {
		const token = (actor, actorLink = false) => ({ actorLink, baseActor: actor, updateSource: vi.fn() });
		const mine = token(wolf);
		linkFollowerTokenOnCreate(mine, {}, {}, "u", deps);
		expect(mine.updateSource).toHaveBeenCalledWith({ actorLink: true });
		const group = token({ type: "npc", uuid: "Actor.band", id: "band" });
		linkFollowerTokenOnCreate(group, {}, {}, "u", deps);
		expect(group.updateSource).not.toHaveBeenCalled();
		const linked = token(wolf, true);
		linkFollowerTokenOnCreate(linked, {}, {}, "u", deps);
		expect(linked.updateSource).not.toHaveBeenCalled();
		// A lookup that throws never stops core making the token.
		expect(() => linkFollowerTokenOnCreate(token(wolf), {}, {}, "u", { cardFor: () => { throw new Error("boom"); } })).not.toThrow();
	});
});
