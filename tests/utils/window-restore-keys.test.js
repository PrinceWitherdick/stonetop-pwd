// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { docOrNewKey, readDocOrNewKey, persistOnTyping, NEW_WINDOW_PREFIX } from "../../module/utils/window-restore.js";

// The small pieces every restorable window shares (utils/window-restore.js): the key of a window over
// a saved document or a new one, read back by its reopener, and the save-soon wiring on typing.

beforeEach(() => vi.stubGlobal("game", { settings: { get: () => false } }));
afterEach(() => vi.unstubAllGlobals());

describe("a key over a saved document or a new one", () => {
	it("is the document's uuid once saved, else the new window's id", () => {
		expect(docOrNewKey("loveLetter", { uuid: "Actor.a.Item.i" }, "w1")).toBe("loveLetter:Actor.a.Item.i");
		expect(docOrNewKey("loveLetter", null, "w1")).toBe(`loveLetter:${NEW_WINDOW_PREFIX}w1`);
	});

	it("reads back to the document, or to the new window's id", async () => {
		const item = { uuid: "Actor.a.Item.i" };
		vi.stubGlobal("fromUuid", async uuid => (uuid === item.uuid ? item : null));
		expect(await readDocOrNewKey("Actor.a.Item.i")).toEqual({ doc: item, newId: null });
		expect(await readDocOrNewKey("Actor.a.Item.gone")).toEqual({ doc: null, newId: null });
		expect(await readDocOrNewKey("new-w1")).toEqual({ doc: null, newId: "w1" });
		expect(await readDocOrNewKey("new-")).toEqual({ doc: null, newId: null });
	});

	it("takes a uuid that fails to resolve as gone", async () => {
		vi.stubGlobal("fromUuid", async () => { throw new Error("bad uuid"); });
		expect(await readDocOrNewKey("Nonsense")).toEqual({ doc: null, newId: null });
	});
});

describe("saving soon as a window is typed in", () => {
	it("follows input and change, and clicks only when asked", () => {
		const root = document.createElement("div");
		const typed = vi.fn();
		persistOnTyping(root, { onEach: typed });
		for (const type of ["input", "change", "click"]) root.dispatchEvent(new Event(type));
		expect(typed).toHaveBeenCalledTimes(2);

		const clicked = vi.fn();
		const other = document.createElement("div");
		persistOnTyping(other, { clicks: true, onEach: clicked });
		for (const type of ["input", "change", "click"]) other.dispatchEvent(new Event(type));
		expect(clicked).toHaveBeenCalledTimes(3);
	});

	it("does nothing with no root", () => {
		expect(() => persistOnTyping(null)).not.toThrow();
	});
});
