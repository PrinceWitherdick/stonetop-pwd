// Audit VL-3 (2026-10-28): the sheet's wiring for two post-death fixes, which the fixes' own tests left
// uncovered: the 0-HP walkthrough opens through openOrFocus under UndeathDialog's per-character id (LV-2),
// and the Post-Death tab's Instinct write-in saves what is typed (R13).

import { describe, expect, it, vi } from "vitest";
import { readRepo } from "../../fakes/css.js";
import { FakeActorBuilder } from "../../fakes/FakeActorBuilder.js";
import { zeroHpMove, zeroHpResolution } from "../../../module/actors/character/deaths-door.js";
import { composeInstinct } from "../../../module/utils/strings.js";

const focus = vi.hoisted(() => ({ openOrFocus: vi.fn(async (id, open) => open()) }));
vi.mock("../../../module/utils/open-or-focus.js", () => ({ openOrFocus: focus.openOrFocus }));

const { createStonetopCharacterSheetClass } = await import("../../../module/actors/character/StonetopCharacterSheet.js");
const { UndeathDialog } = await import("../../../module/actors/character/dialogs/UndeathDialog.js");

function makeSheet({ editable = true } = {}) {
	const actor = new FakeActorBuilder().build();
	actor.id = "vess";
	const Base = class {
		get actor() { return actor; }
		get isEditable() { return editable; }
		activateListeners() {}
		render = vi.fn();
	};
	const Sheet = createStonetopCharacterSheetClass(Base);
	return new Sheet();
}

/** The sheet's html as the write-in handlers use it: `.on` recorders, `.val` from `values`, `.prop` writes. */
function fakeHtml(values = {}) {
	const handlers = {}, props = [];
	const html = {
		find: sel => ({
			on: (evt, fn) => { (handlers[`${sel}|${evt}`] ??= []).push(fn); },
			val: () => values[sel] ?? "",
			prop: (key, value) => props.push({ sel, key, value }),
		}),
	};
	return { html, handlers, props };
}

describe("_onUndeathOpen", () => {
	it("opens the walkthrough through openOrFocus, under UndeathDialog's id for this character", async () => {
		const sheet = makeSheet();
		sheet._stonetopCharacter = { zeroHpMove: zeroHpMove("revenant"), zeroHpResolution: zeroHpResolution("revenant") };
		const opened = vi.spyOn(UndeathDialog, "open").mockResolvedValue({});
		try {
			await sheet._onUndeathOpen();
			expect(focus.openOrFocus).toHaveBeenCalledTimes(1);
			expect(focus.openOrFocus.mock.calls[0][0]).toBe(UndeathDialog.idFor("vess"));
			expect(UndeathDialog.idFor("vess")).toBe("stonetop-undeath-dialog-vess");
			expect(opened).toHaveBeenCalledWith(sheet._stonetopCharacter, expect.any(Function));
		} finally {
			opened.mockRestore();
		}
	});
});

describe("the Post-Death tab's Instinct write-in", () => {
	const WORD = ".stonetop-pdi-instinct-custom-word";
	const DESC = ".stonetop-pdi-instinct-custom-desc";
	const BOTH = `${WORD}, ${DESC}`;

	it("is wired from activateListeners", () => {
		const js = readRepo("module/actors/character/StonetopCharacterSheet.js");
		const body = js.slice(js.indexOf("\t\tactivateListeners(html) {"));
		expect(body.indexOf("this._wirePostDeathInstinctWriteIn(html);")).toBeGreaterThan(-1);
	});

	it("saves the word and its description as one Instinct, and unticks the printed three", () => {
		const sheet = makeSheet();
		sheet._stonetopCharacter = { setPostDeathInstinct: vi.fn() };
		const { html, handlers, props } = fakeHtml({ [WORD]: " Regret ", [DESC]: "To make amends." });
		sheet._wirePostDeathInstinctWriteIn(html);

		handlers[`${BOTH}|change`][0]();
		expect(sheet._stonetopCharacter.setPostDeathInstinct).toHaveBeenCalledWith(composeInstinct("Regret", "To make amends."));
		expect(props).toContainEqual({ sel: ".stonetop-pdi-instinct", key: "checked", value: false });
	});

	it("keeps the word one token as it is typed", () => {
		const sheet = makeSheet();
		const { html, handlers } = fakeHtml();
		sheet._wirePostDeathInstinctWriteIn(html);
		const target = { value: "Old Regret" };
		handlers[`${WORD}|input`][0]({ currentTarget: target });
		expect(target.value).toBe("OldRegret");
	});

	it("clears a written-in Instinct when both boxes are emptied, and writes nothing on a sheet the reader may not edit", () => {
		const blank = makeSheet();
		blank._stonetopCharacter = { setPostDeathInstinct: vi.fn() };
		const one = fakeHtml();
		blank._wirePostDeathInstinctWriteIn(one.html);
		one.handlers[`${BOTH}|change`][0]();
		expect(blank._stonetopCharacter.setPostDeathInstinct).toHaveBeenCalledWith("");

		const locked = makeSheet({ editable: false });
		locked._stonetopCharacter = { setPostDeathInstinct: vi.fn() };
		const two = fakeHtml({ [WORD]: "Regret" });
		locked._wirePostDeathInstinctWriteIn(two.html);
		two.handlers[`${BOTH}|change`][0]();
		expect(locked._stonetopCharacter.setPostDeathInstinct).not.toHaveBeenCalled();
	});
});
