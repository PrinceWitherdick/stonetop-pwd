import { afterEach, describe, expect, it } from "vitest";
import { readRepo as read } from "../fakes/css.js";
import { isTimelineEnabled } from "../../module/settings.js";

// THE TIMELINE IS BUILT, TESTED, AND NOT RELEASED, AND THIS IS WHAT KEEPS IT THAT WAY.
//
// Every other suite under tests/timeline/ proves the feature works. This one proves nobody can see
// it. The distinction matters because the code is all still here and all still imported: the
// modules load, the styles are in the sheet, the templates are preloaded. What separates "shipped"
// from "shipped dark" is a handful of guards in unrelated files, and a guard is exactly the kind of
// thing a later edit walks past without noticing.
//
// Read out of the SOURCE rather than exercised, for the same reason the settings suite is: these
// are init-time and world-setup-time call sites inside hooks that no unit test stands up. What can
// be checked is that the guard is written where it has to be, and that is what each case does.
//
// WHEN THE FEATURE SHIPS, this file is what gets deleted, and the deletion is the checklist: each
// case names one thing that has to be unwrapped.

const SETTINGS = read("module/settings.js");
const SYSTEM_JSON = JSON.parse(read("system.json"));
const EN = JSON.parse(read("languages/en.json"));

describe("the timeline's feature flag", () => {
	// tests/setup.js puts a shared `game` fake on the global for every suite (its i18n, mostly).
	// These cases swap in one with a settings stub and put the original back, rather than deleting
	// it: the fake belongs to the harness, and a suite that walks off with it breaks whichever file
	// runs next in the same worker.
	const realGame = globalThis.game;
	afterEach(() => { globalThis.game = realGame; });

	it("is registered as a hidden world switch that defaults to off", () => {
		// WORLD, not client: the feature is a set of shared journal pages, so one player seeing a
		// tab another does not would be a bug rather than a preference. `config: false` so nobody
		// at a table can switch on an unfinished feature by browsing the settings window.
		const block = /game\.settings\.register\(SYSTEM_ID, "timelineEnabled", \{([\s\S]*?)\n\t\}\);/.exec(SETTINGS);
		expect(block, "timelineEnabled is not registered").not.toBeNull();
		expect(block[1]).toMatch(/scope:\s*"world"/);
		expect(block[1]).toMatch(/config:\s*false/);
		expect(block[1]).toMatch(/default:\s*false/);
	});

	it("answers no for a world that has never heard of it", () => {
		// Three shapes of "never heard of it", and all three are real: no game at all (a macro or a
		// test running before `ready`), a game whose settings have not been registered, and a
		// registered key with nothing stored. Anything but a hard `false` from any of them would open
		// the doors below by accident.
		globalThis.game = undefined;
		expect(isTimelineEnabled()).toBe(false);
		globalThis.game = {};
		expect(isTimelineEnabled()).toBe(false);
		globalThis.game = { settings: { get: () => undefined } };
		expect(isTimelineEnabled()).toBe(false);
	});

	it("answers yes only when the world has actually been switched over", () => {
		globalThis.game = { settings: { get: (ns, key) => key === "timelineEnabled" } };
		expect(isTimelineEnabled()).toBe(true);
	});
});

describe("what the flag withholds", () => {
	// Each of these is one door. The assertion is deliberately shaped as "the call and the guard
	// are on the same line, or the guard opens the block the call is in", which is how all four
	// are actually written -- a guard further away is a guard somebody can move code out from
	// under.

	it("does not register the journal page model or sheet", () => {
		const src = read("stonetop.js");
		expect(src).toMatch(
			/if \(isTimelineEnabled\(\)\) \{[\s\S]*?CONFIG\.JournalEntryPage\.dataModels\["timeline"\][\s\S]*?StonetopTimelinePageSheet[\s\S]*?\n\t\}/);
	});

	it("does not mint a track page for anybody in WorldSetup", () => {
		// The lane that decides whether the timeline exists in a world at all: no track pages means
		// no Timeline entry in the Journal sidebar and nothing for either sheet's tab to find.
		expect(read("module/hooks/WorldSetup.js")).toContain("if (isTimelineEnabled()) await syncTrackPages();");
	});

	it("does not add a Seasons Change row", () => {
		expect(read("module/seasons/seasons-chronicle.js")).toMatch(
			/if \(isTimelineEnabled\(\)\) \{\s*\n\s*const \{ recordSeasonOnTimeline \} = await import\(/);
	});

	it("does not define game.stonetop.openTimeline", () => {
		expect(read("module/hooks/Ready.js")).toContain(
			"if (isTimelineEnabled()) game.stonetop.openTimeline = () => openTimelineWindow();");
	});

	it("draws no Timeline tab on either sheet", () => {
		// The guard is in the TEMPLATE, wrapped around the guard that was already there, because
		// that is how classic layout withholds this same tab: with no mount in the markup,
		// `syncTimelineTab` finds nothing and builds nothing (utils/mounted-panel-slot.js). So the
		// tab lifecycle in both sheets needs no flag of its own, and has none.
		for (const [tpl, nav, panel] of [
			["templates/actor/character.hbs", "stonetop.sheet.tabs.timeline", "stonetop.tab-timeline"],
			["templates/actor/steading.hbs", "stonetop.steading.tabs.timeline", "stonetop.steading-tab-timeline"],
		]) {
			const src = read(tpl);
			for (const frag of [nav, panel]) {
				const line = src.split("\n").find(l => l.includes(frag));
				expect(line, `${tpl}: no line mentions ${frag}`).toBeTruthy();
				expect(line.trim(), `${tpl}: ${frag} is not behind the flag`)
					.toMatch(/^\{\{#if stonetop\.timelineEnabled\}\}.*\{\{\/if\}\}$/);
			}
		}
	});

	it("feeds both sheets the answer the templates read", () => {
		// A template guard on a key nothing sets would hide the tab too, and would keep hiding it
		// after the flag is switched on. Both sheets set it beside their `classicLayout` line.
		for (const sheet of [
			"module/actors/character/StonetopCharacterSheet.js",
			"module/actors/steading/StonetopSteadingSheet.js",
		]) {
			expect(read(sheet), sheet).toContain("context.stonetop.timelineEnabled = isTimelineEnabled();");
		}
	});
});

describe("the manifest", () => {
	// THE ONE THING THE RUNTIME SWITCH CANNOT DO. A document subtype is declared in the manifest,
	// which is read long before any setting exists, so leaving `timeline` there would put "Timeline"
	// in core's Create-Page type dropdown in every shipped world -- and a page made from it would
	// have no model and no sheet, because the block in stonetop.js is behind the flag. So the
	// declaration comes out too, and goes back in by hand (with a WORLD RELAUNCH, since a reload
	// does not pick up a new subtype) to develop the feature.

	it("declares no timeline page type", () => {
		const types = SYSTEM_JSON.documentTypes?.JournalEntryPage ?? {};
		expect(Object.keys(types)).not.toContain("timeline");
		// The neighbours are still there, so this is a guard on one key rather than on the block
		// having survived at all.
		expect(Object.keys(types)).toEqual(
			expect.arrayContaining(["bestiary", "location", "chronicle", "threat", "hazard", "site"]));
	});

	it("carries no label for a type it does not declare", () => {
		// An orphaned TYPES entry is harmless at runtime and misleading to read: it is the only
		// place in the shipped files that would still name the feature.
		expect(EN.TYPES?.JournalEntryPage ?? {}).not.toHaveProperty("timeline");
	});
});

describe("what the flag deliberately does NOT withhold", () => {
	it("keeps logging when each season began", () => {
		// `seasonLogUpdate` rides along with the one write that moves the campaign's clock. It is an
		// invisible flag, it is the system's only record of WHEN a season turned, and it can only be
		// collected as it happens: a world that played a year with the switch off and then turned it
		// on would otherwise have no way to place its own history. So this call has no guard, and
		// must not grow one. See timeline/timeline-seasons.js.
		const src = read("module/seasons/current-season.js");
		expect(src).toContain("Object.assign(flags, seasonLogUpdate(actor, next) ?? {});");
		expect(src, "the season log must not be gated").not.toContain("isTimelineEnabled");
	});
});
