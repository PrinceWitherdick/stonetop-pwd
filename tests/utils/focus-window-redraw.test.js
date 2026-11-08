// @vitest-environment happy-dom
import { describe, it, expect, vi } from "vitest";
import { refocusAfterRedraw } from "../../module/utils/focus-window.js";
import { wireKeyboardButtons } from "../../module/utils/keyboard-buttons.js";

// Live run 2026-11-06: after Apply the sheet redrew for the new level and took the focused Level field
// with it, and core's Tab binding (cycle the map's tokens) swallowed Tab on the window's cards.
function fakeHooks() {
	const handlers = new Map();
	let next = 1;
	return {
		handlers,
		on: (name, fn) => { const id = next++; handlers.set(id, { name, fn }); return id; },
		off: (_name, id) => handlers.delete(id),
		fire: (name, app) => { for (const { name: n, fn } of [...handlers.values()]) if (n === name) fn(app); },
	};
}

describe("refocusAfterRedraw", () => {
	it("puts the keyboard back on the sheet's control after the sheet's next draw", () => {
		const root = document.createElement("div");
		root.innerHTML = `<input name="system.attributes.level.value">`;
		document.body.append(root);
		const sheet = { element: [root] };
		const hooks = fakeHooks();
		refocusAfterRedraw(sheet, "input[name='system.attributes.level.value']", { hooks, setTimer: () => {} });
		document.body.focus();
		hooks.fire("renderApplication", { element: [] }); // another window: ignored
		expect(document.activeElement).not.toBe(root.querySelector("input"));
		hooks.fire("renderActorSheet", sheet);
		expect(document.activeElement).toBe(root.querySelector("input"));
		expect(hooks.handlers.size).toBe(0); // one-shot
		root.remove();
	});

	it("leaves focus alone when the user has moved into another window by then", () => {
		const root = document.createElement("div");
		root.innerHTML = `<input name="lvl">`;
		const other = document.createElement("button");
		document.body.append(root, other);
		const hooks = fakeHooks();
		const sheet = { element: [root] };
		refocusAfterRedraw(sheet, "input[name='lvl']", { hooks, setTimer: () => {} });
		other.focus();
		hooks.fire("renderApplication", sheet);
		expect(document.activeElement).toBe(other);
		root.remove(); other.remove();
	});

	it("stops listening when the wait runs out", () => {
		const hooks = fakeHooks();
		let fire;
		refocusAfterRedraw({ element: [document.createElement("div")] }, null, { hooks, setTimer: fn => { fire = fn; } });
		expect(hooks.handlers.size).toBe(3);
		fire();
		expect(hooks.handlers.size).toBe(0);
	});
});

describe("wireKeyboardButtons and Tab", () => {
	it("keeps Tab inside the window away from core's window-level binding, without cancelling it", () => {
		const root = document.createElement("div");
		root.innerHTML = `<div role="button" tabindex="0">A Safe Place</div>`;
		document.body.append(root);
		wireKeyboardButtons(root);
		const core = vi.fn();
		window.addEventListener("keydown", core);
		const ev = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
		root.querySelector("[role='button']").dispatchEvent(ev);
		expect(core).not.toHaveBeenCalled();
		expect(ev.defaultPrevented).toBe(false); // the browser still moves focus
		const shift = new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true, cancelable: true });
		root.querySelector("[role='button']").dispatchEvent(shift);
		expect(core).not.toHaveBeenCalled();
		window.removeEventListener("keydown", core);
		root.remove();
	});
});
