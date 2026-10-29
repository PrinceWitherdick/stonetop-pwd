// Level Up and the take-the-insert walkthrough, 2026-10-27: step 6 points an insert PC at the Post-Death
// tab (LV-3), a written-in insert Instinct answers the chooser (R13), the moves an insert takes Death's Door
// away from say so on their Level Up row (LV-6), and the chooser's typed answers survive Escape (LV-5).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { composeInstinct } from "../../../module/utils/strings.js";
import { LevelUpDialog, insertInertNote } from "../../../module/actors/character/dialogs/LevelUpDialog.js";
import { StonetopCharacter } from "../../../module/actors/character/StonetopCharacter.js";
import { DEATHS_DOOR_STATE } from "../../../module/actors/character/deaths-door.js";
import { buildPostDeathChoices, flushPostDeathChoices } from "../../../module/actors/character/post-death-choices.js";
import { DeathsDoorDialog } from "../../../module/actors/character/dialogs/DeathsDoorDialog.js";
import { FakeRepositoryFactory } from "../../fakes/FakeRepositoryFactory.js";
import { FakePostDeathInsertRepository } from "../../fakes/FakePostDeathInsertRepository.js";
import { makeLiveActor } from "../../fakes/LiveCharacter.js";
import { readRepo } from "../../fakes/css.js";

const INSERTS = ["revenant", "ghost", "thrall"].map(slug =>
	JSON.parse(readRepo(`packs/src/stonetop-items/post-death-inserts/${slug}.json`)));

function makeUndead(slug, { insert = {}, flags = {} } = {}) {
	const actor = makeLiveActor({
		name: "Vess",
		flags: { deathsDoor: DEATHS_DOOR_STATE.OUT_OF_ACTION, postDeathInsert: { slug, ...insert }, ...flags },
	});
	const factory = new FakeRepositoryFactory({
		postDeathInsert: new FakePostDeathInsertRepository(INSERTS),
		moves: { getPostDeathMoves: async () => [] },
	});
	return { actor, char: new StonetopCharacter(actor, factory) };
}

function levelUp(data = {}, character = {}) {
	const dlg = new LevelUpDialog({ _actor: { id: "pcA" }, ...character }, {
		level: 2, newLevel: 3, cost: 10, xpRemaining: 0, playbookName: "The Heavy", needsInvocation: false,
		availableMoves: [], lockedMoves: [], availableInvocations: [], stats: [], ...data,
	}, vi.fn());
	dlg.render = vi.fn();
	return dlg;
}

// The move step asks a world setting whether this user may write a custom move.
let priorSettings;
beforeEach(() => { priorSettings = game.settings; game.settings ??= { get: () => undefined }; });
afterEach(() => { game.settings = priorSettings; });

const REVENANT = { postDeathSlug: "revenant", zeroHpMove: { name: "Undying", dialog: false } };

describe("LV-3: step 6 points an insert PC at the Post-Death tab", () => {
	it("their insert's Instinct, a temporary one ending, and one not chosen yet", () => {
		expect(levelUp({ insertInstinctName: "Ghost" }, REVENANT)._reviewLine()).toMatch(/Post-Death tab/);
		const temp = levelUp({ temporaryInstinct: "Birdlike" }, REVENANT)._reviewLine();
		expect(temp).toMatch(/"Birdlike" ends/);
		expect(temp).toMatch(/insert's Instinct is back/);
		expect(temp).toMatch(/Post-Death tab/);
		expect(levelUp({}, REVENANT)._reviewLine()).toMatch(/choose your Instinct on the Post-Death tab/);
		// Everyone else is still sent to Details.
		expect(levelUp({ temporaryInstinct: "Birdlike" })._reviewLine()).not.toMatch(/Post-Death/);
	});
});

describe("R13: a written-in insert Instinct answers the chooser's Instinct step", () => {
	it("done on a value that is none of the three printed", async () => {
		const { char } = makeUndead("ghost");
		const before = await buildPostDeathChoices(char);
		expect(before.steps.find(s => s.key === "instinct").done).toBe(false);
		await char.setPostDeathInstinct(composeInstinct("Wrath", "To make the living hurt as I do."));
		const after = await buildPostDeathChoices(char);
		expect(after.steps.find(s => s.key === "instinct").done).toBe(true);
	});
});

describe("LV-6: Level Up says which moves never fire for an insert PC", () => {
	it("Hard to Kill and Unstoppable never; Never Gonna Keep Me Down only its Door half", () => {
		expect(insertInertNote("Hard to Kill", "Undying")).toMatch(/Never fires for you: at 0 HP you face Undying/);
		expect(insertInertNote("Unstoppable", "Tethered")).toMatch(/Tethered/);
		expect(insertInertNote("Never Gonna Keep Me Down", "Dark Succor")).toMatch(/Its Death's Door half/);
		expect(insertInertNote("Carved Out of Wood", "Undying")).toBeNull();
		expect(insertInertNote("Hard to Kill", null)).toBeNull();
	});

	it("on the row, only for a character wearing an insert, and the row stays pickable", () => {
		const moves = [{ compendiumId: "h", name: "Hard to Kill", description: "" }];
		const undead = levelUp({ availableMoves: moves }, REVENANT).getData();
		expect(undead.moves[0].insertNote).toMatch(/Undying/);
		const living = levelUp({ availableMoves: moves }, { zeroHpMove: { name: "Death's Door", dialog: true } }).getData();
		expect(living.moves[0].insertNote).toBeNull();
	});
});

describe("LV-5: the chooser's typed answers survive a close that fires no change", () => {
	const field = (cls, dataset, value) => ({ classList: { contains: c => cls.includes(c) }, dataset, value });
	const htmlOf = byClass => ({ find: sel => ({ toArray: () => sel.split(",").flatMap(s => byClass[s.trim()] ?? []) }) });

	it("writes a name and a tether typed but not saved, and nothing that is already stored", async () => {
		const { char } = makeUndead("ghost", { flags: { postDeathLore: { texts: { "terrible-purpose:vengeance": "Old" } } } });
		const set = vi.spyOn(char, "setPostDeathLoreText");
		await flushPostDeathChoices(htmlOf({
			".stonetop-pdc-name": [field(["stonetop-pdc-name"], { section: "terrible-purpose", option: "longing" }, "My daughter"),
				field(["stonetop-pdc-name"], { section: "terrible-purpose", option: "vengeance" }, "Old")],
			".stonetop-pdc-tether": [field(["stonetop-pdc-tether"], {}, "The oak")],
		}), char);
		expect(char.postDeathLoreText("terrible-purpose", "longing")).toBe("My daughter");
		expect(set).toHaveBeenCalledTimes(1);
		expect(char.tether).toBe("The oak");
	});

	// Audit VL-3 (2026-10-28): the flush is the window's own close, on the choices step only.
	it("is what DeathsDoorDialog#close does on the choices step, and not on another step", async () => {
		const fields = {
			".stonetop-pdc-name": [field(["stonetop-pdc-name"], { section: "terrible-purpose", option: "longing" }, "My daughter")],
			".stonetop-pdc-tether": [field(["stonetop-pdc-tether"], {}, "The oak")],
		};
		const windowOf = () => ({ find: sel => ({ length: 0, val: () => null, ...htmlOf(fields).find(sel) }) });

		const open = makeUndead("ghost");
		const choosing = new DeathsDoorDialog(open.char, () => {});
		choosing._step = "choices";
		choosing.element = windowOf();
		await choosing.close();
		expect(open.char.postDeathLoreText("terrible-purpose", "longing")).toBe("My daughter");
		expect(open.char.tether).toBe("The oak");

		const other = makeUndead("ghost");
		const rolling = new DeathsDoorDialog(other.char, () => {});
		rolling._step = "result";
		rolling.element = windowOf();
		await rolling.close();
		expect(other.char.tether).toBe("");
	});
});
