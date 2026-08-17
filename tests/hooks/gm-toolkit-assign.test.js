import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { _ensureGmToolkit, _assignGmToolkitToGm, _registerGmToolkitAdopt } from "../../module/hooks/Ready.js";
// The same constant Ready.js reaches for. Imported rather than written out: the flag scope is
// the pre-rename package id, not SYSTEM_ID, and a fake that guessed would answer `undefined` to
// every getFlag and make each of these gates look permanently open.
import { STONETOP_SCOPE } from "../../module/actors/character/StonetopFlags.js";
import { GM_TOOLKIT_DEFAULT_IMG } from "../../module/actors/gmtoolkit/gm-toolkit-actor.js";

// A GM gets their own GM Toolkit, minted once, and it becomes what core's "C" hotkey opens
// (game.toggleCharacterSheet renders `game.user.character` when no token is controlled).
//
// The steading used to hold that slot, from before the GM had a sheet of their own. Moving it
// is the part with teeth: a GM who set their OWN character must never be overwritten, and a GM
// who is on the steading because WE put them there should be carried across rather than left
// on a sheet that no longer holds their prep. The two are told apart by the `gmSteadingAssigned`
// flag, which is the only record that the assignment was ours.
//
// Every gate is a per-USER WORLD flag rather than a client setting: a client setting is keyed
// only by namespace.key in localStorage, so it leaks across every world on the browser and a
// fresh world reads it already-set, silently skipping the assignment.

// "Mine" is an EXPLICIT per-user ownership entry, never `isOwner`: Foundry grants every GM
// OWNER on every document, so a permission test is true for every toolkit in the world and a
// fake that set `isOwner: false` would be pinning a state no real GM client can observe.
const GM_USER_ID  = "gm1";
const OTHER_GM_ID = "gm2";
const OWNER = 3;
const NONE  = 0;

// A `game.users` shaped the way isPrimaryGM() reads it. Only built when a test names a primary,
// because "no active GM at all" is how that helper spells "this lone client is it" — which is the
// state every case below except the co-GM ones is actually in.
function usersWithPrimary(primaryId) {
	return {
		activeGM: { id: primaryId },
		find: () => ({ id: primaryId, active: true, isGM: true }),
	};
}

function world({ isGM = true, character = null, flags = {}, actors = [], id = GM_USER_ID,
	primaryGM = null } = {}) {
	const created = [];
	const updates = [];
	const setFlags = {};

	const user = {
		id,
		isGM,
		character,
		getFlag: (scope, key) => (scope === STONETOP_SCOPE ? flags[key] : undefined),
		setFlag: vi.fn(async (scope, key, value) => { setFlags[key] = value; flags[key] = value; }),
		// Applies any flags carried in the update, so a latch written as part of a document
		// update is visible to `getFlag` exactly as a `setFlag` one would be. The assertions
		// below therefore ask what the flag ENDED UP as rather than which call set it — the
		// assignment and its latch are deliberately one write, and that is an implementation
		// choice a test should not have to be rewritten for.
		update: vi.fn(async data => {
			updates.push(data);
			for (const [key, value] of Object.entries(data?.flags?.[STONETOP_SCOPE] ?? {})) {
				setFlags[key] = value;
				flags[key] = value;
			}
		}),
	};

	globalThis.game = {
		user,
		actors,
		i18n: { localize: k => (k === "TYPES.Actor.gmToolkit" ? "GM Toolkit" : k) },
		...(primaryGM ? { users: usersWithPrimary(primaryGM) } : {}),
	};
	globalThis.CONST = { DOCUMENT_OWNERSHIP_LEVELS: { NONE, OWNER } };
	globalThis.Actor = {
		create: vi.fn(async data => {
			// StonetopActor#_preCreate stamps `ownership.default = NONE` plus the creator as
			// OWNER on every creation path; `Actor.create` here never runs the document
			// lifecycle, so the fake stands in for it.
			const doc = actorDoc({
				...data,
				id: `toolkit${created.length + 1}`,
				ownership: { default: NONE, [user.id]: OWNER },
			});
			created.push(doc);
			actors.push(doc);
			return doc;
		}),
	};
	return { user, created, updates, setFlags, actors };
}

/** An actor whose `update` applies dotted writes, so an unwanted one shows up as a mutation. */
function actorDoc(props) {
	const doc = { ...props };
	doc.update = vi.fn(async data => {
		for (const [key, value] of Object.entries(data ?? {})) {
			const [field, sub] = key.split(".");
			if (sub === undefined) doc[field] = value;
			else doc[field] = { ...(doc[field] ?? {}), [sub]: value };
		}
		return doc;
	});
	return doc;
}

// `img` is set because a toolkit in any current world has one: _ensureGmToolkit heals a stock
// default up to the shipped portrait, once (see tests/actors/gmtoolkit/gm-toolkit-portrait.test.js).
// A fixture left on Foundry's mystery-man would be a world mid-upgrade, and every "writes nothing
// to the one it finds" assertion below would be measuring that heal instead of what it means to.
const toolkit = ({ owner = GM_USER_ID, ...over } = {}) => actorDoc({
	id: "t1",
	type: "gmToolkit",
	img: GM_TOOLKIT_DEFAULT_IMG,
	ownership: { default: NONE, ...(owner ? { [owner]: OWNER } : {}) },
	...over,
});
const steading = (over = {}) => actorDoc({ id: "s1", type: "stonetop", ...over });

let saved;
beforeEach(() => { saved = { game: globalThis.game, Actor: globalThis.Actor, CONST: globalThis.CONST }; });
afterEach(() => {
	globalThis.game = saved.game;
	globalThis.Actor = saved.Actor;
	globalThis.CONST = saved.CONST;
});

describe("_ensureGmToolkit", () => {
	it("mints one, named from the localized type label", async () => {
		const w = world();
		const made = await _ensureGmToolkit();
		expect(w.created).toHaveLength(1);
		expect(w.created[0].type).toBe("gmToolkit");
		expect(w.created[0].name).toBe("GM Toolkit");
		expect(made).toBe(w.created[0]);
	});

	it("adopts the world's toolkit instead of minting a second", async () => {
		const existing = toolkit();
		const w = world({ actors: [existing] });
		expect(await _ensureGmToolkit()).toBe(existing);
		expect(w.created).toHaveLength(0);
	});

	// ONE per world, not one per GM: whichever GM loads first mints it, and every gamemaster
	// after that finds the same sheet. Nothing on it is per-GM (empty schema, transcribed move
	// lists, prep stored on the steading), so a second would be a second window onto identical
	// data. Pinned from the SECOND GM's side, since that is the load that would duplicate.
	it("gives a second GM the same toolkit, not one of their own", async () => {
		const first = toolkit({ id: "world-toolkit" });
		const w = world({ actors: [first], id: OTHER_GM_ID });
		expect(await _ensureGmToolkit()).toBe(first);
		expect(w.created).toHaveLength(0);
	});

	// ...and it writes nothing to the one it finds. There is no per-user ownership to claim,
	// which is the point: `isOwner` is true for every GM on every document, so an ownership
	// test could never have told two gamemasters' sheets apart anyway.
	it("adopts without writing to the toolkit", async () => {
		const existing = toolkit();
		world({ actors: [existing] });
		await _ensureGmToolkit();
		expect(existing.update).not.toHaveBeenCalled();
	});

	// No once-per-user latch at all, and the delete guard is what pays for it: with deletion
	// refused (hooks/StonetopSingleton.js), "no toolkit in this world" can only mean "never made
	// one", so there is no thrown-away sheet to avoid resurrecting and no flag that could jam
	// the gate shut by conflating "already minted" with "could not mint".
	it("keeps no mint latch on the user", async () => {
		const w = world();
		await _ensureGmToolkit();
		expect(w.setFlags.gmToolkitMinted).toBeUndefined();
		expect(w.user.setFlag).not.toHaveBeenCalledWith(STONETOP_SCOPE, "gmToolkitMinted", true);
	});

	// A transient failure must retry on the next load.
	it("leaves the gate open when the create fails", async () => {
		const w = world();
		globalThis.Actor.create = vi.fn(async () => { throw new Error("no"); });
		const spy = vi.spyOn(console, "error").mockImplementation(() => {});
		expect(await _ensureGmToolkit()).toBeNull();
		expect(w.created).toHaveLength(0);
		spy.mockRestore();
	});
});

// Minting is a shared-world write, so exactly one client may do it — the rule utils/primary-gm.js
// exists to state and the steading has followed all along (ensureStonetopSingleton).
//
// The preCreateActor veto cannot stand in for this: it counts the INITIATING client's game.actors,
// so two GMs whose `ready` lands inside the same broadcast window each read zero and each pass.
// That is not a theoretical window either — it is a fresh world's first load with a co-GM present,
// and its cost is two toolkits with the world's "I wonder..." list split across them.
describe("only the primary GM mints", () => {
	it("mints when this client is the designated primary", async () => {
		const w = world({ primaryGM: GM_USER_ID });
		expect(await _ensureGmToolkit()).toBe(w.created[0]);
		expect(w.created).toHaveLength(1);
	});

	it("mints for a lone GM, who is primary by default", async () => {
		// No `game.users` at all: isPrimaryGM() answers true rather than deadlocking a solo world.
		const w = world();
		await _ensureGmToolkit();
		expect(w.created).toHaveLength(1);
	});

	it("does not mint on a second GM's client", async () => {
		const w = world({ id: OTHER_GM_ID, primaryGM: GM_USER_ID });
		expect(await _ensureGmToolkit()).toBeNull();
		expect(w.created).toHaveLength(0);
	});

	// The gate is on the MINT, not on finding one. A co-GM must still be handed the toolkit that
	// already exists — otherwise the guard would cost every GM but one their "C" key.
	it("still adopts an existing toolkit on a second GM's client", async () => {
		const existing = toolkit({ id: "world-toolkit" });
		const w = world({ actors: [existing], id: OTHER_GM_ID, primaryGM: GM_USER_ID });
		expect(await _ensureGmToolkit()).toBe(existing);
		expect(w.created).toHaveLength(0);
	});

	// Empty-handed is not failed: the latch stays unset so the next load asks again, exactly as
	// it does for a create that threw. Between now and then, _registerGmToolkitAdopt covers it.
	it("leaves the assignment latch unset when it could not mint", async () => {
		const w = world({ id: OTHER_GM_ID, primaryGM: GM_USER_ID });
		await _assignGmToolkitToGm();
		expect(w.setFlags.gmToolkitAssigned).toBeUndefined();
		expect(w.updates).toHaveLength(0);
	});
});

// The co-GM's other half. Only the primary mints, so a second GM whose `ready` ran first has
// nothing to be assigned; rather than leave them until they reload, take the assignment the
// moment the primary's create broadcasts.
describe("_registerGmToolkitAdopt", () => {
	/** Register the hook and hand back the handler it installed. */
	function adoptHandler() {
		let handler = null;
		globalThis.Hooks = { on: vi.fn((event, fn) => { if (event === "createActor") handler = fn; }) };
		_registerGmToolkitAdopt();
		return handler;
	}

	afterEach(() => { delete globalThis.Hooks; });

	it("assigns a toolkit another GM just made", async () => {
		const made = toolkit({ id: "world-toolkit" });
		const w = world({ id: OTHER_GM_ID, primaryGM: GM_USER_ID });
		const onCreate = adoptHandler();

		w.actors.push(made); // the create landed in game.actors before the hook fired
		await onCreate(made, {}, GM_USER_ID);

		expect(w.updates[0].character).toBe(made.id);
		expect(w.setFlags.gmToolkitAssigned).toBe(true);
	});

	// `createActor` fires from inside the create's own response handling, BEFORE Actor.create
	// resolves. Without this the primary's own mint would re-enter _assignGmToolkitToGm while the
	// outer call is still mid-flight, and both halves would write the same User update.
	it("ignores the create this client initiated", async () => {
		const made = toolkit();
		const w = world({ actors: [made], primaryGM: GM_USER_ID });
		const onCreate = adoptHandler();

		await onCreate(made, {}, GM_USER_ID);
		expect(w.updates).toHaveLength(0);
	});

	it("ignores every other actor type, and every non-GM client", async () => {
		const w = world({ id: OTHER_GM_ID, primaryGM: GM_USER_ID });
		const onCreate = adoptHandler();

		await onCreate(steading(), {}, GM_USER_ID);
		expect(w.updates).toHaveLength(0);

		const player = world({ isGM: false, id: OTHER_GM_ID, primaryGM: GM_USER_ID });
		const onCreateAsPlayer = adoptHandler();
		await onCreateAsPlayer(toolkit(), {}, GM_USER_ID);
		expect(player.updates).toHaveLength(0);
	});
});

describe("_assignGmToolkitToGm", () => {
	it("puts the toolkit behind C for a GM with no character", async () => {
		const w = world();
		await _assignGmToolkitToGm();
		expect(w.updates).toHaveLength(1);
		expect(w.updates[0].character).toBe(w.created[0].id);
		expect(w.setFlags.gmToolkitAssigned).toBe(true);
	});

	// One write, not two. The character and the latch that says it was assigned have to land
	// together: separately, a failure between them re-assigns an already-assigned character on
	// every later load.
	it("writes the assignment and its latch together", async () => {
		const w = world();
		await _assignGmToolkitToGm();
		expect(w.updates).toEqual([{
			character: w.created[0].id,
			flags: { [STONETOP_SCOPE]: { gmToolkitAssigned: true } },
		}]);
	});

	// The steading held this slot before the toolkit existed, and that assignment was ours.
	it("carries a GM across from the steading we assigned them", async () => {
		const w = world({
			character: steading(),
			flags: { gmSteadingAssigned: true },
		});
		await _assignGmToolkitToGm();
		expect(w.updates).toHaveLength(1);
		expect(w.updates[0].character).toBe(w.created[0].id);
	});

	// ...but only when it WAS ours. A GM who picked the steading by hand keeps it.
	it("leaves a steading the GM chose themselves alone", async () => {
		const w = world({ character: steading() });
		await _assignGmToolkitToGm();
		expect(w.updates).toHaveLength(0);
		expect(w.setFlags.gmToolkitAssigned).toBe(true);
	});

	it("never overwrites a GM who runs their own character", async () => {
		const w = world({
			character: { id: "pc1", type: "character" },
			flags: { gmSteadingAssigned: true },
		});
		await _assignGmToolkitToGm();
		expect(w.updates).toHaveLength(0);
		expect(w.setFlags.gmToolkitAssigned).toBe(true);
	});

	// A GM who clears the assignment afterwards stays cleared.
	it("stays quiet once it has run", async () => {
		const w = world({ flags: { gmToolkitAssigned: true } });
		await _assignGmToolkitToGm();
		expect(w.updates).toHaveLength(0);
		expect(w.created).toHaveLength(0);
	});

	it("retries next load if the assignment write fails", async () => {
		const w = world();
		w.user.update = vi.fn(async () => { throw new Error("no"); });
		const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
		await _assignGmToolkitToGm();
		expect(w.setFlags.gmToolkitAssigned).toBeUndefined();
		spy.mockRestore();
	});

	// ...and the retry has to actually WORK, which is a separate fact from leaving the flag
	// unset. The first load minted the toolkit and then failed to assign it, so the second load
	// must find that sheet and put it behind C rather than either minting a duplicate or
	// deciding there is nothing to assign. If it did neither, the GM's C key stays dead forever
	// and no error is ever logged, which is why this is pinned.
	it("completes the assignment on the load after a failed one", async () => {
		const w = world();
		w.user.update = vi.fn(async () => { throw new Error("no"); });
		const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
		await _assignGmToolkitToGm();
		spy.mockRestore();

		// Second load: same world, same user, the minted toolkit still sitting there.
		const minted = w.created[0];
		expect(minted, "nothing was minted on the first load").toBeTruthy();
		w.user.update = vi.fn(async data => { w.updates.push(data); });
		await _assignGmToolkitToGm();

		expect(w.created, "minted a second toolkit instead of adopting the first").toHaveLength(1);
		expect(w.updates.at(-1).character).toBe(minted.id);
	});
});
