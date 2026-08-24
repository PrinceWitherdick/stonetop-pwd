import { describe, it, expect } from "vitest";

import {
	assetHolder, assetTakenLabel, assetTakenTooltip,
} from "../../module/utils/requisition-asset.js";

// Where a requisitioned asset went, worded once for every reader of it. Three screens print
// this: the steading sheet's tooltip on a struck-through asset, the player-facing Requisition
// picker's "Already out" list, and the walkthrough's own asset list. They have to agree, or a
// GM chasing the wagon gets a different answer depending on which window they opened.

describe("who is holding an asset", () => {
	it("is nobody for an asset still on hand", () => {
		expect(assetHolder({ name: "A wagon", checked: true })).toBe(null);
		expect(assetTakenLabel({ name: "A wagon", checked: true })).toBe("");
		expect(assetTakenTooltip({ name: "A wagon", checked: true })).toBe("");
	});

	it("is the character who took it, through the player-facing move", () => {
		const asset = { name: "A wagon", takenBy: { name: "Wren", id: "hero1" } };
		expect(assetHolder(asset)).toEqual({ person: "Wren", expedition: null });
		expect(assetTakenLabel(asset)).toBe("Taken by Wren");
	});

	it("is the expedition it went out on, through the walkthrough", () => {
		const asset = { name: "A wagon", takenBy: { expedition: { id: "trip-1", title: "The Wandering Tower" } } };
		expect(assetHolder(asset)).toEqual({
			person: null, expedition: "The Wandering Tower",
		});
		expect(assetTakenLabel(asset)).toBe("Out on The Wandering Tower");
	});

	it("names both when a character took it on a named trip", () => {
		const asset = {
			name: "A wagon",
			takenBy: { name: "Wren", id: "hero1", expedition: { id: "trip-1", title: "The Wandering Tower" } },
		};
		expect(assetTakenLabel(asset)).toBe("Taken by Wren, out on The Wandering Tower");
	});

	// A takenBy with nothing legible in it still has to say the asset is GONE: falling back to
	// "" would let the sheet render a struck-through name with an empty tooltip, which reads as
	// a bug rather than as an asset out on loan.
	it("still says it is out when the record names no one", () => {
		expect(assetTakenLabel({ name: "A wagon", takenBy: {} })).toBe("Taken by someone");
		expect(assetTakenLabel({ name: "A wagon", takenBy: { name: "   " } })).toBe("Taken by someone");
	});

	it("adds the steading sheet's affordance to the tooltip, and only when it is out", () => {
		const asset = { name: "A wagon", takenBy: { expedition: { id: "t", title: "The Long Walk" } } };
		expect(assetTakenTooltip(asset)).toBe("Out on The Long Walk. Click to return");
	});

	// An unnamed trip is labelled "Expedition N" before it is ever written onto an asset (see
	// expeditionLabel), so a blank title here means a malformed record, not an unnamed trip.
	it("ignores a blank expedition title rather than printing 'Out on '", () => {
		const asset = { name: "A wagon", takenBy: { name: "Wren", expedition: { id: "t", title: "  " } } };
		expect(assetTakenLabel(asset)).toBe("Taken by Wren");
	});
});
