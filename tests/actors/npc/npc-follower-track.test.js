import { describe, it, expect } from "vitest";
import { createStonetopNpcSheetClass } from "../../../module/actors/npc/StonetopNpcSheet.js";
import { SYSTEM_ID } from "../../../module/system-id.js";

// A follower's NPC sheet shows what their card holds that a fight or an order reads: Loyalty and any
// Readiness from an ordered Defend (p.469), off the card on the character they follow, and an Order
// button for whoever may order them.

const Sheet = createStonetopNpcSheetClass(class { constructor(actor) { this.actor = actor; } });
const track = (npc, card) => Sheet.prototype._followerTrack.call({ actor: npc }, card);

function cadi(flags, isOwner = true) {
	return { id: "cadi", type: "character", name: "Cadi", isOwner, flags: { [SYSTEM_ID]: flags } };
}
const npc = () => ({ id: "rill", type: "npc", name: "Rill", system: {}, flags: {} });

describe("a follower's track on their NPC sheet", () => {
	it("reads the companion's Loyalty and Readiness off the card, and offers Order to the leader's owner", () => {
		const character = cadi({ animalCompanion: { loyalty: 2, readiness: 1 } });
		const card = { character, ftype: "animal-companion", slug: "" };
		const out = track(npc(), card);
		expect(out).toMatchObject({ hasLoyalty: true, loyalty: 2, canOrder: true });
	});

	it("reads a Servant of Daagon's Loyalty from the Ring's pool (Book II p.561)", () => {
		const character = cadi({ customFollowers: {
			ring: { sourceUuid: "ring-of-daagon:the-ring", loyalty: 3 },
			batch: { sourceUuid: "ring-of-daagon:servant-of-daagon", loyalty: 0 },
		} });
		expect(track(npc(), { character, ftype: "custom", slug: "batch" })).toMatchObject({ loyalty: 3 });
	});

	it("gives livestock nothing to show and no Order", () => {
		const character = cadi({ beastLoyalty: {} });
		expect(track(npc(), { character, ftype: "beast", slug: "goat" })).toBeNull();
	});

	it("shows the Loyalty but no Order to someone who does not own the leader", () => {
		const character = cadi({ animalCompanion: { loyalty: 1 } }, false);
		expect(track(npc(), { character, ftype: "animal-companion", slug: "" })).toMatchObject({ loyalty: 1, canOrder: false });
	});
});
