import { describe, it, expect, vi } from "vitest";
import { FakeActorBuilder } from "../../fakes/FakeActorBuilder.js";
import { TestCharacterBuilder } from "../../fakes/TestCharacterBuilder.js";
import { treasureItemData } from "../../../module/utils/treasure-drops.js";
import { ARTIFACT_STATE } from "../../../module/actors/character/artifact-identify.js";

// The document side of identifying artifacts (Book I, Discoveries pp.430-431): what lands on
// the item when a treasure is dropped, and the two writes that move it up and down p.430's
// ladder. The concealment RULE lives in artifact-identify.test.js; this is the plumbing.

const BRASS_SPHERE = {
	name: "Brass sphere", section: "Ustrina", origin: "Brass sphere", slug: "ustrina-brass-sphere",
	column: "regular", weight: 1, note: "magical", value: "2", uses: 3, usesLabel: "hours",
};

/** An owned inventory item the character can look up by id, as Foundry's collection allows. */
function withItem(actor, item) {
	actor.items = Object.assign([item], { get: id => (id === item._id ? item : undefined) });
	item.update = vi.fn(async data => {
		for (const [path, value] of Object.entries(data)) {
			const parts = path.split(".");
			let cur = item;
			for (const k of parts.slice(0, -1)) cur = (cur[k] ??= {});
			cur[parts.at(-1)] = value;
		}
	});
	return item;
}

function artifactItem(overrides = {}) {
	return {
		_id: "item-1", id: "item-1", type: "move", name: "A brass sphere",
		system: {
			moveType: "inventory-custom", inventoryColumn: "regular", weight: 1,
			note: "magical, Value 2", isTreasure: true,
			identifyState: ARTIFACT_STATE.UNKNOWN, artifactHint: "It is warm",
			artifactLore: "", artifactLead: "", ...overrides,
		},
	};
}

describe("addDroppedInventoryItem — how an artifact arrives", () => {
	it("lands fully described by default, exactly as it always has", async () => {
		const actor = new FakeActorBuilder().build();
		const char = new TestCharacterBuilder(actor).build();
		await char.addDroppedInventoryItem(treasureItemData(BRASS_SPHERE));
		const [, [created]] = actor.createEmbeddedDocuments.mock.calls[0];
		// No identifyState key at all — an item that isn't hidden must read to every older
		// code path exactly like one from before the feature existed.
		expect(created.system).not.toHaveProperty("identifyState");
		expect(created.system.note).toMatch(/magical/);
	});

	it("lands unidentified when the world asks for it", async () => {
		const actor = new FakeActorBuilder().build();
		const char = new TestCharacterBuilder(actor).build();
		await char.addDroppedInventoryItem(treasureItemData(BRASS_SPHERE), { hideArtifact: true });
		const [, [created]] = actor.createEmbeddedDocuments.mock.calls[0];
		expect(created.system.identifyState).toBe(ARTIFACT_STATE.UNKNOWN);
		// The tags stay ON the item — concealment is a render-time rule, so hiding them here
		// would destroy the very text the 7+ is supposed to hand over.
		expect(created.system.note).toMatch(/magical/);
	});

	it("never hides an ordinary write-in, only a treasure", async () => {
		// A hand-written item has no tags worth concealing, and a "?" on the player's own gear
		// is just a lock with nothing behind it.
		const actor = new FakeActorBuilder().build();
		const char = new TestCharacterBuilder(actor).build();
		await char.addDroppedInventoryItem(
			{ name: "Rope", system: { moveType: "inventory", inventoryColumn: "small" } },
			{ hideArtifact: true });
		const [, [created]] = actor.createEmbeddedDocuments.mock.calls[0];
		expect(created.system).not.toHaveProperty("identifyState");
	});

	it("keeps a state the drop already carries rather than re-hiding it", async () => {
		// A GM who has already revealed an artifact and drags the world copy over must not have
		// it slammed shut again on the way in.
		const actor = new FakeActorBuilder().build();
		const char = new TestCharacterBuilder(actor).build();
		const payload = treasureItemData(BRASS_SPHERE);
		payload.system.identifyState = ARTIFACT_STATE.KNOWN;
		payload.system.artifactLore  = "It opens doors.";
		await char.addDroppedInventoryItem(payload, { hideArtifact: true });
		const [, [created]] = actor.createEmbeddedDocuments.mock.calls[0];
		expect(created.system.identifyState).toBe(ARTIFACT_STATE.KNOWN);
		expect(created.system.artifactLore).toBe("It opens doors.");
	});
});

describe("setArtifactState", () => {
	it("writes the new state", async () => {
		const actor = new FakeActorBuilder().build();
		const item = withItem(actor, artifactItem());
		const char = new TestCharacterBuilder(actor).build();
		expect(await char.setArtifactState("item-1", ARTIFACT_STATE.KNOWN)).toBe(true);
		expect(item.system.identifyState).toBe(ARTIFACT_STATE.KNOWN);
	});

	it("refuses a downgrade when the caller asked for upgrades only", async () => {
		// A GM Shift Down can take a padded 10 back to a 9. That's the GM overriding a spend and
		// their call to make, but it cannot un-tell a write-up the player has already read.
		const actor = new FakeActorBuilder().build();
		const item = withItem(actor, artifactItem({ identifyState: ARTIFACT_STATE.KNOWN }));
		const char = new TestCharacterBuilder(actor).build();
		expect(await char.setArtifactState("item-1", ARTIFACT_STATE.PARTIAL, { upgradeOnly: true })).toBe(false);
		expect(item.update).not.toHaveBeenCalled();
		expect(item.system.identifyState).toBe(ARTIFACT_STATE.KNOWN);
	});

	it("allows the GM's own downgrade — re-hiding is what that control is for", async () => {
		const actor = new FakeActorBuilder().build();
		const item = withItem(actor, artifactItem({ identifyState: ARTIFACT_STATE.KNOWN }));
		const char = new TestCharacterBuilder(actor).build();
		expect(await char.setArtifactState("item-1", ARTIFACT_STATE.UNKNOWN)).toBe(true);
		expect(item.system.identifyState).toBe(ARTIFACT_STATE.UNKNOWN);
	});

	it("writes nothing when the state is already what was asked for", async () => {
		// Otherwise every Logbook spend on an already-open artifact costs a document update and
		// a re-render of every sheet showing it.
		const actor = new FakeActorBuilder().build();
		const item = withItem(actor, artifactItem({ identifyState: ARTIFACT_STATE.KNOWN }));
		const char = new TestCharacterBuilder(actor).build();
		expect(await char.setArtifactState("item-1", ARTIFACT_STATE.KNOWN)).toBe(false);
		expect(item.update).not.toHaveBeenCalled();
	});

	it("is a no-op for an item that has gone", async () => {
		const actor = new FakeActorBuilder().build();
		withItem(actor, artifactItem());
		const char = new TestCharacterBuilder(actor).build();
		expect(await char.setArtifactState("nope", ARTIFACT_STATE.KNOWN)).toBe(false);
	});
});

describe("updateArtifactKnowledge", () => {
	it("writes only the fields it was given", async () => {
		const actor = new FakeActorBuilder().build();
		const item = withItem(actor, artifactItem({ artifactHint: "It is warm", artifactLead: "Ask Gorlas" }));
		const char = new TestCharacterBuilder(actor).build();
		await char.updateArtifactKnowledge("item-1", { lore: "It opens doors." });
		expect(item.update).toHaveBeenCalledWith({ "system.artifactLore": "It opens doors." }, {});
		expect(item.system.artifactLead).toBe("Ask Gorlas");   // untouched
	});

	it("can save the text and the state in one write", async () => {
		const actor = new FakeActorBuilder().build();
		const item = withItem(actor, artifactItem());
		const char = new TestCharacterBuilder(actor).build();
		await char.updateArtifactKnowledge("item-1", { hint: "", lore: "x", lead: "", state: ARTIFACT_STATE.KNOWN });
		expect(item.system.identifyState).toBe(ARTIFACT_STATE.KNOWN);
		expect(item.system.artifactLore).toBe("x");
	});

	it("normalizes a bad state rather than storing it", async () => {
		const actor = new FakeActorBuilder().build();
		const item = withItem(actor, artifactItem());
		const char = new TestCharacterBuilder(actor).build();
		await char.updateArtifactKnowledge("item-1", { state: "identified" });
		expect(item.system.identifyState).toBe(ARTIFACT_STATE.NONE);
	});

	it("writes nothing when handed nothing", async () => {
		const actor = new FakeActorBuilder().build();
		const item = withItem(actor, artifactItem());
		const char = new TestCharacterBuilder(actor).build();
		expect(await char.updateArtifactKnowledge("item-1", {})).toBe(false);
		expect(item.update).not.toHaveBeenCalled();
	});
});

describe("artifactKnowledge", () => {
	it("reads the item's own fields back for the GM window", async () => {
		const actor = new FakeActorBuilder().build();
		withItem(actor, artifactItem({ artifactLore: "It opens doors.", artifactLead: "Ask Gorlas" }));
		const char = new TestCharacterBuilder(actor).build();
		expect(char.artifactKnowledge("item-1")).toMatchObject({
			id: "item-1", name: "A brass sphere", state: ARTIFACT_STATE.UNKNOWN,
			note: "magical, Value 2", hint: "It is warm", lore: "It opens doors.", lead: "Ask Gorlas",
		});
	});

	it("is null for an item that isn't there", () => {
		const actor = new FakeActorBuilder().build();
		withItem(actor, artifactItem());
		const char = new TestCharacterBuilder(actor).build();
		expect(char.artifactKnowledge("nope")).toBeNull();
	});
});
