import { afterEach, describe, expect, it, vi } from "vitest";
import { openZeroHpMove, sheetOnScreen } from "../../module/hooks/DeathsDoorPrompt.js";

// Live, 2026-10-28: a PC whose sheet was closed dropped to 0 HP, the Death's Door window drew first, and the
// sheet (whose AppV1 render(true) returns before it is drawn) then landed on top of it, over its Roll button.
// The walkthrough now opens only once the sheet is on screen.

/** A small Hooks bus, so a test can fire the render hook the way Foundry does, after a delay. */
function hookBus() {
	const handlers = new Map();
	let next = 1;
	return {
		on: vi.fn((name, fn) => { const id = next++; handlers.set(id, { name, fn }); return id; }),
		off: vi.fn((name, id) => { handlers.delete(id); }),
		fire(name, app) { for (const h of [...handlers.values()]) if (h.name === name) h.fn(app); },
		count: () => handlers.size,
	};
}

describe("opening the 0-HP walkthrough over the sheet", () => {
	const saved = global.Hooks;
	afterEach(() => { global.Hooks = saved; vi.useRealTimers(); });

	it("waits for a closed sheet to be drawn before opening the walkthrough", async () => {
		vi.useFakeTimers();
		const bus = hookBus(); global.Hooks = bus;
		const order = [];
		const sheet = {
			rendered: false,
			render: vi.fn(() => { order.push("render called"); setTimeout(() => { order.push("sheet drawn"); bus.fire("renderActorSheet", sheet); }, 200); return sheet; }),
			_onDeathsDoorOpen: vi.fn(async () => { order.push("walkthrough"); }),
		};
		const opening = openZeroHpMove({ sheet });
		await vi.advanceTimersByTimeAsync(250);
		await opening;
		expect(order).toEqual(["render called", "sheet drawn", "walkthrough"]);
		expect(bus.count()).toBe(0);
	});

	it("only raises a sheet already on screen, and opens the walkthrough straight away", async () => {
		const bus = hookBus(); global.Hooks = bus;
		const sheet = { rendered: true, render: vi.fn(), _onDeathsDoorOpen: vi.fn(async () => {}) };
		await openZeroHpMove({ sheet });
		expect(sheet.render).toHaveBeenCalledWith(true);
		expect(bus.on).not.toHaveBeenCalled();
		expect(sheet._onDeathsDoorOpen).toHaveBeenCalled();
	});

	it("ignores another window's render, and stops waiting after the timeout", async () => {
		vi.useFakeTimers();
		const bus = hookBus(); global.Hooks = bus;
		const sheet = { rendered: false, render: vi.fn() };
		let settled = false;
		const p = sheetOnScreen(sheet, { timeout: 1000 }).then(() => { settled = true; });
		bus.fire("renderActorSheet", { someOther: true });
		await vi.advanceTimersByTimeAsync(500);
		expect(settled).toBe(false);
		await vi.advanceTimersByTimeAsync(600);
		await p;
		expect(settled).toBe(true);
		expect(bus.count()).toBe(0);
	});
});
