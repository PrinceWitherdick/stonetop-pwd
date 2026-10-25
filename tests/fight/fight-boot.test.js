import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { registerFightTab, stampFight, stampSide, refreshFightTab } from "../../module/fight/fight-boot.js";
import { snapshotFight } from "../../module/fight/fight-state.js";
import { fightVitalsKey } from "../../module/fight/fight-vitals.js";
import { SYSTEM_ID } from "../../module/system-id.js";
import { fakeActor, fakeToken, fakeScene, fakeCombatant, fakeCombat, collection } from "../fakes/fight.js";

// Turning the Fight tab on at init, and the two stamps it adds.

let saved;
let settings;
beforeEach(() => {
	saved = { game: globalThis.game, canvas: globalThis.canvas };
	settings = new Map();
	globalThis.game = {
		...saved.game,
		user: { id: "gm", isGM: true },
		users: collection([]),
		combats: collection([]),
		settings: { get: (scope, key) => { if (!settings.has(key)) throw new Error("unregistered"); return settings.get(key); } },
	};
});
afterEach(() => {
	globalThis.game = saved.game;
	globalThis.canvas = saved.canvas;
});

function fakeHooks() {
	const on = new Map();
	let id = 0;
	return {
		registered: on,
		on: (name, fn) => { on.set(name, [...(on.get(name) ?? []), fn]); return ++id; },
		off: () => {},
	};
}

class CombatTracker {}
const combatTab = () => ({ documentName: "Combat" });

describe("registerFightTab", () => {
	it("leaves core's Combat tab alone when the world has the Fight tab off, and only opens its window", () => {
		settings.set("fightTab", false);
		const config = { ui: { combat: CombatTracker, sidebar: { TABS: { combat: combatTab() } } } };
		const hooks = fakeHooks();
		expect(registerFightTab({ config, hooks, foundryNs: { applications: { sidebar: { tabs: { CombatTracker } } } } })).toBe(false);
		expect(config.ui.combat).toBe(CombatTracker);
		expect(config.ui.sidebar.TABS.combat.tooltip).toBeUndefined();
		// The window over core's tracker is the one piece that survives the switch (fight-window.js).
		expect(hooks.registered.has("createCombat")).toBe(true);
		expect(hooks.registered.has("closeCombatTracker")).toBe(true);
		// And the clean-up a fight's end owes (combat/readiness-loss.js): a core Combat is the fight then.
		for (const name of ["deleteCombat", "deleteCombatant", "updateActor"]) expect(hooks.registered.has(name), name).toBe(true);
		// Nothing else of ours: no stamps on what joins a combat, no watcher, no map overlay.
		for (const name of ["preCreateCombat", "preCreateCombatant", "refreshToken", "targetToken", "canvasPan", "canvasTearDown"]) {
			expect(hooks.registered.has(name)).toBe(false);
		}
	});

	it("reads an unregistered setting as off", () => {
		const config = { ui: { combat: CombatTracker } };
		expect(registerFightTab({ config, hooks: fakeHooks(), foundryNs: { applications: { sidebar: { tabs: { CombatTracker } } } } })).toBe(false);
		expect(config.ui.combat).toBe(CombatTracker);
	});

	it("swaps in the Fight tab, retitles it, and stamps what joins a fight", () => {
		settings.set("fightTab", true);
		const config = { ui: { combat: CombatTracker, sidebar: { TABS: { combat: combatTab() } } } };
		const hooks = fakeHooks();
		expect(registerFightTab({ config, hooks, foundryNs: { applications: { sidebar: { tabs: { CombatTracker } } } }, game: globalThis.game })).toBe(true);
		expect(config.ui.combat.prototype).toBeInstanceOf(CombatTracker);
		expect(config.ui.combat.name).toBe("FightTracker");
		expect(config.ui.sidebar.TABS.combat.tooltip).toBe("stonetop.fight.tab");
		expect(hooks.registered.get("preCreateCombat")).toEqual([stampFight]);
		expect(hooks.registered.get("preCreateCombatant")).toEqual([stampSide]);
		for (const name of ["updateToken", "targetToken", "updateActor", "refreshToken", "canvasPan", "canvasTearDown", "stonetopPaletteChanged", "ready"]) {
			expect(hooks.registered.has(name), name).toBe(true);
		}
		expect(typeof globalThis.game.stonetop.fight.sendAgainst).toBe("function");
	});

	it("builds the token class on whatever token class is configured, so a click can put the fight ring up", () => {
		settings.set("fightTab", true);
		class ModuleToken { _onUnclickLeft() {} }
		const config = { ui: { combat: CombatTracker }, Token: { objectClass: ModuleToken } };
		const hooks = fakeHooks();
		expect(registerFightTab({ config, hooks, foundryNs: { applications: { sidebar: { tabs: { CombatTracker } } } }, game: globalThis.game })).toBe(true);
		expect(config.Token.objectClass.prototype).toBeInstanceOf(ModuleToken);
		expect(config.Token.objectClass.name).toBe("StonetopToken");
		for (const name of ["canvasReady", "controlToken", "deleteToken"]) expect(hooks.registered.has(name), name).toBe(true);
	});

	it("leaves the token class alone with the Fight tab off", () => {
		settings.set("fightTab", false);
		class CoreToken {}
		const config = { ui: { combat: CombatTracker }, Token: { objectClass: CoreToken } };
		registerFightTab({ config, hooks: fakeHooks(), foundryNs: { applications: { sidebar: { tabs: { CombatTracker } } } } });
		expect(config.Token.objectClass).toBe(CoreToken);
	});

	it("does nothing without core's tracker class to build on", () => {
		settings.set("fightTab", true);
		const config = { ui: { combat: CombatTracker } };
		expect(registerFightTab({ config, hooks: fakeHooks(), foundryNs: {} })).toBe(false);
		expect(config.ui.combat).toBe(CombatTracker);
	});
});

describe("stampFight", () => {
	const combatDoc = (scene = null) => ({ scene, updateSource: vi.fn() });

	it("marks a new combat as a fight and ties it to the scene on the canvas", () => {
		globalThis.canvas = { scene: { id: "here" } };
		const combat = combatDoc();
		stampFight(combat, { active: true });
		expect(combat.updateSource).toHaveBeenCalledWith({ flags: { [SYSTEM_ID]: { fight: { v: 1 } } }, scene: "here" });
	});

	it("leaves a scene, or a deliberate lack of one, as it was given", () => {
		globalThis.canvas = { scene: { id: "here" } };
		const given = combatDoc();
		stampFight(given, { scene: "there" });
		expect(given.updateSource).toHaveBeenCalledWith({ flags: { [SYSTEM_ID]: { fight: { v: 1 } } } });
		const unlinked = combatDoc();
		stampFight(unlinked, { scene: null });
		expect(unlinked.updateSource.mock.calls[0][0]).not.toHaveProperty("scene");
	});

	it("does nothing to a combat already marked and placed", () => {
		globalThis.canvas = { scene: { id: "here" } };
		const combat = combatDoc({ id: "here" });
		stampFight(combat, { flags: { [SYSTEM_ID]: { fight: { v: 1 } } } });
		expect(combat.updateSource).not.toHaveBeenCalled();
	});
});

describe("stampSide", () => {
	it("works out a side for a combatant nobody gave one", () => {
		const scene = fakeScene();
		const combatant = fakeCombatant({ id: "c", scene, token: fakeToken({ id: "t", actor: fakeActor({ id: "a", type: "monster" }) }) });
		combatant.updateSource = vi.fn();
		stampSide(combatant, {});
		expect(combatant.updateSource).toHaveBeenCalledWith({ flags: { [SYSTEM_ID]: { side: "foes" } } });
	});

	it("keeps the side whoever added them chose", () => {
		const scene = fakeScene();
		const combatant = fakeCombatant({ id: "c", scene, token: fakeToken({ id: "t", actor: fakeActor({ id: "a", type: "monster" }) }) });
		combatant.updateSource = vi.fn();
		stampSide(combatant, { flags: { [SYSTEM_ID]: { side: "heroes" } } });
		expect(combatant.updateSource).not.toHaveBeenCalled();
	});

	it("leaves a steading or the GM Toolkit without one", () => {
		const scene = fakeScene();
		const combatant = fakeCombatant({ id: "c", scene, token: fakeToken({ id: "t", actor: fakeActor({ id: "s", type: "stonetop" }) }) });
		combatant.updateSource = vi.fn();
		stampSide(combatant, {});
		expect(combatant.updateSource).not.toHaveBeenCalled();
	});
});

describe("refreshFightTab", () => {
	function tabWithFight(signature) {
		const bram = fakeToken({ id: "tB", col: 0, row: 0, actor: fakeActor({ id: "b" }) });
		const scene = fakeScene({ tokens: [bram] });
		const combat = fakeCombat({ scene, combatants: [fakeCombatant({ id: "cB", token: bram, scene })] });
		return { rendered: true, viewed: combat, fightSignature: signature, render: vi.fn() };
	}

	it("redraws the tracker when the engagements changed", () => {
		const tab = tabWithFight("stale");
		refreshFightTab(tab);
		expect(tab.render).toHaveBeenCalledWith({ parts: ["tracker"] });
	});

	it("skips a redraw that would change nothing", () => {
		const tab = tabWithFight(null);
		tab.fightSignature = snapshotFight(tab.viewed, { scene: tab.viewed.scene }).result.signature;
		tab.fightVitals = fightVitalsKey(tab.viewed);
		refreshFightTab(tab);
		expect(tab.render).not.toHaveBeenCalled();
	});

	it("redraws when someone's HP or armor changed though the engagements did not", () => {
		const tab = tabWithFight(null);
		tab.fightSignature = snapshotFight(tab.viewed, { scene: tab.viewed.scene }).result.signature;
		tab.fightVitals = "stale";
		refreshFightTab(tab);
		expect(tab.render).toHaveBeenCalledWith({ parts: ["tracker"] });
	});

	it("leaves an undrawn tab, or a tab with no fight, alone", () => {
		const undrawn = { ...tabWithFight("stale"), rendered: false };
		refreshFightTab(undrawn);
		expect(undrawn.render).not.toHaveBeenCalled();
		const empty = { rendered: true, viewed: null, render: vi.fn() };
		refreshFightTab(empty);
		expect(empty.render).not.toHaveBeenCalled();
	});
});
