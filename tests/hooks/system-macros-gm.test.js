import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { _ensureHotbarMacro, _ensureSystemMacros } from "../../module/hooks/Ready.js";
import { SYSTEM_ID } from "../../module/system-id.js";

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
	const list = Object.assign([...macros], { get: id => list.find(m => m.id === id) });
	const user = {
		hotbar: {},
		toObject() { return { hotbar: { ...user.hotbar } }; },
		async update() {},
		async assignHotbarMacro(m, slot) { if (m) user.hotbar[slot] = m.id; else delete user.hotbar[slot]; },
	};
	let n = 0;
	global.Macro = {
		create: vi.fn(async data => { const doc = macroDoc(`new${++n}`, data); list.push(doc); return doc; }),
		deleteDocuments: vi.fn(async () => {}),
	};
	// Past every re-snap, and no compendium or script file to seed the two directory macros from.
	const stored = { systemHotbarLayoutVersion: 999 };
	global.game = {
		...priorGame, macros: list, user, folders: [], packs: { get: () => undefined },
		settings: { get: (scope, key) => (scope === SYSTEM_ID ? stored[key] : undefined), set: async () => {} },
	};
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

describe("_ensureSystemMacros", () => {
	let priorFetch;
	beforeEach(() => { priorFetch = global.fetch; global.fetch = vi.fn(async () => ({ ok: false })); });
	afterEach(() => { global.fetch = priorFetch; });

	// One macro that will not create must not leave every macro after it off the bar.
	it("places the rest when one macro fails to create", async () => {
		world([]);
		const create = global.Macro.create;
		global.Macro.create = vi.fn(async data => {
			if (data.name === "Run an Expedition") throw new Error("create refused");
			return create(data);
		});
		const spy = vi.spyOn(console, "error").mockImplementation(() => {});
		await _ensureSystemMacros();
		spy.mockRestore();

		const names = global.game.macros.map(m => m.name);
		expect(names).not.toContain("Run an Expedition");
		expect(names).toEqual(expect.arrayContaining(["Welcome to Stonetop", "Die of Fate", "The Chronicle", "End of Session"]));
		expect(Object.values(global.game.user.hotbar)).toHaveLength(names.length);
	});
});
