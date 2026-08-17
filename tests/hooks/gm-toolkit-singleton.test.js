import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { registerStonetopSingletonHooks } from "../../module/hooks/StonetopSingleton.js";

// The GM Toolkit is a world SINGLETON, on the same two hooks the steading uses.
//
// One rather than one-per-GM because nothing on the sheet is per-GM: the Moves and Core Loop tabs
// are reference transcribed from the playbook, the Threats and Sites tabs read their storage off
// the steading, and the "I wonder..." list on `system.wonders` is the world's open questions
// rather than any one GM's. A second toolkit would be a second
// window onto identical data, and would split that list. What does vary between gamemasters is which sheet their "C" key
// opens, and that is a flag on their own User document.
//
// Enforced in preCreateActor rather than in the Create-Actor picker because this is the only
// place that catches every path: a macro, a duplicate, a compendium import and a drag-drop all
// go through the hook and none of them go near the picker. The delete guard is what lets the
// ready hook stay a plain find-or-mint, so it is load-bearing rather than a nicety: with
// deletion refused, "no toolkit in this world" can only mean "never made one".

/** Capture the two hook handlers the module registers. */
function registerHooks() {
	const handlers = {};
	globalThis.Hooks = { on: vi.fn((event, fn) => { (handlers[event] ??= []).push(fn); }) };
	registerStonetopSingletonHooks();
	return {
		preCreate: (...args) => handlers.preCreateActor.map(fn => fn(...args)).find(r => r === false) ?? undefined,
		preDelete: (...args) => handlers.preDeleteActor.map(fn => fn(...args)).find(r => r === false) ?? undefined,
	};
}

const toolkit = (id = "t1") => ({ id, type: "gmToolkit" });
const steading = (id = "s1") => ({ id, type: "stonetop" });

let warn, saved;
beforeEach(() => {
	saved = { game: globalThis.game, ui: globalThis.ui, Hooks: globalThis.Hooks };
	warn = vi.fn();
	globalThis.ui = { notifications: { warn } };
	globalThis.game = { actors: [], user: { isGM: true } };
});
afterEach(() => {
	globalThis.game = saved.game;
	globalThis.ui = saved.ui;
	globalThis.Hooks = saved.Hooks;
});

describe("the GM Toolkit is one per world", () => {
	it("lets the first one through", () => {
		const hooks = registerHooks();
		expect(hooks.preCreate({ type: "gmToolkit" }, { type: "gmToolkit" }, {})).not.toBe(false);
		expect(warn).not.toHaveBeenCalled();
	});

	it("vetoes a second, and says why", () => {
		globalThis.game.actors = [toolkit()];
		const hooks = registerHooks();
		expect(hooks.preCreate({ type: "gmToolkit" }, { type: "gmToolkit" }, {})).toBe(false);
		expect(warn).toHaveBeenCalledWith(expect.stringContaining("already has a GM Toolkit"));
	});

	// A duplicate carries the source document's full data rather than a bare {name, type}, and a
	// compendium import carries `keepId`. Neither is a special case here: the count is the whole
	// rule, so every path that reaches preCreateActor is covered by the same line.
	it("vetoes a duplicate and a compendium import too", () => {
		globalThis.game.actors = [toolkit()];
		const hooks = registerHooks();
		const dupe = { type: "gmToolkit", name: "GM Toolkit (Copy)", _stats: { duplicateSource: "Actor.t1" } };
		expect(hooks.preCreate(dupe, dupe, {})).toBe(false);
		expect(hooks.preCreate({ type: "gmToolkit" }, { type: "gmToolkit" }, { keepId: true })).toBe(false);
	});

	it("leaves every other actor type alone", () => {
		globalThis.game.actors = [toolkit()];
		const hooks = registerHooks();
		for (const type of ["character", "npc", "follower"]) {
			expect(hooks.preCreate({ type }, { type }, {}), type).not.toBe(false);
		}
	});
});

describe("the GM Toolkit cannot be deleted away", () => {
	// The guard the ready hook's simplicity rests on. Without it, "no toolkit" would be
	// ambiguous between never-made and thrown-away, and telling those apart is what the
	// per-user mint latch used to be for.
	it("refuses to delete the only one", () => {
		const only = toolkit();
		globalThis.game.actors = [only];
		const hooks = registerHooks();
		expect(hooks.preDelete(only)).toBe(false);
		expect(warn).toHaveBeenCalledWith(expect.stringContaining("cannot be deleted"));
	});

	// A world that somehow acquired two (made before the create guard shipped) can be tidied
	// back down to one, which is the only way out of that state.
	it("allows deleting a duplicate down to the last", () => {
		const [a, b] = [toolkit("t1"), toolkit("t2")];
		globalThis.game.actors = [a, b];
		const hooks = registerHooks();
		expect(hooks.preDelete(b)).not.toBe(false);
	});

	// The hole a per-document count cannot see. Core walks a delete batch one document at a time
	// against the collection as it stands BEFORE any of them go, so "is there more than one?" was
	// true for BOTH halves of a two-toolkit selection and the world ended up with none — from
	// which nothing re-mints, because `gmToolkitAssigned` short-circuits the ready hook. Every
	// document in one batch shares one `options` object, which is what lets the guard tell "these
	// two deletes are one action" from "two separate deletes".
	it("keeps one back when both are deleted in a single batch", () => {
		const [a, b] = [toolkit("t1"), toolkit("t2")];
		globalThis.game.actors = [a, b];
		const hooks = registerHooks();
		const batch = {};

		expect(hooks.preDelete(a, batch)).not.toBe(false);
		expect(hooks.preDelete(b, batch)).toBe(false);
		expect(warn).toHaveBeenCalledWith(expect.stringContaining("cannot be deleted"));
	});

	// The order the batch happens to arrive in must not decide the answer: whichever is asked
	// LAST is the one refused, so the GM keeps the copy they did not select first.
	it("keeps the second back regardless of which is offered first", () => {
		const [a, b] = [toolkit("t1"), toolkit("t2")];
		globalThis.game.actors = [a, b];
		const hooks = registerHooks();
		const batch = {};

		expect(hooks.preDelete(b, batch)).not.toBe(false);
		expect(hooks.preDelete(a, batch)).toBe(false);
	});

	// Three at once still leaves one. A count-based guard would have let all three through.
	it("leaves one standing out of three", () => {
		const all = [toolkit("t1"), toolkit("t2"), toolkit("t3")];
		globalThis.game.actors = all;
		const hooks = registerHooks();
		const batch = {};

		const refused = all.filter(t => hooks.preDelete(t, batch) === false);
		expect(refused).toHaveLength(1);
	});

	// Two SEPARATE deletes are not one batch, and must not be treated as one: the first really
	// does leave a toolkit behind, so it is allowed, and the second is then the last one.
	it("treats separate deletes separately", () => {
		const [a, b] = [toolkit("t1"), toolkit("t2")];
		globalThis.game.actors = [a, b];
		const hooks = registerHooks();

		expect(hooks.preDelete(a, {})).not.toBe(false);
		globalThis.game.actors = [b]; // the first delete landed
		expect(hooks.preDelete(b, {})).toBe(false);
	});

	// A refused document is not gone, so it must not count as gone against the rest of its batch.
	// If it did, a selection of [only toolkit, some character] would refuse the toolkit and then
	// have nothing left to protect.
	it("does not count a refusal as a deletion", () => {
		const only = toolkit();
		globalThis.game.actors = [only];
		const hooks = registerHooks();
		const batch = {};

		expect(hooks.preDelete(only, batch)).toBe(false);
		expect(hooks.preDelete(only, batch)).toBe(false);
	});

	it("leaves every other actor type alone", () => {
		globalThis.game.actors = [toolkit()];
		const hooks = registerHooks();
		for (const type of ["character", "npc", "follower"]) {
			expect(hooks.preDelete({ id: "x", type }), type).not.toBe(false);
		}
	});
});

// The steading's own guards are older than the toolkit's and share the same two handlers, so
// these are here to catch a toolkit branch that swallowed the steading's.
describe("the steading's guards still hold", () => {
	it("vetoes a second steading and protects the last", () => {
		const only = steading();
		globalThis.game.actors = [only];
		const hooks = registerHooks();
		expect(hooks.preCreate({ type: "stonetop" }, { type: "stonetop" }, {})).toBe(false);
		expect(hooks.preDelete(only)).toBe(false);
	});

	it("lets the first steading through", () => {
		const hooks = registerHooks();
		expect(hooks.preCreate({ type: "stonetop" }, { type: "stonetop" }, {})).not.toBe(false);
	});

	// The batch guard is one shared helper, so the steading gets the same protection for free.
	// Worth pinning anyway: the steading is the older of the two and had the same hole.
	it("keeps one steading back when both are deleted in a single batch", () => {
		const [a, b] = [steading("s1"), steading("s2")];
		globalThis.game.actors = [a, b];
		const hooks = registerHooks();
		const batch = {};

		expect(hooks.preDelete(a, batch)).not.toBe(false);
		expect(hooks.preDelete(b, batch)).toBe(false);
	});
});
