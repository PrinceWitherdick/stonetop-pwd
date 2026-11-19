import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { _ensureHotbarMacro } from "../../module/hooks/Ready.js";

// The GM's macro pass finds each system macro by name AND command, the same match the re-snap and
// the player pass use. Found by name alone, a GM's own macro that happened to be called "Die of
// Fate" would be adopted as the system one: its icon overwritten, its ownership raised to everyone,
// and ours never created.

const DIE_OF_FATE = {
	name: "Die of Fate",
	img: "systems/stonetop-pwd/assets/icons/macros/die-of-fate.svg",
	command: "game.stonetop?.rollDieOfFate?.()",
	slot: 4, shared: true, playerSlot: 1,
};

function macroDoc(id, data) {
	const doc = { id, ownership: { default: 0 }, ...data };
	doc.update = vi.fn(async patch => {
		for (const [k, v] of Object.entries(patch)) {
			if (k === "ownership.default") doc.ownership.default = v; else doc[k] = v;
		}
	});
	return doc;
}

let priorGame, priorMacro, priorConst;
beforeEach(() => {
	priorGame = global.game;
	priorMacro = global.Macro;
	priorConst = global.CONST;
	global.CONST = { ...priorConst, DOCUMENT_OWNERSHIP_LEVELS: { NONE: 0, LIMITED: 1, OBSERVER: 2, OWNER: 3 } };
});
afterEach(() => {
	global.game = priorGame;
	global.Macro = priorMacro;
	global.CONST = priorConst;
});

function world(macros) {
	const list = [...macros];
	const user = {
		hotbar: {},
		async assignHotbarMacro(m, slot) { user.hotbar[slot] = m.id; },
	};
	let n = 0;
	global.Macro = {
		create: vi.fn(async data => { const doc = macroDoc(`new${++n}`, data); list.push(doc); return doc; }),
	};
	global.game = { ...priorGame, macros: list, user };
	return list;
}

describe("_ensureHotbarMacro", () => {
	it("leaves a GM's own same-named macro alone and creates the system one beside it", async () => {
		const theirs = macroDoc("theirs", { name: "Die of Fate", command: "ui.notifications.info('mine')", img: "my.png" });
		world([theirs]);
		await _ensureHotbarMacro(DIE_OF_FATE);

		expect(theirs.update).not.toHaveBeenCalled();
		expect(theirs.img).toBe("my.png");
		expect(theirs.ownership.default).toBe(0);
		expect(global.Macro.create).toHaveBeenCalledTimes(1);
		expect(global.Macro.create.mock.calls[0][0]).toMatchObject({ name: "Die of Fate", command: DIE_OF_FATE.command });
		expect(global.game.user.hotbar).toEqual({ 4: "new1" });
	});

	it("still adopts the system copy and refreshes its drifted icon and ownership", async () => {
		const ours = macroDoc("ours", { name: "Die of Fate", command: DIE_OF_FATE.command, img: "old.svg" });
		world([ours]);
		await _ensureHotbarMacro(DIE_OF_FATE);

		expect(ours.img).toBe(DIE_OF_FATE.img);
		expect(ours.ownership.default).toBe(2);
		expect(global.Macro.create).not.toHaveBeenCalled();
		expect(global.game.user.hotbar).toEqual({ 4: "ours" });
	});
});
