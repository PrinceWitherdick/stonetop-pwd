import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ensurePlayerHotbarMacros } from "../../module/hooks/Ready.js";

// ensurePlayerHotbarMacros is the player half of onReady's macro pass: the GM's pass
// creates the shared macros (the Die of Fate) and grants everyone OBSERVER, and this
// only SLOTS the world macro that already exists. A player never creates one — a
// player-made copy would be a second document, one per player.

const DIE_OF_FATE = { name: "Die of Fate", command: "game.stonetop?.rollDieOfFate?.()" };

// A macro doc as the function reads it: `canExecute` stands in for the ownership grant
// (Foundry's Macro#canUserExecute is testUserPermission(user, "LIMITED")).
function macro(id, { name = DIE_OF_FATE.name, command = DIE_OF_FATE.command, canExecute = true, img } = {}) {
	return { id, name, command, canExecute, img };
}

// The slice of `game` the placement touches, with a hotbar that records assignments the
// way Foundry does — a sparse { slot: macroId } map on the player's own User document.
function world({ macros = [], hotbar = {} } = {}) {
	const user = {
		hotbar: { ...hotbar },
		async assignHotbarMacro(m, slot) { user.hotbar[slot] = m.id; },
	};
	return { macros, user };
}

let priorGame;
beforeEach(() => { priorGame = global.game; });
afterEach(() => { global.game = priorGame; });

describe("ensurePlayerHotbarMacros", () => {
	it("places the Die of Fate at slot 1 on an empty player hotbar", async () => {
		global.game = world({ macros: [macro("fate")] });
		await ensurePlayerHotbarMacros();
		expect(global.game.user.hotbar).toEqual({ 1: "fate" });
	});

	it("flows past an occupied slot 1 rather than evicting the player's own macro", async () => {
		global.game = world({ macros: [macro("fate")], hotbar: { 1: "mine", 2: "also-mine" } });
		await ensurePlayerHotbarMacros();
		expect(global.game.user.hotbar).toEqual({ 1: "mine", 2: "also-mine", 3: "fate" });
	});

	it("leaves a macro the player already rearranged where they put it", async () => {
		global.game = world({ macros: [macro("fate")], hotbar: { 7: "fate" } });
		await ensurePlayerHotbarMacros();
		expect(global.game.user.hotbar).toEqual({ 7: "fate" });
	});

	// A world whose GM has not loaded since the ownership grant shipped still has the macro
	// at ownership NONE. Slotting it there would put a dead icon on the bar; it fixes itself
	// on the player's next reload after the GM logs in.
	it("skips a macro the player cannot run", async () => {
		global.game = world({ macros: [macro("fate", { canExecute: false })] });
		await ensurePlayerHotbarMacros();
		expect(global.game.user.hotbar).toEqual({});
	});

	// Nothing to place before the GM's first load of a fresh world.
	it("does nothing when the macro does not exist yet", async () => {
		global.game = world();
		await ensurePlayerHotbarMacros();
		expect(global.game.user.hotbar).toEqual({});
	});

	// Keyed on name AND command, so a player's own macro named "Die of Fate" is not
	// mistaken for the system one (and left un-slotted in its place).
	it("ignores a same-named macro with a different command", async () => {
		global.game = world({ macros: [macro("theirs", { command: "ui.notifications.info('hi')" })] });
		await ensurePlayerHotbarMacros();
		expect(global.game.user.hotbar).toEqual({});
	});

	// Our copy with its command edited is still found as ours (name and icon), but what it runs is
	// the GM's now and may be GM-only, so it is left for the GM to put on a player's bar.
	it("does not place our copy once the GM has edited its command", async () => {
		global.game = world({ macros: [macro("edited", {
			command: "ui.notifications.info('gm only')",
			img: "systems/stonetop-pwd/assets/icons/macros/die-of-fate.svg",
		})] });
		await ensurePlayerHotbarMacros();
		expect(global.game.user.hotbar).toEqual({});
	});

	// GM-only macros carry no `shared` flag, so they never reach a player's bar.
	it("places only the shared macros, not the whole system set", async () => {
		global.game = world({
			macros: [macro("fate"), macro("letter", { name: "Write a Love Letter", command: "game.stonetop?.openLoveLetter?.()" })],
		});
		await ensurePlayerHotbarMacros();
		expect(Object.values(global.game.user.hotbar)).toEqual(["fate"]);
	});

	// Each placement is caught on its own, so one that fails leaves the next to be placed.
	it("places the next shared macro when one placement fails", async () => {
		const map = macro("map", { name: "Relationship Map", command: "game.stonetop?.openRelationshipMap?.()" });
		global.game = world({ macros: [macro("fate"), map] });
		const assign = global.game.user.assignHotbarMacro;
		global.game.user.assignHotbarMacro = async (m, slot) => {
			if (m.id === "fate") throw new Error("hotbar write refused");
			return assign(m, slot);
		};
		const spy = vi.spyOn(console, "error").mockImplementation(() => {});
		await ensurePlayerHotbarMacros();
		spy.mockRestore();
		expect(global.game.user.hotbar).toEqual({ 2: "map" });
	});
});
