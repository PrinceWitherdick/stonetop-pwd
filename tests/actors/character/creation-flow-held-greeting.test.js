import { describe, expect, it, vi } from "vitest";
import {
	trackCreationFlow,
	holdGreetingUntilIdle,
	greetingHeld,
	flowWindowClosing,
} from "../../../module/actors/character/creation-flow.js";

// A greeting that stood aside for an open creation flow is re-run, this session, once the last
// flow window has gone, instead of waiting for the player's next load.

const RENDER_STATES = { CLOSING: -2, CLOSED: -1, RENDERED: 2 };
const tick = () => new Promise(resolve => setTimeout(resolve, 5));

function flowWindow() {
	return { _state: RENDER_STATES.RENDERED, get rendered() { return this._state === RENDER_STATES.RENDERED; } };
}

describe("a parked greeting", () => {
	it("waits while another flow window is still open, then runs when the last one closes", async () => {
		const intro = trackCreationFlow(flowWindow(), "a1");
		const picker = trackCreationFlow(flowWindow(), "a1");
		const retry = vi.fn();
		holdGreetingUntilIdle("a2", retry);

		intro._state = RENDER_STATES.CLOSED;
		await flowWindowClosing(intro);
		await tick();
		expect(retry, "the picker is still up").not.toHaveBeenCalled();

		picker._state = RENDER_STATES.CLOSED;
		await flowWindowClosing(picker);
		await tick();
		expect(retry).toHaveBeenCalledTimes(1);
		expect(greetingHeld("a2")).toBe(false);
	});

	it("waits out a closing fade before counting the window gone", async () => {
		const win = trackCreationFlow(flowWindow(), "a3");
		const retry = vi.fn();
		holdGreetingUntilIdle("a4", retry);

		win._state = RENDER_STATES.CLOSING;
		const closing = flowWindowClosing(win);
		await tick();
		expect(retry).not.toHaveBeenCalled();

		win._state = RENDER_STATES.CLOSED;
		await closing;
		await tick();
		expect(retry).toHaveBeenCalledTimes(1);
	});

	it("ignores windows that were never part of a creation flow", async () => {
		const retry = vi.fn();
		holdGreetingUntilIdle("a5", retry);
		const live = trackCreationFlow(flowWindow(), "a6");

		await flowWindowClosing({ _state: RENDER_STATES.CLOSED });
		await tick();
		expect(retry).not.toHaveBeenCalled();

		live._state = RENDER_STATES.CLOSED;
		await flowWindowClosing(live);
		await tick();
		expect(retry).toHaveBeenCalledTimes(1);
	});
});
