import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// The GM Toolkit's create flow, driven end to end through openCreateActor.
//
// Listing the row in ACTOR_OPTIONS is only half of it: the picker returns a choice STRING and
// `openCreateActor` dispatches on it. Drop the dispatch branch and the row is still there, the
// picker still opens, the GM still clicks it, and nothing happens at all. No error, no actor,
// no console line. So this drives the real function rather than asserting on the option list.
const picker = vi.hoisted(() => ({ pick: vi.fn() }));
// Only the CHOOSER is faked — the picker's other half, which runs the flow sitting on the row that
// was picked, is the real one. Stubbing that too would leave these tests asserting against a
// dispatch of their own rather than the one the sidebar uses.
vi.mock("../../module/dialogs/content-picker.js", async (importOriginal) => ({
	...(await importOriginal()),
	pickContentOption: picker.pick,
}));

const { openCreateActor } = await import("../../module/dialogs/create-actor-dialog.js");

describe("creating a GM Toolkit", () => {
	let created;
	let sheetRendered;
	let saved;

	beforeEach(() => {
		created = [];
		sheetRendered = 0;
		saved = { game: globalThis.game, ui: globalThis.ui, getDocumentClass: globalThis.getDocumentClass };

		globalThis.game = { ...globalThis.game, user: { isGM: true, id: "gm1" } };
		globalThis.ui = { notifications: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } };
		globalThis.getDocumentClass = () => ({
			create: async data => {
				created.push(data);
				return { ...data, sheet: { render: () => { sheetRendered++; } } };
			},
		});
		picker.pick.mockReset();
	});

	afterEach(() => {
		globalThis.game = saved.game;
		globalThis.ui = saved.ui;
		globalThis.getDocumentClass = saved.getDocumentClass;
	});

	it("creates a gmToolkit actor and opens it", async () => {
		picker.pick.mockResolvedValueOnce("gmToolkit");

		const actor = await openCreateActor({ folder: "f1" });

		expect(created).toHaveLength(1);
		expect(created[0].type).toBe("gmToolkit");
		expect(created[0].folder).toBe("f1");
		// The localized type label, so the sidebar row reads "GM Toolkit" rather than a raw key.
		expect(created[0].name).toBe("GM Toolkit");
		expect(sheetRendered).toBe(1);
		expect(actor).not.toBeNull();
	});

	it("keeps a name the caller supplied (macros pass one)", async () => {
		picker.pick.mockResolvedValueOnce("gmToolkit");
		await openCreateActor({ name: "  Winter Campaign  " });
		expect(created[0].name).toBe("Winter Campaign");
	});

	// `game.documentTypes.Actor` is derived from `game.model`, which the SERVER builds from the
	// system manifest at WORLD LAUNCH (World#prepareDataModel). A table that updated the system
	// and pressed F5 is running new code against the old type list, and the create then throws a
	// DataModelValidationError from inside the document constructor: a console stack trace and a
	// "see the console" toast, neither of which says "relaunch the world".
	it("tells the GM to relaunch when this world predates the type", async () => {
		globalThis.game.documentTypes = { Actor: ["character", "stonetop", "monster", "npc"] };
		picker.pick.mockResolvedValueOnce("gmToolkit");

		const actor = await openCreateActor({});

		expect(actor).toBeNull();
		expect(created).toHaveLength(0);
		const [message] = ui.notifications.warn.mock.calls[0];
		expect(message).toMatch(/launch the world again/i);
		expect(ui.notifications.error).not.toHaveBeenCalled();
	});

	it("proceeds once the world's launch knows the type", async () => {
		globalThis.game.documentTypes = { Actor: ["character", "stonetop", "monster", "npc", "gmToolkit"] };
		picker.pick.mockResolvedValueOnce("gmToolkit");

		await openCreateActor({});

		expect(created).toHaveLength(1);
		expect(ui.notifications.warn).not.toHaveBeenCalled();
	});

	// The probe must not become a new way to fail. An older or newer core that does not publish
	// this shape has to fall through to the create, not block it.
	it("does not block when the type list is unavailable", async () => {
		globalThis.game.documentTypes = undefined;
		picker.pick.mockResolvedValueOnce("gmToolkit");

		await openCreateActor({});

		expect(created).toHaveLength(1);
	});

	it("reports a failed create instead of leaving the GM with nothing", async () => {
		picker.pick.mockResolvedValueOnce("gmToolkit");
		globalThis.getDocumentClass = () => ({ create: async () => { throw new Error("nope"); } });
		const spy = vi.spyOn(console, "error").mockImplementation(() => {});

		const actor = await openCreateActor({});

		expect(actor).toBeNull();
		expect(ui.notifications.error).toHaveBeenCalled();
		spy.mockRestore();
	});
});
