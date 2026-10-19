// The Lightbearer's Radiant Countenance on a follower (Book I p.123): "If they are a follower, you can
// instead choose to Strengthen Your Bond (as if you paid their cost)." A button beside Pay cost on the
// Followers-tab card while the move is learned, through follower-bond.js#strengthenBond with `radiant`.

import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SYSTEM_ID } from "../../../module/system-id.js";
import { buildLiveCharacter, makeLiveItem, sourceMovesFor } from "../../fakes/LiveCharacter.js";
import { loadPlaybookDefs } from "../../fakes/sourcePack.js";
import { createStonetopCharacterSheetClass } from "../../../module/actors/character/StonetopCharacterSheet.js";
import { RADIANT_COUNTENANCE, strengthenBond } from "../../../module/actors/character/follower-bond.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const read = rel => readFileSync(resolve(HERE, "../../..", rel), "utf8");
const LIGHTBEARER = loadPlaybookDefs().byName.get("The Lightbearer");
const SOURCE = sourceMovesFor("The Lightbearer").find(d => d.name === RADIANT_COUNTENANCE);
const S = SYSTEM_ID;

afterEach(() => { delete globalThis.ChatMessage; });

function pc(flags = {}) {
	return { id: "sol", uuid: "Actor.sol", name: "Sol", type: "character", isOwner: true, flags: { [S]: flags }, update: vi.fn(async () => {}) };
}

function lightbearer({ held = true, learned = true } = {}) {
	const items = held
		? [makeLiveItem({ name: RADIANT_COUNTENANCE, type: "move", system: structuredClone(SOURCE.system),
			flags: learned ? undefined : { [S]: { learned: false } } })]
		: [];
	const { char, actor } = buildLiveCharacter({ slug: "the-lightbearer", name: "The Lightbearer", items,
		flags: { "customFollowers.abc": { name: "Maeve", hpMax: 6, loyalty: 1, cost: "recognition" } } });
	actor.typedActor = char;
	return { char, actor };
}

function sheetFor(actor) {
	const Base = class {
		get actor() { return actor; }
		get isEditable() { return true; }
		async getData() { return {}; }
		activateListeners() {}
		render = vi.fn();
	};
	return new (createStonetopCharacterSheetClass(Base))();
}
const maeveCard = actor => sheetFor(actor)._buildFollowersData(LIGHTBEARER).custom.find(c => c.slug === "abc");

describe("Radiant Countenance on a follower", () => {
	it("ships the move under the name the button reads it by", () => {
		expect(SOURCE?.system?.description).toContain("Strengthen Your Bond");
	});

	it("shows its button beside Pay cost only while the move is learned", () => {
		expect(maeveCard(lightbearer().actor).radiantCountenance).toBe(true);
		expect(maeveCard(lightbearer({ learned: false }).actor).radiantCountenance).toBe(false);
		expect(maeveCard(lightbearer({ held: false }).actor).radiantCountenance).toBe(false);
		const hbs = read("templates/actor/partials/tab-followers.hbs");
		expect(hbs).toMatch(/class="stonetop-pay-cost[\s\S]*\{\{#if radiantCountenance\}\}\s*<button type="button" class="stonetop-radiant-bond[\s\S]*\{\{#if loyaltyAtMax\}\}disabled/);
	});

	it("keeps the books as Pay cost does, and says it was the fond attention, naming no cost", async () => {
		globalThis.ChatMessage = { create: vi.fn(), getSpeaker: () => ({ alias: "Sol" }) };
		const sol = pc({ customFollowers: { abc: { loyalty: 1 } } });
		expect(await strengthenBond(sol, { ftype: "custom", slug: "abc", name: "Maeve", cost: "recognition", radiant: true })).toEqual({ from: 1, to: 2 });
		// "As if you paid their cost": the same Loyalty, paid-recently stamp and ledger move.
		expect(sol.update).toHaveBeenCalledWith(expect.objectContaining({
			[`flags.${S}.customFollowers.abc.loyalty`]: 2, [`flags.${S}.followerCostPaid.custom:abc`]: expect.any(Number),
		}), { stonetopMove: "Strengthen Your Bond" });
		const content = ChatMessage.create.mock.calls[0][0].content;
		expect(content).toContain("<strong>Sol</strong> gives <strong>Maeve</strong> their fond attention (Radiant Countenance): you Strengthen Your Bond as if you paid their cost; they hold +1 Loyalty, 2 in all.");
		expect(content).not.toContain("You pay");
		expect(content).not.toContain("recognition");
	});

	it("leaves the Pay cost card as it was", async () => {
		globalThis.ChatMessage = { create: vi.fn(), getSpeaker: () => ({ alias: "Sol" }) };
		await strengthenBond(pc({ customFollowers: { abc: { loyalty: 1 } } }), { ftype: "custom", slug: "abc", name: "Maeve", cost: "recognition" });
		const content = ChatMessage.create.mock.calls[0][0].content;
		expect(content).toContain("You pay <strong>Maeve</strong>'s cost");
		expect(content).toContain("recognition");
		expect(content).not.toContain("Radiant Countenance");
	});

	it("does not trigger at 3 Loyalty", async () => {
		const full = pc({ customFollowers: { abc: { loyalty: 3 } } });
		expect(await strengthenBond(full, { ftype: "custom", slug: "abc", radiant: true })).toBeNull();
		expect(full.update).not.toHaveBeenCalled();
	});

	it("is wired to the sheet's handler, which strengthens with `radiant`", async () => {
		globalThis.ChatMessage = { create: vi.fn(), getSpeaker: () => ({}) };
		const { actor } = lightbearer();
		actor.isOwner = true;
		const sheet = sheetFor(actor);
		await sheet._onRadiantBond({ ftype: "custom", slug: "abc", followerName: "Maeve" });
		expect(ChatMessage.create.mock.calls[0][0].content).toContain("their fond attention (Radiant Countenance)");
		expect(sheet.render).toHaveBeenCalledWith(false);
	});
});
