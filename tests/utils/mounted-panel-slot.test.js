import { describe, expect, it, vi } from "vitest";
import { mountedPanelSlot } from "../../module/utils/mounted-panel-slot.js";

// A PANEL IN A SHEET TAB IS MOVED, NEVER RE-RENDERED (utils/mounted-panel-slot.js). What is checked
// here is that the reader coming back to the tab does not move it at all: a box taken out of the
// document and put back loses its scroll, and nothing was lifted to say where they were.

/** A mount and the body already painted into it. */
function mounted() {
	const mount = { childNodes: [], replaceChildren: vi.fn() };
	const body = { parentNode: mount };
	mount.childNodes.push(body);
	mount.querySelector = () => null;
	const root = { querySelector: () => mount };
	const panel = { element: [body], setHost: vi.fn(), _restorePlace: vi.fn(), close: vi.fn() };
	const sheet = { _p: panel, _tabs: [{ active: "timeline" }] };
	const slot = mountedPanelSlot({ field: "_p", tab: "timeline", mountSel: "[data-x]", build: () => null });
	return { mount, body, root, panel, sheet, slot };
}

describe("mountedPanelSlot#sync", () => {
	it("leaves a body already in its mount where it is (a tab switch back)", () => {
		const { mount, root, panel, sheet, slot } = mounted();
		slot.sync(sheet, root);
		expect(panel.setHost).toHaveBeenCalledWith(mount);
		expect(mount.replaceChildren).not.toHaveBeenCalled();
	});

	it("moves the body into a fresh mount after a sheet repaint", () => {
		const { body, root, sheet, slot } = mounted();
		const fresh = { childNodes: [], replaceChildren: vi.fn() };
		body.parentNode = null;
		root.querySelector = () => fresh;
		slot.sync(sheet, root);
		expect(fresh.replaceChildren).toHaveBeenCalledWith(body);
	});
});
