// A board that can be PRESSED, DRAGGED and CLICKED, for utils/relmap-drag.js.
//
// WHY IT IS NEITHER OF THE OTHER TWO. `tests/fakes/dom.js` models a rendered sheet receiving
// delegated events, where the interesting question is what `closest` walks up to; `frame-dom.js`
// models a document that hands out elements and takes them into a tree. This models a GESTURE: a
// sequence of pointer events whose meaning is in their ORDER and in what the code does between
// them — when it takes the pointer capture, whether a click still arrives at the thing pressed.
// Neither of the others has a pointer, a capture, an animation frame or a `style` to write to, and
// bolting all four onto the sheet fake would make every list-tab test carry them.
//
// `matchesSelector` is IMPORTED rather than rewritten. It is the one place the suite decides what
// `.foo` and `[data-bar]` mean, and a second copy is how two fakes drift into disagreeing about
// the selectors the same production code is written against.
//
// THE CAPTURE IS THE POINT. A real `setPointerCapture` retargets every later event from that
// pointer — the pointerup, and so the `click` the browser derives from it — at the capturing
// element, and releasing it does not undo that. Nothing here reproduces the retarget, deliberately:
// modelling it would make this fake the authority on a browser quirk it cannot verify. What it
// records instead is WHEN the capture was taken, which is the thing the code controls and the
// thing that was wrong.
import { vi } from "vitest";
import { matchesSelector } from "./dom.js";

/** One element: a parent chain, classes, a dataset, a style object and the handlers on it. */
export function boardEl({ cls = [], dataset = {}, parent = null } = {}) {
	const node = {
		classes: [...cls], dataset, children: [], parent, style: {}, handlers: {}, attrs: {},
		matches: sel => matchesSelector(node, sel),
		setAttribute(k, v) { node.attrs[k] = String(v); },
		getAttribute: k => node.attrs[k] ?? null,
		closest(sel) {
			for (let cur = node; cur; cur = cur.parent) if (cur.matches?.(sel)) return cur;
			return null;
		},
		classList: {
			add(name) { if (!node.classes.includes(name)) node.classes.push(name); },
			remove(name) {
				const at = node.classes.indexOf(name);
				if (at >= 0) node.classes.splice(at, 1);
			},
			contains: name => node.classes.includes(name),
		},
		querySelector: sel => walk(node.children, sel)[0] ?? null,
		querySelectorAll: sel => walk(node.children, sel),
		addEventListener: (type, fn) => { (node.handlers[type] ??= []).push(fn); },
		removeEventListener(type, fn) {
			node.handlers[type] = (node.handlers[type] ?? []).filter(f => f !== fn);
		},
		appendChild(child) {
			child.parent = node;
			if (!node.children.includes(child)) node.children.push(child);
			return child;
		},
		remove() {
			const at = node.parent?.children.indexOf(node) ?? -1;
			if (at >= 0) node.parent.children.splice(at, 1);
			node.parent = null;
		},
		/**
		 * Fire one event AT this element, from `target` somewhere beneath it.
		 *
		 * Every listener relmap-drag installs is on the viewport, so a delegated dispatch straight
		 * to it is what bubbling amounts to here. `target` is the node actually under the pointer,
		 * which is the half that matters: it is what `closest` walks up from.
		 */
		emit(type, target = node, extra = {}) {
			const ev = {
				target, button: 0, pointerId: 1, clientX: 0, clientY: 0,
				defaultPrevented: false, propagationStopped: false, ...extra,
				preventDefault() { ev.defaultPrevented = true; },
				stopPropagation() { ev.propagationStopped = true; },
			};
			for (const fn of node.handlers[type] ?? []) fn(ev);
			return ev;
		},
	};
	parent?.children.push(node);
	return node;
}

/** Every descendant matching `sel`, depth first. */
export function walk(nodes, sel, out = []) {
	for (const node of nodes) {
		if (node.matches(sel)) out.push(node);
		walk(node.children, sel, out);
	}
	return out;
}

/**
 * A wired board, its globals, and the handles a test needs to drive it.
 *
 * `frames` is a QUEUE rather than an immediate call. `requestAnimationFrame` running inline would
 * make every pointermove paint synchronously, which is the one thing the production code goes out
 * of its way not to do — a test written against that would pass over a rewrite that dropped the
 * batching entirely.
 *
 * The globals are installed here and taken back by `destroy`, so a file that forgets the teardown
 * cannot leak a `document` into the suites that run after it.
 */
export function pointerBoard({ nodes = ["n1", "n2"] } = {}) {
	const frames = [];
	const previous = {
		document: globalThis.document,
		requestAnimationFrame: globalThis.requestAnimationFrame,
		cancelAnimationFrame: globalThis.cancelAnimationFrame,
	};

	// Only the two calls relmap-drag makes of the document: the rubber band it builds once, and
	// the hit test that resolves a dropped line onto the portrait under the cursor.
	let hits = [];
	globalThis.document = {
		createElementNS: () => boardEl(),
		elementsFromPoint: () => hits,
	};
	// `push` returns the new length, which is exactly the 1-based handle `cancel` indexes back with.
	globalThis.requestAnimationFrame = fn => frames.push(fn);
	globalThis.cancelAnimationFrame = id => { frames[id - 1] = null; };

	const root = boardEl();
	const view = boardEl({ cls: ["stonetop-relmap-view"], parent: root });
	const board = boardEl({ cls: ["stonetop-relmap-board"], parent: view });

	// A portrait is a node that is also the click target, with its link handle inside it — the
	// nesting the board template prints, and the reason `closest` has to distinguish the two.
	const portraits = {};
	for (const id of nodes) {
		const el = boardEl({ cls: ["stonetop-relmap-node"], dataset: { relmapNode: id, relmapOpen: id }, parent: board });
		el.handle = boardEl({ cls: ["stonetop-relmap-handle"], dataset: { relmapHandle: id }, parent: el });
		portraits[id] = el;
	}

	return {
		root, view, board, portraits,
		/** Where `elementsFromPoint` will say the cursor is, topmost first. */
		setHits(list) { hits = list; },
		/** Run every frame queued so far, the way one paint would. */
		flush() {
			const due = frames.splice(0, frames.length);
			for (const fn of due) fn?.();
		},
		get pending() { return frames.filter(Boolean).length; },
		destroy() { Object.assign(globalThis, previous); },
	};
}

/**
 * A ZoomPanSurface stand-in: the three things relmap-drag asks a surface for.
 *
 * `deltaToPercent` deliberately does NOT divide by the scale — the real one measures against the
 * board's PAINTED size, so the scale is already in it, and a fake that divided again would let a
 * double-correction in the production code pass here.
 */
export function fakeSurface({ scale = 1, per = 10 } = {}) {
	return {
		scale,
		deltaToPercent: vi.fn((dx, dy) => ({ left: dx / per, top: dy / per })),
		pointToPercent: vi.fn(({ clientX, clientY }) => ({ left: clientX / per, top: clientY / per })),
	};
}
