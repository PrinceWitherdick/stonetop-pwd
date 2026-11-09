import { describe, it, expect } from "vitest";
import {
	defaultArcanumItemLine, defaultResourceDef, defaultBackMove, defaultFollower,
	newUnlockRequirement, nextOptionSlug, ensureOptionSlug, validateArcanumFlags,
	markTrackHtml, mysteryHtml, consequenceHtml,
} from "../../module/item/arcanum-edit.js";

const count = (str, glyph) => (str.match(new RegExp(glyph, "g")) || []).length;

describe("arcanum-edit helpers", () => {
	describe("defaults", () => {
		it("item line is blank", () => {
			expect(defaultArcanumItemLine()).toEqual({ name: "", weight: null, note: "", inventoryColumn: null });
		});
		it("resource def has a sane default max + empty labels", () => {
			expect(defaultResourceDef()).toEqual({ max: 3, maxStat: null, title: "", labels: [] });
		});
		it("back move is blank", () => {
			expect(defaultBackMove()).toEqual({ name: "", rollType: null, description: "" });
		});
		it("follower has sane defaults (it/follower/6hp, not repeatable)", () => {
			const f = defaultFollower();
			expect(f).toMatchObject({ name: "", pronoun: "it", typeLabel: "follower", hp: 6, armor: 0, loyalty: 0, repeatable: false });
		});
	});

	describe("newUnlockRequirement", () => {
		it("option row carries slug/description/max", () => {
			expect(newUnlockRequirement("option", "option-1")).toEqual({ type: "option", slug: "option-1", description: "", max: 1 });
		});
		it("text row carries content only", () => {
			expect(newUnlockRequirement("text")).toEqual({ type: "text", content: "" });
		});
	});

	describe("nextOptionSlug", () => {
		it("starts at option-1", () => {
			expect(nextOptionSlug([])).toBe("option-1");
		});
		it("skips taken slugs", () => {
			expect(nextOptionSlug(["option-1", "option-2"])).toBe("option-3");
			expect(nextOptionSlug(new Set(["option-1"]))).toBe("option-2");
		});
	});

	describe("ensureOptionSlug", () => {
		it("keeps an explicit slug (slugified)", () => {
			expect(ensureOptionSlug("My Slug", "ignored", [])).toBe("my-slug");
		});
		it("derives from the description when slug is blank", () => {
			expect(ensureOptionSlug("", "Decipher the glyphs", [])).toBe("decipher-the-glyphs");
		});
		it("falls back to a unique option-N when both are blank", () => {
			expect(ensureOptionSlug("", "", ["option-1"])).toBe("option-2");
		});
	});

	describe("validateArcanumFlags", () => {
		const complete = {
			slug: "x",
			// An unlock step (ruling A14): a card with none stays locked, which the editor warns of.
			front: { title: "T", description: "<p>front</p>", unlock: { description: "", requirements: [{ type: "option", slug: "o", description: "Do it", max: 1 }] } },
			back:  { title: "B", description: "<p>payoff</p>", item: null, resource: null, move: null, options: [] },
		};

		it("a complete card has no issues", () => {
			expect(validateArcanumFlags(complete)).toEqual([]);
		});
		it("flags a missing slug and front title as errors", () => {
			const issues = validateArcanumFlags({ front: { title: "" }, back: {} });
			const errors = issues.filter(i => i.level === "error").map(i => i.message);
			expect(errors).toEqual(expect.arrayContaining([
				expect.stringContaining("Slug is required"),
				expect.stringContaining("Front title is required"),
			]));
		});
		it("warns when the front body is empty", () => {
			const f = { slug: "x", front: { title: "T", description: "", unlock: { description: "", requirements: [] } }, back: { title: "B", description: "<p>p</p>" } };
			expect(validateArcanumFlags(f).some(i => i.level === "warn" && /front has no/i.test(i.message))).toBe(true);
		});
		it("warns when the back has no payoff", () => {
			const f = { slug: "x", front: { title: "T", description: "<p>f</p>", unlock: { description: "", requirements: [] } }, back: { title: "B", description: "", item: null, resource: null, move: null } };
			expect(validateArcanumFlags(f).some(i => /no payoff/i.test(i.message))).toBe(true);
		});
		it("accepts a back whose only payoff is a move", () => {
			const f = { slug: "x", front: { title: "T", description: "<p>f</p>", unlock: { description: "", requirements: [] } }, back: { title: "B", description: "", move: { name: "m" } } };
			expect(validateArcanumFlags(f).some(i => /no payoff/i.test(i.message))).toBe(false);
		});
	});

	describe("major-mode snippets", () => {
		it("markTrackHtml emits exactly N circles + the unlock lead", () => {
			expect(count(markTrackHtml(3), "○")).toBe(3);
			expect(count(markTrackHtml(5), "○")).toBe(5);
			expect(markTrackHtml(4)).toMatch(/make the last mark/i);
		});
		it("markTrackHtml clamps to 1–9 and defaults to 4", () => {
			expect(count(markTrackHtml(0), "○")).toBe(4);   // 0 is falsy → default
			expect(count(markTrackHtml(0.4), "○")).toBe(1); // rounds to 0 → clamped to 1
			expect(count(markTrackHtml(99), "○")).toBe(9);
			expect(count(markTrackHtml(), "○")).toBe(4);
		});
		it("mysteryHtml leads with a single □ box + the name", () => {
			expect(count(mysteryHtml("Eye of the Storm"), "□")).toBe(1);
			expect(mysteryHtml("Eye of the Storm")).toContain("Eye of the Storm");
			expect(mysteryHtml("")).toContain("NEW MYSTERY");
		});
		it("consequenceHtml weights with 1–3 boxes", () => {
			expect(count(consequenceHtml(1), "□")).toBe(1);
			expect(count(consequenceHtml(3), "□")).toBe(3);
			expect(count(consequenceHtml(9), "□")).toBe(3);
		});
	});
});
