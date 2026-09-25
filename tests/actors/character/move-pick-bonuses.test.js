// What a ROLLER brings to another move's printed list (module/actors/character/move-pick-bonuses.js).
//
// From the 2026-09-25 Fox audit: Perceptive ("When you Seek Insight, you may ask 1 additional
// question. Even on a 6-, you can ask 1 question") was never counted. The Seek Insight card's caps
// are stamped from the move's prose alone (3 on a 10+, 1 on a 7-9, no list on a 6-), so a
// Perceptive Fox's 4th question let go of her 1st, and her miss showed nothing to ask.

import { readFileSync } from "node:fs";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { applyPickBonuses, movePickBonusesFor, withMovePickBonuses, MOVE_PICK_BONUSES } from "../../../module/actors/character/move-pick-bonuses.js";
import { pickableMoveDescription } from "../../../module/utils/chat.js";
import { moveCardBody } from "../../../module/utils/move-tiers.js";
import { stripHtmlToText } from "../../../module/utils/strings.js";

const ROOT = "Z:/Foundry/FoundryVTT/Data/systems/stonetop-pwd/packs/src/stonetop-items";
const doc = rel => JSON.parse(readFileSync(`${ROOT}/${rel}`, "utf8"));
const SEEK   = doc("basic-moves/seek-insight.json");
const FORAGE = doc("expedition-moves/forage.json");

const openTag = html => /<ul class="stonetop-picklist"[^>]*>/.exec(html)?.[0] ?? "";
const attr = (tag, name) => new RegExp(`${name}="([^"]*)"`).exec(tag)?.[1] ?? null;
const rows = html => (/<ul class="stonetop-picklist"[^>]*>([\s\S]*?)<\/ul>/.exec(html)?.[1].match(/<li\b/g) ?? []).length;

const SCOPE = "stonetop-pwd";
const move = (name, { learned = true } = {}) => ({ type: "move", name, system: {}, flags: learned ? {} : { [SCOPE]: { learned: false } } });
const character = ({ items = [], playbook = "The Fox", background = null } = {}) => ({
	type: "character", system: { playbook: { name: playbook } }, items,
	flags: { [SCOPE]: background ? { background: { selected: background } } : {} },
});
const PERCEPTIVE = MOVE_PICK_BONUSES.find(b => b.ownsLearned === "Perceptive");

describe("applyPickBonuses", () => {
	const seek = pickableMoveDescription(SEEK.system.description);

	it("starts from the book's Seek Insight stamp: 3 on a 10+, 1 on a 7-9, no list on a miss", () => {
		const tag = openTag(seek);
		expect(attr(tag, "data-pick-max-success")).toBe("3");
		expect(attr(tag, "data-pick-max-partial")).toBe("1");
		expect(attr(tag, "data-pick-tiers")).toBe("success partial");
	});

	it("counts Perceptive: 4 on a 10+, 2 on a 7-9, and 1 even on a 6-", () => {
		const tag = openTag(applyPickBonuses(seek, [PERCEPTIVE]));
		expect(attr(tag, "data-pick-max-success")).toBe("4");
		expect(attr(tag, "data-pick-max-partial")).toBe("2");
		expect(attr(tag, "data-pick-max-failure")).toBe("1");
		expect(attr(tag, "data-pick-tiers")).toBe("success partial failure");
	});

	it("spreads a flat cap over the tiers, so the miss floor does not lift the hit", () => {
		const flat = '<ul class="stonetop-picklist" data-pick-max="2" data-pick-tiers="success partial"><li>a</li><li>b</li><li>c</li></ul>';
		const tag = openTag(applyPickBonuses(flat, [{ plus: 1, missFloor: 1 }]));
		expect(attr(tag, "data-pick-max")).toBeNull();
		expect(attr(tag, "data-pick-max-success")).toBe("3");
		expect(attr(tag, "data-pick-max-partial")).toBe("3");
		expect(attr(tag, "data-pick-max-failure")).toBe("1");
	});

	it("adds options at the END, numbered on from the printed ones", () => {
		const out = applyPickBonuses(seek, [{ addOptions: ["What opportunity does no one else see?"] }]);
		expect(rows(out)).toBe(7);
		expect(out).toContain('data-index="6"><span>What opportunity does no one else see?</span>');
		// The count is the move's own: an added question is one more to choose FROM, not one more to ask.
		expect(attr(openTag(out), "data-pick-max-success")).toBe("3");
	});

	it("leaves a card with no tickable list alone", () => {
		expect(applyPickBonuses("<p>No list.</p>", [PERCEPTIVE])).toBe("<p>No list.</p>");
	});

	it("survives the ladder moving the list below it on the real card body", () => {
		const body = moveCardBody(SEEK.system.description, SEEK.system.moveResults);
		expect(attr(openTag(applyPickBonuses(body, [PERCEPTIVE])), "data-pick-max-failure")).toBe("1");
	});
});

describe("movePickBonusesFor", () => {
	it("counts a LEARNED Perceptive only", () => {
		expect(movePickBonusesFor(character({ items: [move("Perceptive")] }), "Seek Insight")).toEqual([PERCEPTIVE]);
		expect(movePickBonusesFor(character({ items: [move("Perceptive", { learned: false })] }), "Seek Insight")).toEqual([]);
		expect(movePickBonusesFor(character({ items: [move("Perceptive")] }), "Know Things")).toEqual([]);
	});

	it("gives The Natural's question to a Fox who took that background, and to no one else", () => {
		const natural = movePickBonusesFor(character({ background: "the-natural" }), "Seek Insight");
		expect(natural.flatMap(b => b.addOptions)).toEqual(["What opportunity does no one else see?"]);
		expect(movePickBonusesFor(character({ background: "a-life-of-crime" }), "Seek Insight")).toEqual([]);
		expect(movePickBonusesFor(character({ playbook: "The Heavy", background: "the-natural" }), "Seek Insight")).toEqual([]);
	});

	it("reads Survivalist on Forage: one more pick, 1 even on a 6-, and its added option", () => {
		const [b] = movePickBonusesFor(character({ playbook: "The Ranger", items: [move("Survivalist")] }), "Forage");
		const tag = openTag(applyPickBonuses(pickableMoveDescription(FORAGE.system.description), [b]));
		expect(attr(tag, "data-pick-max-success")).toBe("3");
		expect(attr(tag, "data-pick-max-partial")).toBe("2");
		expect(attr(tag, "data-pick-max-failure")).toBe("1");
	});
});

describe("withMovePickBonuses", () => {
	beforeEach(() => {
		globalThis.game ??= {};
		globalThis.game.i18n ??= { format: vi.fn((k, d) => `${k}:${JSON.stringify(d)}`), localize: k => k };
	});

	it("names what changed the count under the list", () => {
		const out = withMovePickBonuses(pickableMoveDescription(SEEK.system.description),
			character({ items: [move("Perceptive")] }), "Seek Insight");
		expect(out).toContain("stonetop-pick-bonus-note");
		expect(stripHtmlToText(out)).toContain("Perceptive");
	});

	it("changes nothing for a roller who brings nothing", () => {
		const html = pickableMoveDescription(SEEK.system.description);
		expect(withMovePickBonuses(html, character(), "Seek Insight")).toBe(html);
	});
});

// The added options are the granting text's own words, retyped in the table. Pinned here so a
// reworded source fails a test instead of quietly offering a stale option.
describe("MOVE_PICK_BONUSES quotes its sources", () => {
	const SOURCES = {
		"Survivalist":  () => doc("playbook-moves/the-ranger/survivalist.json").system.description,
		"Perceptive":   () => doc("playbook-moves/the-fox/perceptive.json").system.description,
		"the-natural":  () => doc("playbooks/the-fox.json").flags.stonetop.backgrounds.find(b => b.slug === "the-natural").description,
	};
	for (const b of MOVE_PICK_BONUSES) {
		const key = b.ownsLearned ?? b.background.slug;
		it(`${key} on ${b.move}`, () => {
			const text = stripHtmlToText(SOURCES[key]()).replace(/[“”]/g, '"');
			expect(text).toContain(b.move);
			for (const option of b.addOptions ?? []) expect(text).toContain(`"${option}"`);
		});
	}
});
