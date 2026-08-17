import { describe, it, expect } from "vitest";
import {
	MIN_SPAN, SQ_MIN, HEAD_SHARE,
	normalizeRect, isValidFrame, normalizeFrame, rectEq,
	sameSrc, frameSourceFor, frameStyle, resolvePortrait,
	suggestSquare, stageFor, rectToBox, boxToRect,
	hitTestBox, clampBox, resizeBox, boxFromDrag, nudgeBox,
} from "../../module/utils/portrait-frame.js";
import { bakeFileName } from "../../module/utils/portrait-tokenizer.js";

// The square frame a user chooses over a portrait. These cover the pure half: the stored shape
// (which must never use `img` as its path key), the path identity that decides whether a stored
// rect still belongs to the picture on screen, the four percentages that paint it, and the
// geometry the editor drags around.
//
// The load-bearing property, asserted throughout: a rect is square in PIXELS, not in fractions.

const RECT = [0.25, 0, 0.75, 0.25];
const frame = (extra = {}) => ({ src: "worlds/w/art/kel.webp", rect: RECT, ...extra });

describe("rect normalisation", () => {
	it("rounds to three decimals, matching the art picker and the merge script", () => {
		expect(normalizeRect([0.12345, 0.6789, 0.54321, 0.98765])).toEqual([0.123, 0.679, 0.543, 0.988]);
	});

	it("preserves exact 0 and exact 1, because flush-to-an-edge is the common case", () => {
		// A square cut from the top of a standing figure sits on y=0, and a full-width one on
		// x=0..1. A normaliser that nudged those would move most of the library.
		expect(normalizeRect([0, 0, 1, 0.3])).toEqual([0, 0, 1, 0.3]);
	});

	it("clamps out-of-range numbers rather than rejecting them", () => {
		expect(normalizeRect([-0.5, -1, 1.5, 0.4])).toEqual([0, 0, 1, 0.4]);
	});

	it("rejects a sliver that rounding collapses to zero area", () => {
		// Round THEN validate: [0.5, 0, 0.5004, 0.2] has positive area before rounding and none
		// after, and it is the rounded value that gets stored.
		expect(normalizeRect([0.5, 0, 0.5004, 0.2])).toBeNull();
	});

	it("rejects a span under the display floor, which would ask for a five-figure width", () => {
		expect(normalizeRect([0, 0, MIN_SPAN / 2, 0.5])).toBeNull();
	});

	it("rejects malformed input without throwing", () => {
		for (const bad of [null, undefined, [], [0, 0, 1], "0,0,1,1", [0, 0, "x", 1], [0, 0, NaN, 1]]) {
			expect(normalizeRect(bad)).toBeNull();
		}
	});
});

describe("frame validity", () => {
	it("accepts a src plus a usable rect", () => {
		expect(isValidFrame(frame())).toBe(true);
	});

	it("REJECTS `img` used as the path key", () => {
		// repoint-portraits.js rewrites any flag key literally named `img` from an illustration to
		// its square. A frame keyed that way would be silently detached from the picture its rect
		// was measured on, with no error. The alias must never validate.
		expect(isValidFrame({ img: "worlds/w/art/kel.webp", rect: RECT })).toBe(false);
	});

	it("rejects a missing or empty src, and a rect that does not normalise", () => {
		expect(isValidFrame({ rect: RECT })).toBe(false);
		expect(isValidFrame(frame({ src: "   " }))).toBe(false);
		expect(isValidFrame(frame({ rect: [0.5, 0.5, 0.5, 0.5] }))).toBe(false);
	});

	it("does not throw on anything a hand-edited flag can hold", () => {
		for (const bad of [null, undefined, [], "x", 7, { src: 1, rect: RECT }]) {
			expect(isValidFrame(bad)).toBe(false);
		}
	});

	it("normalizeFrame stores the rounded rect, or null", () => {
		expect(normalizeFrame(frame({ rect: [0.2501, 0, 0.7499, 0.2501] })))
			.toEqual({ src: "worlds/w/art/kel.webp", rect: [0.25, 0, 0.75, 0.25] });
		expect(normalizeFrame({ src: "", rect: RECT })).toBeNull();
	});
});

describe("path identity", () => {
	it("ignores a query string, because Tokenizer appends a cache-buster to actor.img", () => {
		// vtta-tokenizer writes `<path>?<timestamp>` on every run. Without this, a frame would go
		// stale on every actor it touched.
		expect(sameSrc("art/kel.webp", "art/kel.webp?1754099")).toBe(true);
	});

	it("ignores a hash and a leading ./", () => {
		expect(sameSrc("art/kel.webp", "art/kel.webp#a")).toBe(true);
		expect(sameSrc("./art/kel.webp", "art/kel.webp")).toBe(true);
	});

	it("decodes percent-escapes so a round trip through a URL still matches", () => {
		expect(sameSrc("art/old%20kel.webp", "art/old kel.webp")).toBe(true);
	});

	it("compares case-sensitively, because data paths are on a Linux host", () => {
		expect(sameSrc("art/Kel.webp", "art/kel.webp")).toBe(false);
	});

	it("survives a malformed escape by comparing the raw strings", () => {
		expect(() => sameSrc("art/%zz.webp", "art/%zz.webp")).not.toThrow();
		expect(sameSrc("art/%zz.webp", "art/%zz.webp")).toBe(true);
	});

	it("never equates an absolute URL with a data-relative path", () => {
		expect(sameSrc("https://x.test/art/kel.webp", "art/kel.webp")).toBe(false);
	});

	it("treats empty and non-string as matching nothing, including each other", () => {
		expect(sameSrc("", "")).toBe(false);
		expect(sameSrc(null, null)).toBe(false);
	});
});

describe("the style string", () => {
	it("pins both corners of a whole-image rect", () => {
		expect(frameStyle([0, 0, 1, 1]))
			.toBe("position:absolute;object-fit:fill;max-width:none;max-height:none;border-radius:0;"
				+ "width:100%;height:100%;left:0%;top:0%");
	});

	it("keeps fractional precision on the offsets, which are amplified by 1/span", () => {
		// left is -100*x0/fw. Rounding this to whole percent is a visibly wrong crop.
		expect(frameStyle([0.4, 0, 1, 0.3])).toContain("left:-66.6667%");
	});

	it("always carries the three overrides that beat the surface rules", () => {
		const s = frameStyle(RECT);
		expect(s).toContain("object-fit:fill");      // beats the shared object-fit:cover
		expect(s).toContain("max-width:none");       // beats core's img { max-width: 100% }
		expect(s).toContain("border-radius:0");      // a 50% radius on an oversized img is an ellipse
	});

	it("emits nothing Handlebars would escape, so a double stash is safe", () => {
		expect(frameStyle([0.4, 0.1, 1, 0.7])).toMatch(/^[a-z0-9:;%.-]+$/);
	});

	it("is empty for a rect that does not normalise", () => {
		expect(frameStyle([0.5, 0.5, 0.5, 0.5])).toBe("");
		expect(frameStyle(null)).toBe("");
	});
});

describe("the read-side resolver", () => {
	const full = (src) => (src === "art/kel-q250-000-750-250.webp" ? "art/kel.webp" : null);

	it("passes the image through untouched when there is no frame", () => {
		expect(resolvePortrait("art/kel.webp", null)).toEqual({ src: "art/kel.webp", style: "", framed: false });
	});

	it("preserves null and empty string, so a producer's {{#if img}} is unaffected", () => {
		expect(resolvePortrait(null, null).src).toBeNull();
		expect(resolvePortrait("", null).src).toBe("");
	});

	it("frames in place when the stamp names the image", () => {
		const out = resolvePortrait("art/kel.webp", { src: "art/kel.webp", rect: RECT });
		expect(out.framed).toBe(true);
		expect(out.src).toBe("art/kel.webp");
		expect(out.style).toBe(frameStyle(RECT));
	});

	it("swaps in the whole illustration when the rect was measured on it", () => {
		// A rect measured on the illustration CANNOT be applied to the square cut out of it.
		const out = resolvePortrait("art/kel-q250-000-750-250.webp", { src: "art/kel.webp", rect: RECT }, { fullSrc: full });
		expect(out.framed).toBe(true);
		expect(out.src).toBe("art/kel.webp");
	});

	it("survives repoint moving actor.img from the illustration to its square", () => {
		// The frame is authored while img is the illustration; repoint-portraits.js then rewrites
		// img to the square. The frame must keep working, at higher resolution, not go stale.
		const f = { src: "art/kel.webp", rect: RECT };
		const before = resolvePortrait("art/kel.webp", f, { fullSrc: full });
		const after = resolvePortrait("art/kel-q250-000-750-250.webp", f, { fullSrc: full });
		expect(before.framed && after.framed).toBe(true);
		expect(after.src).toBe(before.src);
	});

	it("falls back unframed when the user replaced the picture", () => {
		const out = resolvePortrait("art/someone-else.webp", frame(), { fullSrc: () => null });
		expect(out).toEqual({ src: "art/someone-else.webp", style: "", framed: false });
	});

	it("ignores a corrupt frame rather than throwing", () => {
		expect(resolvePortrait("art/kel.webp", { src: "art/kel.webp", rect: "nope" }).framed).toBe(false);
		expect(resolvePortrait("art/kel.webp", "nope").framed).toBe(false);
	});
});

describe("the suggested square", () => {
	it("takes the whole height of an image no taller than it is wide", () => {
		const r = suggestSquare(400, 300);
		expect(r[3] - r[1]).toBeCloseTo(1, 6);
		expect(r[0]).toBeCloseTo((1 - 300 / 400) / 2, 6);   // centred
	});

	it("takes HEAD_SHARE of the height when the figure is tall but not narrow", () => {
		const r = suggestSquare(400, 600);           // 600*0.4 = 240 <= 400
		expect(r[3] - r[1]).toBeCloseTo(HEAD_SHARE, 6);
		expect(r[1]).toBe(0);                        // top-anchored
	});

	it("falls back to full width on a very tall figure, where the width IS the head square", () => {
		const r = suggestSquare(200, 656);           // 656*0.4 = 262 > 200
		expect(r[0]).toBe(0);
		expect(r[2]).toBe(1);
	});

	it("returns null for the dimensions a failed decode gives", () => {
		for (const [w, h] of [[0, 100], [100, 0], [-1, 5], [NaN, 5], [Infinity, 5]]) {
			expect(suggestSquare(w, h)).toBeNull();
		}
	});
});

describe("stage sizing", () => {
	it("applies ONE scale to both axes, which is the editor's core invariant", () => {
		// The art picker floored each axis independently. On a lopsided source that breaks
		// uniformity, and a square in stage pixels stops being a square in image pixels. Assert
		// the single scale rather than the ratio of the rounded pixel sizes, which necessarily
		// differ by up to a pixel.
		const { w, h, scale } = stageFor(200, 656, { maxW: 520, maxH: 560 });
		expect(w).toBe(Math.round(200 * scale));
		expect(h).toBe(Math.round(656 * scale));
		expect(Math.abs(w / 200 - h / 656)).toBeLessThan(1 / 200);
	});

	it("respects each cap independently", () => {
		expect(stageFor(4000, 100, { maxW: 520, maxH: 560, minSide: 0 }).w).toBeLessThanOrEqual(520);
		expect(stageFor(100, 4000, { maxW: 520, maxH: 560, minSide: 0 }).h).toBeLessThanOrEqual(560);
		expect(stageFor(10, 10, { maxUpscale: 4, minSide: 0 }).w).toBe(40);
	});

	it("lets the minimum-size floor beat maxUpscale for a postage-stamp source", () => {
		expect(stageFor(20, 20, { maxUpscale: 4, minSide: 140 }).w).toBe(140);
	});

	it("never lets that floor push a long thin image past the width cap", () => {
		// Flooring the SHORT side of a 900x100 strip to 140px would ask for a 1260px stage.
		expect(stageFor(900, 100, { maxW: 520, maxH: 560, minSide: 140 }).w).toBeLessThanOrEqual(520);
	});

	it("uses the viewport when it is tighter than the height cap", () => {
		expect(stageFor(100, 1000, { maxH: 560, viewH: 600, minSide: 0 }).h).toBeLessThanOrEqual(Math.round(600 * 0.66));
	});
});

describe("box and rect conversion", () => {
	it("round-trips", () => {
		const box = rectToBox(RECT, 400, 800);
		expect(normalizeRect(boxToRect(box, 400, 800))).toEqual(RECT);
	});

	it("re-squares off the X span when the axes disagree", () => {
		// Self-correcting by design, which is why the dirty check compares normalised rects.
		const box = rectToBox([0.25, 0, 0.75, 0.9], 400, 800);
		expect(box.side).toBe(200);
	});

	it("returns null for a rect that does not normalise", () => {
		expect(rectToBox(null, 400, 800)).toBeNull();
	});
});

describe("editor gestures", () => {
	const W = 400, H = 800;
	const box = { left: 100, top: 100, side: 200 };

	it("treats a press on a corner as a resize, beating the inside test", () => {
		expect(hitTestBox(100, 100, box)).toMatchObject({ mode: "resize", corner: "nw" });
		expect(hitTestBox(300, 300, box)).toMatchObject({ mode: "resize", corner: "se" });
	});

	it("returns the grab offset for a move, so the box does not jump under the pointer", () => {
		expect(hitTestBox(180, 190, box)).toEqual({ mode: "move", dx: 80, dy: 90 });
	});

	it("draws from empty space, and from no box at all", () => {
		expect(hitTestBox(10, 10, box).mode).toBe("draw");
		expect(hitTestBox(10, 10, null)).toEqual({ mode: "draw" });
	});

	it("SLIDES a box back inside rather than shrinking it", () => {
		// Dragging past an edge should move the square, not resize it out from under the pointer.
		const out = clampBox({ left: -50, top: 780, side: 200 }, W, H);
		expect(out).toEqual({ left: 0, top: 600, side: 200 });
	});

	it("pins the opposite corner for each of the four grips", () => {
		expect(resizeBox("se", box, 380, 380, W, H)).toMatchObject({ left: 100, top: 100 });
		const nw = resizeBox("nw", box, 50, 50, W, H);
		expect(nw.left + nw.side).toBeCloseTo(300, 6);
		expect(nw.top + nw.side).toBeCloseTo(300, 6);
		const ne = resizeBox("ne", box, 350, 50, W, H);
		expect(ne.left).toBeCloseTo(100, 6);
		expect(ne.top + ne.side).toBeCloseTo(300, 6);
		const sw = resizeBox("sw", box, 50, 350, W, H);
		expect(sw.left + sw.side).toBeCloseTo(300, 6);
		expect(sw.top).toBeCloseTo(100, 6);
	});

	it("follows the longer axis, so the box tracks whichever way you pull", () => {
		expect(resizeBox("se", box, 400, 150, W, H).side).toBeCloseTo(300, 6);
	});

	it("never resizes past the stage edge or below the minimum", () => {
		expect(resizeBox("se", box, 9999, 9999, W, H).side).toBeCloseTo(300, 6); // room to the right
		expect(resizeBox("se", box, 101, 101, W, H).side).toBeCloseTo(Math.min(W, H) * SQ_MIN, 6);
	});

	it("caps a fresh draw at both stage axes and flips its origin when dragged up or left", () => {
		expect(boxFromDrag(200, 200, 50, 100, W, H)).toMatchObject({ left: 50, top: 50, side: 150 });
		expect(boxFromDrag(0, 0, 9999, 9999, W, H).side).toBe(W);
	});

	it("nudges by 2px, or 10 with shift", () => {
		expect(nudgeBox(box, "ArrowRight", {}, W, H).left).toBe(102);
		expect(nudgeBox(box, "ArrowUp", { shift: true }, W, H).top).toBe(90);
	});

	it("grows about the centre, pushing a top-flush square down rather than refusing", () => {
		const flush = { left: 100, top: 0, side: 200 };
		const out = nudgeBox(flush, "+", {}, W, H);
		expect(out.side).toBe(202);
		expect(out.top).toBe(0);          // slid back in-bounds, not rejected
		expect(out.left).toBe(99);
	});

	it("returns null for a key it does not handle, so Tab and Escape still reach the dialog", () => {
		expect(nudgeBox(box, "Tab", {}, W, H)).toBeNull();
		expect(nudgeBox(box, "Escape", {}, W, H)).toBeNull();
	});
});

describe("editor source selection", () => {
	it("prefers the whole illustration behind a shipped square", () => {
		expect(frameSourceFor("art/kel-q.webp", { fullSrc: () => "art/kel.webp" })).toBe("art/kel.webp");
	});

	it("falls back to the image itself for a browsed file", () => {
		expect(frameSourceFor("art/mine.png", { fullSrc: () => null })).toBe("art/mine.png");
	});
});

describe("rect equality", () => {
	it("tolerates float noise from the box round trip but not a real change", () => {
		expect(rectEq([0.25, 0, 0.75, 0.25], [0.25, 0, 0.75, 0.2500000001])).toBe(true);
		expect(rectEq([0.25, 0, 0.75, 0.25], [0.25, 0, 0.75, 0.26])).toBe(false);
		expect(rectEq(null, [0, 0, 1, 1])).toBe(false);
	});
});

describe("the Tokenizer bake filename", () => {
	// ONE file per person, overwritten on every send. The bake is a transient INPUT to Tokenizer,
	// which masks it into a pog, uploads that under its own name and points the token at THAT — so
	// there is nothing to preserve by versioning this name, and Foundry exposes no delete, so
	// anything that accumulated here would stay forever.
	it("is stable across re-crops of the same person", () => {
		expect(bakeFileName("Kel", "abc123")).toBe(bakeFileName("Kel", "abc123"));
	});

	it("separates two people who share a display name", () => {
		expect(bakeFileName("Guard", "aaa")).not.toBe(bakeFileName("Guard", "bbb"));
	});

	it("is a safe filename whatever the display name contains", () => {
		expect(bakeFileName("Kel / the Bold!", "id1")).toMatch(/^[\w.-]+\.webp$/);
		expect(bakeFileName("", "")).toBe("portrait-frame.webp");
		expect(bakeFileName(null, null)).toBe("portrait-frame.webp");
	});

	it("does not run away on a very long name", () => {
		expect(bakeFileName("x".repeat(500), "y".repeat(500)).length).toBeLessThan(80);
	});
});
