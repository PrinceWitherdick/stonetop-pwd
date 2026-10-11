// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach } from "vitest";

// A THREAD WITH NO PAGE YET, on a sheet's tab. A reader who can write it is handed the empty thread
// (their first entry mints the page); "waiting on your GM" is only for a reader who cannot. Before,
// the waiting notice showed under a working New Entry button.

const { TimelineWindow } = await import("../../module/dialogs/TimelineWindow.js");

let saved;
beforeEach(() => {
	saved = { ...global.game };
	global.game.settings = { get: () => undefined };
	global.game.journal = { contents: [] };
	global.game.folders = { contents: [] };
	global.game.actors = { get: () => null, find: () => null, contents: [] };
});
afterEach(() => { global.game = saved; });

const pageless = () => new TimelineWindow({ trackId: "pc-ellis", trackKind: "character", name: "Ellis" });

describe("a pageless thread", () => {
	it("is the empty thread to a reader who can write it", async () => {
		global.game.user = { isGM: true };
		const data = await pageless().getData();
		expect(data.canEdit).toBe(true);
		expect(data.awaitingGm).toBe(false);
	});

	it("is waiting on the GM for a reader who cannot", async () => {
		global.game.user = { isGM: false };
		const data = await pageless().getData();
		expect(data.canEdit).toBe(false);
		expect(data.awaitingGm).toBe(true);
	});
});
