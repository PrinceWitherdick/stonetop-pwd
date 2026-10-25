import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Handlebars from "handlebars";

// Foundry's own `eq` helper, which the guide's template uses and the shared test setup does not register.
if (!Handlebars.helpers.eq) Handlebars.registerHelper("eq", (a, b) => a === b);

// The GM's first-session guide: its step count, and the roster's "Create character" button.

const fakes = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("../../module/actors/character/create-character.js", () => ({
	createCharacterForUser: fakes.create,
}));

const { WelcomeDialog } = await import("../../module/dialogs/WelcomeDialog.js");

let saved;
beforeEach(() => {
	saved = { game: global.game, ui: global.ui };
	const users = [{ id: "u1", name: "Aderyn", isGM: false }];
	users.get = id => users.find(u => u.id === id);
	global.game = { ...global.game, users };
	global.ui = { ...global.ui, notifications: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } };
	fakes.create.mockReset();
});
afterEach(() => {
	global.game = saved.game;
	global.ui = saved.ui;
});

describe("the banner's step count", () => {
	// Book Art keeps its place in the rail but is optional and unnumbered; the five Book I steps
	// read 1 to 5 of 5.
	it("numbers only Book I's five steps", () => {
		const guide = new WelcomeDialog();
		const labels = [0, 1, 2, 3, 4, 5, 6].map(i => guide._countLabel(i));
		expect(labels).toEqual(["", "", "Step 1 of 5", "Step 2 of 5", "Step 3 of 5", "Step 4 of 5", "Step 5 of 5"]);
	});
});

describe("Create character on the roster", () => {
	it("mints once on a double-click, and disables the button while it works", async () => {
		let finish;
		fakes.create.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
		const guide = new WelcomeDialog();
		const btn = { disabled: false };

		const first = guide._onCreateCharacter("u1", btn);
		const second = guide._onCreateCharacter("u1", btn);
		expect(btn.disabled).toBe(true);
		expect(guide._creatingFor.has("u1"), "a re-render draws it disabled too").toBe(true);

		finish({ id: "a1" });
		await Promise.all([first, second]);

		expect(fakes.create).toHaveBeenCalledTimes(1);
		expect(guide._creatingFor.has("u1")).toBe(false);
		expect(btn.disabled).toBe(false);
	});

	it("lets the next press through once the first has finished, even if it failed", async () => {
		fakes.create.mockRejectedValueOnce(new Error("nope")).mockResolvedValueOnce({ id: "a2" });
		const guide = new WelcomeDialog();

		await expect(guide._onCreateCharacter("u1")).rejects.toThrow("nope");
		await guide._onCreateCharacter("u1");

		expect(fakes.create).toHaveBeenCalledTimes(2);
	});

	it("warns rather than doing nothing for a player who has been deleted", async () => {
		const guide = new WelcomeDialog();

		expect(await guide._onCreateCharacter("gone")).toBeNull();

		expect(fakes.create).not.toHaveBeenCalled();
		expect(ui.notifications.warn).toHaveBeenCalledTimes(1);
	});
});

describe("the roster button while a mint is in flight", () => {
	it("renders disabled", async () => {
		const html = await renderTemplate("systems/stonetop-pwd/templates/dialogs/welcome.hbs", {
			activeTab: "characters", sections: [], active: {},
			players: [{ id: "u1", name: "Aderyn", creating: true, characters: [] }],
		});
		expect(html).toMatch(/class="stonetop-welcome-create" data-user-id="u1" disabled/);
	});

	it("locks the don't-show box once the first session is finished", async () => {
		const html = await renderTemplate("systems/stonetop-pwd/templates/dialogs/welcome.hbs", {
			activeTab: "overview", sections: [], active: {}, players: [],
			dontShowAgain: true, dontShowLocked: true,
		});
		expect(html).toMatch(/stonetop-welcome-dontshow-input" checked disabled/);
		expect(html).toContain("Won't show again: first session finished");
	});
});
