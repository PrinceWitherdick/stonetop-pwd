import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	ownsForGreeting,
	dropStaleAutoOpen,
	registerAutoOpenForCleanup,
	MINT_OPTION,
} from "../../../module/actors/character/create-character.js";

// Who a minted character's `autoOpenFor` greeting may still reach, and the GM-side tidy that
// drops the flag once the sheet has been handed to someone else.

const OWNER = 3;
const SCOPE = "stonetop-pwd";

function character({ ownership = {}, autoOpenFor = null } = {}) {
	const actor = {
		id: "a1", type: "character", ownership,
		flags: { [SCOPE]: autoOpenFor ? { autoOpenFor } : {} },
		getFlag: (_s, key) => actor.flags[SCOPE][key],
		unsetFlag: vi.fn(async () => {}),
		testUserPermission: (user, level) => level === "OWNER" && (ownership[user.id] ?? ownership.default ?? 0) >= OWNER,
	};
	return actor;
}

let saved;
let gm, alice, bob;
beforeEach(() => {
	saved = { game: global.game, CONST: global.CONST, Hooks: global.Hooks };
	gm = { id: "gm", isGM: true, active: true, character: null };
	alice = { id: "alice", isGM: false, character: null };
	bob = { id: "bob", isGM: false, character: null };
	const users = [gm, alice, bob];
	users.get = id => users.find(u => u.id === id);
	global.game = { ...global.game, user: gm, users };
	global.CONST = { DOCUMENT_OWNERSHIP_LEVELS: { OWNER } };
});
afterEach(() => {
	global.game = saved.game;
	global.CONST = saved.CONST;
	global.Hooks = saved.Hooks;
});

describe("ownsForGreeting", () => {
	it("needs ownership made out by name, or an assignment the player can write", () => {
		expect(ownsForGreeting(character({ ownership: { alice: OWNER } }), alice)).toBe(true);
		alice.character = { id: "a1" };
		expect(ownsForGreeting(character(), alice), "assignment alone").toBe(false);
		expect(ownsForGreeting(character({ ownership: { default: OWNER } }), alice)).toBe(true);
	});

	it("is false for a character another player holds as theirs", () => {
		bob.character = { id: "a1" };
		expect(ownsForGreeting(character({ ownership: { alice: OWNER, bob: OWNER } }), alice)).toBe(false);
	});
});

describe("dropStaleAutoOpen", () => {
	it("drops the flag once the named player no longer owns the sheet", () => {
		const moved = character({ ownership: { bob: OWNER }, autoOpenFor: "alice" });
		dropStaleAutoOpen(moved);
		expect(moved.unsetFlag).toHaveBeenCalledWith(SCOPE, "autoOpenFor");
	});

	it("keeps it while the named player still owns it", () => {
		const fine = character({ ownership: { alice: OWNER }, autoOpenFor: "alice" });
		dropStaleAutoOpen(fine);
		expect(fine.unsetFlag).not.toHaveBeenCalled();
	});

	it("drops it for a player who has been deleted", () => {
		const orphan = character({ ownership: { carol: OWNER }, autoOpenFor: "carol" });
		dropStaleAutoOpen(orphan);
		expect(orphan.unsetFlag).toHaveBeenCalled();
	});

	it("leaves it to the primary GM", () => {
		game.user = alice;
		const moved = character({ ownership: { bob: OWNER }, autoOpenFor: "alice" });
		dropStaleAutoOpen(moved);
		expect(moved.unsetFlag).not.toHaveBeenCalled();
	});
});

describe("a copy of a minted character", () => {
	it("loses the greeting flag unless the create is a mint", () => {
		const handlers = {};
		global.Hooks = { on: (name, fn) => { handlers[name] = fn; } };
		registerAutoOpenForCleanup();
		const data = { flags: { [SCOPE]: { autoOpenFor: "alice" } } };

		const copy = { updateSource: vi.fn() };
		handlers.preCreateActor(copy, data, {});
		expect(copy.updateSource).toHaveBeenCalledWith({ [`flags.${SCOPE}.autoOpenFor`]: null });

		const mint = { updateSource: vi.fn() };
		handlers.preCreateActor(mint, data, { [MINT_OPTION]: true });
		expect(mint.updateSource).not.toHaveBeenCalled();
	});
});

describe("a copy of a character holding post-death records (audit LC-1)", () => {
	it("loses the host, manifestation, roll marker, kept-HP stamp and pending marker, and keeps the insert", () => {
		const handlers = {};
		global.Hooks = { on: (name, fn) => { handlers[name] = fn; } };
		registerAutoOpenForCleanup();
		const data = { flags: { [SCOPE]: {
			postDeathInsert: { slug: "ghost", manifest: ["Your touch can harm the living (ignores armor)"] },
			bodysnatcherHost: { uuid: "Actor.host", name: "Host" },
			deathsDoorRolling: { id: "undeath:abc" },
			undeathKeptHp: true,
			insertMovesPending: { slug: "ghost" },
		} } };

		const copy = { updateSource: vi.fn() };
		handlers.preCreateActor(copy, data, {});
		expect(copy.updateSource).toHaveBeenCalledTimes(1);
		const changes = copy.updateSource.mock.calls[0][0];
		expect(changes).toEqual({
			[`flags.${SCOPE}.-=bodysnatcherHost`]: null,
			[`flags.${SCOPE}.-=deathsDoorRolling`]: null,
			[`flags.${SCOPE}.-=undeathKeptHp`]: null,
			[`flags.${SCOPE}.-=insertMovesPending`]: null,
			[`flags.${SCOPE}.postDeathInsert.-=manifest`]: null,
		});
		expect(Object.keys(changes).some(k => k.endsWith("slug"))).toBe(false);
	});

	it("writes nothing for a copy with none of them", () => {
		const handlers = {};
		global.Hooks = { on: (name, fn) => { handlers[name] = fn; } };
		registerAutoOpenForCleanup();
		const copy = { updateSource: vi.fn() };
		handlers.preCreateActor(copy, { flags: { [SCOPE]: { postDeathInsert: { slug: "ghost" } } } }, {});
		expect(copy.updateSource).not.toHaveBeenCalled();
	});
});
