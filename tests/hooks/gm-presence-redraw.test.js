import { describe, expect, it, vi } from "vitest";
import { cardsToRedraw, installGmPresenceRedraw, isSystemCard } from "../../module/hooks/gm-presence-redraw.js";
import { SYSTEM_ID } from "../../module/system-id.js";

// Audit EDG-14 (2026-11-06): a card's Apply / spend / suffer buttons are gated on who is connected when it is
// drawn, so a GM coming or going has to redraw the cards still in play, or a new primary GM finds them disabled
// and a card drawn with no GM keeps writing directly beside the GM's relay.

const card = (id, extra = {}) => ({ id, logged: true, flags: { [SYSTEM_ID]: { damage: true } }, content: "", ...extra });

describe("which cards are redrawn", () => {
	it("is this system's cards", () => {
		expect(isSystemCard(card("a"))).toBe(true);
		expect(isSystemCard({ flags: {}, content: '<div class="stonetop-card">' })).toBe(true);
		expect(isSystemCard({ flags: {}, content: "<p>hello</p>" })).toBe(false);
		expect(isSystemCard(null)).toBe(false);
	});

	it("is the latest few the log has drawn, never one it has not (updateMessage would post it)", () => {
		const list = [card("old"), card("plain", { flags: {}, content: "hi" }), card("undrawn", { logged: false }), card("new")];
		expect(cardsToRedraw(list).map(m => m.id)).toEqual(["old", "new"]);
		expect(cardsToRedraw(list, { depth: 1 }).map(m => m.id)).toEqual(["new"]);
		expect(cardsToRedraw({ contents: list }, { depth: 2 }).map(m => m.id)).toEqual(["new"]);
	});
});

describe("listening", () => {
	function rig() {
		const handlers = {};
		const hooks = { on: vi.fn((name, fn) => { handlers[name] = fn; return 7; }), off: vi.fn() };
		const updateMessage = vi.fn(async () => {});
		const queued = [];
		const timers = { set: vi.fn(fn => { queued.push(fn); return queued.length; }), clear: vi.fn() };
		const list = [card("a"), card("b")];
		const stop = installGmPresenceRedraw({ hooks, messages: () => list, chat: () => ({ updateMessage }), timers });
		return { handlers, hooks, updateMessage, queued, timers, stop };
	}

	it("redraws the cards once a GM connects or leaves, after a settle", async () => {
		const r = rig();
		r.handlers.userConnected({ isGM: true }, true);
		r.handlers.userConnected({ isGM: true }, false);
		expect(r.timers.clear).toHaveBeenCalledTimes(1);
		await r.queued.at(-1)();
		await Promise.resolve();
		expect(r.updateMessage.mock.calls.map(([m]) => m.id)).toEqual(["a", "b"]);
	});

	it("redraws them all at once, and one that fails doesn't stop the rest", async () => {
		const r = rig();
		const started = [];
		let release;
		const gate = new Promise(resolve => { release = resolve; });
		r.updateMessage.mockImplementation(async m => {
			started.push(m.id);
			await gate;
			if (m.id === "a") throw new Error("gone");
		});
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		r.handlers.userConnected({ isGM: true }, true);
		r.queued.at(-1)();
		// Both started before either finished.
		expect(started).toEqual(["a", "b"]);
		release();
		await vi.waitFor(() => expect(warn).toHaveBeenCalledTimes(1));
		warn.mockRestore();
	});

	it("leaves the log alone when a player comes or goes", () => {
		const r = rig();
		r.handlers.userConnected({ isGM: false }, true);
		expect(r.timers.set).not.toHaveBeenCalled();
	});

	it("stops listening", () => {
		const r = rig();
		r.stop();
		expect(r.hooks.off).toHaveBeenCalledWith("userConnected", 7);
	});
});
