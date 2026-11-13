// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { LoveLetterDialog } from "../../module/dialogs/LoveLetterDialog.js";
import { LOVE_LETTER_WINDOW_CLASS, reopenLoveLetter } from "../../module/dialogs/love-letter-restore.js";

// A reload brings the love letter window back (love-letter-restore.js, by way of
// utils/window-restore.js) with the letter as typed: the form is copied as it changes, and the copy
// is written over the freshly drawn form once.

function form({ recipient = true } = {}) {
	const root = document.createElement("div");
	root.innerHTML = `
		${recipient ? `<select name="recipient"><option value="">-</option><option value="a1">Hero</option></select>` : ""}
		<input type="text" name="name"><textarea name="description"></textarea>
		<select name="rollType"><option value="">none</option><option value="str">STR</option></select>
		<input type="radio" name="resultStyle" value="prose" checked><input type="radio" name="resultStyle" value="list">
		<textarea name="success"></textarea><input type="number" name="pickSuccess">
		<input type="checkbox" name="markXp" checked><input type="text" name="signed">`;
	return root;
}

beforeEach(() => vi.stubGlobal("game", { user: { isGM: true } }));
afterEach(() => vi.unstubAllGlobals());

describe("the love letter across a reload", () => {
	it("is restored under the class name its hooks are built from, keyed by its letter once saved", () => {
		expect(LoveLetterDialog.name).toBe(LOVE_LETTER_WINDOW_CLASS);
		expect(new LoveLetterDialog({ letterId: "l1" }).restoreKey).toBe("loveLetter:new-l1");
		expect(new LoveLetterDialog().restoreKey).not.toBe(new LoveLetterDialog().restoreKey);
		expect(new LoveLetterDialog({ item: { uuid: "Actor.a1.Item.i1", parent: null } }).restoreKey).toBe("loveLetter:Actor.a1.Item.i1");
	});

	it("comes back with the letter as typed", async () => {
		const left = new LoveLetterDialog({ letterId: "l1" });
		const typed = form();
		typed.querySelector("[name=recipient]").value = "a1";
		typed.querySelector("[name=name]").value = "Come home";
		typed.querySelector("[name=description]").value = "Your mother writes.";
		typed.querySelector("[name=rollType]").value = "str";
		typed.querySelector("[name=resultStyle][value=list]").checked = true;
		typed.querySelector("[name=markXp]").checked = false;
		left._form = left._readFormCopy(typed);
		const view = JSON.parse(JSON.stringify(left.restoreView));

		const back = await reopenLoveLetter("loveLetter:new-l1");
		expect(back.restoreKey).toBe("loveLetter:new-l1");
		back._takeRestoredView(view);
		const drawn = form();
		back._writeFormCopy(drawn, back._pendingForm);
		expect(drawn.querySelector("[name=recipient]").value).toBe("a1");
		expect(drawn.querySelector("[name=name]").value).toBe("Come home");
		expect(drawn.querySelector("[name=description]").value).toBe("Your mother writes.");
		expect(drawn.querySelector("[name=rollType]").value).toBe("str");
		expect(drawn.querySelector("[name=resultStyle]:checked").value).toBe("list");
		expect(drawn.querySelector("[name=markXp]").checked).toBe(false);
		// Still saved for a reload before anything else is typed.
		expect(back.restoreView.form.name).toBe("Come home");
	});

	it("ignores what doesn't fit, and leaves a recipient no longer offered unpicked", () => {
		const back = new LoveLetterDialog();
		back._takeRestoredView({ form: { name: 5, markXp: "yes", recipient: "gone", nonsense: "x" } });
		expect(back._pendingForm).toEqual({ recipient: "gone" });
		const drawn = form();
		back._writeFormCopy(drawn, back._pendingForm);
		expect(drawn.querySelector("[name=recipient]").value).toBe("");
		back._pendingForm = null;
		back._takeRestoredView({ form: "nonsense" });
		expect(back._pendingForm).toBeNull();
	});

	it("brings back the letter being edited, or a new one with the typing when that letter has gone", async () => {
		const item = { uuid: "Actor.a1.Item.i1", documentName: "Item", parent: { name: "Hero" } };
		vi.stubGlobal("fromUuid", async () => item);
		expect((await reopenLoveLetter("loveLetter:Actor.a1.Item.i1"))._item).toBe(item);
		vi.stubGlobal("fromUuid", async () => null);
		const gone = await reopenLoveLetter("loveLetter:Actor.a1.Item.i1");
		expect(gone._item).toBeNull();
	});

	it("stays shut for a player", async () => {
		expect(await reopenLoveLetter("loveLetter:new-l1")).toBeInstanceOf(LoveLetterDialog);
		game.user.isGM = false;
		expect(await reopenLoveLetter("loveLetter:new-l1")).toBeNull();
		expect(await reopenLoveLetter("camp:new-l1")).toBeNull();
	});
});
