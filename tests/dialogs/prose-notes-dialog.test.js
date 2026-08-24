import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { openProseNotesDialog } from "../../module/dialogs/prose-notes-dialog.js";

// The pop-up rich-text editor shared by the Steading's NPC notes and the GM Toolkit's encounter
// notes.
//
// WHAT IS WORTH TESTING HERE is not the editor — that is core's `<prose-mirror>` — but the little
// state machine around it: which edits reach the caller, which are dropped as duplicates, and what
// happens to one the caller could not write. That last case is the quiet one. NPCs are GM-owned
// prep, so a player who reaches this dialog from the Steading Residents column gets a permission
// rejection, and a dialog that recorded the rejected text as saved would never send it again: the
// GM could grant ownership while the pop-up was still open and pressing Done would write nothing,
// with the editor still showing the note that was lost.

/** The last dialog this file built, with its config and options captured. */
let built;

/** An editor stand-in: what core's `<prose-mirror>` gives the dialog to read and listen to. */
function fakeEditor(value = "") {
	const el = {
		value,
		handlers: {},
		addEventListener: (type, fn) => { (el.handlers[type] ??= []).push(fn); },
		/** Core fires this from the save keybinding and from `disconnectedCallback`. */
		type(next) {
			el.value = next;
			for (const fn of el.handlers.change ?? []) fn({ target: el });
		},
	};
	return el;
}

/** Open the dialog, wire an editor into it, and hand back the two things a test drives it with. */
async function open(onSave, value = "") {
	await openProseNotesDialog({ title: "T", doneLabel: "Done", value, onSave });
	const editor = fakeEditor(value);
	built.config.render({ querySelector: sel => (sel === "prose-mirror" ? editor : null) });
	return { editor, close: () => built.config.close() };
}

/** Let the commit's own promise chain settle; the write is deliberately not awaited inline. */
const settle = () => new Promise(resolve => setImmediate(resolve));

beforeEach(() => {
	built = null;
	// Enough of an AppV1 Dialog for the shell: `attachFrontOnOpen` wraps `_render` and
	// `activateListeners` to keep the window in front of the sheet it was opened from.
	globalThis.Dialog = class {
		constructor(config, options) {
			this.config = config;
			this.options = options;
			built = this;
		}
		async _render() {}
		activateListeners() {}
		async close() {}
		render() { return this; }
	};
	globalThis.foundry = {
		...(globalThis.foundry ?? {}),
		utils: { ...(globalThis.foundry?.utils ?? {}), escapeHTML: s => String(s) },
	};
});

afterEach(() => {
	delete globalThis.Dialog;
});

describe("what reaches the caller", () => {
	it("writes each new value once", async () => {
		const wrote = [];
		const { editor } = await open(v => { wrote.push(v); });
		editor.type("<p>one</p>");
		editor.type("<p>two</p>");
		await settle();
		expect(wrote).toEqual(["<p>one</p>", "<p>two</p>"]);
	});

	// The initial value bubbling straight back through would re-render the caller's sheet under
	// somebody who has not typed anything yet, which is what makes the save on close free.
	it("drops a value that is already what was written", async () => {
		const wrote = [];
		const { editor, close } = await open(v => { wrote.push(v); }, "<p>as it was</p>");
		editor.type("<p>as it was</p>");
		close();
		await settle();
		expect(wrote).toEqual([]);
	});

	// Escape and the X both dismiss an AppV1 window straight from the focused editor, so the
	// `change` core fires from its save keybinding never happens.
	it("saves what is in the editor when the window is dismissed", async () => {
		const wrote = [];
		const { editor, close } = await open(v => { wrote.push(v); });
		editor.value = "<p>typed and never blurred</p>";
		close();
		await settle();
		expect(wrote).toEqual(["<p>typed and never blurred</p>"]);
	});
});

describe("an edit the caller could not write", () => {
	// The failure this whole file exists for: a rejected write recorded as a successful one means
	// the retry is dropped as a duplicate and the note is lost with nothing on screen saying so.
	it("is tried again when the caller rejects", async () => {
		let allow = false;
		const tried = [];
		const { editor, close } = await open(v => {
			tried.push(v);
			return allow ? Promise.resolve() : Promise.reject(new Error("no permission"));
		});
		editor.type("<p>He owes Marrow a debt.</p>");
		await settle();
		expect(tried).toHaveLength(1);

		// The GM grants ownership while the pop-up is still open, and Done goes out again.
		allow = true;
		close();
		await settle();
		expect(tried).toEqual(["<p>He owes Marrow a debt.</p>", "<p>He owes Marrow a debt.</p>"]);
	});

	// A caller whose write path absorbs its own failures on purpose — ActorListStore does, so one
	// refused write cannot wedge the ones queued behind it — has no rejection left to hand back,
	// and says so by resolving false instead.
	it("is tried again when the caller answers false", async () => {
		let allow = false;
		const tried = [];
		const { editor, close } = await open(async v => { tried.push(v); return allow; });
		editor.type("<p>notes</p>");
		await settle();
		allow = true;
		close();
		await settle();
		expect(tried).toEqual(["<p>notes</p>", "<p>notes</p>"]);
	});

	// Only the value that failed is unsaid. Anything typed since is newer and has a write of its
	// own in flight; putting the old text back over it would lose that instead.
	it("does not unsay an edit made after the one that failed", async () => {
		const tried = [];
		let fail = true;
		const { editor, close } = await open(async v => {
			tried.push(v);
			if (fail) { fail = false; throw new Error("no permission"); }
		});
		editor.type("<p>first</p>");
		editor.type("<p>second</p>");
		await settle();
		expect(tried).toEqual(["<p>first</p>", "<p>second</p>"]);

		// "second" landed, so dismissing writes nothing more.
		close();
		await settle();
		expect(tried).toHaveLength(2);
	});
});
