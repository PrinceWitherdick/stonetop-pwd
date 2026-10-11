import { describe, expect, it, vi } from "vitest";
import { ZOOM_VAR, anchoredScroll, clampScale, wireWheelZoom } from "../../module/utils/wheel-zoom-scroll.js";

// WHEEL-ZOOM ON A REAL SCROLL BOX (the timeline's column). How big a notch is belongs to
// utils/image-zoom.js and is tested there; what is checked here is that the speck under the cursor
// stays under it, that the scale lands on the box for the stylesheet, and which wheels are not zooms.

/**
 * A scroll box with a picture in it `gutter` pixels in from the scroll origin, as the timeline's
 * canvas pads its content. The picture's rect follows the offsets, as a browser's would.
 */
function fakeBox({ w = 400, h = 300, gutter = 100, ui = 1 } = {}) {
	let fn = null;
	const props = new Map();
	const el = {
		clientWidth: w, clientHeight: h, clientLeft: 0, clientTop: 0, offsetWidth: w,
		scrollLeft: 0, scrollTop: 0,
		style: { setProperty: (k, v) => props.set(k, v) },
		// `ui`: the window drawn that many times its laid-out size, as a UI scale draws it.
		getBoundingClientRect: () => ({ left: 50, top: 20, width: w * ui, height: h * ui }),
		querySelector: () => picture,
		addEventListener: (type, f) => { if (type === "wheel") fn = f; },
		removeEventListener: () => { fn = null; },
		prop: k => props.get(k),
		wheel(ev) {
			const full = { clientX: 0, clientY: 0, deltaMode: 0, preventDefault: vi.fn(), ...ev };
			fn?.(full);
			return full;
		},
		get wired() { return fn !== null; },
	};
	const picture = {
		getBoundingClientRect: () => ({ left: 50 + ui * (gutter - el.scrollLeft), top: 20 + ui * (gutter - el.scrollTop) }),
	};
	return el;
}

describe("anchoredScroll", () => {
	it("keeps the point under the cursor where it was", () => {
		// Cursor 200px in, box scrolled 300, picture corner at 100: the speck is 400px into the
		// picture at 1x. Doubled, it is 800 in, so the box must scroll to 100 + 800 - 200.
		expect(anchoredScroll({ scroll: 300, pointer: 200, originBefore: 100, originAfter: 100, from: 1, to: 2 }))
			.toBe(700);
	});

	it("follows a corner that moved with the size", () => {
		expect(anchoredScroll({ scroll: 0, pointer: 100, originBefore: 50, originAfter: 80, from: 1, to: 1 }))
			.toBe(30);
	});

	it("leaves the offset alone for a nonsense scale", () => {
		expect(anchoredScroll({ scroll: 42, pointer: 10, from: 0, to: 2 })).toBe(42);
	});
});

describe("clampScale", () => {
	it("holds the range and turns nonsense into 1", () => {
		expect(clampScale(9, 0.25, 4)).toBe(4);
		expect(clampScale(0.1, 0.25, 4)).toBe(0.25);
		expect(clampScale(Number.NaN, 0.25, 4)).toBe(1);
		expect(clampScale(-1, 0.25, 4)).toBe(1);
	});
});

describe("wireWheelZoom", () => {
	const wire = (el, scale = 1, extra = {}) => {
		const state = { scale };
		const off = wireWheelZoom(el, {
			content: ".picture",
			get: () => state.scale,
			set: s => { state.scale = s; },
			step: 2,
			...extra,
		});
		return { state, off };
	};

	it("paints the host's scale onto a fresh box straight away", () => {
		const el = fakeBox();
		wire(el, 1.5);
		expect(el.prop(ZOOM_VAR)).toBe("1.5");
	});

	it("zooms in on a wheel UP, about the cursor", () => {
		const el = fakeBox({ gutter: 100 });
		el.scrollLeft = 300;
		el.scrollTop = 100;
		const { state } = wire(el);
		// Cursor 200 across and 50 down inside the box (whose corner is at 50, 20).
		const ev = el.wheel({ deltaY: -100, clientX: 250, clientY: 70 });
		expect(ev.preventDefault).toHaveBeenCalled();
		expect(state.scale).toBe(2);
		expect(el.prop(ZOOM_VAR)).toBe("2");
		// Across: 400px into the picture at 1x, 800 at 2x, so 100 + 800 - 200.
		expect(el.scrollLeft).toBe(700);
		// Down: 50px into the picture at 1x, 100 at 2x, so 100 + 100 - 50.
		expect(el.scrollTop).toBe(150);
	});

	it("keeps the same speck under the cursor when the window is drawn at a UI scale", () => {
		// The case above drawn twice its size: the cursor is 400 across and 100 down on screen, which
		// is the same 200 and 50 laid out, and the scroll offsets are laid out either way.
		const el = fakeBox({ gutter: 100, ui: 2 });
		el.scrollLeft = 300;
		el.scrollTop = 100;
		wire(el);
		el.wheel({ deltaY: -100, clientX: 450, clientY: 120 });
		expect(el.scrollLeft).toBe(700);
		expect(el.scrollTop).toBe(150);
	});

	it("zooms out on a wheel DOWN", () => {
		const el = fakeBox();
		const { state } = wire(el, 2);
		el.wheel({ deltaY: 100 });
		expect(state.scale).toBe(1);
	});

	it("stops at the ends of the range without moving the box", () => {
		const el = fakeBox();
		el.scrollLeft = 123;
		const { state } = wire(el, 4, { max: 4 });
		const ev = el.wheel({ deltaY: -100, clientX: 250 });
		expect(state.scale).toBe(4);
		expect(el.scrollLeft).toBe(123);
		// Still eaten: a wheel at the end of the zoom must not fall through to scrolling the column.
		expect(ev.preventDefault).toHaveBeenCalled();
	});

	it("leaves a sideways wheel to scroll", () => {
		const el = fakeBox();
		const { state } = wire(el);
		const ev = el.wheel({ deltaY: 0, deltaX: 100 });
		expect(ev.preventDefault).not.toHaveBeenCalled();
		expect(state.scale).toBe(1);
	});

	it("spends a frame's worth of wheel events as one zoom", () => {
		const frames = [];
		globalThis.requestAnimationFrame = fn => frames.push(fn);
		globalThis.cancelAnimationFrame = vi.fn();
		try {
			const el = fakeBox();
			const { state } = wire(el);
			el.wheel({ deltaY: -100 });
			el.wheel({ deltaY: -100 });
			// Nothing laid out until the frame, and one frame for both.
			expect(state.scale).toBe(1);
			expect(frames).toHaveLength(1);
			frames[0]();
			expect(state.scale).toBe(4);
			expect(el.prop(ZOOM_VAR)).toBe("4");
		} finally {
			delete globalThis.requestAnimationFrame;
			delete globalThis.cancelAnimationFrame;
		}
	});

	it("drops a frame still owed when it comes off", () => {
		globalThis.requestAnimationFrame = () => 7;
		globalThis.cancelAnimationFrame = vi.fn();
		try {
			const el = fakeBox();
			const { off } = wire(el);
			el.wheel({ deltaY: -100 });
			off();
			expect(globalThis.cancelAnimationFrame).toHaveBeenCalledWith(7);
		} finally {
			delete globalThis.requestAnimationFrame;
			delete globalThis.cancelAnimationFrame;
		}
	});

	it("comes back off", () => {
		const el = fakeBox();
		const { off } = wire(el);
		expect(el.wired).toBe(true);
		off();
		expect(el.wired).toBe(false);
	});
});
