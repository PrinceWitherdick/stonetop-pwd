import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { speakerActor } from "../../module/utils/speaker-actor.js";

// How a chat card gets from a message back to the thing it spends.
//
// The rule under test is the exception, not the default: a monster or an NPC resolves to the
// TOKEN, because a scene's six goblins are six creatures sharing one sidebar Actor. A CHARACTER
// resolves to the shared world Actor, because a PC is one person the whole table shares and an
// unlinked token's `token.actor` is a private ActorDelta copy of them.
//
// Getting that backwards is what the whole repair exists for: core's
// ChatMessage.getSpeaker({actor}) rewrites the speaker to point at a token whenever the actor
// has one on the canvas, so a roll marks +1 XP on the character while the Burn Brightly button
// on the very same card spends 2 out of the token's copy.

const message = (speaker) => ({ speaker });

/** A world Actor and the private copy an unlinked token of it would carry. */
const split = (type, worldXp, tokenXp) => {
	const world = { id: "a1", type, system: { attributes: { xp: { value: worldXp } } } };
	const onToken = { id: "a1", type, isToken: true, system: { attributes: { xp: { value: tokenXp } } } };
	global.game = { actors: { get: (id) => (id === "a1" ? world : null) } };
	global.canvas = { tokens: { get: (id) => (id === "t1" ? { actor: onToken } : null) } };
	return { world, onToken };
};

beforeEach(() => {
	global.game = { actors: { get: () => null } };
	global.canvas = { tokens: { get: () => null } };
});

afterEach(() => {
	delete global.game;
	delete global.canvas;
});

describe("speakerActor", () => {
	it("resolves a character to the SHARED actor, never the token's private copy", () => {
		const { world } = split("character", 16, 11);
		expect(speakerActor(message({ token: "t1", actor: "a1" }))).toBe(world);
	});

	// The token's id is on the speaker whether or not the token is linked, so this is what
	// keeps a card that marks XP and a card that spends it talking about one total.
	it("gives every card on one message the same character", () => {
		split("character", 16, 11);
		const card = message({ token: "t1", actor: "a1" });
		expect(speakerActor(card)).toBe(speakerActor(card));
		expect(speakerActor(card).system.attributes.xp.value).toBe(16);
	});

	it("resolves a monster to its TOKEN, so one goblin's harm is not spent from another's", () => {
		const { onToken } = split("monster", 10, 3);
		expect(speakerActor(message({ token: "t1", actor: "a1" }))).toBe(onToken);
	});

	it("resolves an NPC to its token for the same reason", () => {
		const { onToken } = split("npc", 10, 3);
		expect(speakerActor(message({ token: "t1", actor: "a1" }))).toBe(onToken);
	});

	it("falls back to the world actor for a speaker naming no token", () => {
		const { world } = split("character", 16, 11);
		expect(speakerActor(message({ actor: "a1" }))).toBe(world);
	});

	// A card rolled on a scene nobody is viewing: the token is not on the canvas to be found.
	// The character still resolves, because the speaker's `actor` is the world Actor's id even
	// when the token that stamped it was unlinked.
	it("still finds a character whose token is not on the current canvas", () => {
		const { world } = split("character", 16, 11);
		global.canvas = { tokens: { get: () => null } };
		expect(speakerActor(message({ token: "t1", actor: "a1" }))).toBe(world);
	});

	it("keeps a good token actor when the speaker's actor id no longer resolves", () => {
		// A character deleted out from under a card still on screen. Preferring the world actor
		// unconditionally would turn a perfectly good token into null.
		const onToken = { id: "gone", type: "character", isToken: true };
		global.game = { actors: { get: () => null } };
		global.canvas = { tokens: { get: () => ({ actor: onToken }) } };
		expect(speakerActor(message({ token: "t1", actor: "gone" }))).toBe(onToken);
	});

	it("answers null for a message with no speaker at all", () => {
		expect(speakerActor(message(undefined))).toBe(null);
		expect(speakerActor(undefined)).toBe(null);
	});
});
