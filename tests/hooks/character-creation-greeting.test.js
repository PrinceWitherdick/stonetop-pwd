import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The greeting a player gets on load (and on a GM's mint) for a character still being made.

const fakes = vi.hoisted(() => ({
	open: vi.fn(async () => ({})),
	snapshots: new Map(),
	clear: null,
	exitShown: new Set(),
}));
vi.mock("../../module/actors/character/dialogs/CharacterCreationDialog.js", () => ({
	CharacterCreationDialog: { open: fakes.open },
}));
vi.mock("../../module/actors/character/onboarding-resume.js", () => {
	fakes.clear = vi.fn();
	return {
		readOnboardingResume: actor => fakes.snapshots.get(actor.id) ?? null,
		clearOnboardingResume: fakes.clear,
		writeOnboardingResume: vi.fn(),
		resumeHasUnsavedWork: snap => !!snap?.playbookUuid && !!snap?.selections && snap.committed !== true,
		exitedSheetShown: actor => fakes.exitShown.has(actor.id),
		markExitedSheetShown: actor => { fakes.exitShown.add(actor.id); },
	};
});

const { _maybeOpenCharacterCreation } = await import("../../module/hooks/Ready.js");
const { holdCreationFlow, greetingHeld } = await import("../../module/actors/character/creation-flow.js");

const OWNER = 3;
const SCOPE = "stonetop-pwd";
const tick = () => new Promise(resolve => setTimeout(resolve, 5));

/** One of the player's characters, as the greeting reads it. */
function mine(id, { playbook = null, flags = {}, ownership = { u1: OWNER }, onNew = vi.fn(async () => {}) } = {}) {
	const actor = {
		id, name: `PC ${id}`, type: "character",
		ownership,
		system: { playbook: playbook ? { slug: playbook, name: "The Fox" } : null },
		flags: { [SCOPE]: { ...flags } },
		getFlag: (_scope, key) => actor.flags[SCOPE][key],
		unsetFlag: vi.fn(async () => {}),
		testUserPermission: (user, level) => level === "OWNER" && (actor.ownership[user.id] ?? actor.ownership.default ?? 0) >= OWNER,
		sheet: { _onNewCharacter: onNew, render: vi.fn() },
	};
	return actor;
}

let saved;
let user;
beforeEach(() => {
	saved = { game: global.game, CONST: global.CONST };
	user = { id: "u1", isGM: false, character: null };
	global.game = { ...global.game, user, users: [user], actors: new Map() };
	global.CONST = { DOCUMENT_OWNERSHIP_LEVELS: { OWNER } };
	fakes.open.mockClear();
	fakes.clear.mockClear();
	fakes.snapshots.clear();
	fakes.exitShown.clear();
});
afterEach(async () => {
	// Let any parked greeting run against THIS test's world before the next one replaces it.
	await tick();
	global.game = saved.game;
	global.CONST = saved.CONST;
});

describe("the load-time sweep", () => {
	// The resume path awaits its playbook before its window exists, and the sweep over the
	// player's characters is synchronous: the second half-built character's intro opened beside
	// the first character's walkthrough.
	it("opens one flow at a time for a player with two half-built characters", async () => {
		let resumed;
		const first = mine("a1", { onNew: vi.fn(() => new Promise(resolve => { resumed = resolve; })) });
		const second = mine("a2");
		fakes.snapshots.set("a1", { playbookUuid: "Compendium.x.fox", selections: {} });

		_maybeOpenCharacterCreation(first);
		_maybeOpenCharacterCreation(second);

		expect(first.sheet._onNewCharacter).toHaveBeenCalledWith({ openSheetWhenDone: true, resume: true });
		expect(fakes.open, "the second waits for the first").not.toHaveBeenCalled();
		resumed();
	});
});

// The greeting stood aside for an open flow and waited for the NEXT LOAD, while the GM had been
// told it was on the player's screen. It now runs as soon as the open flow is done.
describe("a greeting held back by an open flow", () => {
	it("is shown this session once the open flow ends", async () => {
		let finish;
		holdCreationFlow("other", new Promise(resolve => { finish = resolve; }));
		const minted = mine("a2", { flags: { autoOpenFor: "u1" } });
		game.actors.set("a2", minted);

		_maybeOpenCharacterCreation(minted, { creatorId: "gm" });
		expect(fakes.open).not.toHaveBeenCalled();
		expect(minted.unsetFlag, "the one-shot flag is kept until it is shown").not.toHaveBeenCalled();
		expect(greetingHeld("a2")).toBe(true);

		finish();
		await tick();

		expect(fakes.open).toHaveBeenCalledTimes(1);
		expect(fakes.open).toHaveBeenCalledWith(minted, { startedByGM: true });
		expect(greetingHeld("a2")).toBe(false);
	});
});

describe("who is greeted", () => {
	// The GM handed the sheet to someone else before the first player logged in: their client
	// can no longer clear the flag, and used to greet them about it on every load.
	it("does not greet a player the flag names once ownership has moved away", () => {
		const moved = mine("a1", { flags: { autoOpenFor: "u1" }, ownership: { u2: OWNER } });
		_maybeOpenCharacterCreation(moved);
		expect(fakes.open).not.toHaveBeenCalled();
		expect(moved.unsetFlag).not.toHaveBeenCalled();
	});

	it("does not greet when another player now holds it as their character", () => {
		const other = { id: "u2", isGM: false, character: { id: "a1" } };
		game.users = [user, other];
		const taken = mine("a1", { flags: { autoOpenFor: "u1" } });
		_maybeOpenCharacterCreation(taken);
		expect(fakes.open).not.toHaveBeenCalled();
	});

	it("does not greet on assignment alone, without ownership", () => {
		user.character = { id: "a1" };
		const assigned = mine("a1", { ownership: {} });
		_maybeOpenCharacterCreation(assigned);
		expect(fakes.open).not.toHaveBeenCalled();
	});

	it("greets an assigned character the player can write", () => {
		user.character = { id: "a1" };
		const assigned = mine("a1", { ownership: { default: OWNER } });
		_maybeOpenCharacterCreation(assigned);
		expect(fakes.open).toHaveBeenCalledWith(assigned, { startedByGM: false });
	});

	it("tells a self-made character from a GM's mint", () => {
		const own = mine("a1", { flags: { autoOpenFor: "u1" } });
		_maybeOpenCharacterCreation(own, { creatorId: "u1" });
		expect(fakes.open).toHaveBeenCalledWith(own, { startedByGM: false });
	});
});

describe("tidying a character with a committed playbook", () => {
	it("keeps the progress of one saved and closed part-way through", () => {
		const saved = mine("a1", { playbook: "the-fox", flags: { onboardingProgress: { state: "exited", playbook: "The Fox" } } });
		_maybeOpenCharacterCreation(saved);
		expect(saved.unsetFlag).not.toHaveBeenCalledWith(SCOPE, "onboardingProgress");
	});

	it("still clears a stale progress note off a finished one", () => {
		const done = mine("a1", {
			playbook: "the-fox",
			flags: { onboardingProgress: { state: "exited" }, creationFinished: true },
		});
		_maybeOpenCharacterCreation(done);
		expect(done.unsetFlag).toHaveBeenCalledWith(SCOPE, "onboardingProgress");
		expect(fakes.clear).toHaveBeenCalledWith(done);
	});
});

// Save commits the playbook part-way; "Continue editing" carries on, and every answer after that
// lives only in the resume snapshot. A reload used to delete it because a playbook was present.
describe("reloading after a mid-creation Save", () => {
	const midway = () => mine("a1", {
		playbook: "the-fox",
		flags: { onboardingProgress: { state: "exited", playbook: "The Fox" } },
	});

	it("resumes the walkthrough when the snapshot holds answers the sheet doesn't", () => {
		const actor = midway();
		fakes.snapshots.set("a1", { playbookUuid: "Compendium.x.fox", selections: { name: "later" }, committed: false });

		_maybeOpenCharacterCreation(actor);

		expect(actor.sheet._onNewCharacter).toHaveBeenCalledWith({ openSheetWhenDone: true, resume: true });
		expect(fakes.clear, "the later answers are kept").not.toHaveBeenCalled();
	});

	it("leaves the player alone when the snapshot holds nothing newer than the save", () => {
		const actor = midway();
		fakes.snapshots.set("a1", { playbookUuid: "Compendium.x.fox", selections: {}, committed: true });

		_maybeOpenCharacterCreation(actor);

		expect(actor.sheet._onNewCharacter).not.toHaveBeenCalled();
		expect(fakes.open).not.toHaveBeenCalled();
		expect(fakes.clear).not.toHaveBeenCalled();
	});
});

describe("a player who backed out with nothing to resume", () => {
	it("is shown their sheet once, not on every load", () => {
		const backedOut = mine("a1", { flags: { onboardingProgress: { state: "exited" } } });

		_maybeOpenCharacterCreation(backedOut);
		_maybeOpenCharacterCreation(backedOut);

		expect(backedOut.sheet.render).toHaveBeenCalledTimes(1);
		expect(fakes.open).not.toHaveBeenCalled();
	});
});
