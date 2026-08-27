import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { wireUndoXpMark, XP_MARK_FLAG, XP_UNDONE_FLAG } from "../../module/utils/undo-xp-mark.js";
import { SYSTEM_ID } from "../../module/system-id.js";

// The Undo on the XP receipt a miss posts.
//
// Two properties carry the whole feature. It takes back a DELTA, so undoing an old mark does not
// wipe out what happened since; and it fires ONCE, enforced on the message rather than on the
// button, because the button is re-created on every client and after every reload.

const flush = () => new Promise(resolve => setImmediate(resolve));

/** A button with the handful of DOM methods the wiring touches. */
function fakeButton() {
	const card = { classList: { classes: new Set(), add(c) { this.classes.add(c); } } };
	return {
		disabled: false,
		innerHTML: "Undo",
		removed: false,
		card,
		listeners: [],
		addEventListener(type, fn) { this.listeners.push({ type, fn }); },
		remove() { this.removed = true; },
		closest: (sel) => (sel === ".stonetop-xp-mark-card" ? card : null),
		click() { return Promise.all(this.listeners.map(l => l.fn())); },
	};
}

const fakeHtml = (btn) => ({ querySelector: (sel) => (sel === ".stonetop-xp-undo" ? btn : null) });

/** A chat message carrying the mark flag, with flag writes that actually stick. */
function fakeMessage({ marked = 1, undone = false, canModify = true } = {}) {
	const flags = { [XP_MARK_FLAG]: marked, ...(undone ? { [XP_UNDONE_FLAG]: true } : {}) };
	return {
		flags,
		speaker: { actor: "a1" },
		getFlag: (scope, key) => (scope === SYSTEM_ID ? flags[key] : undefined),
		setFlag: vi.fn(async (scope, key, value) => { flags[key] = value; }),
		unsetFlag: vi.fn(async (scope, key) => { delete flags[key]; }),
		canUserModify: () => canModify,
	};
}

/** The character the receipt names, and the world it lives in. */
function world({ xp = 16, level = 1, isOwner = true, type = "character" } = {}) {
	const actor = {
		name: "Torwyn",
		uuid: "Actor.a1",
		type,
		isOwner,
		system: { attributes: { xp: { value: xp }, level: { value: level } } },
		update: vi.fn(async (data) => {
			await flush();
			actor.system.attributes.xp.value = data["system.attributes.xp.value"];
		}),
	};
	global.game = { user: { isGM: true }, actors: { get: (id) => (id === "a1" ? actor : null) } };
	global.canvas = { tokens: { get: () => null } };
	return actor;
}

let noticed;

beforeEach(() => {
	noticed = [];
	global.ui = { notifications: { info: (m) => noticed.push(m), warn: () => {}, error: () => {} } };
});

afterEach(() => {
	delete global.game;
	delete global.canvas;
	delete global.ui;
});

describe("wireUndoXpMark", () => {
	it("hands back exactly what the card marked", async () => {
		const actor = world({ xp: 16 });
		const btn = fakeButton();
		wireUndoXpMark(fakeMessage({ marked: 1 }), fakeHtml(btn));

		await btn.click();

		expect(actor.system.attributes.xp.value).toBe(15);
		expect(noticed[0]).toContain("Took back 1 XP from Torwyn");
	});

	// The mark being undone might be ten minutes old. Restoring a remembered total would erase
	// everything earned since; a delta composes with it.
	it("takes back a delta, leaving whatever was earned since it alone", async () => {
		const actor = world({ xp: 16 });
		const btn = fakeButton();
		wireUndoXpMark(fakeMessage({ marked: 1 }), fakeHtml(btn));

		actor.system.attributes.xp.value = 19; // three more marks landed after this card
		await btn.click();

		expect(actor.system.attributes.xp.value).toBe(18);
	});

	it("attributes the reversal in the ledger", async () => {
		const actor = world();
		const btn = fakeButton();
		wireUndoXpMark(fakeMessage(), fakeHtml(btn));

		await btn.click();

		expect(actor.update).toHaveBeenCalledWith(expect.anything(), { stonetopMove: "Undo XP" });
	});

	it("marks the card spent, so the log stops asserting a total that is no longer true", async () => {
		world();
		const btn = fakeButton();
		wireUndoXpMark(fakeMessage(), fakeHtml(btn));

		await btn.click();

		expect(btn.disabled).toBe(true);
		expect(btn.innerHTML).toContain("Undone");
		expect(btn.card.classList.classes.has("is-xp-undone")).toBe(true);
	});
});

describe("wireUndoXpMark fires once", () => {
	it("writes the latch before touching the XP", async () => {
		const actor = world();
		const btn = fakeButton();
		const message = fakeMessage();
		wireUndoXpMark(message, fakeHtml(btn));

		await btn.click();

		// Order matters: latch first means a failure leaves a dead button, which is visible and
		// fixable. XP first means a crash between the two hands the same XP back twice.
		expect(message.setFlag).toHaveBeenCalledWith(SYSTEM_ID, XP_UNDONE_FLAG, true);
		expect(message.setFlag.mock.invocationCallOrder[0])
			.toBeLessThan(actor.update.mock.invocationCallOrder[0]);
	});

	it("does not hand the XP back twice on a double click", async () => {
		const actor = world({ xp: 16 });
		const btn = fakeButton();
		wireUndoXpMark(fakeMessage(), fakeHtml(btn));

		// Both presses land before the first write resolves.
		const [handler] = btn.listeners;
		await Promise.all([handler.fn(), handler.fn()]);

		expect(actor.update).toHaveBeenCalledTimes(1);
		expect(actor.system.attributes.xp.value).toBe(15);
	});

	it("refuses a second press after the first has finished", async () => {
		const actor = world({ xp: 16 });
		const btn = fakeButton();
		wireUndoXpMark(fakeMessage(), fakeHtml(btn));

		await btn.click();
		await btn.click();

		expect(actor.update).toHaveBeenCalledTimes(1);
		expect(actor.system.attributes.xp.value).toBe(15);
	});

	// The DOM is not where "once" lives: this card re-renders on every other client and again
	// after every reload, and each of those would otherwise offer a fresh, enabled button.
	it("renders spent, and inert, on a card already undone", async () => {
		const actor = world();
		const btn = fakeButton();
		wireUndoXpMark(fakeMessage({ undone: true }), fakeHtml(btn));

		expect(btn.disabled).toBe(true);
		expect(btn.innerHTML).toContain("Undone");
		expect(btn.listeners).toEqual([]);

		await btn.click();
		expect(actor.update).not.toHaveBeenCalled();
	});

	it("releases the latch when the write fails, so the undo can be asked for again", async () => {
		const actor = world();
		actor.update.mockRejectedValueOnce(new Error("no connection"));
		const btn = fakeButton();
		const message = fakeMessage();
		wireUndoXpMark(message, fakeHtml(btn));

		await btn.click();

		expect(message.unsetFlag).toHaveBeenCalledWith(SYSTEM_ID, XP_UNDONE_FLAG);
		expect(message.getFlag(SYSTEM_ID, XP_UNDONE_FLAG)).toBeUndefined();
		expect(btn.disabled).toBe(false);
		expect(btn.card.classList.classes.has("is-xp-undone")).toBe(false);
	});
});

describe("wireUndoXpMark shows the button only where it means something", () => {
	it("is absent from a card that marked no XP", () => {
		world();
		const btn = fakeButton();
		wireUndoXpMark(fakeMessage({ marked: 0 }), fakeHtml(btn));
		expect(btn.removed).toBe(true);
	});

	it("is absent for someone who does not own the character", () => {
		world({ isOwner: false });
		const btn = fakeButton();
		wireUndoXpMark(fakeMessage(), fakeHtml(btn));
		expect(btn.removed).toBe(true);
	});

	// The right that Burn Brightly once missed: the player owns the character, but the GM rolled
	// on their behalf and owns the message.
	it("is absent for an owner who cannot modify the message", () => {
		world();
		const btn = fakeButton();
		wireUndoXpMark(fakeMessage({ canModify: false }), fakeHtml(btn));
		expect(btn.removed).toBe(true);
	});

	it("does nothing at all on a card with no undo button", () => {
		world();
		expect(() => wireUndoXpMark(fakeMessage(), { querySelector: () => null })).not.toThrow();
	});

	it("still marks the card undone when there is no XP left to give back", async () => {
		const actor = world({ xp: 0 });
		const btn = fakeButton();
		wireUndoXpMark(fakeMessage(), fakeHtml(btn));

		await btn.click();

		expect(actor.update).not.toHaveBeenCalled();
		expect(noticed[0]).toContain("no XP left to take back");
		expect(btn.card.classList.classes.has("is-xp-undone")).toBe(true);
	});
});
