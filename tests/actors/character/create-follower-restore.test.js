import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { CreateFollowerDialog, applyCustomFollower } from "../../../module/actors/character/dialogs/CreateFollowerDialog.js";
import {
	CREATE_FOLLOWER_WINDOW_CLASS, reopenCreateFollower,
} from "../../../module/actors/character/dialogs/create-follower-restore.js";

// A reload brings Create a Follower back (create-follower-restore.js, by way of
// utils/window-restore.js) on the step it was left on with every answer; with no sheet waiting on it
// then, finishing stores the follower on the character itself.

function character({ owner = true, followers = {} } = {}) {
	return {
		uuid: "Actor.hero", documentName: "Actor", isOwner: owner,
		getFlag: vi.fn(() => followers),
		update: vi.fn(async () => {}),
		sheet: { _steadingResidentNames: () => ["Ade", "Bryn"] },
	};
}

beforeEach(() => {
	vi.stubGlobal("ui", { notifications: { info: vi.fn() } });
});
afterEach(() => vi.unstubAllGlobals());

describe("Create a Follower across a reload", () => {
	it("is restored under the class name its hooks are built from, keyed by the character", () => {
		expect(CreateFollowerDialog.name).toBe(CREATE_FOLLOWER_WINDOW_CLASS);
		expect(new CreateFollowerDialog(character(), null).restoreKey).toBe("createFollower:Actor.hero");
		expect(new CreateFollowerDialog({ uuid: "Compendium.x.Actor.y", pack: "x" }, null).restoreKey).toBeNull();
	});

	it("comes back on its step with every answer, and still counts as unsaved", async () => {
		const actor = character();
		vi.stubGlobal("fromUuid", async () => actor);
		const left = new CreateFollowerDialog(actor, () => {});
		Object.assign(left._sel, { name: "Wren", instinct: "To wander off", tags: ["brave", "cautious"], gear: [{ label: "a spear" }], isGroup: true, groupSize: 4 });
		left._step = 5;
		const view = JSON.parse(JSON.stringify(left.restoreView));
		expect(view.step).toBe("instinct");

		const back = await reopenCreateFollower("createFollower:Actor.hero");
		expect(back._residentNames).toEqual(["Ade", "Bryn"]);
		back._takeRestoredView(view);
		expect(back._sel).toMatchObject({ name: "Wren", instinct: "To wander off", tags: ["brave", "cautious"], gear: [{ label: "a spear" }], isGroup: true, groupSize: 4 });
		expect(back._step).toBe(5);
		expect(back._pristineWork).toBeDefined();
	});

	it("ignores what doesn't fit the shape it keeps", () => {
		const back = new CreateFollowerDialog(character(), null);
		back._takeRestoredView({ step: "nowhere", sel: { name: 7, tags: "brave", gear: [{ label: 3 }, "x", { label: "rope" }], hpBase: "tough" } });
		expect(back._sel.name).toBe("");
		expect(back._sel.tags).toEqual([]);
		expect(back._sel.gear).toEqual([{ label: "rope" }]);
		expect(back._sel.hpBase).toBe("tough");
		expect(back._step).toBe(0);
	});

	it("stays shut for a character that's gone or that this user can't edit", async () => {
		vi.stubGlobal("fromUuid", async () => null);
		expect(await reopenCreateFollower("createFollower:Actor.gone")).toBeNull();
		vi.stubGlobal("fromUuid", async () => character({ owner: false }));
		expect(await reopenCreateFollower("createFollower:Actor.hero")).toBeNull();
		expect(await reopenCreateFollower("camp:Actor.hero")).toBeNull();
	});

	it("stores the follower on the character when it finishes after a reload", async () => {
		const actor = character({ followers: { a: { order: 10 } } });
		vi.stubGlobal("fromUuid", async () => actor);
		const back = await reopenCreateFollower("createFollower:Actor.hero");
		back._takeRestoredView({ step: "equip", sel: { name: "Wren" } });
		back.close = vi.fn();
		await back._finish();
		expect(actor.update).toHaveBeenCalledTimes(1);
		const [[changes]] = actor.update.mock.calls;
		const [[key, stored]] = Object.entries(changes);
		expect(key).toMatch(/^flags\.stonetop-pwd\.customFollowers\.\w{16}$/);
		expect(stored).toMatchObject({ name: "Wren" });
		expect(stored.order).toBeGreaterThan(10);
		expect(back.close).toHaveBeenCalledWith({ discard: true });
	});

	it("stores nothing for no follower", async () => {
		const actor = character();
		await applyCustomFollower(actor, null);
		expect(actor.update).not.toHaveBeenCalled();
	});
});
