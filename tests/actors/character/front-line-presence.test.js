// FRONT LINE LEADER (the Marshal, Book I p.126): "When you lead your crew into battle, hold 2 Presence.
// Spend Presence in lieu of your crew's Loyalty or as Readiness (as if you Defended them)." The hold is the
// learned move's track; it pays for the crew only, wherever the crew pays (the user's ruling, 2026-10-18).

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
	FRONT_LINE_LEADER, PURSE_FIELD, presenceHeld, presenceCovers, presenceFor, spendPresence, paysWithPresence,
	purseChoiceHtml, pickedPurse, presenceKeeperFor,
} from "../../../module/actors/character/front-line-presence.js";
import { SYSTEM_ID } from "../../../module/system-id.js";

const fll = ({ learned = true } = {}) => ({
	type: "move", name: FRONT_LINE_LEADER,
	system: { resource: { max: 2, title: "Presence" } },
	flags: learned ? {} : { [SYSTEM_ID]: { learned: false } },
});

/** A character holding `held` Presence on its Front Line Leader track. */
function marshal(held = 2, { learned = true, items = null } = {}) {
	const tracks = { [FRONT_LINE_LEADER]: held };
	return {
		name: "Rhianna", type: "character", uuid: "Actor.rhianna", isOwner: true,
		items: items ?? [fll({ learned })],
		typedActor: { moveResources: {
			getMoveResources: () => tracks,
			setUses: vi.fn(async (move, value) => { tracks[move] = value; }),
		} },
		tracks,
	};
}

/** A stand-in for a dialog's html: answers the `:checked` input of each radio name it was given. */
function formWith(checked = {}) {
	return [{
		querySelector: sel => {
			const name = /name="([^"]+)"/.exec(sel)?.[1];
			return name && checked[name] != null ? { value: checked[name] } : null;
		},
		querySelectorAll: () => [],
	}];
}

describe("the Presence a Marshal holds", () => {
	it("is the learned move's track, within its max, and nothing without the move", () => {
		expect(presenceHeld(marshal(2))).toBe(2);
		expect(presenceHeld(marshal(1))).toBe(1);
		expect(presenceHeld(marshal(5))).toBe(2);
		expect(presenceHeld(marshal(2, { learned: false }))).toBe(0);
		expect(presenceHeld(marshal(2, { items: [] }))).toBe(0);
		expect(presenceHeld(null)).toBe(0);
	});

	it("pays for the crew only, and only while the move is learned", () => {
		expect(presenceCovers(marshal(2), "crew")).toBe(true);
		expect(presenceCovers(marshal(0), "crew")).toBe(true);
		for (const ftype of ["custom", "initiate", "beast", "animal-companion", ""]) expect(presenceCovers(marshal(2), ftype)).toBe(false);
		expect(presenceCovers(marshal(2, { learned: false }), "crew")).toBe(false);
		expect(presenceFor(marshal(2), "crew")).toBe(2);
		expect(presenceFor(marshal(2), "custom")).toBe(0);
		expect(presenceFor(marshal(0), "crew")).toBe(0);
	});
});

describe("spending Presence", () => {
	it("takes 1 off what is held, attributed to the move", async () => {
		const m = marshal(2);
		expect(await spendPresence(m)).toEqual({ from: 2, to: 1 });
		expect(m.tracks[FRONT_LINE_LEADER]).toBe(1);
		expect(m.typedActor.moveResources.setUses).toHaveBeenCalledWith(FRONT_LINE_LEADER, 1, { stonetopMove: FRONT_LINE_LEADER });
	});

	it("spends nothing with none held, or with the move switched off", async () => {
		const broke = marshal(0);
		expect(await spendPresence(broke)).toBe(null);
		const off = marshal(2, { learned: false });
		expect(await spendPresence(off)).toBe(null);
		expect(off.typedActor.moveResources.setUses).not.toHaveBeenCalled();
	});
});

describe("which purse a spend comes out of", () => {
	it("is the one asked for while it holds any, else whichever does", () => {
		expect(paysWithPresence(1, 2, "presence")).toBe(true);
		expect(paysWithPresence(1, 2, "")).toBe(false);
		expect(paysWithPresence(0, 2, "")).toBe(true);
		expect(paysWithPresence(1, 0, "presence")).toBe(false);
		expect(paysWithPresence(0, 0, "presence")).toBe(false);
	});

	it("is chosen in the window by a radio drawn only while Presence is held", () => {
		expect(purseChoiceHtml({ own: 2, ownLabel: "Loyalty", presence: 0, presenceLabel: "Presence" })).toBe("");
		const both = purseChoiceHtml({ own: 2, ownLabel: "Loyalty", presence: 1, presenceLabel: "Presence" });
		expect(both).toMatch(new RegExp(`name="${PURSE_FIELD}" value="own" checked>`));
		expect(both).toMatch(new RegExp(`name="${PURSE_FIELD}" value="presence">`));
		const presenceOnly = purseChoiceHtml({ own: 0, ownLabel: "Loyalty", presence: 1, presenceLabel: "Presence <1>" });
		expect(presenceOnly).toMatch(/value="own" disabled>/);
		expect(presenceOnly).toMatch(/value="presence" checked>/);
		expect(presenceOnly).toContain("Presence &lt;1&gt;");
	});

	it("reads the radio back", () => {
		expect(pickedPurse(formWith({ [PURSE_FIELD]: "presence" })[0])).toBe("presence");
		expect(pickedPurse(formWith({ [PURSE_FIELD]: "own" })[0])).toBe("");
		expect(pickedPurse(formWith({})[0])).toBe("");
		expect(pickedPurse(null)).toBe("");
	});
});

describe("whose Presence guards a blow's target", () => {
	const crewNpc = { type: "npc", name: "The Wolves" };

	it("is the crew's leader while they hold any, and nobody for any other follower", () => {
		const m = marshal(1);
		expect(presenceKeeperFor(crewNpc, { cardFor: () => ({ character: m, ftype: "crew", slug: "" }) })).toBe(m);
		expect(presenceKeeperFor(crewNpc, { cardFor: () => ({ character: marshal(0), ftype: "crew", slug: "" }) })).toBe(null);
		expect(presenceKeeperFor(crewNpc, { cardFor: () => ({ character: m, ftype: "custom", slug: "f1" }) })).toBe(null);
		expect(presenceKeeperFor(crewNpc, { cardFor: () => null })).toBe(null);
		expect(presenceKeeperFor(m, { cardFor: () => ({ character: m, ftype: "crew" }) })).toBe(null);
	});
});

// The crew card's Spend Loyalty and Spend Readiness, paid with Presence (StonetopCharacterSheet.js).
const { createStonetopCharacterSheetClass } = await import("../../../module/actors/character/StonetopCharacterSheet.js");
const { FakeActorBuilder } = await import("../../fakes/FakeActorBuilder.js");

function crewSheet({ presence = 2, loyalty = 1, readiness = 0, learned = true } = {}) {
	const actor = new FakeActorBuilder().withName("Rhianna")
		.withFlags({ crew: { name: "The Wolves", size: 6, loyalty, readiness } })
		.withItems([fll({ learned })]).build();
	actor.isOwner = true;
	const tracks = { [FRONT_LINE_LEADER]: presence };
	actor.typedActor = { moveResources: {
		getMoveResources: () => tracks,
		setUses: vi.fn(async (move, value) => { tracks[move] = value; }),
	} };
	const Base = class {
		constructor() { this._actor = actor; }
		get actor() { return this._actor; }
		get isEditable() { return true; }
		async getData() { return {}; }
		activateListeners() {}
		render = vi.fn();
	};
	const Sheet = createStonetopCharacterSheetClass(Base);
	return { sheet: new Sheet(), actor, tracks };
}

describe("the crew card's spends, paid with Presence", () => {
	let chat;
	beforeEach(() => {
		chat = vi.fn(async data => data);
		globalThis.ChatMessage = { create: chat, getSpeaker: vi.fn(() => ({})) };
		globalThis.ui = { notifications: { warn: vi.fn(), info: vi.fn() } };
	});

	const loyaltyReasons = [{ key: "fear", label: "Overcome their fear to do as you say" }];
	const readinessReasons = [{ key: "halve", label: "Halve an attack's effect or damage" }];

	it("Spend Loyalty takes Presence when it is picked, and leaves the crew's Loyalty alone", async () => {
		const { sheet, actor, tracks } = crewSheet({ presence: 2, loyalty: 1 });
		await sheet._applySpendLoyalty("crew.loyalty", "The Wolves", loyaltyReasons,
			formWith({ "spend-loyalty": "fear", [PURSE_FIELD]: "presence" }), { ftype: "crew", slug: "" });
		expect(tracks[FRONT_LINE_LEADER]).toBe(1);
		expect(actor.flags[SYSTEM_ID].crew.loyalty).toBe(1);
		expect(chat.mock.calls[0][0].content).toMatch(/1 Presence<\/strong> in place of the crew's Loyalty/);
	});

	it("Spend Loyalty at 0 Loyalty pays with Presence; with Loyalty picked it pays Loyalty as before", async () => {
		const broke = crewSheet({ presence: 1, loyalty: 0 });
		await broke.sheet._applySpendLoyalty("crew.loyalty", "The Wolves", loyaltyReasons, formWith({ "spend-loyalty": "fear" }), { ftype: "crew" });
		expect(broke.tracks[FRONT_LINE_LEADER]).toBe(0);

		const both = crewSheet({ presence: 2, loyalty: 2 });
		await both.sheet._applySpendLoyalty("crew.loyalty", "The Wolves", loyaltyReasons,
			formWith({ "spend-loyalty": "fear", [PURSE_FIELD]: "own" }), { ftype: "crew" });
		expect(both.tracks[FRONT_LINE_LEADER]).toBe(2);
		expect(both.actor.flags[SYSTEM_ID].crew.loyalty).toBe(1);
	});

	it("never pays another follower's Loyalty with Presence", async () => {
		const { sheet, tracks } = crewSheet({ presence: 2 });
		await sheet.actor.update({ "flags.stonetop-pwd.customFollowers.f1": { name: "Andras", loyalty: 0 } });
		await sheet._applySpendLoyalty("customFollowers.f1.loyalty", "Andras", loyaltyReasons,
			formWith({ "spend-loyalty": "fear", [PURSE_FIELD]: "presence" }), { ftype: "custom", slug: "f1" });
		expect(tracks[FRONT_LINE_LEADER]).toBe(2);
	});

	it("Spend Readiness spends Presence as if the Marshal Defended them, at 0 Readiness too", async () => {
		const { sheet, actor, tracks } = crewSheet({ presence: 2, readiness: 0 });
		await sheet._applySpendReadiness({ rPath: "crew.readiness", lPath: "crew.loyalty", name: "The Wolves",
			reasons: readinessReasons, html: formWith({ "spend-readiness": "halve", [PURSE_FIELD]: "presence" }), ftype: "crew" });
		expect(tracks[FRONT_LINE_LEADER]).toBe(1);
		expect(actor.flags[SYSTEM_ID].crew.readiness).toBe(0);
		expect(actor.flags[SYSTEM_ID].crew.loyalty).toBe(1);
		expect(chat.mock.calls[0][0].content).toMatch(/as if you had Defended <strong>The Wolves<\/strong>, to <em>halve an attack(&#x27;|')s effect or damage on them/);
	});

	it("Spend Readiness with their own Readiness picked spends that, not Presence", async () => {
		const { sheet, actor, tracks } = crewSheet({ presence: 2, readiness: 2 });
		await sheet._applySpendReadiness({ rPath: "crew.readiness", lPath: "crew.loyalty", name: "The Wolves",
			reasons: readinessReasons, html: formWith({ "spend-readiness": "halve", [PURSE_FIELD]: "own" }), ftype: "crew" });
		expect(tracks[FRONT_LINE_LEADER]).toBe(2);
		expect(actor.flags[SYSTEM_ID].crew.readiness).toBe(1);
	});
});
