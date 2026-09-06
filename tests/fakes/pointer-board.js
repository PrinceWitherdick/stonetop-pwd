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
import { fakeClassList, matchesSelector } from "./dom.js";

/**
 * A `style` that answers `setProperty`, because CUSTOM PROPERTIES are how a drag moves a portrait.
 *
 * A plain object would swallow every write silently (optional-call syntax on a missing method is
 * a no-op), and a test could then only assert that nothing was written wrong. Storing them under
 * their own names lets one assert the two things that matter: that the travel is written, and that
 * `transform` is left alone, since an inline transform would replace the centring the stylesheet
 * puts every node's coordinates through.
 */
function styleBag() {
	const style = {
		setProperty(name, value) { style[name] = String(value); },
		removeProperty(name) { delete style[name]; },
	};
	return style;
}

/** One element: a parent chain, classes, a dataset, a style object and the handlers on it. */
export function boardEl({ cls = [], dataset = {}, parent = null } = {}) {
	const node = {
		classes: [...cls], dataset, children: [], parent, style: styleBag(), handlers: {}, attrs: {},
		matches: sel => matchesSelector(node, sel),
		setAttribute(k, v) { node.attrs[k] = String(v); },
		getAttribute: k => node.attrs[k] ?? null,
		closest(sel) {
			for (let cur = node; cur; cur = cur.parent) if (cur.matches?.(sel)) return cur;
			return null;
		},
		// The other half of that walk, downwards: the click handler asks the BOARD whether what
		// was clicked is inside it, rather than naming the viewport chrome it is not.
		contains: other => { for (let cur = other; cur; cur = cur.parent) if (cur === node) return true; return false; },
		/**
		 * A box, so anything that PLACES itself can be tested.
		 *
		 * Zero by default and settable through `rect`, because a fake that made up a size would be
		 * asserting arithmetic against numbers nothing in the test chose. The tie bar clamps itself
		 * into the viewport, and both boxes in that sum have to be the test's own.
		 */
		rect: { left: 0, top: 0, width: 0, height: 0 },
		getBoundingClientRect: () => ({ ...node.rect }),
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
	node.classList = fakeClassList(node);
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
export function pointerBoard({ nodes = ["n1", "n2"], edges = ["e1"] } = {}) {
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

	// A portrait EXACTLY AS THE BOARD PARTIAL PRINTS ONE: an outer node that carries the id and
	// takes the drag, with TWO SEPARATE BUTTONS inside it — the face, which opens the sheet, and the
	// link handle, which is its SIBLING and not its child.
	//
	// ⚠ THIS FAKE USED TO PUT `relmapOpen` ON THE NODE ITSELF, and that one shortcut hid a real
	// defect for as long as it stood: `closest("[data-relmap-open]")` from the handle found the
	// node, so every test agreed the handle was part of the face. In the shipped markup it walks
	// past the handle to `.stonetop-relmap-node`, which carries no such attribute, and finds
	// nothing — which is how Delete and the arrow keys came to leak past the board to the scene
	// canvas from every second tab stop. A fake that is easier to press than the real thing is a
	// fake that certifies handlers the real thing never reaches.
	const portraits = {};
	for (const id of nodes) {
		const el = boardEl({ cls: ["stonetop-relmap-node"], dataset: { relmapNode: id }, parent: board });
		el.face = boardEl({ cls: ["stonetop-relmap-face"], dataset: { relmapOpen: id }, parent: el });
		el.name = boardEl({ cls: ["stonetop-relmap-name"], parent: el });
		el.handle = boardEl({ cls: ["stonetop-relmap-handle"], dataset: { relmapHandle: id }, parent: el });
		portraits[id] = el;
	}

	// A caption, as the board template prints one: a group inside the shared caption layer, with the
	// WORDS inside it. The words are the thing a reader aims at and focuses — there is no HTML
	// button any more (a hundred of those over one svg is what the merge got rid of), so they wear
	// `role` and `tabindex` themselves and relmap-drag has to hand them Enter and Space.
	const labels = boardEl({ cls: ["stonetop-relmap-labels"], parent: board });
	const captions = {};
	for (const id of edges) {
		const g = boardEl({ cls: ["stonetop-relmap-label"], dataset: { relmapEdge: id }, parent: labels });
		g.words = boardEl({ cls: ["stonetop-relmap-label-text"], dataset: { relmapWords: id }, parent: g });
		captions[id] = g;
	}

	// A LINE, AS THE BOARD PARTIAL PRINTS ONE: the painted stroke, which takes no pointer events at
	// all, and the invisible wide one over it, which is the only thing on that layer a click can
	// land on. Both, and not just the target: what makes the pair worth having in a fake is that a
	// test can prove the click goes to the one that can receive it.
	const lines = boardEl({ cls: ["stonetop-relmap-lines"], parent: board });
	const strokes = {};
	for (const id of edges) {
		const painted = boardEl({ cls: ["stonetop-relmap-line"], dataset: { relmapLine: id }, parent: lines });
		painted.hit = boardEl({ cls: ["stonetop-relmap-hit"], dataset: { relmapHit: id }, parent: lines });
		strokes[id] = painted;
	}

	// THE TIE BAR, in the VIEWPORT and not on the board -- which is exactly where the production
	// markup puts it, and the reason it has to be here: its own presses arrive at the same
	// delegated click handler every gesture on this board does, and a fake that left it out would
	// certify a handler that closes the bar under the swatch operating it.
	const tiebar = boardEl({ cls: ["stonetop-relmap-tiebar"], parent: view });
	tiebar.hidden = true;

	return {
		root, view, board, portraits, captions, strokes, tiebar,
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
