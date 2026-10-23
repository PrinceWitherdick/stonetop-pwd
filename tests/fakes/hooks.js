import { vi } from "vitest";

/** A Hooks stand-in that keeps its handlers, so a test can fire an event (a card update landing late). */
export function fakeHooks() {
	const handlers = new Map();
	let next = 1;
	return {
		handlers,
		on: vi.fn((name, fn) => { const id = next++; handlers.set(id, { name, fn }); return id; }),
		off: vi.fn((name, id) => { handlers.delete(id); }),
		once: () => {},
		call: () => true,
		callAll: () => true,
		fire: (name, ...args) => { for (const h of [...handlers.values()]) if (h.name === name) h.fn(...args); },
	};
}

/** Swap `global.Hooks` for a fakeHooks() for one test; call the answer's `restore()` after. */
export function useFakeHooks() {
	const saved = global.Hooks;
	const hooks = fakeHooks();
	global.Hooks = hooks;
	hooks.restore = () => { global.Hooks = saved; };
	return hooks;
}
