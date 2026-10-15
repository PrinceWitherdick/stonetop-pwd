import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect, afterEach, vi } from "vitest";
import {
	SETTLEMENT_DEFAULT_IMG, isSettlementPlaceholderImg, isSystemSettlementImg, letterDiscSvg,
	resolveSettlementPortraits, settlementInitials, settlementLetterOut, settlementPortraitOut,
	settlementPortraitPlan, settlementPortraitUpdate,
} from "../../../module/actors/settlement/settlement-portrait.js";
import { SETTLEMENT_PORTRAITS } from "../../../module/data/settlement-portraits.js";
import { LETTER_CAP_INK, LETTER_FOOT, LETTER_GLYPHS } from "../../../module/data/settlement-letter-glyphs.js";
import { BOOK_SETTLEMENT_STATS, SETTLEMENT_TEMPLATES } from "../../../module/data/settlement-stats.js";

// A settlement's portrait: a square cut from its own Book II picture (the user's picks), else its
// initials on the house disc, one letter per word. Only images this system set are ever replaced.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../../..");
const ART = "stonetop-book-art";
const OLD_PLACEHOLDER = "systems/stonetop-pwd/assets/icons/landmarks/place-region.svg";
const OLD_MAP = "stonetop-book-art/assets/maps/map-marshedge.webp";
const MB = `${ART}/assets/settlements/letters/MB-v1.svg`;

describe("settlementInitials", () => {
	// The user's own examples, 2026-10-14.
	it("takes one capital per word, a hyphenated word counting once", () => {
		expect(settlementInitials("Marshedge")).toBe("M");
		expect(settlementInitials("Mammoth-herder band")).toBe("MB");
		expect(settlementInitials("North Manmarch hillfort")).toBe("NMH");
	});

	it("skips what is not a letter, stops at three, and gives nothing for no letters", () => {
		expect(settlementInitials("Gordin's Delve")).toBe("GD");
		expect(settlementInitials("  the  old   mill ")).toBe("TOM");
		expect(settlementInitials("Village of the Damned")).toBe("VOT");
		expect(settlementInitials("1066")).toBe("");
		expect(settlementInitials("")).toBe("");
	});

	it("names the disc by its initials, versioned", () => {
		expect(settlementLetterOut("MB")).toBe("assets/settlements/letters/MB-v1.svg");
		expect(settlementLetterOut("")).toBeNull();
	});
});

describe("the letter outlines", () => {
	// Every coordinate in a glyph's path is ABSOLUTE, so the largest must reach the glyph's measured
	// extent (its right edge or its top, whichever is further). A formatter that mangles numbers (one
	// briefly turned 100 into 1, drawing every letter as specks) falls short at once.
	it("draw each capital out to its own measured extent", () => {
		for (const [ch, g] of Object.entries(LETTER_GLYPHS)) {
			const nums = g.d.match(/-?\d+(?:\.\d+)?/g).map(Number);
			expect(Math.max(...nums), ch).toBeGreaterThanOrEqual(Math.max(g.xMax, g.yMax) - 1);
			expect(Math.max(...nums), ch).toBeLessThanOrEqual(Math.max(g.xMax, g.yMax, g.advance) + 1);
		}
		expect(Object.keys(LETTER_GLYPHS).join("")).toBe("ABCDEFGHIJKLMNOPQRSTUVWXYZ");
		expect(LETTER_CAP_INK).toBeGreaterThan(0);
		expect(LETTER_FOOT).toBeLessThanOrEqual(0);
	});
});

describe("letterDiscSvg", () => {
	const transformOf = svg => svg.match(/<g fill="#f0ece3" transform="translate\(([-\d.]+) ([-\d.]+)\) scale\(([-\d.]+) /).slice(1).map(Number);

	it("is the house disc, a cream rim round a black field, with one path per letter", () => {
		const svg = letterDiscSvg("NMH");
		expect(svg).toMatch(/<circle cx="800" cy="800" r="723.45" fill="#f0ece3"\/><circle cx="800" cy="800" r="712.6" fill="#000"\/>/);
		expect(svg.match(/<path /g)).toHaveLength(3);
		expect(svg).toContain('aria-label="NMH"');
	});

	// Centred on the row's ink: its left-to-right, and its tallest top to its lowest foot.
	it("centres the row's ink on the disc", () => {
		for (const initials of ["M", "MB", "NMH", "AT"]) {
			const [tx, ty, s] = transformOf(letterDiscSvg(initials));
			let pen = 0;
			const placed = [...initials].map(c => { const g = LETTER_GLYPHS[c]; const at = pen; pen += g.advance; return { g, at }; });
			const left = placed[0].at + placed[0].g.xMin, right = placed.at(-1).at + placed.at(-1).g.xMax;
			const top = Math.max(...placed.map(p => p.g.yMax)), bottom = Math.min(...placed.map(p => Math.max(p.g.yMin, LETTER_FOOT)));
			expect(tx + ((left + right) / 2) * s, initials).toBeCloseTo(800, 0);
			expect(ty - ((top + bottom) / 2) * s, initials).toBeCloseTo(800, 0);
		}
	});

	it("shrinks a long row so it still fits inside the field", () => {
		const [, , one] = transformOf(letterDiscSvg("M"));
		const [, , three] = transformOf(letterDiscSvg("MWM"));
		expect(three).toBeLessThan(one);
	});
});

describe("isSettlementPlaceholderImg / isSystemSettlementImg", () => {
	it("count the discs, the village icon and the old empty marker as placeholders", () => {
		expect(isSettlementPlaceholderImg(MB)).toBe(true);
		expect(isSettlementPlaceholderImg(`https://assets.example/u/${MB}`)).toBe(true);
		expect(isSettlementPlaceholderImg(SETTLEMENT_DEFAULT_IMG)).toBe(true);
		expect(isSettlementPlaceholderImg(OLD_PLACEHOLDER)).toBe(true);
		expect(isSettlementPlaceholderImg("")).toBe(true);
	});

	it("count a book square and an earlier build's map as ours to replace, but not as placeholders", () => {
		const square = `${ART}/assets/settlements/lygos-q542-000-876-1000.webp`;
		expect(isSettlementPlaceholderImg(square)).toBe(false);
		expect(isSystemSettlementImg(square)).toBe(true);
		expect(isSystemSettlementImg(OLD_MAP, { legacyMaps: true })).toBe(true);
	});

	it("leave a poster map alone after a world's first pass, since the GM may have picked it", () => {
		expect(isSystemSettlementImg(OLD_MAP)).toBe(false);
	});

	it("leave a picture the GM chose alone", () => {
		expect(isSystemSettlementImg("worlds/x/marshedge-by-night.webp")).toBe(false);
	});
});

describe("the user's picks", () => {
	const keys = new Set([...Object.keys(BOOK_SETTLEMENT_STATS), ...SETTLEMENT_TEMPLATES.map(t => t.id)]);

	it("are keyed by places a settlement sheet can be made from", () => {
		for (const key of Object.keys(SETTLEMENT_PORTRAITS)) expect(keys.has(key), key).toBe(true);
	});

	it("each name a book picture and a rect inside it", () => {
		for (const [key, { src, crop }] of Object.entries(SETTLEMENT_PORTRAITS)) {
			expect(src, key).toMatch(/^assets\/(locations|bestiary|people)\/[a-z0-9-]+\.webp$/);
			const [x0, y0, x1, y1] = crop;
			expect(crop.every(n => n >= 0 && n <= 1), key).toBe(true);
			expect(x1 > x0 && y1 > y0, key).toBe(true);
		}
	});

	it("leaves the two Whitefang places on their initials", () => {
		expect(SETTLEMENT_PORTRAITS["whitefang-farm-valley"]).toBeUndefined();
		expect(SETTLEMENT_PORTRAITS["fortress-monastery"]).toBeUndefined();
	});
});

describe("settlementPortraitOut / settlementPortraitPlan", () => {
	const picks = { lygos: { src: "assets/bestiary/antiquarian.webp", crop: [0.542, 0, 0.876, 1] } };
	const out = "assets/settlements/lygos-q542-000-876-1000.webp";

	it("names the square by its rect, so a re-framed pick is a new file", () => {
		expect(settlementPortraitOut("lygos", picks.lygos)).toBe(out);
		expect(settlementPortraitOut("nowhere", undefined)).toBeNull();
	});

	it("uses a square already cut", () => {
		const present = new Set([`${ART}/${out}`]);
		expect(settlementPortraitPlan("lygos", present, ART, picks)).toEqual({ src: `${ART}/${out}` });
	});

	it("plans a cut when only the book picture is on disk", () => {
		const present = new Set([`${ART}/assets/bestiary/antiquarian.webp`]);
		expect(settlementPortraitPlan("lygos", present, ART, picks)).toEqual({
			cut: { parent: `${ART}/assets/bestiary/antiquarian.webp`, crop: picks.lygos.crop, out },
		});
	});

	it("has nothing to offer without the art, or without a pick", () => {
		expect(settlementPortraitPlan("lygos", new Set(), ART, picks)).toBeNull();
		expect(settlementPortraitPlan("homebrew", new Set([`${ART}/${out}`]), ART, picks)).toBeNull();
	});

	// On The Forge the listing answers an Assets Library URL, which is what a browser must fetch.
	it("hands back what the host serves the file as", () => {
		const served = `https://assets.example/u/${ART}/${out}`;
		const present = { has: p => p === `${ART}/${out}`, resolve: () => served };
		expect(settlementPortraitPlan("lygos", present, ART, picks)).toEqual({ src: served });
	});
});

describe("settlementPortraitUpdate", () => {
	const actor = (img, token = img) => ({ img, prototypeToken: { texture: { src: token } } });
	const square = `${ART}/assets/settlements/lygos-q542-000-876-1000.webp`;

	it("moves an image of ours, and its token, onto the portrait", () => {
		expect(settlementPortraitUpdate(actor(MB), square)).toEqual({ img: square, "prototypeToken.texture.src": square });
		expect(settlementPortraitUpdate(actor(OLD_MAP, SETTLEMENT_DEFAULT_IMG), MB, { legacyMaps: true })).toEqual({ img: MB, "prototypeToken.texture.src": MB });
	});

	it("leaves a poster map, image or token, outside the first pass", () => {
		expect(settlementPortraitUpdate(actor(OLD_MAP), MB)).toBeNull();
		expect(settlementPortraitUpdate(actor(MB, OLD_MAP), square)).toEqual({ img: square });
	});

	it("does nothing once the sheet is where it should be", () => {
		expect(settlementPortraitUpdate(actor(square), square)).toBeNull();
	});

	it("never touches a picture the GM chose, nor a token they chose", () => {
		expect(settlementPortraitUpdate(actor("worlds/x/mine.webp"), MB)).toBeNull();
		expect(settlementPortraitUpdate(actor(MB, "worlds/x/token.webp"), square)).toEqual({ img: square });
	});
});

describe("resolveSettlementPortraits", () => {
	afterEach(() => { vi.unstubAllGlobals(); });

	// A player cannot browse or write, and cannot make or rename a settlement either.
	it("gives anyone but a GM the village icon", async () => {
		vi.stubGlobal("game", { user: { isGM: false } });
		expect(await resolveSettlementPortraits([{ key: "lygos", name: "Lygos" }])).toEqual([SETTLEMENT_DEFAULT_IMG]);
	});
});

describe("the village icon file", () => {
	it("is still on disk, for a name with no letters", () => {
		expect(fs.existsSync(path.join(ROOT, SETTLEMENT_DEFAULT_IMG.replace(/^systems\/[^/]+\//, "")))).toBe(true);
	});
});
