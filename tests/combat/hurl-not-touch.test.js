// Audit XS-3: Poltergeist's Hurl, "Hurl an object at someone ... deal your damage (forceful)" (Book I p.149), is an
// object thrown, not the Ghost's touch, so its card's damage button tells rollDamageAt so (`notTouch`), and a manifest
// touch's "ignores armor" stays off it (attack-flow.js#rollAndPostDamage).

import { describe, it, expect, vi } from "vitest";

vi.mock("../../module/combat/attack-flow.js", async importOriginal => ({
	...(await importOriginal()),
	rollDamageAt: vi.fn(async () => true),
	pcDamageDie: vi.fn(async () => "d6"),
}));
const { rollDamageAt } = await import("../../module/combat/attack-flow.js");
const { pressCardButton } = await import("../../module/actors/character/post-death-actions.js");

function card() {
	const flags = {};
	return {
		flags,
		getFlag: (_s, key) => key.split(".").reduce((v, k) => v?.[k], flags),
		setFlag: vi.fn(async (_s, key, value) => {
			const parts = key.split(".");
			let node = flags;
			for (const part of parts.slice(0, -1)) node = node[part] ??= {};
			node[parts.at(-1)] = value;
		}),
		unsetFlag: vi.fn(async () => {}),
	};
}

describe("Poltergeist's Hurl button", () => {
	it("deals the character's own damage as no touch of theirs", async () => {
		const btn = {
			classList: { contains: c => c === "stonetop-pd-own-damage" },
			dataset: { key: "own-damage", move: "Poltergeist: Hurl", tags: "forceful" },
			disabled: false,
		};
		expect(await pressCardButton(card(), { name: "Wisp", type: "character" }, btn)).toBe(true);
		expect(rollDamageAt).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
			formula: "d6", label: "Poltergeist: Hurl", keywords: "forceful", notTouch: true,
		}));
	});
});
