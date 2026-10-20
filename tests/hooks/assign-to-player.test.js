import { beforeEach, describe, expect, it, vi } from "vitest";
import { assignToPlayer, assignToPlayerEntry, registerAssignToPlayer } from "../../module/hooks/assign-to-player.js";
import { stubAsk } from "../fakes/confirm.js";

// A GM hands any actor (an NPC, usually) to a player from the Actors sidebar, since User
// Configuration's dropdown now offers playbook characters only.

const OWNER = 3;

function user(id, { isGM = false, character = null } = {}) {
	return { id, name: id[0].toUpperCase() + id.slice(1), isGM, character,
		update: vi.fn(async function (data) {
			if ("character" in data) this.character = data.character ? actors[data.character] : null;
		}) };
}
function actor(id, type, owners = []) {
	return { id, name: id, type, owners: new Set(owners),
		testUserPermission(u, level) { return level === "OWNER" && this.owners.has(u.id); },
		update: vi.fn(async () => {}) };
}

let actors, users;
const row = id => ({ dataset: { entryId: id } });

beforeEach(() => {
	actors = {
		npc: actor("npc", "npc"),
		pc: actor("pc", "character", ["wren"]),
		home: actor("home", "stonetop"),
		kit: actor("kit", "gmToolkit"),
		town: actor("town", "settlement"),
		mod: actor("mod", "vehicle"),
		beast: actor("beast", "monster"),
	};
	users = [user("gm", { isGM: true }), user("wren", { character: actors.pc }), user("ash")];
	global.game = {
		user: users[0],
		actors: { get: id => actors[id] },
		users: { filter: fn => users.filter(fn), find: fn => users.find(fn) },
	};
	global.CONST = { DOCUMENT_OWNERSHIP_LEVELS: { OWNER } };
	global.ui = { notifications: { info: vi.fn(), error: vi.fn() } };
	globalThis.foundry = { utils: { escapeHTML: s => String(s) } };
});

describe("Assign to Player menu entry", () => {
	it("goes in after Configure Ownership on the Actors menu", () => {
		const registered = [];
		global.Hooks = { on: (name, fn) => registered.push([name, fn]) };
		registerAssignToPlayer();
		expect(registered.map(([name]) => name)).toEqual(["getActorContextOptions"]);
		const options = [{ label: "SIDEBAR.Duplicate" }, { label: "OWNERSHIP.Configure" }, { label: "SIDEBAR.Delete" }];
		registered[0][1](null, options);
		expect(options.map(o => o.label)).toEqual(["SIDEBAR.Duplicate", "OWNERSHIP.Configure", "Assign to Player…", "SIDEBAR.Delete"]);
	});

	it("shows for a GM on a person, not on the steading, a settlement, the toolkit or a module's type", () => {
		const { visible } = assignToPlayerEntry();
		expect(visible(row("npc"))).toBe(true);
		expect(visible(row("pc"))).toBe(true);
		expect(visible(row("beast"))).toBe(true);
		expect(visible(row("home"))).toBe(false);
		expect(visible(row("town"))).toBe(false);
		expect(visible(row("kit"))).toBe(false);
		expect(visible(row("mod"))).toBe(false);
	});

	it("is hidden from players", () => {
		game.user = users[1];
		expect(assignToPlayerEntry().visible(row("npc"))).toBe(false);
	});
});

describe("assignToPlayer", () => {
	it("offers each player, naming the character a pick would replace", async () => {
		const wait = stubAsk(null);
		await assignToPlayer(actors.npc);
		expect(wait.mock.calls[0][0].buttons.map(b => b.label))
			.toEqual(["Give to Wren, instead of pc", "Give to Ash", "Leave it as it is"]);
	});

	it("makes the player an owner and assigns the actor", async () => {
		stubAsk("ash");
		await assignToPlayer(actors.npc);
		expect(actors.npc.update).toHaveBeenCalledWith({ "ownership.ash": OWNER });
		expect(users[2].character).toBe(actors.npc);
	});

	it("does not touch ownership a player already has", async () => {
		actors.npc.owners.add("ash");
		stubAsk("ash");
		await assignToPlayer(actors.npc);
		expect(actors.npc.update).not.toHaveBeenCalled();
		expect(users[2].character).toBe(actors.npc);
	});

	it("moves an actor off the player who held it, ownership and all", async () => {
		stubAsk("ash");
		await assignToPlayer(actors.pc);
		expect(users[1].character).toBe(null);
		expect(users[2].character).toBe(actors.pc);
		// Still an owner, the old holder could go on running it.
		expect(actors.pc.update).toHaveBeenCalledWith({ "ownership.-=wren": null });
		expect(actors.pc.update).toHaveBeenCalledWith({ "ownership.ash": OWNER });
	});

	it("releases it from its holder", async () => {
		const wait = stubAsk("wren");
		await assignToPlayer(actors.pc);
		expect(wait.mock.calls[0][0].buttons[0].label).toBe("Release from Wren");
		expect(users[1].character).toBe(null);
		expect(actors.pc.update).toHaveBeenCalledTimes(1);
		expect(actors.pc.update).toHaveBeenCalledWith({ "ownership.-=wren": null });
	});

	it("changes nothing when left as it is", async () => {
		stubAsk("cancel");
		await assignToPlayer(actors.npc);
		expect(users.some(u => u.update.mock.calls.length)).toBe(false);
		expect(actors.npc.update).not.toHaveBeenCalled();
	});
});
