// The Lightbearer's Auspicious Birth on a debility box ticked by hand (user ruling 2026-10-18): "When one
// of your moves has you mark a debility, you may mark this background's circle instead, to no ill effect."
// A hand tick can be the GM's "mark a debility" or one of the character's moves, so with the circle clear
// the sheet asks which (StonetopCharacterSheet#_onDebilityBoxTick).
//
// Driven against the stateful LiveCharacter harness, so what markDebility writes is read back the way the
// sheet reads it.

import { describe, it, expect, vi, afterEach } from "vitest";
import { buildLiveCharacter, makeLiveItem, sourceMovesFor } from "../../fakes/LiveCharacter.js";
import { stubConfirm, stubAsk } from "../../fakes/confirm.js";
import { WALK_IT_OFF } from "../../../module/actors/character/walk-it-off.js";
import { createStonetopCharacterSheetClass } from "../../../module/actors/character/StonetopCharacterSheet.js";

const WALK_IT_OFF_SOURCE = sourceMovesFor("The Ranger").find(d => d.name === WALK_IT_OFF);

function lightbearer({ background = "auspicious-birth", circle = 0, walkItOff = false } = {}) {
	const items = walkItOff
		? [makeLiveItem({ name: WALK_IT_OFF, type: "move", system: structuredClone(WALK_IT_OFF_SOURCE.system) })]
		: [];
	const { char, actor } = buildLiveCharacter({
		slug: "the-lightbearer", name: "The Lightbearer", seedStartingMoves: false, items,
		flags: { background: { selected: background, setupResources: { "auspicious-birth": circle } } },
	});
	actor.typedActor = char;
	return { char, actor };
}

function sheetFor(char, actor) {
	const Base = class {
		get actor() { return actor; }
		get isEditable() { return true; }
		async getData() { return {}; }
		activateListeners() {}
		render = vi.fn();
	};
	const sheet = new (createStonetopCharacterSheetClass(Base))();
	sheet._stonetopCharacter = char;
	return sheet;
}
const tick = (key, checked = true) =>
	({ currentTarget: { name: `system.attributes.debilities.options.${key}.value`, checked }, stopPropagation: vi.fn() });
const circleOf = char => Number(char.background.setupResources["auspicious-birth"]) || 0;
const debilitiesMarked = actor => Object.entries(actor.system.attributes.debilities.options)
	.filter(([, o]) => o.value).map(([key]) => key);

afterEach(() => { delete globalThis.foundry?.applications?.api?.DialogV2; });

describe("a debility box ticked by hand with Auspicious Birth", () => {
	it("asks first, holding the tick back from the form, and marks only the circle when told to", async () => {
		const { char, actor } = lightbearer();
		const asked = stubConfirm(true);
		const ev = tick("weakened");
		sheetFor(char, actor)._onDebilityBoxTick(ev);
		expect(ev.stopPropagation).toHaveBeenCalled();
		expect(ev.currentTarget.checked).toBe(false);
		await vi.waitFor(() => expect(circleOf(char)).toBe(1));
		const config = asked.mock.calls[0][0];
		expect(config.content).toContain("Did one of your moves have you mark <strong>Weakened</strong>?");
		expect(config.buttons.map(b => b.label)).toEqual(["Mark the circle instead", "Mark the debility"]);
		expect(debilitiesMarked(actor)).toEqual([]);
	});

	it("marks the debility when that is the answer, and leaves the circle clear", async () => {
		const { char, actor } = lightbearer();
		stubConfirm(false);
		sheetFor(char, actor)._onDebilityBoxTick(tick("dazed"));
		await vi.waitFor(() => expect(debilitiesMarked(actor)).toEqual(["dazed"]));
		expect(circleOf(char)).toBe(0);
	});

	it("marks nothing when the question is closed, and re-renders the unticked box", async () => {
		const { char, actor } = lightbearer();
		const asked = stubConfirm(null);
		const sheet = sheetFor(char, actor);
		const ev = tick("miserable");
		sheet._onDebilityBoxTick(ev);
		await vi.waitFor(() => expect(sheet.render).toHaveBeenCalledWith(false));
		expect(asked).toHaveBeenCalledTimes(1);
		expect(ev.currentTarget.checked).toBe(false);
		expect(debilitiesMarked(actor)).toEqual([]);
		expect(circleOf(char)).toBe(0);
		expect(actor.update).not.toHaveBeenCalled();
	});

	it("does not ask once the circle is marked, nor without the background, nor when unticking", () => {
		const asked = stubConfirm(true);
		for (const who of [lightbearer({ circle: 1 }), lightbearer({ background: "itinerant-mystic" })]) {
			const ev = tick("weakened");
			sheetFor(who.char, who.actor)._onDebilityBoxTick(ev);
			expect(ev.stopPropagation).not.toHaveBeenCalled();
		}
		const { char, actor } = lightbearer();
		const off = tick("weakened", false);
		sheetFor(char, actor)._onDebilityBoxTick(off);
		expect(off.stopPropagation).not.toHaveBeenCalled();
		expect(asked).not.toHaveBeenCalled();
	});

	it("asks after Walk It Off, and only once the player still means to mark the debility itself", async () => {
		// Walk It Off's "Mark Weakened", then the circle's "Mark the circle instead".
		const answers = ["no", "yes"];
		const wait = vi.fn(async () => answers.shift() ?? null);
		stubAsk(null);
		globalThis.foundry.applications.api.DialogV2 = { wait };
		const { char, actor } = lightbearer({ walkItOff: true });
		sheetFor(char, actor)._onDebilityBoxTick(tick("weakened"));
		await vi.waitFor(() => expect(circleOf(char)).toBe(1));
		expect(wait.mock.calls.map(c => c[0].buttons[0].label)).toEqual([`Mark ${WALK_IT_OFF} instead`, "Mark the circle instead"]);
		expect(debilitiesMarked(actor)).toEqual([]);
	});

	it("does not ask about the circle once Walk It Off is chosen", async () => {
		const asked = stubConfirm(true);
		const { char, actor } = lightbearer({ walkItOff: true });
		sheetFor(char, actor)._onDebilityBoxTick(tick("weakened"));
		await vi.waitFor(() => expect(actor.update).toHaveBeenCalled());
		expect(asked).toHaveBeenCalledTimes(1);
		expect(circleOf(char)).toBe(0);
	});
});
