import { describe, it, expect, vi, beforeEach } from "vitest";
import {
	createFollowerActor, ensureFollowerActors, followerActorFromLink, syncFollowerActors,
} from "../../../module/actors/character/follower-actors.js";
import { followerNpcActorData } from "../../../module/data/follower-actor.js";

// Every follower on a character sheet gets an `npc` Actor made for it, once, the first time the
// sheet renders after they are added. The guards are what this file is about: the sweep must be
// free in the steady state, must not make a second copy of a creature that already exists, and
// must not resurrect one somebody deliberately deleted.

const snapshot = (slug, follower = {}) => ({
	ftype: "custom",
	slug,
	detailBase: `customFollowers.${slug}`,
	follower: { name: `Follower ${slug}`, hp: { value: 3, max: 3 }, ...follower },
});

// The options every write the sync sweep makes has to carry: the ledgers' own kill switch, so a
// card edited on a character sheet doesn't file a column of entries against the follower's NPC in
// the voice of whichever client's render won the stagger.
const SILENT = { stonetopLedger: true };

let created, docs, character;

/** A character whose followers' stored links are whatever `links` says. */
function makeCharacter(links = {}, extra = {}) {
	const customFollowers = {};
	for (const [slug, actorUuid] of Object.entries(links)) customFollowers[slug] = { actorUuid };
	return {
		id: "pc1",
		uuid: "Actor.pc1",
		isOwner: true,
		ownership: { default: 0, user1: 3 },
		flags: { "stonetop-pwd": { customFollowers } },
		update: vi.fn(async () => {}),
		testUserPermission: () => true,
		...extra,
	};
}

beforeEach(() => {
	created = [];
	docs = new Map();

	globalThis.CONST = { TOKEN_DISPLAY_MODES: { HOVER: 30 }, TOKEN_DISPOSITIONS: { FRIENDLY: 1 } };
	globalThis.game = {
		user: { id: "user1" },
		users: { contents: [{ id: "user1", active: true }] },
		folders: [{ type: "Actor", name: "Followers", id: "fold1" }],
	};
	globalThis.fromUuidSync = vi.fn((uuid) => docs.get(uuid) ?? null);
	globalThis.Folder = { canUserCreate: () => true, create: vi.fn(async () => ({ id: "fold1" })) };
	globalThis.Actor = {
		canUserCreate: vi.fn(() => true),
		create: vi.fn(async (data) => {
			const actor = { ...data, documentName: "Actor", uuid: `Actor.new${created.length}` };
			created.push(actor);
			return actor;
		}),
	};
});

describe("followerActorFromLink", () => {
	it("prefers the actor already made for this card", () => {
		docs.set("Actor.mine", { documentName: "Actor", type: "npc", uuid: "Actor.mine" });
		docs.set("Actor.src", { documentName: "Actor", type: "npc", uuid: "Actor.src" });

		expect(followerActorFromLink({ actorUuid: "Actor.mine", sourceUuid: "Actor.src" }).uuid)
			.toBe("Actor.mine");
	});

	it("falls back to the NPC they were recruited from, who IS them", () => {
		docs.set("Actor.src", { documentName: "Actor", type: "npc", uuid: "Actor.src" });

		expect(followerActorFromLink({ sourceUuid: "Actor.src" }).uuid).toBe("Actor.src");
	});

	it("treats a monster or a compendium entry as provenance, not identity", () => {
		// A bestiary monster is a template for its KIND; this follower is one individual.
		docs.set("Actor.beast", { documentName: "Actor", type: "monster", uuid: "Actor.beast" });
		// A pack uuid resolves synchronously only to an index stub, which is not a document.
		docs.set("Compendium.x.actors.y", { documentName: "Actor", type: "npc", pack: "x.actors" });

		expect(followerActorFromLink({ sourceUuid: "Actor.beast" })).toBeNull();
		expect(followerActorFromLink({ actorUuid: "Compendium.x.actors.y" })).toBeNull();
	});

	it("is null for a follower with no links at all", () => {
		expect(followerActorFromLink()).toBeNull();
		expect(followerActorFromLink({ actorUuid: "" })).toBeNull();
	});
});

describe("createFollowerActor", () => {
	it("gives the new NPC the CHARACTER's ownership, not the creator's", async () => {
		// Otherwise a GM tidying a player's sheet makes an NPC that player cannot open — and the
		// follower they were ordering about a moment ago stops being theirs.
		character = makeCharacter();

		await createFollowerActor(snapshot("f1"), character, { folder: "fold1" });

		expect(created[0].ownership).toEqual({ default: 0, user1: 3 });
		expect(created[0].flags["stonetop-pwd"].followerOrigin)
			.toEqual({ characterUuid: "Actor.pc1", ftype: "custom", slug: "f1" });
	});

	it("reports a refused creation rather than throwing at its caller", async () => {
		globalThis.Actor.create = vi.fn(async () => { throw new Error("nope"); });
		const quiet = vi.spyOn(console, "error").mockImplementation(() => {});

		await expect(createFollowerActor(snapshot("f1"), makeCharacter())).resolves.toBeNull();
		quiet.mockRestore();
	});
});

describe("ensureFollowerActors", () => {
	it("costs nothing once every follower has one", async () => {
		character = makeCharacter({ f1: "Actor.a", f2: "Actor.b" });
		const snaps = [snapshot("f1", { actorUuid: "Actor.a" }), snapshot("f2", { actorUuid: "Actor.b" })];

		expect(await ensureFollowerActors(character, snaps)).toBe(0);
		expect(globalThis.Actor.create).not.toHaveBeenCalled();
		expect(character.update).not.toHaveBeenCalled();
	});

	it("makes one for every unlinked follower and writes them all back in ONE update", async () => {
		character = makeCharacter();

		expect(await ensureFollowerActors(character, [snapshot("f1"), snapshot("f2")])).toBe(2);

		expect(globalThis.Actor.create).toHaveBeenCalledTimes(2);
		expect(character.update).toHaveBeenCalledTimes(1);
		expect(character.update).toHaveBeenCalledWith({
			"flags.stonetop-pwd.customFollowers.f1.actorUuid": "Actor.new0",
			"flags.stonetop-pwd.customFollowers.f2.actorUuid": "Actor.new1",
		});
	});

	it("leaves a follower whose actor was DELETED alone, so deleting one sticks", async () => {
		// The stored link is what answers "have they been made"; whether it still resolves is a
		// different question. A sweep that asked the second one would undo the deletion on the
		// very next render, and the NPC could never be got rid of.
		character = makeCharacter({ f1: "Actor.gone" });

		expect(await ensureFollowerActors(character, [snapshot("f1", { actorUuid: "Actor.gone" })])).toBe(0);
		expect(globalThis.Actor.create).not.toHaveBeenCalled();
	});

	it("does not clone the NPC a follower was recruited from", async () => {
		docs.set("Actor.src", { documentName: "Actor", type: "npc", uuid: "Actor.src" });
		character = makeCharacter();

		expect(await ensureFollowerActors(character, [snapshot("f1", { sourceUuid: "Actor.src" })])).toBe(0);
		expect(globalThis.Actor.create).not.toHaveBeenCalled();
	});

	it("stands down for a viewer who does not own the character", async () => {
		character = makeCharacter({}, { isOwner: false });

		expect(await ensureFollowerActors(character, [snapshot("f1")])).toBe(0);
		expect(globalThis.Actor.create).not.toHaveBeenCalled();
	});

	it("stands down, silently, where the GM has revoked actor creation", async () => {
		globalThis.Actor.canUserCreate = vi.fn(() => false);
		character = makeCharacter();

		expect(await ensureFollowerActors(character, [snapshot("f1")])).toBe(0);
		expect(globalThis.Actor.create).not.toHaveBeenCalled();
	});

	it("re-reads the card before creating, so a client that lost the race makes nothing", async () => {
		// Two people with the same sheet open both see every write to it. The later client waits
		// its turn and then looks again — by which time the link is there and there is no work.
		character = makeCharacter();
		globalThis.Actor.create = vi.fn(async (data) => {
			// The other client's write lands while this one is mid-create.
			character.flags["stonetop-pwd"].customFollowers.f2 = { actorUuid: "Actor.theirs" };
			const actor = { ...data, documentName: "Actor", uuid: `Actor.new${created.length}` };
			created.push(actor);
			return actor;
		});

		expect(await ensureFollowerActors(character, [snapshot("f1"), snapshot("f2")])).toBe(1);
		expect(character.update).toHaveBeenCalledWith({
			"flags.stonetop-pwd.customFollowers.f1.actorUuid": "Actor.new0",
		});
	});

	it("takes its own copy back out when the other client claimed the slot mid-sweep", async () => {
		// The re-read before each create cannot cover the ones already made, so a slot can be
		// claimed after ours exists. Keeping it would leave an NPC nothing points at, growing the
		// sidebar quietly — exactly the duplicate the stagger is there to prevent.
		character = makeCharacter();
		const deleted = [];
		globalThis.Actor.create = vi.fn(async (data) => {
			const actor = {
				...data, documentName: "Actor", uuid: `Actor.new${created.length}`,
				delete: vi.fn(async function () { deleted.push(this.uuid); }),
			};
			created.push(actor);
			// Their write for THIS follower lands just after ours was made.
			if (created.length === 1) character.flags["stonetop-pwd"].customFollowers.f1 = { actorUuid: "Actor.theirs" };
			return actor;
		});

		expect(await ensureFollowerActors(character, [snapshot("f1"), snapshot("f2")])).toBe(1);
		expect(deleted).toEqual(["Actor.new0"]);
		expect(character.update).toHaveBeenCalledWith({
			"flags.stonetop-pwd.customFollowers.f2.actorUuid": "Actor.new1",
		});
	});

	it("ignores a snapshot with no flag namespace to write back to", async () => {
		character = makeCharacter();

		expect(await ensureFollowerActors(character, [{ ftype: "custom", slug: "f1", follower: {} }])).toBe(0);
		expect(globalThis.Actor.create).not.toHaveBeenCalled();
	});
});

// Making the actor once was not enough. A follower renamed or given a portrait AFTER their NPC
// existed went on wearing the name, face and numbers it was born with — most visibly as the token
// dropped onto a scene.
describe("syncFollowerActors", () => {
	const MARK = "systems/stonetop-pwd/assets/icons/bestiary/human-individual.svg";
	const BEAST = "systems/stonetop-pwd/assets/icons/bestiary/natural-beast.svg";

	// One card, and an actor built from it: the steady state every test drifts one thing away from.
	const CARD = {
		name: "Enfys", pronoun: "she", typeLabel: "initiate", instinct: "To tend the grove",
		tags: ["loyal"], hp: { value: 4, max: 6 }, armor: 1, armorSource: "hide",
		damage: "d6 (hand)", damageRoll: "d6", moves: ["Sing to the shoot"],
		portraitIcon: "fas fa-user",
	};
	const card = (over = {}) => ({ ...CARD, ...over });
	const snap = (over = {}, uuid = "Actor.a") => ({
		ftype: "custom", slug: "f1", detailBase: "customFollowers.f1",
		follower: { actorUuid: uuid, ...card(over) },
	});

	/** The NPC as the sweep finds it: made from `from`, then drifted by `props`. */
	function makeFollowerActor(uuid, from = CARD, props = {}) {
		const data = followerNpcActorData(from);
		const actor = {
			documentName: "Actor", type: "npc", uuid, isOwner: true,
			name: data.name, img: data.img, system: data.system,
			prototypeToken: data.prototypeToken,
			flags: foundry.utils.deepClone(data.flags),
			items: data.items.map((item, n) => ({ ...item, id: `item${n}` })),
			update: vi.fn(async () => {}),
			createEmbeddedDocuments: vi.fn(async () => {}),
			deleteEmbeddedDocuments: vi.fn(async () => {}),
			...props,
		};
		docs.set(uuid, actor);
		return actor;
	}

	/** The one update this sweep made, for a test that only cares what changed. */
	const wrote = (npc) => npc.update.mock.calls[0]?.[0] ?? {};

	it("costs nothing while the actor still matches its card", async () => {
		const npc = makeFollowerActor("Actor.a");
		character = makeCharacter({ f1: "Actor.a" });

		expect(await syncFollowerActors(character, [snap()])).toBe(0);
		expect(npc.update).not.toHaveBeenCalled();
	});

	// Foundry WRITES to the options object it is handed — Document#update opens with
	// `operation.parent = this.parent; operation.pack = this.pack;`, and the two embedded-document
	// calls do the same. A shared frozen constant therefore threw TypeError on the first write of
	// every pass (ES modules are strict), the throw was swallowed by the per-actor catch, and the
	// whole card→NPC sync was dead while logging one warning per render. The fakes above never
	// touched their options argument, which is exactly why nothing here noticed.
	it("hands every write an options object Foundry is free to write back to", async () => {
		const stamped = [];
		const foundryish = (fn) => vi.fn(async (...args) => {
			const operation = args[args.length - 1];
			// Precisely what core does to it, before anything else.
			operation.parent = null;
			operation.pack = null;
			stamped.push(operation);
			return fn?.();
		});
		// Registered for its side effect — syncFollowerActors resolves it by uuid, not from here.
		makeFollowerActor("Actor.a", card({ img: "" }), {
			update: foundryish(),
			createEmbeddedDocuments: foundryish(),
			deleteEmbeddedDocuments: foundryish(),
		});
		character = makeCharacter({ f1: "Actor.a" });

		expect(await syncFollowerActors(character, [snap({ img: "worlds/art/enfys.webp", moves: ["A new song"] })])).toBe(1);
		expect(stamped.length).toBeGreaterThan(0);
		// Still the kill switch, and never one object shared between two calls: a reused one would
		// carry the first actor's `parent` into the next actor's write.
		for (const operation of stamped) expect(operation.stonetopLedger).toBe(true);
		expect(new Set(stamped).size).toBe(stamped.length);
	});

	// Re-cropping leaves `src` alone and changes only the rect, so the field loop finds nothing and
	// the stamp (which carries the fields and the moves, never the frame) compares equal too — the
	// whole plan came back null and the NPC wore the first crop for good.
	it("carries a re-cropped portrait frame through on an unchanged picture", async () => {
		const SRC = "worlds/art/enfys.webp";
		const F1 = { src: SRC, rect: [0.1, 0.1, 0.6, 0.6] };
		const F2 = { src: SRC, rect: [0.2, 0.2, 0.8, 0.8] };
		const npc = makeFollowerActor("Actor.a", card({ img: SRC, portraitFrame: F1 }));
		npc.flags["stonetop-pwd"].portraitFrame = F1;
		character = makeCharacter({ f1: "Actor.a" });

		expect(await syncFollowerActors(character, [snap({ img: SRC, portraitFrame: F2 })])).toBe(1);
		expect(wrote(npc)["flags.stonetop-pwd.portraitFrame"]).toEqual(F2);
		// The picture itself never moved, so nothing should be rewriting it.
		expect(wrote(npc).img).toBeUndefined();
	});

	it("fills the numbers on an actor still sitting at the schema's own 0", async () => {
		// NpcModel starts armor and the HP ceiling at 0, and 0 used to read as "the actor holds
		// something": skipped on the first pass, the stamp then planted saying the card had given
		// 6, and every pass after compared 0 against 6 and skipped them again. An actor made
		// before the stamp existed was stranded there — the token dropped on the map read 0/0
		// forever, which is the exact drift this sweep is for.
		const npc = makeFollowerActor("Actor.a", CARD, {
			flags: {},
			system: { attributes: { hp: { value: 0, max: 0 }, armor: { value: 0, source: "" }, damage: {} } },
		});
		character = makeCharacter({ f1: "Actor.a" });

		expect(await syncFollowerActors(character, [snap()])).toBe(1);
		expect(wrote(npc)["system.attributes.hp.max"]).toBe(6);
		expect(wrote(npc)["system.attributes.armor.value"]).toBe(1);
	});

	it("leaves a number somebody typed on the NPC itself alone", async () => {
		// The other half of the same rule: 0 is the empty field, but 3 is a decision.
		const npc = makeFollowerActor("Actor.a");
		npc.system.attributes.armor.value = 3;
		character = makeCharacter({ f1: "Actor.a" });

		await syncFollowerActors(character, [snap({ armor: 2 })]);

		expect(wrote(npc)["system.attributes.armor.value"]).toBeUndefined();
	});

	it("puts a newly chosen portrait on the actor the drop will place", async () => {
		const npc = makeFollowerActor("Actor.a", card({ img: "" }));
		character = makeCharacter({ f1: "Actor.a" });

		expect(await syncFollowerActors(character, [snap({ img: "worlds/art/enfys.webp" })])).toBe(1);
		// No prototypeToken.texture here: writing `img` is what
		// StonetopActor#_syncPrototypeTokenImage watches, and it carries a token that was following.
		expect(wrote(npc).img).toBe("worlds/art/enfys.webp");
	});

	it("carries a rename through to the token's own label", async () => {
		// Half a rename is worse than none: the sheet says one name and the token announces another.
		const npc = makeFollowerActor("Actor.a");
		character = makeCharacter({ f1: "Actor.a" });

		expect(await syncFollowerActors(character, [snap({ name: "Bryn, your acolyte" })])).toBe(1);
		expect(wrote(npc).name).toBe("Bryn");
		expect(wrote(npc)["prototypeToken.name"]).toBe("Bryn");
		// The epithet lands where the NPC sheet prints it, rather than inside the name.
		expect(wrote(npc)["system.traits"]).toBe("your acolyte");
	});

	it("follows the descriptive stats the card is the author of", async () => {
		const npc = makeFollowerActor("Actor.a");
		character = makeCharacter({ f1: "Actor.a" });

		await syncFollowerActors(character, [snap({
			tags: ["loyal", "organized"], instinct: "To flee", armor: 2, armorSource: "mail",
			damage: "d8 (close)", damageRoll: "d8", typeLabel: "warband", pronoun: "they",
		})]);

		expect(wrote(npc)).toMatchObject({
			"system.tags": "loyal, organized",
			"system.instinct": "To flee",
			"system.attributes.armor.value": 2,
			"system.attributes.armor.source": "mail",
			"system.attributes.damage.value": "d8 (close)",
			"system.attributes.damage.rollFormula": "d8",
			"system.occupation": "warband",
			"system.pronouns": "they",
		});
	});

	it("re-prints the notes when the cost or the gear on the card changes", async () => {
		const npc = makeFollowerActor("Actor.a");
		character = makeCharacter({ f1: "Actor.a" });

		await syncFollowerActors(character, [snap({
			cost: "A share of the harvest", gear: [{ label: "sling", checked: true }],
		})]);

		expect(wrote(npc)["system.notes"])
			.toBe("<p><strong>Cost:</strong> A share of the harvest</p><p><strong>Gear:</strong> sling</p>");
	});

	it("follows the HP ceiling but never the current HP, which the token owns", async () => {
		// A sweep that wrote `value` would heal a follower mid-fight every time the sheet rendered.
		const npc = makeFollowerActor("Actor.a");
		npc.system.attributes.hp.value = 2;
		character = makeCharacter({ f1: "Actor.a" });

		await syncFollowerActors(character, [snap({ hp: { value: 6, max: 8 } })]);

		expect(wrote(npc)["system.attributes.hp.max"]).toBe(8);
		expect(wrote(npc)["system.attributes.hp.value"]).toBeUndefined();
	});

	it("drags the current HP down with a ceiling the card lowered past it", async () => {
		const npc = makeFollowerActor("Actor.a");
		npc.system.attributes.hp.value = 6;
		character = makeCharacter({ f1: "Actor.a" });

		await syncFollowerActors(character, [snap({ hp: { value: 6, max: 3 } })]);

		expect(wrote(npc)["system.attributes.hp.max"]).toBe(3);
		expect(wrote(npc)["system.attributes.hp.value"]).toBe(3);
	});

	it("leaves anything somebody typed on the NPC's own sheet exactly where it is", async () => {
		const npc = makeFollowerActor("Actor.a", CARD, { img: "worlds/art/gm-picked.webp" });
		npc.system.instinct = "To betray them at the ford";
		character = makeCharacter({ f1: "Actor.a" });

		await syncFollowerActors(character, [snap({ img: "worlds/art/enfys.webp", instinct: "To flee" })]);

		expect(wrote(npc).img).toBeUndefined();
		expect(wrote(npc)["system.instinct"]).toBeUndefined();
	});

	it("goes on following after the first change, from one portrait to the next", async () => {
		// The stamp is the whole reason this works twice: by now the actor's img is real art, so
		// the placeholder test can no longer answer "is this still ours to move".
		const npc = makeFollowerActor("Actor.a", card({ img: "worlds/art/enfys.webp" }));
		character = makeCharacter({ f1: "Actor.a" });

		expect(await syncFollowerActors(character, [snap({ img: "worlds/art/enfys-older.webp" })])).toBe(1);
		expect(wrote(npc).img).toBe("worlds/art/enfys-older.webp");
	});

	it("moves an actor made before the stamp existed off any of our stand-in discs", async () => {
		// isDefaultImg knows the mystery man and the "human, individual" mark; a converted beast's
		// paw disc is just as much a placeholder, and only isFollowerMarkerImg can say so.
		const npc = makeFollowerActor("Actor.a", CARD, { img: BEAST, flags: {} });
		character = makeCharacter({ f1: "Actor.a" });

		expect(await syncFollowerActors(character, [snap({ img: "worlds/art/hound.webp" })])).toBe(1);
		expect(wrote(npc).img).toBe("worlds/art/hound.webp");
	});

	it("only fills the BLANKS on an actor made before the stamp existed, then stamps it", async () => {
		// For a value it already holds there is no telling "the card changed" from "a GM typed
		// this", so the first pass plants the stamp and every change after it follows.
		const npc = makeFollowerActor("Actor.a", CARD, { flags: {} });
		npc.system.instinct = "";
		character = makeCharacter({ f1: "Actor.a" });

		await syncFollowerActors(character, [snap({ instinct: "To flee", damage: "d8 (close)" })]);

		expect(wrote(npc)["system.instinct"]).toBe("To flee");
		expect(wrote(npc)["system.attributes.damage.value"]).toBeUndefined();
		expect(wrote(npc)["flags.stonetop-pwd.followerCard"].fields.damage).toBe("d8 (close)");
	});

	it("takes the frame with the picture, and takes the old rect away with it", async () => {
		const frame = { src: "worlds/art/enfys.webp", rect: [0.1, 0.1, 0.5, 0.5] };
		const withArt = makeFollowerActor("Actor.a", card({ img: "" }));
		const cleared = makeFollowerActor("Actor.b", card({ img: "worlds/art/enfys.webp", portraitFrame: frame }));
		character = makeCharacter({ f1: "Actor.a", f2: "Actor.b" });

		await syncFollowerActors(character, [
			snap({ img: "worlds/art/enfys.webp", portraitFrame: frame }),
			// Its portrait cleared: back to the card's mark, and the rect measured on the picture
			// it no longer wears goes with it.
			{ ...snap({ img: "" }, "Actor.b"), slug: "f2", detailBase: "customFollowers.f2" },
		]);

		expect(wrote(withArt)["flags.stonetop-pwd.portraitFrame"]).toEqual(frame);
		expect(wrote(cleared).img).toBe(MARK);
		expect(wrote(cleared)["flags.stonetop-pwd.-=portraitFrame"]).toBeNull();
	});

	it("adds a move the card gained and removes one it lost", async () => {
		const npc = makeFollowerActor("Actor.a");
		character = makeCharacter({ f1: "Actor.a" });

		expect(await syncFollowerActors(character, [snap({ moves: ["Stand fast"] })])).toBe(1);
		// Removals first, so a renamed move is never briefly listed twice.
		expect(npc.deleteEmbeddedDocuments).toHaveBeenCalledWith("Item", ["item0"], SILENT);
		expect(npc.createEmbeddedDocuments)
			.toHaveBeenCalledWith("Item", [{ name: "Stand fast", type: "npcMove" }], SILENT);
	});

	it("marks every write it makes as the machine's, so the NPC ledger stays quiet", async () => {
		// NpcLedger watches all thirteen fields the card governs, plus move adds and removes. An
		// edit made ON THE CARD must not read on the NPC's own log as though somebody sat down
		// and typed it there — nor be attributed to whichever client's render won the stagger.
		const npc = makeFollowerActor("Actor.a");
		character = makeCharacter({ f1: "Actor.a" });

		await syncFollowerActors(character, [snap({ name: "Enfys the Quiet", moves: ["Stand fast"] })]);

		expect(npc.update).toHaveBeenCalledWith(expect.any(Object), SILENT);
		expect(npc.deleteEmbeddedDocuments).toHaveBeenCalledWith("Item", expect.any(Array), SILENT);
		expect(npc.createEmbeddedDocuments).toHaveBeenCalledWith("Item", expect.any(Array), SILENT);
	});

	it("never takes away a GM move written on the NPC itself", async () => {
		// Only moves the card put there are removed, and a hand-written one was never stamped.
		const npc = makeFollowerActor("Actor.a");
		npc.items.push({ id: "gm1", name: "Calls the birds down", type: "npcMove" });
		character = makeCharacter({ f1: "Actor.a" });

		await syncFollowerActors(character, [snap({ moves: [] })]);

		expect(npc.deleteEmbeddedDocuments).toHaveBeenCalledWith("Item", ["item0"], SILENT);
	});

	it("never rewrites the villager a follower was recruited from", async () => {
		// That NPC is a document in their own right; editing the follower card is not a licence to
		// change theirs. Only the actor made FOR this card follows.
		const source = makeFollowerActor("Actor.src");
		character = makeCharacter();

		expect(await syncFollowerActors(character, [{
			ftype: "custom", slug: "f1", detailBase: "customFollowers.f1",
			follower: { sourceUuid: "Actor.src", ...card({ name: "Someone else" }) },
		}])).toBe(0);
		expect(source.update).not.toHaveBeenCalled();
	});

	it("stands down for a viewer who does not own the actor, and shrugs off a stale link", async () => {
		const npc = makeFollowerActor("Actor.a", CARD, { isOwner: false });
		character = makeCharacter({ f1: "Actor.a", f2: "Actor.gone" });

		expect(await syncFollowerActors(character, [
			snap({ name: "Someone else" }),
			{ ...snap({ name: "Nobody" }, "Actor.gone"), slug: "f2", detailBase: "customFollowers.f2" },
		])).toBe(0);
		expect(npc.update).not.toHaveBeenCalled();
	});

	it("reports a refused write rather than throwing at its caller", async () => {
		makeFollowerActor("Actor.a", CARD, { update: vi.fn(async () => { throw new Error("nope"); }) });
		const quiet = vi.spyOn(console, "warn").mockImplementation(() => {});
		character = makeCharacter({ f1: "Actor.a" });

		await expect(syncFollowerActors(character, [snap({ name: "Someone else" })])).resolves.toBe(0);
		quiet.mockRestore();
	});

	it("re-plans after waiting its turn, so the client that lost the race adds nothing twice", async () => {
		// Writing a field twice is merely wasteful; adding a MOVE twice leaves the follower
		// carrying it twice, and nothing takes that back. So the later client looks again.
		globalThis.game.users.contents = [
			{ id: "user0", active: true }, { id: "user1", active: true },
		];
		const npc = makeFollowerActor("Actor.a");
		character = makeCharacter({ f1: "Actor.a" });
		// The first client's write lands while this one is still waiting its turn.
		setTimeout(() => {
			npc.items.push({ id: "theirs", name: "Stand fast", type: "npcMove" });
			npc.flags["stonetop-pwd"].followerCard =
				followerNpcActorData(card({ moves: ["Stand fast"] })).flags["stonetop-pwd"].followerCard;
		}, 0);

		expect(await syncFollowerActors(character, [snap({ moves: ["Stand fast"] })])).toBe(0);
		expect(npc.createEmbeddedDocuments).not.toHaveBeenCalled();
	});
});
