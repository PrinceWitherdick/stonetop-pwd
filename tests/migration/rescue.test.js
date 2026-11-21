import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { findStrandedScope, rescueStrandedWorld, maybeRescueStrandedWorld } from "../../module/migration/rescue.js";
import { RESCUABLE_SOURCE_IDS, PRIOR_SYSTEM_IDS } from "../../module/migration/compat.js";
import { ITEM_FLAG_SCOPE, CUTOVER_KEY } from "../../module/system-id.js";
import { OLD_ID as OLD, NEW_ID as NEW, collection, settingsStorage } from "../fakes/migration.js";

vi.mock("../../module/utils/primary-gm.js", () => ({ isPrimaryGM: () => true, isActingPrimaryGM: () => !!globalThis.game?.user?.isGM }));
const setSetting = vi.fn().mockResolvedValue(undefined);
vi.mock("../../module/settings.js", () => ({ setSetting: (...a) => setSetting(...a) }));

const IDS = { sources: [OLD], target: NEW };

/** An actor whose Stonetop data never made it into the active scope. */
const stranded = (id = "a1") => ({ _id: id, flags: { [OLD]: { playbook: "Blessed" } } });
/** One the migration already carried across. */
const healthy = (id = "a2") => ({
	_id: id,
	flags: { [OLD]: { playbook: "Blessed" }, [NEW]: { playbook: "Blessed", [CUTOVER_KEY]: OLD } }
});

function makeWorld(actors, settings = []) {
	return {
		user: { isGM: true },
		actors: collection(actors),
		packs: [],
		settings: { storage: settingsStorage(settings) }
	};
}

describe("RESCUABLE_SOURCE_IDS", () => {
	// The hazard this whole constant exists for. "stonetop" is a former system id AND the
	// live scope for shipped compendium content, so copying it wholesale would stamp pack
	// content onto every item and journal page in the world.
	it("never offers ITEM_FLAG_SCOPE as something to copy from", () => {
		expect(PRIOR_SYSTEM_IDS).toContain(ITEM_FLAG_SCOPE);
		expect(RESCUABLE_SOURCE_IDS).not.toContain(ITEM_FLAG_SCOPE);
	});
});

describe("findStrandedScope", () => {
	it("finds a world whose actors never got copied across", () => {
		expect(findStrandedScope(makeWorld([stranded()]), IDS)).toBe(OLD);
	});

	it("is silent on a world that migrated properly", () => {
		expect(findStrandedScope(makeWorld([healthy()]), IDS)).toBeNull();
	});

	it("is silent on a world that never saw the old id at all", () => {
		expect(findStrandedScope(makeWorld([{ _id: "a3", flags: {} }]), IDS)).toBeNull();
	});

	it("is silent on an empty world", () => {
		expect(findStrandedScope(makeWorld([]), IDS)).toBeNull();
		expect(findStrandedScope({}, IDS)).toBeNull();
	});

	// An empty bag is not stranded data, and firing on one would run the whole repair, and
	// clear the sweep stamp, on every launch forever.
	it("ignores an empty flag bag under the old id", () => {
		expect(findStrandedScope(makeWorld([{ _id: "a4", flags: { [OLD]: {} } }]), IDS)).toBeNull();
	});

	it("finds one stranded actor among healthy ones", () => {
		expect(findStrandedScope(makeWorld([healthy("a1"), healthy("a2"), stranded("a3")]), IDS)).toBe(OLD);
	});

	// A GM's prep world can hold journals and scenes and no characters at all. Scanning
	// actors alone would leave map-pin data and journal flags stranded there forever.
	it("finds a world stranded only in its journals or scenes", () => {
		const world = makeWorld([]);
		world.journal = collection([{ _id: "j1", flags: { [OLD]: { pinned: true } } }]);
		expect(findStrandedScope(world, IDS)).toBe(OLD);

		const scenic = makeWorld([]);
		scenic.scenes = collection([{ _id: "s1", flags: { [OLD]: { pins: 2 } } }]);
		expect(findStrandedScope(scenic, IDS)).toBe(OLD);
	});

	// The sentinel walks collections that are already in memory. Loading world compendiums
	// on every launch to answer "is anything wrong?" would be the wrong trade.
	it("never touches world compendiums", () => {
		const world = makeWorld([healthy()]);
		world.packs = [{ metadata: { packageType: "world" }, locked: false, getDocuments: vi.fn() }];
		expect(findStrandedScope(world, IDS)).toBeNull();
		expect(world.packs[0].getDocuments).not.toHaveBeenCalled();
	});
});

describe("rescueStrandedWorld", () => {
	it("copies the stranded bag into the active scope and stamps it", async () => {
		const world = makeWorld([stranded()]);
		await rescueStrandedWorld(world, { source: OLD, target: NEW });

		const [updates] = world.actors.documentClass.updateDocuments.mock.calls[0];
		expect(updates[0].flags[NEW]).toEqual({ playbook: "Blessed", [CUTOVER_KEY]: OLD });
	});

	// The second hazard. By the time this runs the GM has been playing on the new id, so a
	// value already stored there is their current choice and the old one is a fossil.
	it("fills in missing settings but never overwrites one the world already has", async () => {
		const world = makeWorld([stranded()], [
			{ _id: "s1", key: `${OLD}.customMovesGmOnly`, _source: { value: "true" } },
			{ _id: "s2", key: `${OLD}.seedingComplete`,   _source: { value: "true" } },
			// Already set under the new id, to a different value. Must survive.
			{ _id: "s3", key: `${NEW}.customMovesGmOnly`, _source: { value: "false" } }
		]);
		await rescueStrandedWorld(world, { source: OLD, target: NEW });

		const io = world.settings.storage.get("world").documentClass;
		const [creates] = io.createDocuments.mock.calls[0];
		expect(creates).toEqual([{ key: `${NEW}.seedingComplete`, value: "true" }]);
		expect(io.updateDocuments).not.toHaveBeenCalled();
	});
});

describe("maybeRescueStrandedWorld", () => {
	beforeEach(() => {
		globalThis.ui = { notifications: { info: vi.fn() } };
		vi.spyOn(console, "warn").mockImplementation(() => {});
		vi.spyOn(console, "log").mockImplementation(() => {});
	});
	afterEach(() => {
		vi.restoreAllMocks();
		delete globalThis.ui;
	});

	it("does nothing for a player", async () => {
		const world = makeWorld([stranded()]);
		world.user = { isGM: false };
		expect(await maybeRescueStrandedWorld(world)).toMatchObject({ ran: false, reason: "not-primary-gm" });
		expect(world.actors.documentClass.updateDocuments).not.toHaveBeenCalled();
	});

	it("does nothing in a healthy world, and touches no document", async () => {
		const world = makeWorld([healthy()]);
		expect(await maybeRescueStrandedWorld(world)).toMatchObject({ ran: false, reason: "nothing-stranded" });
		expect(world.actors.documentClass.updateDocuments).not.toHaveBeenCalled();
		expect(globalThis.ui.notifications.info).not.toHaveBeenCalled();
	});
});
