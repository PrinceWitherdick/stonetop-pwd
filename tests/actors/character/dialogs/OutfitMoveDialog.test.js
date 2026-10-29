import { describe, it, expect, vi } from "vitest";
import { OutfitMoveDialog, OUTFIT_ID_PREFIX } from "../../../../module/actors/character/dialogs/OutfitMoveDialog.js";
import { StonetopDialog } from "../../../../module/utils/stonetop-dialog.js";

// "You can select: ... Any of your special possessions." The window used to build its lists from
// the columns, treasures and arcana alone, so special-possession gear the sheet counts toward load
// was missing here: 0 load in Outfit, heavy on the sheet, and no way to mark or unmark it.
function snapshot(overrides = {}) {
	return {
		regularSegments: [{ items: [{ slug: "rope", name: "Rope", weight: 1, checked: false }] }],
		smallItems: [{ slug: "chalk", name: "Chalk", checked: false }],
		smallItemLimit: 5,
		prosperityKnown: true,
		possessionRegular: [
			{ slug: "hook", name: "Grappling hook", note: "Burglar's kit", weight: 1, checked: true },
			{ slug: "weapons-of-war:long-spear", name: "Long spear", note: "Weapons of war", weight: 2, checked: true },
		],
		possessionSmall: [
			{ slug: "picks", name: "Lockpicks", note: "Burglar's kit", weight: 1, checked: true },
		],
		...overrides,
	};
}

describe("OutfitMoveDialog: special-possession gear", () => {
	it("lists the gear under its own rows in each column, with its current marks", () => {
		const data = new OutfitMoveDialog({}, snapshot(), null).getData();
		expect(data.possessionRegular.map(r => [r.slug, r.checked])).toEqual([["hook", true], ["weapons-of-war:long-spear", true]]);
		expect(data.possessionSmall.map(r => [r.slug, r.checked])).toEqual([["picks", true]]);
		expect(data.hasPossessionRegular).toBe(true);
		expect(data.hasPossessionSmall).toBe(true);
	});

	it("counts marked possession gear toward load and the small allowance, as the sheet does", () => {
		const dialog = new OutfitMoveDialog({}, snapshot(), null);
		let data = dialog.getData();
		expect(data.totalMarks).toBe(3);
		expect(data.totalSmallMarks).toBe(1);

		dialog._checked.hook = false;
		dialog._checked.picks = false;
		data = dialog.getData();
		expect(data.totalMarks).toBe(2);
		expect(data.totalSmallMarks).toBe(0);
	});

	it("hands every possession row's mark, unmarked ones included, to applyOutfit", async () => {
		const character = { applyOutfit: vi.fn(async () => {}) };
		const dialog = new OutfitMoveDialog(character, snapshot(), null);
		dialog._checked["weapons-of-war:long-spear"] = false;
		await dialog._applyOutfit();
		const [marks] = character.applyOutfit.mock.calls[0];
		expect(marks).toMatchObject({ hook: true, picks: true, "weapons-of-war:long-spear": false, rope: false, chalk: false });
	});

	// Book I p.327: "If they want to carry 10 ◇ or more...". The window folded that into heavy while
	// the sheet it wrote to said overloaded.
	it("says overloaded past heavy, as the sheet does, with the heavy band lit", () => {
		const data = new OutfitMoveDialog({}, snapshot({
			regularSegments: [{ items: [{ slug: "anvil", name: "Anvil", weight: 11, checked: true }] }],
			possessionRegular: [],
		}), null).getData();
		expect(data.totalMarks).toBe(11);
		expect(data.loadLevelOverloaded).toBe(true);
		expect(data.loadLevelHeavy).toBe(true);
	});

	// "4 plus Stonetop's current Prosperity (+0 by default)" (Book I p.88): the snapshot's limit is
	// already 4+0 when it can't be read (StonetopCharacter#getSmallItemLimit), and the window holds the
	// undefined □ to it; it prints the limit line only when Prosperity was read.
	it("holds the undefined small items to the snapshot's limit, and prints it only when Prosperity was read", () => {
		const dialog = new OutfitMoveDialog({}, snapshot({ smallItemLimit: 4, prosperityKnown: false, possessionSmall: [] }), null);
		dialog._undefinedSmall = 9;
		expect(dialog.getData().smallPool.current).toBe(4);
		expect(dialog.getData().hasSmallItemLimit).toBe(false);
		expect(new OutfitMoveDialog({}, snapshot(), null).getData()).toMatchObject({ smallItemLimit: 5, hasSmallItemLimit: true });
	});

	// One window per character: two shared one id, and the second painted into the first's frame.
	it("takes an id of its own per character", () => {
		const spy = vi.spyOn(StonetopDialog, "perDocumentOptions");
		new OutfitMoveDialog({ _actor: { id: "pc-a" } }, snapshot(), null, { classes: ["x"] });
		expect(spy).toHaveBeenCalledWith(OUTFIT_ID_PREFIX, "pc-a", { classes: ["x"] });
		expect(spy.mock.results[0].value.id).toBe("stonetop-outfit-dialog-pc-a");
		spy.mockRestore();
	});

	// The undefined reserves are drawn as the Inventory tab's tracks: every box of the heavy load
	// and of the small allowance, with the room the marked items leave as the click cap.
	it("draws the undefined reserves as full tracks, capped by the room the marks leave", () => {
		const dialog = new OutfitMoveDialog({}, snapshot(), null);
		dialog._undefinedRegular = 2;
		const data = dialog.getData();
		expect(data.regularPool).toEqual({ current: 2, max: 9 });
		expect(data.regularPoolCap).toBe(6);
		expect(data.smallPool).toEqual({ current: 0, max: 5 });
		expect(data.smallPoolCap).toBe(4);
	});

	it("sets a reserve from the box clicked, clears back to a filled one, and stops at the room left", () => {
		const warn = vi.fn();
		globalThis.ui = { notifications: { warn } };
		globalThis.game = { ...globalThis.game, i18n: { localize: k => k } };
		const dialog = new OutfitMoveDialog({}, snapshot(), null);
		dialog._setPoolFromClick(false, 4, true);
		expect(dialog._undefinedRegular).toBe(5);
		dialog._setPoolFromClick(false, 2, false);
		expect(dialog._undefinedRegular).toBe(2);
		// 3 ◇ marked leaves room for 6: a click on the 9th box fills to 6, quietly.
		dialog._setPoolFromClick(false, 8, true);
		expect(dialog._undefinedRegular).toBe(6);
		expect(warn).not.toHaveBeenCalled();
		dialog._setPoolFromClick(false, 8, true);
		expect(dialog._undefinedRegular).toBe(6);
		expect(warn).toHaveBeenCalledWith("stonetop.inventory.regularPoolAtLimit");
		dialog._setPoolFromClick(true, 1, true);
		expect(dialog._undefinedSmall).toBe(2);
	});

	// The standard small items sit in a two-column grid under the list, as on the Inventory tab,
	// and still count against the allowance like the rest.
	it("hands the standard small items over apart from the list, still counting them", () => {
		const dialog = new OutfitMoveDialog({}, snapshot({
			smallGridItems: [{ slug: "awl", name: "Awl", checked: true }, { slug: "cup", name: "Cup", checked: false }],
			treasureSmall: [{ slug: "coin", name: "Old coin", checked: false }],
		}), null);
		const data = dialog.getData();
		expect(data.smallItems.map(r => r.slug)).toEqual(["chalk", "coin"]);
		expect(data.smallGridItems.map(r => [r.slug, r.checked])).toEqual([["awl", true], ["cup", false]]);
		expect(data.totalSmallMarks).toBe(2);
	});

	// Every mark re-renders the window, and each list used to come back scrolled to its top.
	it("keeps both lists' and the body's scroll place, and the ticked box's keyboard, through a redraw", () => {
		expect(OutfitMoveDialog.defaultOptions.scrollY).toEqual([".stonetop-outfit-regular-section", ".stonetop-outfit-small-section"]);
		const dialog = new OutfitMoveDialog({}, snapshot(), null);
		expect(dialog._keptScrollSelector).toBe(".stonetop-outfit-move-body");
		const box = (cls, dataset) => ({ classList: { contains: c => c === cls }, dataset });
		expect(dialog._focusSelector(box("stonetop-outfit-item-check", { slug: "weapons-of-war:long-spear" })))
			.toBe('.stonetop-outfit-item-check[data-slug="weapons-of-war:long-spear"]');
		expect(dialog._focusSelector(box("stonetop-outfit-item-check", { slug: 'a"b' })))
			.toBe('.stonetop-outfit-item-check[data-slug="a\\"b"]');
		expect(dialog._focusSelector(box("stonetop-small-pool-display", { index: "2" })))
			.toBe('.stonetop-small-pool-display[data-index="2"]');
		expect(dialog._focusSelector(box("stonetop-regular-pool-btn", { index: "0" })))
			.toBe('.stonetop-regular-pool-btn[data-index="0"]');
		expect(dialog._focusSelector(box("stonetop-outfit-confirm-btn", {}))).toBeNull();
	});

	// The running total sits above both lists. Left out until the first mark, it arrived then and
	// pushed them down a row: the first tick "jumped" though every scroll offset was kept.
	it("draws the running total even at none, hidden, so the first mark moves nothing", async () => {
		const { readFileSync } = await import("node:fs");
		const hbs = readFileSync("templates/dialogs/outfit-move.hbs", "utf8");
		expect(hbs).toMatch(/class="stonetop-outfit-weight-row\{\{#if loadLevelNone\}\} is-empty\{\{\/if\}\}"/);
		expect(hbs).not.toMatch(/\{\{#unless loadLevelNone\}\}/);
	});

	it("has no possession rows for a snapshot that carries none", () => {
		const data = new OutfitMoveDialog({}, snapshot({ possessionRegular: undefined, possessionSmall: undefined }), null).getData();
		expect(data.possessionRegular).toEqual([]);
		expect(data.hasPossessionRegular).toBe(false);
		expect(data.totalMarks).toBe(0);
	});
});
