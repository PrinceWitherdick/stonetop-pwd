import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
	getAskRollModeEachRollSetting, getPromptRollModifierSetting, getPromptDamageModifierSetting,
	getOpenSheetsInEditMode, getHoverDescriptionSetting, getRollStatChipsSetting,
	getTimelineOrientation, getTimelineThreadsChosen, getTimelineKindColours, getTimelineAgeColourSeq,
	getSheetSize, getCrewSectionsOpen, getSidebarCollapsed, getSettingOverviewShown,
} from "../../module/settings.js";

// Core's ClientSettings#get THROWS on a key it has no registration for; it does not return
// undefined. So `game.settings?.get?.(…) ?? default` does not deliver the default it promises:
// before `init` has registered the settings, in a world one build behind the key, or in a test,
// the read takes its caller down. Every getter here answers with its shipped default instead.

let priorGame;
beforeEach(() => { priorGame = global.game; });
afterEach(() => { global.game = priorGame; });

const unregistered = () => {
	global.game = {
		...priorGame,
		world: { id: "w" },
		settings: { get: (ns, key) => { throw new Error(`${ns}.${key} is not a registered game setting`); } },
	};
};
const stored = values => {
	global.game = { ...priorGame, world: { id: "w" }, settings: { get: (ns, key) => values[key] } };
};

describe("the settings getters, on an unregistered key", () => {
	beforeEach(unregistered);

	it("answer with their shipped defaults instead of throwing", () => {
		expect(getAskRollModeEachRollSetting()).toBe(false);
		expect(getPromptRollModifierSetting()).toBe(false);
		expect(getPromptDamageModifierSetting()).toBe(true);
		expect(getOpenSheetsInEditMode()).toBe(false);
		expect(getHoverDescriptionSetting("hoverDescriptionsTraits")).toBe(true);
		expect(getHoverDescriptionSetting("hoverDescriptionsTraits", { ignoreMaster: true })).toBe(true);
		expect(getRollStatChipsSetting()).toBe(true);
		expect(getTimelineOrientation()).toBe("horizontal");
		expect(getTimelineThreadsChosen()).toBe(false);
		expect(getTimelineKindColours()).toEqual({});
		expect(getTimelineAgeColourSeq()).toBe(0);
		expect(getSheetSize("a")).toEqual({ width: null, height: null });
		expect(getCrewSectionsOpen("a")).toEqual([]);
		expect(getSidebarCollapsed("a")).toBe(false);
		expect(getSettingOverviewShown()).toBe(false);
	});
});

describe("the settings getters, on a stored value", () => {
	it("still read what is stored", () => {
		stored({
			askRollModeEachRoll: true, promptRollModifier: true, promptDamageModifier: false,
			openSheetsInEditMode: true, showRollStatChips: false, timelineOrientation: "vertical",
			timelineThreadsChosen: true, timelineAgeColourSeq: 3, sheetSizes: { a: { width: 500, height: 600 } },
			crewSectionsOpen: { a: ["x"] }, characterSidebarCollapsed: { a: true },
			settingOverviewShown: { w: true },
		});
		expect(getAskRollModeEachRollSetting()).toBe(true);
		expect(getPromptRollModifierSetting()).toBe(true);
		expect(getPromptDamageModifierSetting()).toBe(false);
		expect(getOpenSheetsInEditMode()).toBe(true);
		expect(getRollStatChipsSetting()).toBe(false);
		expect(getTimelineOrientation()).toBe("vertical");
		expect(getTimelineThreadsChosen()).toBe(true);
		expect(getTimelineAgeColourSeq()).toBe(3);
		expect(getSheetSize("a")).toEqual({ width: 500, height: 600 });
		expect(getCrewSectionsOpen("a")).toEqual(["x"]);
		expect(getSidebarCollapsed("a")).toBe(true);
		expect(getSettingOverviewShown()).toBe(true);
	});

	it("turns a hover description off by its own switch or by the master", () => {
		stored({ hoverDescriptionsEnabled: true, hoverDescriptionsTraits: false });
		expect(getHoverDescriptionSetting("hoverDescriptionsTraits")).toBe(false);
		stored({ hoverDescriptionsEnabled: false, hoverDescriptionsTraits: true });
		expect(getHoverDescriptionSetting("hoverDescriptionsTraits")).toBe(false);
		expect(getHoverDescriptionSetting("hoverDescriptionsTraits", { ignoreMaster: true })).toBe(true);
	});
});
