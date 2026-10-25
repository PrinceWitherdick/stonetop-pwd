import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CharacterCreationDialog } from "../../../../module/actors/character/dialogs/CharacterCreationDialog.js";

// The player's "Create Your Character" intro. Every instance shares one DOM id, so the two things
// pinned here are both about never having two of them, or two of what they start, at once.

const STATES = Application.RENDER_STATES;

let savedUi;
beforeEach(() => {
	savedUi = global.ui;
	global.ui = { ...global.ui, windows: {} };
});
afterEach(() => {
	global.ui = savedUi;
	vi.restoreAllMocks();
});

describe("CharacterCreationDialog.open", () => {
	// The replace path: the delete's cleanup has just closed the old greeting, which is now
	// fading (CLOSING) and still in ui.windows. Core's close() returns at once for such a window,
	// so the old code opened the new greeting straight away; core then found the OLD element by
	// the shared id, drew the new greeting into it, and the fade removed both.
	it("waits for a fading greeting to be gone before opening the next one", async () => {
		const old = new CharacterCreationDialog({ id: "old" });
		old._state = STATES.CLOSING;
		old.close = vi.fn(async () => {});
		global.ui.windows[1] = old;
		const render = vi.spyOn(CharacterCreationDialog.prototype, "render").mockImplementation(function () { return this; });

		const opening = CharacterCreationDialog.open({ id: "new" });
		await new Promise(resolve => setTimeout(resolve, 60));
		expect(render, "the old element is still in the document").not.toHaveBeenCalled();

		old._state = STATES.CLOSED;
		const opened = await opening;
		expect(render).toHaveBeenCalledTimes(1);
		expect(opened._actor.id).toBe("new");
	});

	it("hands back a greeting still painting for the same character rather than stacking another", async () => {
		const painting = new CharacterCreationDialog({ id: "a1" });
		painting._state = STATES.RENDERING;
		painting.close = vi.fn(async () => {});
		global.ui.windows[1] = painting;
		const render = vi.spyOn(CharacterCreationDialog.prototype, "render");

		expect(await CharacterCreationDialog.open({ id: "a1" })).toBe(painting);
		expect(render).not.toHaveBeenCalled();
		expect(painting.close).not.toHaveBeenCalled();
	});
});

describe("Create Character", () => {
	// The button stays live while the intro fades out, so a double-click started the flow twice.
	it("starts creation once, however many times it is clicked", () => {
		const onNew = vi.fn();
		const dialog = new CharacterCreationDialog({ id: "a1", isOwner: true, sheet: { _onNewCharacter: onNew } });
		dialog.close = vi.fn();

		dialog._onCreate();
		dialog._onCreate();

		expect(onNew).toHaveBeenCalledTimes(1);
		expect(onNew).toHaveBeenCalledWith({ openSheetWhenDone: true });
	});

	// _onNewCharacter does nothing for a player who can't write the character; the intro used to
	// close on top of that, leaving them with nothing on screen and no reason why.
	it("warns a player who can't write the character, and keeps the intro up", () => {
		const onNew = vi.fn();
		const warn = vi.fn();
		global.ui.notifications = { warn };
		const dialog = new CharacterCreationDialog({ id: "a1", isOwner: false, sheet: { _onNewCharacter: onNew } });
		dialog.close = vi.fn();

		dialog._onCreate();

		expect(onNew).not.toHaveBeenCalled();
		expect(dialog.close).not.toHaveBeenCalled();
		expect(warn).toHaveBeenCalledTimes(1);
	});

	it("names the character and says who started it", () => {
		const gm = new CharacterCreationDialog({ id: "a1", name: "Wren" }, { startedByGM: true });
		const own = new CharacterCreationDialog({ id: "a1", name: "Wren" });
		expect(gm.getData()).toMatchObject({ characterName: "Wren", startedByGM: true });
		expect(own.getData()).toMatchObject({ characterName: "Wren", startedByGM: false });
	});
});
