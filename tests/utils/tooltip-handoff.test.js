import { beforeEach, describe, it, expect, vi } from "vitest";
import { dropOrphanedTooltip, registerOrphanedTooltipCleanup } from "../../module/utils/tooltip-handoff.js";

// A window that re-renders under a still pointer takes the tooltipped element out of the page;
// Foundry's tooltip, which goes by the pointer, would hang there until the pointer moved.

let frames;
let hovered;
beforeEach(() => {
	frames = [];
	hovered = [];
	global.requestAnimationFrame = fn => frames.push(fn);
	global.document = { querySelectorAll: sel => (sel === ":hover" ? hovered : []) };
	global.game = {
		tooltip: {
			element: null,
			activate: vi.fn(function (el) { this.element = el; }),
			deactivate: vi.fn(function () { this.element = null; }),
		},
	};
});

describe("a tooltip left on an element a render took away", () => {
	it("comes down, and opens on the tooltipped element under the pointer a frame later", () => {
		game.tooltip.element = { isConnected: false };
		const fresh = { isConnected: true };
		hovered = [{}, { closest: () => fresh }];
		dropOrphanedTooltip();
		expect(game.tooltip.deactivate).toHaveBeenCalled();
		expect(game.tooltip.element).toBe(null);
		frames.forEach(fn => fn());
		expect(game.tooltip.activate).toHaveBeenCalledWith(fresh);
	});

	it("stays down when nothing under the pointer has a tooltip", () => {
		game.tooltip.element = { isConnected: false };
		hovered = [{ closest: () => null }];
		dropOrphanedTooltip();
		frames.forEach(fn => fn());
		expect(game.tooltip.activate).not.toHaveBeenCalled();
	});

	it("a tooltip still on the page is left alone", () => {
		const el = { isConnected: true };
		game.tooltip.element = el;
		dropOrphanedTooltip();
		expect(game.tooltip.deactivate).not.toHaveBeenCalled();
		expect(frames).toHaveLength(0);
	});

	it("runs after every V1 and V2 window render", () => {
		const on = vi.fn();
		global.Hooks = { on };
		registerOrphanedTooltipCleanup();
		expect(on).toHaveBeenCalledWith("renderApplication", dropOrphanedTooltip);
		expect(on).toHaveBeenCalledWith("renderApplicationV2", dropOrphanedTooltip);
	});
});
