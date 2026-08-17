import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createStonetopActorClass } from "../../module/actors/StonetopActor.js";
import { PERSON_DEFAULT_IMG } from "../../module/utils/person-portrait.js";

const HOVER = 2;
const FOUNDRY_DEFAULT = "icons/svg/mystery-man.svg";

/** The barest Actor base the mixin needs: it only calls super._preCreate and updateSource. */
class FakeBaseActor {
	constructor(data = {}) {
		this.type = data.type;
		this.img  = data.img;
		this.applied = [];
	}
	async _preCreate() { return undefined; }
	updateSource(changes) {
		this.applied.push(changes);
		Object.assign(this, changes);
	}
}

const StonetopActor = createStonetopActorClass(FakeBaseActor);

const CREATOR_ID = "gm1";

/** Run _preCreate the way Foundry does: the document already holds the creation data. */
async function precreate({ type = "npc", img = FOUNDRY_DEFAULT }, data = {}, user = { id: CREATOR_ID }) {
	const actor = new StonetopActor({ type, img });
	await actor._preCreate(data, {}, user);
	return actor;
}

const OWNERSHIP = { NONE: 0, LIMITED: 1, OBSERVER: 2, OWNER: 3 };

beforeEach(() => {
	global.CONST = {
		...(global.CONST ?? {}),
		TOKEN_DISPLAY_MODES: { NONE: 0, HOVER: HOVER },
		DOCUMENT_OWNERSHIP_LEVELS: OWNERSHIP,
	};
});
afterEach(() => { delete global.CONST; });

describe("StonetopActor#_preCreate", () => {
	it("gives an NPC with no portrait the people silhouette, not Foundry's mystery-man", async () => {
		const actor = await precreate({ img: FOUNDRY_DEFAULT });
		expect(actor.img).toBe(PERSON_DEFAULT_IMG);
	});

	it("fills in a blank portrait too", async () => {
		expect((await precreate({ img: "" })).img).toBe(PERSON_DEFAULT_IMG);
	});

	it("never touches a portrait somebody chose", async () => {
		const chosen = "worlds/mine/art/aderyn.webp";
		expect((await precreate({ img: chosen })).img).toBe(chosen);
	});

	// A duplicate, or an import of an NPC this system already stamped: re-writing the same
	// path would be a pointless change in the creation data.
	it("leaves an NPC already wearing the placeholder alone", async () => {
		const actor = await precreate({ img: PERSON_DEFAULT_IMG });
		expect(actor.applied.some(change => "img" in change)).toBe(false);
	});

	// The GM Toolkit is the GM's own sheet. A world Actor is broadcast to every client and
	// `ownership` is the only thing gating the UI, so without this stamp "GM Toolkit" is a row
	// in every player's Actors sidebar. Foundry's own default happens to be NONE today, which
	// is exactly why losing this would go unnoticed until a core release moved it.
	it("hides a GM Toolkit from players", async () => {
		const actor = await precreate({ type: "gmToolkit", img: FOUNDRY_DEFAULT });
		const patch = actor.applied.find(change => "ownership.default" in change);
		expect(patch?.["ownership.default"]).toBe(OWNERSHIP.NONE);
	});

	// A GM who deliberately shares one keeps their choice, the same way a chosen portrait and a
	// chosen displayName survive.
	it("leaves a deliberately shared GM Toolkit alone", async () => {
		const actor = await precreate({ type: "gmToolkit" }, { ownership: { default: OWNERSHIP.OBSERVER } });
		expect(actor.applied.some(change => "ownership.default" in change)).toBe(false);
	});

	// No per-user entry beside the default. The toolkit is a world singleton, so "whose is it"
	// is not a question anything asks, and a recorded creator would be a field nothing reads
	// sitting where a later reader would take it for a permission that matters.
	it("records no per-user owner on a GM Toolkit", async () => {
		const actor = await precreate({ type: "gmToolkit" });
		expect(actor.applied.some(change => `ownership.${CREATOR_ID}` in change)).toBe(false);
	});

	it("does not stamp ownership on any other actor type", async () => {
		for (const type of ["character", "monster", "npc", "stonetop"]) {
			const actor = await precreate({ type, img: FOUNDRY_DEFAULT });
			expect(actor.applied.some(change => "ownership.default" in change), type).toBe(false);
		}
	});

	it("does not portrait other actor types", async () => {
		for (const type of ["character", "monster", "stonetop"]) {
			expect((await precreate({ type, img: FOUNDRY_DEFAULT })).img).toBe(FOUNDRY_DEFAULT);
		}
	});

	it("defaults EVERY kind of actor's token to name-on-hover", async () => {
		// Foundry's own default is a nameless token, which leaves a table reading the map by
		// portrait alone. The rule is deliberately not per-type — a PC's token, a villager's and
		// a creature's all answer the same question.
		for (const type of ["npc", "character", "monster", "stonetop"]) {
			expect((await precreate({ type }))["prototypeToken.displayName"]).toBe(HOVER);
		}
	});

	it("keeps a display mode the creation data chose, whatever the type", async () => {
		// A duplicate, or a compendium import that carries its own mode. Checked on a character
		// too, because that branch returns early and could easily stop seeing this rule.
		for (const type of ["npc", "character"]) {
			const actor = await precreate({ type }, { prototypeToken: { displayName: 0 } });
			expect(actor.applied.some(change => "prototypeToken.displayName" in change)).toBe(false);
		}
	});

	// Foundry leaves actorLink false, which for a PC means every token on a scene carries a
	// private copy of the character. A GM who opens the sheet by double-clicking that token is
	// editing the copy: gear handed over there saves without complaint and never reaches the
	// sheet the player opens from the sidebar.
	it("links a new character's prototype token, so a token on the map edits the shared character", async () => {
		const actor = await precreate({ type: "character" });
		expect(actor["prototypeToken.actorLink"]).toBe(true);
	});

	it("keeps an actorLink the creation data chose, so a duplicate or import is preserved", async () => {
		const actor = await precreate({ type: "character" }, { prototypeToken: { actorLink: false } });
		expect(actor.applied.some(change => "prototypeToken.actorLink" in change)).toBe(false);
	});

	// A scene's townsfolk and monsters are placed many times over and each copy is its own
	// creature, so only characters get the link.
	it("leaves other actor types' tokens unlinked", async () => {
		for (const type of ["npc", "monster", "stonetop"]) {
			const actor = await precreate({ type });
			expect(actor.applied.some(change => "prototypeToken.actorLink" in change)).toBe(false);
		}
	});
});

// `actor.img` and `prototypeToken.texture.src` are two separate pictures, and Foundry fills the
// second only at creation, from the stock default. Choosing a face on the sheet therefore gave a
// person a face everywhere EXCEPT the map, which is where they are actually looked at in play.
describe("StonetopActor#_syncPrototypeTokenImage", () => {
	const ART = "worlds/mine/art/bryn.webp";

	/** An actor already in the world, with a portrait and a prototype token. */
	function existing({ type = "npc", img = PERSON_DEFAULT_IMG, token = FOUNDRY_DEFAULT, customType } = {}) {
		const actor = new StonetopActor({ type, img });
		actor.prototypeToken = { texture: { src: token } };
		if (customType) actor.system = { customType };
		return actor;
	}

	/** What the update would carry by the time it reaches the server. */
	const sync = (actor, changed) => { actor._syncPrototypeTokenImage(changed); return changed; };

	it("points a stock token at the portrait being chosen", () => {
		expect(sync(existing(), { img: ART })["prototypeToken.texture.src"]).toBe(ART);
	});

	it("counts this system's people silhouette as stock, not as a chosen token", () => {
		const actor = existing({ token: PERSON_DEFAULT_IMG });
		expect(sync(actor, { img: ART })["prototypeToken.texture.src"]).toBe(ART);
	});

	it("keeps a token that was already following the portrait in step", () => {
		// It showed the OLD portrait, so it was following; it goes on following.
		const actor = existing({ img: ART, token: ART });
		expect(sync(actor, { img: "worlds/mine/art/other.webp" })["prototypeToken.texture.src"])
			.toBe("worlds/mine/art/other.webp");
	});

	it("never overwrites a token somebody chose", () => {
		// The whole point of the two-state rule: a hand-picked token (or one Tokenizer cut) is a
		// deliberate choice that has nothing to do with the portrait.
		const actor = existing({ img: ART, token: "worlds/mine/tokens/bryn-token.webp" });
		expect(sync(actor, { img: "worlds/mine/art/other.webp" })).toEqual({ img: "worlds/mine/art/other.webp" });
	});

	it("defers to a token image the same update is setting explicitly, in either shape", () => {
		const dotted = existing();
		expect(sync(dotted, { img: ART, "prototypeToken.texture.src": "chosen.webp" })["prototypeToken.texture.src"])
			.toBe("chosen.webp");
		const nested = existing();
		const out = sync(nested, { img: ART, prototypeToken: { texture: { src: "chosen.webp" } } });
		expect(out["prototypeToken.texture.src"]).toBeUndefined();
		expect(out.prototypeToken.texture.src).toBe("chosen.webp");
	});

	it("follows a cleared portrait back to the placeholder, so the two stay symmetric", () => {
		const actor = existing({ img: ART, token: ART });
		expect(sync(actor, { img: PERSON_DEFAULT_IMG })["prototypeToken.texture.src"]).toBe(PERSON_DEFAULT_IMG);
	});

	it("stays out of an update that is not about the portrait", () => {
		expect(sync(existing(), { "system.notes": "hello" })).toEqual({ "system.notes": "hello" });
	});

	it("leaves the steading alone, whose portrait is a picture of a place", () => {
		expect(sync(existing({ type: "stonetop" }), { img: ART })).toEqual({ img: ART });
		expect(sync(existing({ type: "other", customType: "stonetop" }), { img: ART })).toEqual({ img: ART });
	});

	it("does nothing for an actor with no prototype token to speak of", () => {
		const actor = new StonetopActor({ type: "npc", img: PERSON_DEFAULT_IMG });
		expect(sync(actor, { img: ART })).toEqual({ img: ART });
	});

	// Tokenizer rewrites `actor.img` to `<path>?<timestamp>` after a send, and a baked crop is
	// pointed at with a cache-buster of its own — so "is this token following the portrait?"
	// cannot be a raw string compare, or a token that IS following reads as one somebody chose
	// and gets stranded on the old picture.
	describe("past a cache-buster", () => {
		const NEXT = "worlds/mine/art/other.webp";

		it("still recognises a token following a portrait Tokenizer has stamped", () => {
			const actor = existing({ img: `${ART}?1699999999`, token: ART });
			expect(sync(actor, { img: NEXT })["prototypeToken.texture.src"]).toBe(NEXT);
		});

		it("and the mirror case, where the TOKEN carries the stamp", () => {
			const actor = existing({ img: ART, token: `${ART}?1699999999` });
			expect(sync(actor, { img: NEXT })["prototypeToken.texture.src"]).toBe(NEXT);
		});

		it("moves a baked crop of the old portrait onto the new one", () => {
			// A bake is a square of the picture being replaced. Left where it was, the sheet
			// would show one face and the map another for ever.
			const actor = existing({ img: ART, token: "worlds/mine/stonetop-portrait-frames/bryn-abc-frame.webp?123" });
			expect(sync(actor, { img: NEXT })["prototypeToken.texture.src"]).toBe(NEXT);
		});
	});
});
