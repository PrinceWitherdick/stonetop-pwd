// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// AN ACTOR DRAWN ON THE BOARD REPAINTS IT when its name, portrait or playbook changes: a lane says
// all three, and the page's own rename waits on the primary GM, who may not be online.

const { TimelineWindow } = await import("../../module/dialogs/TimelineWindow.js");
const { STONETOP_SCOPE } = await import("../../module/actors/character/StonetopFlags.js");
const { WBH_HERO_FLAG } = await import("../../module/actors/character/WouldBeHeroAsterisk.js");

let hooks, app, savedHooks, savedHas;
beforeEach(() => {
	hooks = new Map();
	savedHooks = { on: Hooks.on, off: Hooks.off };
	savedHas = foundry.utils.hasProperty;
	Hooks.on = (name, fn) => { hooks.set(name, fn); return name; };
	Hooks.off = (name) => hooks.delete(name);
	foundry.utils.hasProperty = (obj, path) => foundry.utils.getProperty(obj, path) !== undefined;
	app = new TimelineWindow();
	app._syncRepaint = vi.fn();
	app._drawnActorIds = new Set(["pc1"]);
	app._wireSync();
});
afterEach(() => {
	app._unwireSync();
	Object.assign(Hooks, savedHooks);
	foundry.utils.hasProperty = savedHas;
});

const update = (id, changes) => hooks.get("updateActor")({ id }, changes);

describe("the board's actor repaint", () => {
	it("repaints for a drawn actor's new name, portrait, playbook or hero cross-off", () => {
		update("pc1", { name: "Pim" });
		update("pc1", { img: "pim.webp" });
		update("pc1", { system: { playbook: { name: "The Seeker" } } });
		update("pc1", { flags: { [STONETOP_SCOPE]: { [WBH_HERO_FLAG]: true } } });
		expect(app._syncRepaint).toHaveBeenCalledTimes(4);
	});

	it("ignores an actor with no lane, and a change no lane shows", () => {
		update("npc9", { name: "Someone else" });
		update("pc1", { system: { hp: { value: 3 } } });
		expect(app._syncRepaint).not.toHaveBeenCalled();
	});

	// A thread's name is handed in when the window is built and titles it: the repaint alone would
	// draw the old one again.
	it("renames a single thread's window when its own actor is renamed", () => {
		app._unwireSync();
		app = new TimelineWindow({ trackId: "pc1", trackKind: "character", name: "Pim" });
		app._syncRepaint = vi.fn();
		app._trackActor = () => ({ id: "pc1" });
		app._drawnActorIds = new Set(["pc1"]);
		app._wireSync();
		hooks.get("updateActor")({ id: "pc1", name: "Pimmo" }, { name: "Pimmo" });
		expect(app._trackName).toBe("Pimmo");
		expect(app._syncRepaint).toHaveBeenCalledTimes(1);
	});

	it("comes off with the rest of the sync hooks", () => {
		app._unwireSync();
		expect(hooks.has("updateActor")).toBe(false);
	});
});
