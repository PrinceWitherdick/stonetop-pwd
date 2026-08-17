import { describe, it, expect } from "vitest";
import { EMPTY_ARTIFACT, InventoryItemSnapshotBuilder } from "../../module/model/InventorySnapshot.js";
import { concealArtifactFields, ARTIFACT_STATE } from "../../module/actors/character/artifact-identify.js";

// The row's artifact view is the ONE object concealArtifactFields hands over, kept whole (see the
// builder's note). These cover the seam between the two: every field the concealer produces has to
// survive the builder, or the producer and the consumer quietly disagree about what a row carries.

const build = view => new InventoryItemSnapshotBuilder().withName("Urn").withArtifact(view).build().artifact;

describe("withArtifact", () => {
	it("carries every field of the view that the row doesn't take for itself", () => {
		const view = concealArtifactFields(
			{ state: ARTIFACT_STATE.UNKNOWN, note: "fragile", hint: "It hums.", lead: "Ask Aeronwen." },
			{ viewerIsGM: false });
		// `note` and `resource` land on the ROW (already concealed to match); everything else the
		// concealer produces belongs to the view and has to reach the template through it.
		const owned = Object.keys(view).filter(key => key !== "note" && key !== "resource");

		expect(Object.keys(build(view)).sort()).toEqual(owned.sort());
		// And the empty view is the same shape, so an ordinary row answers the same questions.
		expect(Object.keys(EMPTY_ARTIFACT).sort()).toEqual(owned.sort());
	});

	it("says a hidden row IS an artifact, and an ordinary one isn't", () => {
		expect(build(concealArtifactFields({ state: ARTIFACT_STATE.UNKNOWN })).isArtifact).toBe(true);
		expect(build(concealArtifactFields({ state: ARTIFACT_STATE.KNOWN })).isArtifact).toBe(true);
		expect(build(concealArtifactFields({ state: ARTIFACT_STATE.NONE })).isArtifact).toBe(false);
	});

	// Derived from `state` rather than copied, so a caller handing over half a view can't leave the
	// flag claiming an artifact the state denies.
	it("derives the flag from the state rather than trusting it", () => {
		expect(build({ state: ARTIFACT_STATE.PARTIAL, isArtifact: false }).isArtifact).toBe(true);
		expect(build({ state: "", isArtifact: true }).isArtifact).toBe(false);
	});

	it("falls back to the empty view, which is a full one", () => {
		expect(new InventoryItemSnapshotBuilder().withName("Rope").build().artifact).toBe(EMPTY_ARTIFACT);
		expect(build(null)).toBe(EMPTY_ARTIFACT);
	});
});
