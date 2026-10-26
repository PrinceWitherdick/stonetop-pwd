import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// "If you're making a new character to join an ongoing game, you still start at level 1"
// (Book I p.53). On a sheet that has left play, Edit Character makes a NEW character through the
// add/replace flow, and the old sheet stays as the record. It is never rebuilt in place, which
// would keep its level, XP, death and insert.

const fakes = vi.hoisted(() => ({
	ask: vi.fn(async () => null),
	mint: vi.fn(async () => ({ id: "new" })),
}));
vi.mock("../../../module/utils/ask-with-buttons.js", async (importOriginal) => ({
	...(await importOriginal()),
	askWithButtons: fakes.ask,
}));
vi.mock("../../../module/actors/character/create-character.js", async (importOriginal) => ({
	...(await importOriginal()),
	createCharacterForUser: fakes.mint,
}));
vi.mock("../../../module/actors/character/onboarding-resume.js", async (importOriginal) => ({
	...(await importOriginal()),
	readOnboardingResume: () => null,
	clearOnboardingResume: vi.fn(),
}));

const { createStonetopCharacterSheetClass } = await import("../../../module/actors/character/StonetopCharacterSheet.js");
const { DEATHS_DOOR_STATE } = await import("../../../module/actors/character/deaths-door.js");

const SCOPE = "stonetop-pwd";
const OWNER = 3;

function makeSheet(flags = {}) {
	const actor = {
		id: "dead-1", name: "Brannoc", type: "character", isOwner: true,
		folder: { id: "pcs" },
		ownership: { player1: OWNER },
		system: { playbook: { slug: "the-heavy", name: "The Heavy" } },
		flags: { [SCOPE]: { ...flags } },
		getFlag: (_scope, key) => actor.flags[SCOPE][key],
		// Core's answer for a non-GM: their own ownership entry (utils/playbook-actors.js#playerOf asks).
		testUserPermission: (user, level) => level === "OWNER" && (actor.ownership[user.id] ?? 0) >= OWNER,
	};
	const Base = class {
		constructor() { this._actor = actor; }
		get actor() { return this._actor; }
		get isEditable() { return true; }
		async getData() { return {}; }
		activateListeners() {}
		render = vi.fn();
	};
	const sheet = new (createStonetopCharacterSheetClass(Base))();
	sheet._openEditCharacterOnboarding = vi.fn(async () => {});
	return sheet;
}

let saved;
beforeEach(() => {
	saved = { user: global.game.user, users: global.game.users, CONST: global.CONST };
	global.CONST = { ...(global.CONST ?? {}), DOCUMENT_OWNERSHIP_LEVELS: { OWNER } };
	fakes.ask.mockReset();
	fakes.mint.mockClear();
});
afterEach(() => {
	global.game.user = saved.user;
	global.game.users = saved.users;
	global.CONST = saved.CONST;
});

describe("Edit Character on a sheet that has left play", () => {
	it("makes a new character for the player who presses it, filed beside the old one", async () => {
		global.game.user = { id: "player1", isGM: false };
		fakes.ask.mockResolvedValue("mint");
		const sheet = makeSheet({ deathsDoor: DEATHS_DOOR_STATE.DEAD });

		await sheet._onNewCharacter();

		expect(fakes.ask).toHaveBeenCalledTimes(1);
		const asked = fakes.ask.mock.calls[0][0];
		expect(asked.buttons.map(b => b.value)).toEqual(["mint", "edit", null]);
		expect(asked.content).toContain("level 1");
		expect(fakes.mint).toHaveBeenCalledWith("player1", { folder: "pcs" });
	});

	it("a GM makes it for the dead character's player", async () => {
		const player = { id: "player1", isGM: false, character: { id: "dead-1" } };
		const gm = { id: "gm", isGM: true };
		global.game.user = gm;
		global.game.users = [gm, player];
		fakes.ask.mockResolvedValue("mint");

		await makeSheet({ deathsDoor: DEATHS_DOOR_STATE.DEAD })._onNewCharacter();

		expect(fakes.mint).toHaveBeenCalledWith("player1", { folder: "pcs" });
	});

	it("can still edit the record, and leaving it changes nothing", async () => {
		global.game.user = { id: "player1", isGM: false };
		const sheet = makeSheet({ deathsDoor: DEATHS_DOOR_STATE.DEAD });

		fakes.ask.mockResolvedValue("edit");
		await sheet._onNewCharacter();
		expect(sheet._openEditCharacterOnboarding).toHaveBeenCalledTimes(1);

		fakes.ask.mockResolvedValue(null);
		await sheet._onNewCharacter();
		expect(fakes.mint).not.toHaveBeenCalled();
	});

	it("asks the ordinary reset question of a character still in play, even one dying", async () => {
		global.game.user = { id: "player1", isGM: false };
		fakes.ask.mockResolvedValue(null);

		await makeSheet({ deathsDoor: DEATHS_DOOR_STATE.DYING })._onNewCharacter();

		expect(fakes.ask.mock.calls[0][0].buttons.map(b => b.value)).toEqual(["new", "edit", null]);
		expect(fakes.mint).not.toHaveBeenCalled();
	});
});
