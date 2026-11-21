import { describe, it, expect } from "vitest";
import { wireDropHighlight } from "../../module/utils/drop-highlight.js";

// A stand-in element: just the classList and listeners the highlight touches.
function fakeDropTarget() {
	const classes = new Set();
	const listeners = {};
	return {
		classList: { add: c => classes.add(c), remove: c => classes.delete(c), contains: c => classes.has(c) },
		addEventListener: (type, fn) => (listeners[type] ??= []).push(fn),
		fire: type => (listeners[type] ?? []).forEach(fn => fn()),
	};
}

describe("wireDropHighlight", () => {
	it("holds the highlight while the drag crosses children, and drops it once the drag has left", () => {
		const el = fakeDropTarget();
		wireDropHighlight(el);
		el.fire("dragenter");                         // into the section
		el.fire("dragenter"); el.fire("dragleave");   // into a child: its enter lands before the leave
		expect(el.classList.contains("is-drop-target")).toBe(true);
		el.fire("dragleave");                         // out of the section
		expect(el.classList.contains("is-drop-target")).toBe(false);
	});

	it("takes a class of its own, for drop surfaces other than a relationships section", () => {
		const el = fakeDropTarget();
		wireDropHighlight(el, "drag-over");
		el.fire("dragenter");
		expect(el.classList.contains("drag-over")).toBe(true);
		expect(el.classList.contains("is-drop-target")).toBe(false);
		el.fire("dragenter"); el.fire("dragleave");   // across the playbook zone's instinct badge
		expect(el.classList.contains("drag-over")).toBe(true);
	});

	it("returns a clear() that resets the depth, for a drop the host consumed before dragleave", () => {
		const el = fakeDropTarget();
		const clear = wireDropHighlight(el, "drag-over");
		el.fire("dragenter"); el.fire("dragenter");
		clear();
		expect(el.classList.contains("drag-over")).toBe(false);
		// The next drag starts from zero: one enter and one leave are a whole visit.
		el.fire("dragenter"); el.fire("dragleave");
		expect(el.classList.contains("drag-over")).toBe(false);
	});

	it("is a no-op clear() when the section isn't rendered", () => {
		expect(() => wireDropHighlight(null)()).not.toThrow();
	});
});
