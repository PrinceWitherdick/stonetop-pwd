import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { hiddenMirrorUpdates, installHiddenMirror } from "../../module/fight/fight-hidden.js";
import { fakeActor, fakeToken, fakeScene, fakeCombatant, fakeCombat, collection } from "../fakes/fight.js";

// FGT-1: core copies a token's `hidden` onto its combatant once, when the combatant is made, and never again. The
// fight shows a player only a fighter neither hides (fight-state.js#fighterOf), so a token revealed from its HUD
// left its foe out of every player's fight. The token now takes its rows with it.

/** A hooks stand-in that keeps each handler, so a test can fire it. */
function fakeHooks() {
	const handlers = new Map();
	return {
		on: (name, fn) => { handlers.set(name, fn); return name; },
		off: name => handlers.delete(name),
		fire: (name, ...args) => handlers.get(name)?.(...args),
		has: name => handlers.has(name),
	};
}

function ambush() {
	const crinwin = fakeToken({ id: "tCrin", hidden: true, actor: fakeActor({ id: "crinwin", type: "monster" }) });
	const bram = fakeToken({ id: "tBram", col: 1, actor: fakeActor({ id: "bram" }) });
	const scene = fakeScene({ tokens: [crinwin, bram] });
	const cCrin = fakeCombatant({ id: "cCrin", token: crinwin, scene, hidden: true });
	const cBram = fakeCombatant({ id: "cBram", token: bram, scene });
	const combat = fakeCombat({ scene, combatants: [cCrin, cBram] });
	combat.updateEmbeddedDocuments = vi.fn(async () => []);
	return { crinwin, scene, combat };
}

let saved;
beforeEach(() => { saved = globalThis.game; });
afterEach(() => { globalThis.game = saved; });

describe("hiddenMirrorUpdates", () => {
	it("brings every combatant on the token in line with it, in every fight, and nobody else", () => {
		const { crinwin, combat } = ambush();
		const other = fakeCombat({ id: "other", combatants: [] });
		expect(hiddenMirrorUpdates([combat, other], crinwin, false)).toEqual([{ combat, updates: [{ _id: "cCrin", hidden: false }] }]);
		// Already agreeing: nothing to write.
		expect(hiddenMirrorUpdates([combat], crinwin, true)).toEqual([]);
		expect(hiddenMirrorUpdates([combat], null, false)).toEqual([]);
	});
});

describe("installHiddenMirror", () => {
	it("writes on the primary GM's client alone, when a token's hidden changed", () => {
		const { crinwin, combat } = ambush();
		const hooks = fakeHooks();
		installHiddenMirror({ hooks });
		const gm = { id: "gm", isGM: true, active: true };
		globalThis.game = { user: gm, users: Object.assign(collection([gm]), { activeGM: gm }), combats: collection([combat]) };
		hooks.fire("updateToken", crinwin, { x: 100 });
		expect(combat.updateEmbeddedDocuments).not.toHaveBeenCalled();
		hooks.fire("updateToken", crinwin, { hidden: false });
		expect(combat.updateEmbeddedDocuments).toHaveBeenCalledWith("Combatant", [{ _id: "cCrin", hidden: false }]);
		// A player's client, and a second GM's, write nothing.
		combat.updateEmbeddedDocuments.mockClear();
		globalThis.game.user = { id: "player", isGM: false };
		hooks.fire("updateToken", crinwin, { hidden: false });
		const other = { id: "gm2", isGM: true, active: true };
		globalThis.game.user = other;
		hooks.fire("updateToken", crinwin, { hidden: false });
		expect(combat.updateEmbeddedDocuments).not.toHaveBeenCalled();
	});
});
