import { describe, it, expect } from "vitest";
import { TestCharacterBuilder } from "../../fakes/TestCharacterBuilder.js";
import { FakeActorBuilder } from "../../fakes/FakeActorBuilder.js";
import { ARTIFACT_STATE } from "../../../module/actors/character/artifact-identify.js";

// Identifying artifacts reaches the gear tab (Book I, Discoveries pp.430-431). The rule itself
// is covered in artifact-identify.test.js; what matters HERE is that the concealment happens
// while the snapshot is built — before anything is rendered — so a withheld note never enters
// the DOM for a player to find in the inspector.

function treasureItem(system = {}) {
	return {
		_id: "item-1", id: "item-1", type: "move", name: "A brass sphere",
		system: {
			moveType: "inventory-custom", inventoryColumn: "regular", weight: 1,
			isTreasure: true, note: "magical, Value 2",
			resource: { max: 3, title: "hours", labels: [] },
			...system,
		},
	};
}

const build = (item, view) =>
	new TestCharacterBuilder(new FakeActorBuilder().withItems([item]).build()).build().buildSnapshot(view);

const treasure = async (item, view) => (await build(item, view)).inventory.outfit.treasureRegular[0];

describe("buildSnapshot — a concealed artifact on the gear tab", () => {
	it("leaves an unhidden treasure exactly as it was", async () => {
		const row = await treasure(treasureItem());
		expect(row.note).toMatch(/magical/);
		expect(row.resource.max).toBe(3);
		expect(row.artifact.state).toBe("");
		expect(row.artifact.concealed).toBe(false);
	});

	it("withholds the tags and the ○ uses of an unidentified one", async () => {
		const row = await treasure(treasureItem({
			identifyState: ARTIFACT_STATE.UNKNOWN,
			artifactHint: "It is warm to the touch",
			artifactLore: "It opens doors.",
		}));
		expect(row.note).toBeNull();
		expect(row.resource).toBeNull();
		expect(row.artifact.lore).toBe("");        // the write-up isn't theirs yet
		expect(row.artifact.hint).toBe("It is warm to the touch");
		expect(row.artifact.concealed).toBe(true);
	});

	it("keeps the ◇ load visible even while everything else is hidden", async () => {
		// p.428 has the PCs "accounting for its load" the moment they take an artifact — you can
		// feel how heavy a thing is without knowing what it is — and a hidden weight would
		// silently mis-state encumbrance, which is a readout the player is entitled to.
		const row = await treasure(treasureItem({ identifyState: ARTIFACT_STATE.UNKNOWN }));
		expect(row.weight).toBe(1);
	});

	it("still counts a hidden artifact toward load when it's marked", async () => {
		const actor = new FakeActorBuilder()
			.withItems([treasureItem({ identifyState: ARTIFACT_STATE.UNKNOWN })])
			.withFlag("inventory.checked", { "item-1": true })
			.build();
		const snap = await new TestCharacterBuilder(actor).build().buildSnapshot();
		expect(snap.inventory.outfit.load.totalMarks).toBe(1);
	});

	it("gives up the tags and the uses on a 7-9, and still owes the write-up", async () => {
		const row = await treasure(treasureItem({
			identifyState: ARTIFACT_STATE.PARTIAL, artifactLore: "It opens doors.",
		}));
		expect(row.note).toMatch(/magical/);
		expect(row.resource.max).toBe(3);
		expect(row.artifact.lore).toBe("");
		expect(row.artifact.loreOwed).toBe(true);
		expect(row.artifact.concealed).toBe(true);
	});

	it("hands the write-up over at known and drops the tease", async () => {
		const row = await treasure(treasureItem({
			identifyState: ARTIFACT_STATE.KNOWN,
			artifactHint: "It is warm to the touch", artifactLore: "It opens doors.",
			artifactLead: "Ask Gorlas",
		}));
		expect(row.note).toMatch(/magical/);
		expect(row.artifact.lore).toBe("It opens doors.");
		expect(row.artifact.hint).toBe("");
		expect(row.artifact.lead).toBe("");
		expect(row.artifact.concealed).toBe(false);
	});

	it("shows the GM what they wrote, and says they're the only one seeing it", async () => {
		const row = await treasure(
			treasureItem({ identifyState: ARTIFACT_STATE.UNKNOWN, artifactLore: "It opens doors." }),
			{ viewerIsGM: true });
		expect(row.note).toMatch(/magical/);
		expect(row.artifact.lore).toBe("It opens doors.");
		expect(row.artifact.gmPeeking).toBe(true);
	});

	it("conceals when the caller doesn't say who is looking", async () => {
		// buildSnapshot has several callers that only want vitals; none of them should be able
		// to leak an artifact by forgetting to name a viewer.
		const row = await treasure(treasureItem({ identifyState: ARTIFACT_STATE.UNKNOWN }));
		expect(row.note).toBeNull();
	});
});
