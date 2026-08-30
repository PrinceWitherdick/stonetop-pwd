import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { actorOptionsFor, openCreateActor, ownerOptions } from "../../module/dialogs/create-actor-dialog.js";
import { runPickedOption } from "../../module/dialogs/content-picker.js";

// Only the CHOOSER is faked. The picker's other half — running the flow that sits on the row that
// was picked — is the real one, because that dispatch is what these tests are about.
const picker = vi.hoisted(() => ({ pick: vi.fn() }));
vi.mock("../../module/dialogs/content-picker.js", async (importOriginal) => ({
	...(await importOriginal()),
	pickContentOption: picker.pick,
}));

const minted = vi.hoisted(() => ({ forUser: vi.fn() }));
vi.mock("../../module/actors/character/create-character.js", () => ({
	createCharacterForUser: minted.forUser,
}));

describe("actorOptionsFor", () => {
	it("offers the GM every kind of actor", () => {
		expect(actorOptionsFor(true).map(o => o.id)).toEqual(["character", "npc", "monster", "gmToolkit"]);
	});

	it("offers a player only their own character", () => {
		// People and monsters are GM prep; preCreateActor vetoes a player-made monster anyway.
		expect(actorOptionsFor(false).map(o => o.id)).toEqual(["character"]);
	});

	// The toolkit is a world singleton, so once the world has one the row is a dead entry that
	// only ever warns. It stays offered while the world has NONE, which is the case a world
	// launched before the subtype existed lands in: there the picker is the way to make it.
	it("drops the GM Toolkit row once the world has one", () => {
		expect(actorOptionsFor(true, { haveToolkit: true }).map(o => o.id))
			.toEqual(["character", "npc", "monster"]);
	});

	it("keeps offering it while the world has none", () => {
		expect(actorOptionsFor(true, { haveToolkit: false }).map(o => o.id)).toContain("gmToolkit");
	});

	it("still offers a player nothing but their character either way", () => {
		expect(actorOptionsFor(false, { haveToolkit: true }).map(o => o.id)).toEqual(["character"]);
	});

	it("gives every row an icon and a hint", () => {
		for (const option of actorOptionsFor(true)) {
			expect(option.icon).toMatch(/^fa-/);
			expect(option.hint.length).toBeGreaterThan(0);
		}
	});
});

describe("ownerOptions", () => {
	const players = [
		{ id: "u1", name: "Aderyn", isGM: false, active: true },
		{ id: "u2", name: "Bryn", isGM: false, active: false },
	];

	it("lists one row per player, in order, with an unassigned row last", () => {
		const rows = ownerOptions(players);
		expect(rows.map(r => r.id)).toEqual(["u1", "u2", "__unassigned__"]);
		expect(rows.map(r => r.label)).toEqual(["Aderyn", "Bryn", "No one yet"]);
	});

	it("leaves GMs out: they run the world rather than play a PC", () => {
		const rows = ownerOptions([...players, { id: "gm", name: "The GM", isGM: true, active: true }]);
		expect(rows.map(r => r.id)).not.toContain("gm");
	});

	// A player who already has one is not a dead end and is not a silent delete either: the
	// row has to say that picking it raises a question, so the GM knows before they pick it
	// that the button is not the destructive thing it used to be.
	it("tells the GM a player with a character will be asked to add or replace", () => {
		const rows = ownerOptions(players, id => (id === "u1" ? [{ name: "Wren" }] : []));
		expect(rows[0].hint).toContain("Wren");
		expect(rows[0].hint).toContain("add another character");
		expect(rows[0].hint).toContain("replace it");
	});

	it("agrees in number when the player already runs several characters", () => {
		const rows = ownerOptions(players, id => (id === "u1" ? [{ name: "Wren" }, { name: "Gethin" }] : []));
		expect(rows[0].hint).toContain("Wren, Gethin");
		expect(rows[0].hint).toContain("replace them");
	});

	it("says where creation will open for a player with no character yet", () => {
		const rows = ownerOptions(players);
		expect(rows[0].hint).toContain("Online");   // u1 is connected
		expect(rows[1].hint).toContain("Offline");  // u2 is not
	});

	it("still offers the unassigned row in a world with no players", () => {
		expect(ownerOptions([]).map(r => r.id)).toEqual(["__unassigned__"]);
	});
});

// Who a new character BELONGS to, and who gets asked.
//
// Choosing an owner is the GM's step — a player's character is their own by definition, and the
// owner picker lists every other player in the world. So the answer to "is this the GM?" must
// never be something a caller can hand in wrong: a row of ACTOR_OPTIONS carrying a baked-in `true`
// put a player one call away from minting a sheet that replaces someone else's, and the only
// thing standing in the way was an early return higher up the same function.
describe("creating a character", () => {
	let saved;

	const asUser = (isGM, id = "u1") => {
		globalThis.game = {
			...globalThis.game,
			user: { isGM, id },
			// Foundry's Actors is a Collection: it both iterates like an array (`.filter`) and
			// exposes `.contents`, and this flow reads it each way.
			actors: Object.assign([], { contents: [] }),
			users: [
				{ id: "u1", isGM: false, name: "Aderyn", active: true },
				{ id: "u2", isGM: false, name: "Bryn", active: true },
			],
		};
	};

	beforeEach(() => {
		saved = { game: globalThis.game, ui: globalThis.ui, CONST: globalThis.CONST };
		globalThis.CONST = { DOCUMENT_OWNERSHIP_LEVELS: { OWNER: 3 } };
		globalThis.ui = { notifications: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } };
		picker.pick.mockReset();
		minted.forUser.mockReset().mockResolvedValue({ id: "a1", sheet: { render: vi.fn() } });
	});

	afterEach(() => {
		globalThis.game = saved.game;
		globalThis.ui = saved.ui;
		globalThis.CONST = saved.CONST;
	});

	it("mints a player's character for that player, without asking whose it is", async () => {
		asUser(false);
		await openCreateActor({ folder: "f1", name: "Aderyn" });
		expect(picker.pick).not.toHaveBeenCalled();
		expect(minted.forUser).toHaveBeenCalledWith("u1", { folder: "f1", name: "Aderyn" });
	});

	it("asks the GM whose it is", async () => {
		asUser(true, "gm1");
		picker.pick.mockResolvedValueOnce("character").mockResolvedValueOnce("u2");
		await openCreateActor({ folder: null, name: "" });
		expect(picker.pick.mock.calls[1][0].title).toBe("Whose character is this?");
		expect(minted.forUser).toHaveBeenCalledWith("u2", { folder: null, name: "" });
	});

	it("keeps a player out of the owner picker even when the row is run directly", async () => {
		// actorOptionsFor hands this exact row object to a player, so running its flow is a
		// supported thing to do — the row must not carry an assumption about who is calling it.
		asUser(false);
		const [row] = actorOptionsFor(false);
		expect(row.id).toBe("character");

		await row.create("f2", "Aderyn");

		expect(picker.pick).not.toHaveBeenCalled();
		expect(minted.forUser).toHaveBeenCalledWith("u1", { folder: "f2", name: "Aderyn" });
	});
});

describe("runPickedOption", () => {
	let saved;
	beforeEach(() => {
		saved = globalThis.ui;
		globalThis.ui = { notifications: { error: vi.fn() } };
	});
	afterEach(() => { globalThis.ui = saved; vi.restoreAllMocks(); });

	it("runs the picked row's flow and returns what it returns", () => {
		const options = [{ id: "a", create: (x) => `ran ${x}` }, { id: "b", create: () => "no" }];
		expect(runPickedOption(options, "a", "one")).toBe("ran one");
	});

	it("is null for a dismissed dialog, without touching any row", () => {
		const create = vi.fn();
		expect(runPickedOption([{ id: "a", create }], null)).toBeNull();
		expect(create).not.toHaveBeenCalled();
	});

	it("says so when a row has no flow, rather than resolving a bare null", () => {
		// A silent null is indistinguishable from the user closing the chooser: the sidebar
		// creates nothing and nobody learns why. That is the failure the table was meant to end.
		const err = vi.spyOn(console, "error").mockImplementation(() => {});
		expect(runPickedOption([{ id: "a", label: "A" }], "a")).toBeNull();
		expect(err).toHaveBeenCalledWith(expect.stringContaining('"a"'));
		expect(globalThis.ui.notifications.error).toHaveBeenCalled();
	});

	it("says so when the id matches no row at all", () => {
		const err = vi.spyOn(console, "error").mockImplementation(() => {});
		expect(runPickedOption([{ id: "a", create: () => "x" }], "gone")).toBeNull();
		expect(err).toHaveBeenCalled();
	});
});
