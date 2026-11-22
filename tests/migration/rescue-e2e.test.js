import { describe, it, expect, vi, beforeEach } from "vitest";
import { findStrandedScope, maybeRescueStrandedWorld } from "../../module/migration/rescue.js";
import { RESCUABLE_SOURCE_IDS } from "../../module/migration/compat.js";
import { SYSTEM_ID, ITEM_FLAG_SCOPE, CUTOVER_KEY } from "../../module/system-id.js";

// End-to-end against the PRODUCTION defaults: no ids passed anywhere, so this exercises
// exactly what Ready.js calls, with the real constants rather than fixtures. Writes are
// actually applied, so the idempotency claim is real rather than asserted.
vi.mock("../../module/utils/primary-gm.js", () => ({ isPrimaryGM: () => true, isActingPrimaryGM: () => !!globalThis.game?.user?.isGM }));
const setSetting = vi.fn().mockResolvedValue(undefined);
vi.mock("../../module/settings.js", () => ({ setSetting: (...a) => setSetting(...a) }));

// Derived, not hardcoded, so this file is meaningful in whichever tree it sits in. Empty in
// the bridge, where there is no prior id safe to copy from and the rescue is inert by
// construction, so there is nothing here to exercise.
const OLD = RESCUABLE_SOURCE_IDS[0];

/** Applies flag updates the way Foundry's deep merge would, so re-runs see the writes. */
function applying(docs) {
	const arr = [...docs];
	arr.documentClass = {
		updateDocuments: vi.fn(async (updates) => {
			for (const u of updates) {
				const doc = arr.find(d => d._id === u._id);
				for (const [scope, bag] of Object.entries(u.flags ?? {})) {
					doc.flags[scope] = { ...(doc.flags[scope] ?? {}), ...bag };
				}
			}
		})
	};
	return arr;
}

function embedded(parent, prop, docs) {
	parent[prop] = docs;
	parent.updateEmbeddedDocuments = vi.fn(async (_name, updates) => {
		for (const u of updates) {
			const doc = docs.find(d => d._id === u._id);
			for (const [scope, bag] of Object.entries(u.flags ?? {})) {
				doc.flags[scope] = { ...(doc.flags[scope] ?? {}), ...bag };
			}
		}
	});
	return parent;
}

/** The Forge world as it actually lands: everything still filed under the old id. */
function forgeWorld() {
	const actor = { _id: "a1", name: "Reva", flags: {
		[OLD]: { playbook: "Blessed", "inventory.checked": { rations: true }, arcana: { "mask-of-thorns": { boxes: 2 } } }
	} };
	embedded(actor, "items", [
		// A shipped compendium move: its ITEM_FLAG_SCOPE bag must NOT be copied anywhere.
		{ _id: "i1", flags: { [ITEM_FLAG_SCOPE]: { summary: "shipped content" } } },
		{ _id: "i2", flags: { [OLD]: { learned: false } } }
	]);
	const journal = embedded({ _id: "j1", name: "Log", flags: {} }, "pages",
		[{ _id: "p1", flags: { [ITEM_FLAG_SCOPE]: { checks: { c0: true } }, [OLD]: { pinned: true } } }]);
	const scene = embedded({ _id: "s1", name: "Stonetop", flags: {} }, "notes",
		[{ _id: "n1", flags: { [OLD]: { label: "The Old Stone" } } }]);
	scene.tokens = [];

	// Built once: `storage.get` must return the SAME collection every call, or the mock the
	// assertions read is not the one the run wrote to.
	const worldSettings = Object.assign([
		{ _id: "g1", key: `${OLD}.seedingComplete`,    _source: { value: "true" } },
		{ _id: "g2", key: `${OLD}.customMovesGmOnly`,  _source: { value: "true" } },
		{ _id: "g3", key: `${SYSTEM_ID}.customMovesGmOnly`, _source: { value: "false" } }
	], {
		documentClass: {
			createDocuments: vi.fn().mockResolvedValue([]),
			updateDocuments: vi.fn().mockResolvedValue([])
		}
	});

	return {
		user: { isGM: true },
		actors: Object.assign(applying([actor]), { invalidDocumentIds: new Set() }),
		items: applying([]),
		journal: applying([journal]),
		scenes: applying([scene]),
		packs: [],
		settings: { storage: { get: (s) => (s === "world" ? worldSettings : null) } },
		_docs: { actor, journal, scene }
	};
}

describe.skipIf(!OLD)("rescue, end to end on production defaults", () => {
	beforeEach(() => {
		globalThis.ui = { notifications: { info: vi.fn() } };
		globalThis.localStorage = { length: 0, key: () => null, getItem: () => null, setItem: () => {} };
		vi.spyOn(console, "warn").mockImplementation(() => {});
		vi.spyOn(console, "log").mockImplementation(() => {});
		setSetting.mockClear();
	});

	it("detects the stranded world using no arguments at all", () => {
		expect(findStrandedScope(forgeWorld())).toBe(OLD);
	});

	it("carries the campaign across, and is a no-op the second time", async () => {
		const world = forgeWorld();
		const first = await maybeRescueStrandedWorld(world);

		expect(first).toMatchObject({ ran: true, source: OLD });
		expect(world._docs.actor.flags[SYSTEM_ID]).toEqual({
			playbook: "Blessed",
			"inventory.checked": { rations: true },
			arcana: { "mask-of-thorns": { boxes: 2 } },
			[CUTOVER_KEY]: OLD
		});
		// Additive: the old bag is untouched, so a rollback still finds it.
		expect(world._docs.actor.flags[OLD].playbook).toBe("Blessed");

		// Embedded documents come too.
		expect(world._docs.actor.items[1].flags[SYSTEM_ID]).toMatchObject({ learned: false });
		expect(world._docs.journal.pages[0].flags[SYSTEM_ID]).toMatchObject({ pinned: true });
		expect(world._docs.scene.notes[0].flags[SYSTEM_ID]).toMatchObject({ label: "The Old Stone" });

		// The sweep stamp is cleared so phase 3 re-runs over what was just copied.
		expect(setSetting).toHaveBeenCalledWith("idMigrationFinishedFor", "");

		// Second launch: nothing left stranded, so it never even scans.
		expect(findStrandedScope(world)).toBeNull();
		expect(await maybeRescueStrandedWorld(world)).toMatchObject({ ran: false, reason: "nothing-stranded" });
	});

	// The hazard RESCUABLE_SOURCE_IDS exists for: shipped pack content lives under
	// ITEM_FLAG_SCOPE, and duplicating it into the system scope would corrupt the world.
	it("never copies shipped compendium content into the system scope", async () => {
		const world = forgeWorld();
		await maybeRescueStrandedWorld(world);

		const shippedMove = world._docs.actor.items[0];
		expect(shippedMove.flags[SYSTEM_ID]).toBeUndefined();
		expect(shippedMove.flags[ITEM_FLAG_SCOPE]).toEqual({ summary: "shipped content" });

		// The journal page had BOTH: its old-id bag copies, its pack-content bag does not.
		const page = world._docs.journal.pages[0];
		expect(page.flags[SYSTEM_ID]).toMatchObject({ pinned: true });
		expect(page.flags[SYSTEM_ID].checks).toBeUndefined();
		expect(page.flags[ITEM_FLAG_SCOPE]).toEqual({ checks: { c0: true } });
	});

	// The copy is the expensive, hard-to-redo part and it has already landed by then. The
	// sentinel will not fire again, so failing here would report a repair that plainly worked
	// as broken, and leave nothing to retry.
	it("still reports success when only the stamp clear fails", async () => {
		setSetting.mockRejectedValueOnce(new Error("settings not ready"));
		vi.spyOn(console, "error").mockImplementation(() => {});
		const world = forgeWorld();

		expect(await maybeRescueStrandedWorld(world)).toMatchObject({ ran: true, source: OLD });
		expect(world._docs.actor.flags[SYSTEM_ID]).toMatchObject({ playbook: "Blessed" });
	});

	it("restores the seed flags before Ready's seeders read them, without clobbering live choices", async () => {
		const world = forgeWorld();
		await maybeRescueStrandedWorld(world);

		const io = world.settings.storage.get("world").documentClass;
		const [creates] = io.createDocuments.mock.calls[0];
		expect(creates).toEqual([{ key: `${SYSTEM_ID}.seedingComplete`, value: "true" }]);
		// customMovesGmOnly already exists under the new id: the GM's current choice wins.
		expect(io.updateDocuments).not.toHaveBeenCalled();
	});
});
