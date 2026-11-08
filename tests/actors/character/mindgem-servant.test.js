import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
	installSummonConsequenceHooks, markedSummonConsequences, settleSummons, summonDamage, summonTags, summonUpdate,
} from "../../../module/actors/character/mindgem-servant.js";
import { arcanaSummon } from "../../../module/data/arcana-summons.js";
import { SYSTEM_ID } from "../../../module/system-id.js";

// Audit EDG-15 (2026-11-06): the Mindgem's Consequences rewrite the Mighty Servant (Book II pp.548-549).

const back = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../../packs/src/stonetop-arcana/major/mindgem.json"), "utf8")).flags.stonetop.back.description;
const printed = arcanaSummon("mindgem").followers[0];
const WEAPON   = "It realizes its potential as a weapon";
const RECKLESS = "It becomes aggressive and reckless in battle";
const marks = (...labels) => new Set(labels);

describe("the Servant's damage and tags", () => {
	it("starts as the summon prints it", () => {
		expect(summonDamage(printed)).toBe("stone fists d10+1 (hand, close, disadvantage)");
		expect(summonDamage(printed, marks())).toBe(printed.damage);
	});

	it("becomes 1d10+5 (hand, close, messy, forceful, 3 piercing) as a weapon, and gains area and dangerous when reckless", () => {
		expect(summonDamage(printed, marks(WEAPON))).toBe("stone fists 1d10+5 (hand, close, messy, forceful, 3 piercing)");
		expect(summonDamage(printed, marks(RECKLESS))).toBe("stone fists d10+1 (hand, close, disadvantage, area, dangerous)");
		expect(summonDamage(printed, marks(WEAPON, RECKLESS))).toBe("stone fists 1d10+5 (hand, close, messy, forceful, 3 piercing, area, dangerous)");
	});

	it("swaps slow for warrior, and back", () => {
		expect(summonTags(printed, printed.tags, marks(WEAPON))).toContain("warrior");
		expect(summonTags(printed, printed.tags, marks(WEAPON))).not.toContain("slow");
		expect(summonTags(printed, summonTags(printed, printed.tags, marks(WEAPON)), marks())).toEqual(printed.tags);
		expect(summonTags(printed, printed.tags, marks(RECKLESS))).toEqual(printed.tags);
	});

	it("reads the two Consequences off the shipped back", () => {
		expect(markedSummonConsequences(printed, "mindgem", back, {})).toEqual(marks());
		expect(markedSummonConsequences(printed, "mindgem", back, { "mindgem:back:4": true })).toEqual(marks(WEAPON));
		expect(markedSummonConsequences(printed, "mindgem", back, { "mindgem:back:5": true })).toEqual(marks(RECKLESS));
	});
});

describe("the card's update", () => {
	const cards = (damage = printed.damage) => ({ s1: { sourceUuid: printed.sourceUuid, damage, tags: [...printed.tags] }, other: { sourceUuid: "x", damage: "d6" } });

	it("rewrites the Servant's card only", () => {
		const update = summonUpdate(cards(), printed, marks(WEAPON));
		expect(update).toEqual({
			[`flags.${SYSTEM_ID}.customFollowers.s1.damage`]: summonDamage(printed, marks(WEAPON)),
			[`flags.${SYSTEM_ID}.customFollowers.s1.tags`]: summonTags(printed, printed.tags, marks(WEAPON)),
		});
		expect(summonUpdate(cards(), printed, marks())).toBeNull();
		// Unmarked again, it goes back to the printed line.
		expect(summonUpdate(cards(summonDamage(printed, marks(WEAPON, RECKLESS))), printed, marks())).toEqual({
			[`flags.${SYSTEM_ID}.customFollowers.s1.damage`]: printed.damage,
		});
	});

	it("leaves a damage line typed by hand alone", () => {
		const update = summonUpdate(cards("granite hammer 2d8 (reach)"), printed, marks(RECKLESS));
		expect(update).toBeNull();
	});

	it("settles a holder's Servant when their Mindgem boxes change, on the client that changed them", async () => {
		const actor = {
			type: "character",
			flags: { [SYSTEM_ID]: { customFollowers: cards() } },
			typedActor: { _arcana: { boxStates: { "mindgem:back:5": true } } },
			update: vi.fn(async () => {}),
		};
		const card = vi.fn(async () => ({ back: { description: back, title: "Mysteries of the Mindgem" } }));
		expect(await settleSummons(actor, "mindgem", { card })).toBe(true);
		expect(card).toHaveBeenCalledWith(actor, "mindgem");
		expect(actor.update).toHaveBeenCalledWith({
			[`flags.${SYSTEM_ID}.customFollowers.s1.damage`]: summonDamage(printed, marks(RECKLESS)),
		}, { stonetopMove: "Mysteries of the Mindgem" });
		// A card with no changing summon, or a holder with no such follower, is left alone without reading the card.
		expect(await settleSummons(actor, "storm-markings", { card })).toBe(false);
		expect(await settleSummons({ ...actor, flags: { [SYSTEM_ID]: { customFollowers: {} } } }, "mindgem", { card })).toBe(false);
		expect(card).toHaveBeenCalledTimes(1);

		let handler = null;
		const hooks = { on: vi.fn((_n, fn) => { handler = fn; return 3; }), off: vi.fn() };
		const stop = installSummonConsequenceHooks({ hooks });
		globalThis.game = { ...(globalThis.game ?? {}), user: { id: "me" } };
		const other = { ...actor, update: vi.fn() };
		handler(other, { flags: { [SYSTEM_ID]: { arcana: { boxes: { "mindgem:back:5": true } } } } }, {}, "someone-else");
		handler(other, { flags: { [SYSTEM_ID]: { arcana: { boxes: { "storm-markings:back:0": true } } } } }, {}, "me");
		await Promise.resolve();
		expect(other.update).not.toHaveBeenCalled();
		stop();
		expect(hooks.off).toHaveBeenCalledWith("updateActor", 3);
	});
});
