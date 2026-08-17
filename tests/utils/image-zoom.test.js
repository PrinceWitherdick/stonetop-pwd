import { describe, it, expect } from "vitest";
import { readRepo as read } from "../fakes/css.js";
import {
	anchoredOffset, centreOffset, clampPan, clampZoom, fitScale, stepZoom,
	MIN_ZOOM, MAX_ZOOM, PAN_MARGIN, ZOOM_STEP,
} from "../../module/utils/image-zoom.js";

// The arithmetic behind the image-zoom window. Everything here is a pure function of a few
// numbers, which is exactly why it is worth pinning: a viewer whose anchor maths is subtly wrong
// still opens, still zooms, and still looks fine in a screenshot — it just walks away from the
// cursor a little more with every notch, and nobody can say when it started.

const WINDOW_JS = read("module/utils/image-zoom-window.js");

describe("clampZoom", () => {
	it("holds the scale between the floor and the ceiling", () => {
		expect(clampZoom(0.001)).toBe(MIN_ZOOM);
		expect(clampZoom(500)).toBe(MAX_ZOOM);
		expect(clampZoom(1.5)).toBe(1.5);
	});

	// Each of these would otherwise reach `img.style.width` as a degenerate pixel count and the
	// picture would simply vanish, with nothing in the console to say why.
	it("answers 1 for anything that is not a usable number", () => {
		for (const bad of [0, -2, NaN, Infinity, undefined, null, "wide"]) {
			expect(clampZoom(bad), String(bad)).toBe(1);
		}
	});
});

describe("fitScale", () => {
	// The case the window was built for: a GM playbook flowchart, opened in a normal window.
	it("fits a page-sized diagram to the shorter axis", () => {
		expect(fitScale({ imageWidth: 1400, imageHeight: 2000, viewWidth: 700, viewHeight: 600 }))
			.toBe(0.3);
	});

	// Fitting UP would blow a thumbnail across a maximised window and show nothing but its own
	// pixels, so fit means "no bigger than the window AND no bigger than the file".
	it("never enlarges a picture smaller than the window", () => {
		expect(fitScale({ imageWidth: 200, imageHeight: 200, viewWidth: 900, viewHeight: 900 }))
			.toBe(1);
	});

	// The state before the image has loaded and reported a natural size, and the state of a
	// window whose viewport has not been laid out yet.
	it("answers 1 while any measurement is still missing", () => {
		expect(fitScale({ imageWidth: 0, imageHeight: 0, viewWidth: 800, viewHeight: 600 })).toBe(1);
		expect(fitScale({ imageWidth: 800, imageHeight: 600, viewWidth: 0, viewHeight: 0 })).toBe(1);
		expect(fitScale()).toBe(1);
	});
});

describe("stepZoom", () => {
	it("moves one notch each way", () => {
		expect(stepZoom(1, 1)).toBeCloseTo(ZOOM_STEP, 10);
		expect(stepZoom(1, -1)).toBeCloseTo(1 / ZOOM_STEP, 10);
	});

	it("stops at the ends of its travel rather than running off", () => {
		expect(stepZoom(MAX_ZOOM, 1)).toBe(MAX_ZOOM);
		expect(stepZoom(MIN_ZOOM, -1)).toBe(MIN_ZOOM);
	});

	// A handful of notches from fit to legible, not a dozen: a chart that opens at 30% reaches
	// full size in nine, which is the difference between wheeling and grinding.
	it("reaches full size from a fitted flowchart in a handful of notches", () => {
		let scale = 0.3, notches = 0;
		while (scale < 1 && notches < 50) { scale = stepZoom(scale, 1); notches++; }
		expect(notches).toBeLessThanOrEqual(10);
	});
});

describe("centreOffset", () => {
	it("puts a picture smaller than the window in the middle of it", () => {
		expect(centreOffset({ paintedWidth: 400, paintedHeight: 300, viewWidth: 800, viewHeight: 700 }))
			.toEqual({ x: 200, y: 200 });
	});

	// Negative is the ORDINARY case here, not an error: a fitted flowchart is the height of the
	// window and wider than it, so its left edge sits outside. A scroll position could not say this.
	it("hangs a picture larger than the window off both edges", () => {
		expect(centreOffset({ paintedWidth: 1200, paintedHeight: 700, viewWidth: 800, viewHeight: 700 }))
			.toEqual({ x: -200, y: 0 });
	});
});

describe("anchoredOffset", () => {
	// THE thing that makes a zoom viewer usable: the spot under the cursor stays under the cursor.
	it("keeps the point under the cursor under the cursor", () => {
		// The cursor is 100px into the view; the picture's left edge is 200px outside it, so the
		// cursor is over the point 300px along the picture. At double the scale that point is 600px
		// along, and it has to still be 100px into the view: 100 - 600.
		expect(anchoredOffset({ offset: -200, pointer: 100, from: 1, to: 2 })).toBe(-500);
		// And back again.
		expect(anchoredOffset({ offset: -500, pointer: 100, from: 2, to: 1 })).toBe(-200);
	});

	it("leaves the picture where it is when the scale does not change", () => {
		expect(anchoredOffset({ offset: -340, pointer: 120, from: 1.5, to: 1.5 })).toBe(-340);
	});

	// The old scroll-based version clamped its answer at zero, because a scroll position cannot go
	// negative. An offset can and must: that clamp would have stopped the picture at the window's
	// edge, which is the exact behaviour this model exists to be rid of.
	it("lets the picture sit past the window's top-left corner", () => {
		// Flush with the left edge, cursor 400px in, zoomed 4x about it: the point that was 400
		// along is now 1600 along, so the edge has to be 1200px outside the window.
		expect(anchoredOffset({ offset: 0, pointer: 400, from: 1, to: 4 })).toBe(-1200);
	});

	it("survives a degenerate scale rather than returning NaN", () => {
		expect(anchoredOffset({ offset: -120, pointer: 40, from: 0, to: 2 })).toBe(-120);
	});
});

describe("clampPan", () => {
	// The freedom that the whole model is for: a picture may hang as far off either edge as the
	// reader drags it, and nothing pulls it back to the window.
	it("leaves an ordinary drag entirely alone", () => {
		expect(clampPan({ offset: -3000, painted: 6000, view: 800 })).toBe(-3000);
		expect(clampPan({ offset: 500, painted: 6000, view: 800 })).toBe(500);
	});

	// ...but never so far that there is nothing left to grab. Without scrollbars, a picture that
	// left the window entirely would leave no evidence it was ever there.
	it("keeps a sliver in view at both ends of the travel", () => {
		// Dragged right, off the far edge: the picture's left edge stops PAN_MARGIN inside the view.
		expect(clampPan({ offset: 100000, painted: 6000, view: 800 })).toBe(800 - PAN_MARGIN);
		// Dragged left: its right edge (offset + painted) stops PAN_MARGIN inside.
		expect(clampPan({ offset: -100000, painted: 6000, view: 800 })).toBe(PAN_MARGIN - 6000);
	});

	// A picture or a window smaller than the margin would otherwise produce a low bound above the
	// high one, and the clamp would snap it to a single position it could never be dragged off.
	it("still gives a picture smaller than the margin somewhere to go", () => {
		const tiny = clampPan({ offset: 5, painted: 10, view: 30 });
		expect(tiny).toBe(5);
		expect(clampPan({ offset: 999, painted: 10, view: 30 })).toBe(20);
		expect(clampPan({ offset: -999, painted: 10, view: 30 })).toBe(0);
	});

	// Before layout there is no window to hold anything inside of, and clamping against a zero
	// width would drag every offset to the corner just as the fit was being computed.
	it("holds its peace until the window has a size", () => {
		expect(clampPan({ offset: -400, painted: 6000, view: 0 })).toBe(-400);
		expect(clampPan({ offset: -400, painted: 0, view: 800 })).toBe(-400);
		expect(clampPan({ offset: NaN, painted: 100, view: 800 })).toBe(0);
	});
});

// Counts a template's TOP-LEVEL elements. It has to walk the nesting rather than read the left
// margin, because a sibling root added indented, or written on the same line as the one already
// there, is still a second root — and a margin-reading count would wave it through as one.
const VOID_TAGS = /^(?:img|br|hr|input|meta|link|source|area|base|col|embed|param|track|wbr)$/i;
function countRoots(hbs) {
	const markup = hbs.replace(/\{\{![\s\S]*?\}\}/g, "");
	let depth = 0, roots = 0;
	for (const [, closing, tag, selfClosing] of markup.matchAll(/<(\/?)(\w+)[^>]*?(\/?)>/g)) {
		if (closing) { depth = Math.max(0, depth - 1); continue; }
		if (depth === 0) roots += 1;
		if (!selfClosing && !VOID_TAGS.test(tag)) depth += 1;
	}
	return roots;
}

// The window itself is a thin shell over the above, but a few of its decisions are the kind that
// are invisible until they bite, so they are pinned here on the source.
describe("the zoom window", () => {
	// The window is the picture and nothing else (user, 2026-08-16). The row of magnifiers, the
	// percentage readout and the line telling the reader to scroll and drag are gone, and a
	// helpful re-addition would silently take height back off a page-sized flowchart.
	it("carries no toolbar above the picture", () => {
		const hbs = read("templates/dialogs/image-zoom.hbs");
		expect(hbs).not.toContain("stonetop-image-zoom-bar");
		expect(hbs).not.toContain("data-zoom");
		expect(hbs).not.toContain("stonetop.imageZoom.");
		expect(read("languages/en.json")).not.toContain('"imageZoom"');
		expect(WINDOW_JS).not.toContain("_onToolbarClick");
	});

	// A transform scales what was already painted, so a flowchart zoomed in on would be resampled
	// from its fitted size and go soft exactly where the reader wanted the small print.
	it("scales by setting a pixel width, not by transforming", () => {
		expect(WINDOW_JS).toContain("Math.floor(this._naturalWidth * this._scale)");
		expect(WINDOW_JS).toContain("this._img.style.width = `${width}px`");
		expect(WINDOW_JS).not.toMatch(/style\.transform\s*=/);
	});

	// FLOOR and not round, and it is not a taste: a fitted picture is the size of the viewport, so
	// a width rounded UP puts a hairline of it past the edge that is meant to be showing all of it.
	it("rounds a fitted width down", () => {
		expect(WINDOW_JS).not.toContain("Math.round(this._naturalWidth");
	});

	// The picture is PLACED, not scrolled (user, 2026-08-16). A scroll box can only reach inside
	// its own content, so it pins a picture to its edges and grows the scrollbars that were asked
	// to go away; an absolute left/top can put the picture anywhere the reader drags it.
	it("moves the picture by its own offsets, with no scroll container behind it", () => {
		expect(WINDOW_JS).toContain("this._img.style.left = `${Math.round(this._offset.x)}px`");
		expect(WINDOW_JS).toContain("this._img.style.top = `${Math.round(this._offset.y)}px`");
		expect(WINDOW_JS).not.toMatch(/scrollLeft|scrollTop/);

		const css = read("styles/stonetop.css");
		const view = css.slice(css.indexOf(".stonetop-image-zoom-view {"));
		expect(view).toMatch(/^\.stonetop-image-zoom-view \{[^}]*position: relative/s);
		expect(view).toMatch(/^\.stonetop-image-zoom-view \{[^}]*overflow: hidden/s);
		expect(view).not.toMatch(/^\.stonetop-image-zoom-view \{[^}]*overflow: auto/s);
		const img = css.slice(css.indexOf(".stonetop-image-zoom-img {"));
		expect(img).toMatch(/^\.stonetop-image-zoom-img \{[^}]*position: absolute/s);
	});

	// A drag accumulates from where it STARTED plus the total travel. Last-position-plus-delta
	// would have the clamp eating a pixel per move, and a drag along an edge would creep off
	// the cursor.
	it("drags from the offset the press began at", () => {
		expect(WINDOW_JS).toContain("x: this._pan.offsetX + dx");
		expect(WINDOW_JS).toContain("y: this._pan.offsetY + dy");
	});

	// A cached picture — the second open of the same diagram — is already `complete` when the
	// listeners run and will never fire `load` again, so a load-only path opens it at 100% with
	// no natural size and no way back to fit.
	it("measures a cached image as well as a freshly loaded one", () => {
		expect(WINDOW_JS).toContain("this._img.complete && this._img.naturalWidth");
	});

	// The wheel has to beat the page's own scrolling, which a passive listener may not do.
	it("takes the wheel non-passively so it can zoom instead of scroll", () => {
		expect(WINDOW_JS).toMatch(/addEventListener\("wheel",.*passive: false/);
	});

	// Taking the toolbar out left the viewport as the template's ONLY element, so AppV1 hands it
	// to activateListeners as the root itself. `root.querySelector(".stonetop-image-zoom-view")`
	// searches descendants and never the element it was called on, so it answered null, the guard
	// below it returned, and not one listener was ever bound: the window opened on a picture that
	// would not zoom, would not drag, and had nothing to scroll either. The class the template's
	// root carries and the class the window looks for have to agree, and the lookup has to be able
	// to find it ON the root.
	it("finds the viewport when it is the template's own root", () => {
		const hbs = read("templates/dialogs/image-zoom.hbs");
		expect(countRoots(hbs)).toBe(1);
		expect(hbs).toMatch(/<div class="stonetop-image-zoom-view">/);
		expect(WINDOW_JS).toContain('root.matches?.(".stonetop-image-zoom-view")');
	});
});
