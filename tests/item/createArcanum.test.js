import { describe, it, expect } from "vitest";
import {
	newArcanumSlug, buildArcanumItemData,
} from "../../module/item/createArcanum.js";
import { slugify } from "../../module/utils/strings.js";

describe("createArcanum helpers", () => {
	describe("slugify", () => {
		it("kebab-cases a display name", () => {
			expect(slugify("Azure Hand")).toBe("azure-hand");
		});
		it("trims punctuation and collapses runs", () => {
			expect(slugify("  A Folktale!! ")).toBe("a-folktale");
		});
		it("strips accents via NFKD", () => {
			expect(slugify("Café Crème")).toBe("cafe-creme");
		});
		it("returns '' for empty/nullish input", () => {
			expect(slugify("")).toBe("");
			expect(slugify(null)).toBe("");
			expect(slugify(undefined)).toBe("");
		});
	});

	// The slug is the identity key for every holder's saved marks, so it must be opaque and
	// permanent: NOT derived from the name (renaming would orphan the marks) and never
	// repeated (a shared slug means shared marks, and a shipped pack slug would shadow the
	// card entirely). The editor doesn't show it, so these are the only guarantees it has.
	describe("newArcanumSlug", () => {
		it("is prefixed so it reads as an arcanum slug in the console", () => {
			expect(newArcanumSlug()).toMatch(/^arc-[A-Za-z0-9]{16}$/);
		});
		it("never repeats", () => {
			const slugs = new Set(Array.from({ length: 500 }, () => newArcanumSlug()));
			expect(slugs.size).toBe(500);
		});
		it("carries nothing from any name, so renaming a card can't orphan its marks", () => {
			expect(newArcanumSlug()).not.toContain("azure");
		});
	});

	describe("buildArcanumItemData", () => {
		it("produces a move item flagged as an arcanum with the dedicated sheet", () => {
			const data = buildArcanumItemData({ slug: "my-homebrew", name: "My Homebrew" });
			expect(data.type).toBe("move");
			expect(data.system.moveType).toBe("arcanum");
			expect(data.flags.core.sheetClass).toBe("stonetop.StonetopArcanumSheet");
		});
		it("stores card data under flags.stonetop with the slug and tier", () => {
			const data = buildArcanumItemData({ slug: "my-homebrew", name: "My Homebrew", major: true });
			expect(data.flags.stonetop.slug).toBe("my-homebrew");
			expect(data.flags.stonetop.major).toBe(true);
			expect(data.flags.stonetop.front.title).toBe("My Homebrew");
		});
		it("defaults to a minor arcanum", () => {
			expect(buildArcanumItemData({ slug: "x" }).flags.stonetop.major).toBe(false);
		});
		it("scaffolds empty front/back shapes the model expects", () => {
			const { front, back } = buildArcanumItemData({ slug: "x" }).flags.stonetop;
			expect(front.unlock).toEqual({ description: "", requirements: [] });
			expect(back.options).toEqual([]);
			expect(back.resource).toBeNull();
			expect(back.move).toBeNull();
		});
		it("only sets img when provided", () => {
			expect(buildArcanumItemData({ slug: "x" }).img).toBeUndefined();
			expect(buildArcanumItemData({ slug: "x", img: "a.webp" }).img).toBe("a.webp");
		});
		it("defaults everyone to OBSERVER so the card is visible to all players", () => {
			expect(buildArcanumItemData({ slug: "x" }).ownership).toEqual({ default: 2 });
		});
		it("grants the author OWNER when an ownerId is given, so the editor opens editable", () => {
			const data = buildArcanumItemData({ slug: "x", ownerId: "user123" });
			expect(data.ownership).toEqual({ default: 2, user123: 3 });
		});
		it("merges a front pre-fill over the defaults (wizard seed), keeping the scaffold", () => {
			const seed = "<p><em>Inspiration</em></p>";
			const { front } = buildArcanumItemData({ slug: "x", name: "Seeded", front: { description: seed } }).flags.stonetop;
			expect(front.description).toBe(seed);
			// Untouched defaults survive the merge.
			expect(front.title).toBe("Seeded");
			expect(front.unlock).toEqual({ description: "", requirements: [] });
		});
		it("merges a back pre-fill over the defaults", () => {
			const { back } = buildArcanumItemData({ slug: "x", back: { description: "<p>boon</p>" } }).flags.stonetop;
			expect(back.description).toBe("<p>boon</p>");
			expect(back.options).toEqual([]);
			expect(back.move).toBeNull();
		});
	});
});
