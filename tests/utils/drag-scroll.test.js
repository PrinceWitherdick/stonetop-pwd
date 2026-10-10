import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	GUTTER_LEFT_VAR, GUTTER_TOP_VAR, GUTTER_X_VAR, GUTTER_Y_VAR, LIFT_PX, PANNABLE_CLASS, PANNING_CLASS, gutterFor, wireDragScroll,
} from "../../module/utils/drag-scroll.js";

// GRAB-AND-THROW ON A REAL SCROLL BOX (the timeline's column). The throw arithmetic is
// utils/pan-glide.js's and is tested there; what is checked here is the wiring: which presses become
// drags, which way the box goes, which clicks a drag eats, and that a throw keeps it going.

/** A scroll box: offsets clamped to what the content allows, as a browser clamps them. */
function fakeBox({ w = 400, h = 300, sw = 2000, sh = 1500, scale = 1 } = {}) {
	const listeners = new Map();
	const classes = new Set();
	let left = 0;
	let top = 0;
	const clamp = (v, max) => Math.min(Math.max(v, 0), max);
	const el = {
		isConnected: true,
		clientWidth: w, clientHeight: h, clientLeft: 0, clientTop: 0,
		scrollWidth: sw, scrollHeight: sh,
		get scrollLeft() { return left; },
		set scrollLeft(v) { left = clamp(v, sw - w); },
		get scrollTop() { return top; },
		set scrollTop(v) { top = clamp(v, sh - h); },
		// `scale`: a window drawn at a UI scale, whose rect is scaled and whose layout is not.
		offsetWidth: w + 12, offsetHeight: h + 12,
		getBoundingClientRect: () => ({ left: 0, top: 0, width: (w + 12) * scale, height: (h + 12) * scale }),
		classList: {
			add: c => classes.add(c),
			remove: c => classes.delete(c),
			toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)),
			contains: c => classes.has(c),
		},
		captured: null,
		setPointerCapture(id) { this.captured = id; },
		releasePointerCapture() { this.captured = null; },
		addEventListener(type, fn) { listeners.set(type, fn); },
		removeEventListener(type) { listeners.delete(type); },
		closest: () => null,
		has: type => listeners.has(type),
		emit(type, ev = {}) {
			const full = {
				pointerId: 1, button: 0, pointerType: "mouse", target: el,
				defaultPrevented: false, stopped: false,
				preventDefault() { this.defaultPrevented = true; },
				stopPropagation() { this.stopped = true; },
				...ev,
			};
			listeners.get(type)?.(full);
			return full;
		},
	};
	return el;
}

/** A child of the box: a card's words, or a control when `control` is set. */
const child = ({ control = false } = {}) => ({ closest: sel => (control && sel ? {} : null) });

describe("wireDragScroll", () => {
	let box;
	let off;
	let frames;
	let clock;

	beforeEach(() => {
		frames = [];
		globalThis.requestAnimationFrame = fn => frames.push(fn);
		globalThis.cancelAnimationFrame = id => { frames[id - 1] = null; };
		// A clock that leaps a second per read: every drag is a slow placement, never a throw,
		// unless a test drives the clock itself.
		clock = 0;
		vi.spyOn(globalThis.performance, "now").mockImplementation(() => (clock += 1000));
		box = fakeBox();
		box.scrollLeft = 500;
		box.scrollTop = 500;
		off = wireDragScroll(box);
	});

	afterEach(() => {
		off?.();
		vi.restoreAllMocks();
		delete globalThis.requestAnimationFrame;
		delete globalThis.cancelAnimationFrame;
	});

	const runFrames = (n = 200) => {
		for (let i = 0; i < n && frames.length; i++) {
			const pending = frames.splice(0, frames.length);
			for (const fn of pending) fn?.();
		}
	};

	it("moves the box the other way to the hand, as content following the pointer does", () => {
		box.emit("pointerdown", { clientX: 100, clientY: 100, target: child() });
		box.emit("pointermove", { clientX: 160, clientY: 70 });
		expect(box.scrollLeft).toBe(440);
		expect(box.scrollTop).toBe(530);
		expect(box.classList.contains(PANNING_CLASS)).toBe(true);
		expect(box.captured).toBe(1);
		box.emit("pointerup", { clientX: 160, clientY: 70 });
		expect(box.classList.contains(PANNING_CLASS)).toBe(false);
	});

	it("leaves a press that never travelled as a click: no capture, no scroll, click goes through", () => {
		box.emit("pointerdown", { clientX: 100, clientY: 100, target: child() });
		box.emit("pointermove", { clientX: 100 + LIFT_PX - 1, clientY: 100 });
		expect(box.captured).toBe(null);
		expect(box.scrollLeft).toBe(500);
		box.emit("pointerup", { clientX: 100 + LIFT_PX - 1, clientY: 100 });
		expect(box.emit("click").stopped).toBe(false);
	});

	it("eats the click a drag ends in, even with lostpointercapture between the release and it", () => {
		box.emit("pointerdown", { clientX: 100, clientY: 100, target: child() });
		box.emit("pointermove", { clientX: 140, clientY: 100 });
		box.emit("pointerup", { clientX: 140, clientY: 100 });
		box.emit("lostpointercapture");
		const click = box.emit("click");
		expect(click.stopped).toBe(true);
		expect(click.defaultPrevented).toBe(true);
		// Spent: the next click is the reader's own.
		expect(box.emit("click").stopped).toBe(false);
	});

	it("does not pan from a control on a left press, but a right drag goes from anywhere", () => {
		box.emit("pointerdown", { clientX: 100, clientY: 100, target: child({ control: true }) });
		box.emit("pointermove", { clientX: 200, clientY: 100 });
		expect(box.scrollLeft).toBe(500);
		box.emit("pointerup", { clientX: 200, clientY: 100 });

		box.emit("pointerdown", { button: 2, clientX: 100, clientY: 100, target: child({ control: true }) });
		box.emit("pointermove", { clientX: 200, clientY: 100 });
		expect(box.scrollLeft).toBe(400);
		box.emit("pointerup", { button: 2, clientX: 200, clientY: 100 });
		// The right drag's menu is eaten; its absent click is not waited for.
		expect(box.emit("contextmenu").defaultPrevented).toBe(true);
		expect(box.emit("click").stopped).toBe(false);
	});

	it("leaves touch and the box's own scrollbar to the browser", () => {
		box.emit("pointerdown", { pointerType: "touch", clientX: 100, clientY: 100, target: child() });
		box.emit("pointermove", { pointerType: "touch", clientX: 200, clientY: 100 });
		expect(box.scrollLeft).toBe(500);
		box.emit("pointercancel", { pointerType: "touch" });

		// Past the client box, on the box itself: the vertical scrollbar.
		box.emit("pointerdown", { clientX: 405, clientY: 100, target: box });
		box.emit("pointermove", { clientX: 405, clientY: 200 });
		expect(box.scrollTop).toBe(500);
	});

	it("slides on after a throw, and a press on the sliding box stops it and opens nothing", () => {
		vi.restoreAllMocks();
		let t = 0;
		vi.spyOn(globalThis.performance, "now").mockImplementation(() => t);
		box.emit("pointerdown", { clientX: 300, clientY: 100, target: child() });
		t = 10; box.emit("pointermove", { clientX: 280, clientY: 100 });
		t = 20; box.emit("pointermove", { clientX: 260, clientY: 100 });
		t = 30; box.emit("pointerup", { clientX: 240, clientY: 100 });
		const released = box.scrollLeft;
		expect(released).toBe(540);
		expect(frames.length).toBe(1);

		t = 46; frames.splice(0)[0]();
		expect(box.scrollLeft).toBeGreaterThan(released);

		box.emit("click"); // the drag's own click, spent
		const where = box.scrollLeft;
		box.emit("pointerdown", { clientX: 10, clientY: 10, target: child({ control: true }) });
		runFrames();
		expect(box.scrollLeft).toBe(where);
		box.emit("pointerup", { clientX: 10, clientY: 10 });
		expect(box.emit("click").stopped).toBe(true);
	});

	it("does not throw a drag that paused before it was let go", () => {
		vi.restoreAllMocks();
		let t = 0;
		vi.spyOn(globalThis.performance, "now").mockImplementation(() => t);
		box.emit("pointerdown", { clientX: 300, clientY: 100, target: child() });
		t = 10; box.emit("pointermove", { clientX: 250, clientY: 100 });
		t = 500; box.emit("pointerup", { clientX: 250, clientY: 100 });
		expect(frames.length).toBe(0);
	});

	// It stops exactly where the throw dies away: nothing settles it afterwards (timeline-no-snap).
	it("lets a throw die away on its own, and asks for no frame after", () => {
		vi.restoreAllMocks();
		let t = 0;
		vi.spyOn(globalThis.performance, "now").mockImplementation(() => t);
		box.emit("pointerdown", { clientX: 300, clientY: 100, target: child() });
		t = 10; box.emit("pointermove", { clientX: 280, clientY: 100 });
		t = 20; box.emit("pointermove", { clientX: 260, clientY: 100 });
		t = 30; box.emit("pointerup", { clientX: 240, clientY: 100 });
		expect(frames.length).toBe(1);
		let ran = 0;
		for (; ran < 400 && frames.length; ran++) { t += 16; frames.splice(0)[0]?.(); }
		expect(ran, "the glide never died away").toBeLessThan(400);
		expect(frames.length).toBe(0);
	});

	it("shows the grab hand only when there is somewhere to go", () => {
		box.emit("pointerenter");
		expect(box.classList.contains(PANNABLE_CLASS)).toBe(true);
		const small = fakeBox({ sw: 400, sh: 300 });
		const offSmall = wireDragScroll(small);
		small.emit("pointerenter");
		expect(small.classList.contains(PANNABLE_CLASS)).toBe(false);
		offSmall();
	});

	it("puts no gutter on a box that did not ask for one", () => {
		expect(box.scrollLeft).toBe(500);
		expect(box.scrollTop).toBe(500);
	});

	// A window drawn at twice its size: the hand travels on screen, the box scrolls laid out, so the
	// content stays under the hand only if the travel is halved.
	describe("in a window drawn at a UI scale", () => {
		let big;
		let offBig;
		beforeEach(() => {
			big = fakeBox({ scale: 2 });
			big.scrollLeft = 500;
			big.scrollTop = 500;
			offBig = wireDragScroll(big);
		});
		afterEach(() => offBig?.());

		it("keeps the content under the hand", () => {
			big.emit("pointerdown", { clientX: 100, clientY: 100, target: child() });
			big.emit("pointermove", { clientX: 160, clientY: 70 });
			expect(big.scrollLeft).toBe(470);
			expect(big.scrollTop).toBe(515);
		});

		it("finds its scrollbar where it is drawn, not where it is laid out", () => {
			// Past the laid-out client width (400) but inside the drawn one (800): the content.
			big.emit("pointerdown", { clientX: 405, clientY: 100, target: big });
			big.emit("pointermove", { clientX: 465, clientY: 100 });
			expect(big.scrollLeft).toBe(470);
			big.emit("pointerup", { clientX: 465, clientY: 100 });
			// Past the drawn client width: the scrollbar, left to the browser.
			big.emit("pointerdown", { clientX: 805, clientY: 100, target: big });
			big.emit("pointermove", { clientX: 805, clientY: 200 });
			expect(big.scrollTop).toBe(500);
		});

		it("throws as far as the hand does on screen", () => {
			const glideAfterThrow = (el) => {
				let t = 0;
				vi.spyOn(globalThis.performance, "now").mockImplementation(() => t);
				el.emit("pointerdown", { clientX: 300, clientY: 100, target: child() });
				t = 10; el.emit("pointermove", { clientX: 280, clientY: 100 });
				t = 20; el.emit("pointermove", { clientX: 260, clientY: 100 });
				t = 30; el.emit("pointerup", { clientX: 240, clientY: 100 });
				const released = el.scrollLeft;
				t = 46; frames.splice(0).forEach(fn => fn?.());
				vi.restoreAllMocks();
				return el.scrollLeft - released;
			};
			const plain = glideAfterThrow(box);
			const scaled = glideAfterThrow(big);
			expect(plain).toBeGreaterThan(0);
			expect(scaled).toBeCloseTo(plain / 2, 5);
		});
	});
});

describe("the gutter to drag off into", () => {
	let observers;

	beforeEach(() => {
		observers = [];
		globalThis.ResizeObserver = class {
			constructor(fn) { this.fn = fn; this.on = false; observers.push(this); }
			observe() { this.on = true; }
			disconnect() { this.on = false; }
		};
	});

	afterEach(() => { delete globalThis.ResizeObserver; });

	/** A box whose scroll range grows with the gutter, as the canvas's padding makes it. */
	function gutteredBox({ w = 400, h = 300, cw = 400, ch = 1000 } = {}) {
		const vars = {};
		const box = fakeBox({ w, h });
		// `contentSized`: the box still grows with what it holds, so it has no room to scroll at all.
		const range = () => (box.contentSized ? { x: 0, y: 0 } : {
			x: cw + (parseInt(vars[GUTTER_LEFT_VAR]) || 0) + (parseInt(vars[GUTTER_X_VAR]) || 0) - box.clientWidth,
			y: ch + (parseInt(vars[GUTTER_TOP_VAR]) || 0) + (parseInt(vars[GUTTER_Y_VAR]) || 0) - box.clientHeight,
		});
		let left = 0;
		let top = 0;
		Object.defineProperties(box, {
			scrollLeft: { get: () => left, set: v => { left = Math.min(Math.max(v, 0), Math.max(range().x, 0)); } },
			scrollTop: { get: () => top, set: v => { top = Math.min(Math.max(v, 0), Math.max(range().y, 0)); } },
		});
		box.style = { setProperty: (k, v) => { vars[k] = v; } };
		box.vars = vars;
		return box;
	}

	it("measures a share of the box per side, capped by the browser window", () => {
		expect(gutterFor({ width: 400, height: 300 }, { width: 1920, height: 1080 }, 0.75)).toEqual({ x: 300, y: 225 });
		expect(gutterFor({ width: 4000, height: 3000 }, { width: 1000, height: 800 }, 0.5)).toEqual({ x: 500, y: 400 });
		expect(gutterFor({ width: 400, height: 300 }, {}, 0)).toEqual({ x: 0, y: 0 });
	});

	it("opens at the content's top-left, past the top and left gutters", () => {
		const box = gutteredBox();
		const off = wireDragScroll(box, { gutter: 0.75 });
		expect(box.vars[GUTTER_X_VAR]).toBe("300px");
		expect(box.vars[GUTTER_Y_VAR]).toBe("225px");
		expect(box.scrollLeft).toBe(300);
		expect(box.scrollTop).toBe(225);
		off();
		expect(observers[0].on).toBe(false);
	});

	it("lets a drag carry the timeline off the top-left corner into the gutter", () => {
		const box = gutteredBox();
		const off = wireDragScroll(box, { gutter: 0.75 });
		box.emit("pointerdown", { clientX: 10, clientY: 10, target: child() });
		box.emit("pointermove", { clientX: 260, clientY: 210 });
		expect(box.scrollLeft).toBe(50);
		expect(box.scrollTop).toBe(25);
		off();
	});

	it("keeps the content still on screen when the box is resized", () => {
		const box = gutteredBox();
		const off = wireDragScroll(box, { gutter: 0.75 });
		box.scrollTop = 400; // the reader has scrolled down a way
		box.clientWidth = 600;
		box.clientHeight = 500;
		observers[0].fn();
		expect(box.vars[GUTTER_X_VAR]).toBe("450px");
		expect(box.vars[GUTTER_Y_VAR]).toBe("375px");
		expect(box.scrollLeft).toBe(450);
		expect(box.scrollTop).toBe(550);
		off();
	});

	// AppV1 wires listeners BEFORE `setPosition` sizes the window, so the first sizing can find a box
	// with no room to scroll yet. The shift it could not take is owed, and paid when the box is sized.
	it("still opens past the gutter when the first sizing found no room to scroll", () => {
		const box = gutteredBox();
		box.contentSized = true;
		const off = wireDragScroll(box, { gutter: 0.75 });
		expect(box.scrollLeft).toBe(0);
		expect(box.scrollTop).toBe(0);
		box.contentSized = false;
		box.clientWidth = 600;
		box.clientHeight = 500;
		observers[0].fn();
		expect(box.scrollLeft).toBe(450);
		expect(box.scrollTop).toBe(375);
		off();
	});

	it("never pulls back a box that was moved after the shift it could not take", () => {
		const box = gutteredBox();
		box.contentSized = true;
		const off = wireDragScroll(box, { gutter: 0.75 });
		box.contentSized = false;
		box.scrollLeft = 100; // a restore, or the reader
		box.clientWidth = 600;
		box.clientHeight = 500;
		observers[0].fn();
		expect(box.scrollLeft).toBe(250);
		expect(box.scrollTop).toBe(375);
		off();
	});

	// A host whose top row is a sticky header (the aggregate timeline's names) has nothing above it to
	// scroll into, so the row stays on the top edge; the other three sides keep their room.
	it("leaves no room above the content when the top is pinned", () => {
		const box = gutteredBox();
		const off = wireDragScroll(box, { gutter: 0.75, pinTop: true });
		expect(box.vars[GUTTER_TOP_VAR]).toBe("0px");
		expect(box.vars[GUTTER_Y_VAR]).toBe("225px");
		expect(box.scrollLeft).toBe(300);
		expect(box.scrollTop).toBe(0);
		box.scrollTop = -50;
		expect(box.scrollTop).toBe(0);
		// A resize grows the room below, and still moves nothing down.
		box.scrollTop = 400;
		box.clientHeight = 500;
		observers[0].fn();
		expect(box.vars[GUTTER_Y_VAR]).toBe("375px");
		expect(box.vars[GUTTER_TOP_VAR]).toBe("0px");
		expect(box.scrollTop).toBe(400);
		off();
	});

	// The swimlanes' thread names are a sticky column at the left: nothing left of them to scroll into.
	it("leaves no room left of the content when the left is pinned", () => {
		const box = gutteredBox();
		const off = wireDragScroll(box, { gutter: 0.75, pinLeft: true });
		expect(box.vars[GUTTER_LEFT_VAR]).toBe("0px");
		expect(box.vars[GUTTER_X_VAR]).toBe("300px");
		expect(box.scrollLeft).toBe(0);
		expect(box.scrollTop).toBe(225);
		box.scrollLeft = -50;
		expect(box.scrollLeft).toBe(0);
		// A resize grows the room to the right, and still moves nothing across.
		box.scrollLeft = 200;
		box.clientWidth = 600;
		observers[0].fn();
		expect(box.vars[GUTTER_X_VAR]).toBe("450px");
		expect(box.vars[GUTTER_LEFT_VAR]).toBe("0px");
		expect(box.scrollLeft).toBe(200);
		off();
	});

	// The timeline stops at its foot as a page does (user, 2026-10-05): no room below, the room above
	// still the host's to keep or pin, and nothing moves on a resize.
	it("leaves no room below the content when the bottom is pinned", () => {
		const box = gutteredBox();
		const off = wireDragScroll(box, { gutter: 0.75, pinBottom: true });
		expect(box.vars[GUTTER_Y_VAR]).toBe("0px");
		expect(box.vars[GUTTER_TOP_VAR]).toBe("225px");
		expect(box.vars[GUTTER_X_VAR]).toBe("300px");
		expect(box.scrollTop).toBe(225);
		box.scrollTop = 100;
		box.clientHeight = 500;
		observers[0].fn();
		expect(box.vars[GUTTER_Y_VAR]).toBe("0px");
		expect(box.vars[GUTTER_TOP_VAR]).toBe("375px");
		expect(box.scrollTop).toBe(250);
		off();
	});

	it("pins top, left and bottom together, leaving only the room to the right", () => {
		const box = gutteredBox();
		const off = wireDragScroll(box, { gutter: 0.75, pinTop: true, pinLeft: true, pinBottom: true });
		expect(box.vars[GUTTER_TOP_VAR]).toBe("0px");
		expect(box.vars[GUTTER_LEFT_VAR]).toBe("0px");
		expect(box.vars[GUTTER_Y_VAR]).toBe("0px");
		expect(box.vars[GUTTER_X_VAR]).toBe("300px");
		expect(box.scrollLeft).toBe(0);
		expect(box.scrollTop).toBe(0);
		off();
	});

	it("adds no gutter unless asked", () => {
		const box = gutteredBox();
		const off = wireDragScroll(box);
		expect(box.vars[GUTTER_X_VAR]).toBeUndefined();
		expect(observers.length).toBe(0);
		off();
	});
});

describe("unwiring", () => {
	it("takes every listener back off", () => {
		const box = fakeBox();
		let off = wireDragScroll(box);
		expect(box.has("pointerdown")).toBe(true);
		off();
		off = null;
		for (const type of ["pointerdown", "pointermove", "pointerup", "click", "contextmenu", "wheel"]) {
			expect(box.has(type)).toBe(false);
		}
	});
});
