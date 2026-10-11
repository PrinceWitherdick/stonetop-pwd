import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { createStonetopCharacterSheetClass } from "../../../module/actors/character/StonetopCharacterSheet.js";

// The stat block — stats, debilities, damage/HP/armor/XP/level — sits in one of two places
// depending on the user's layout setting (`classicLayout` + `classicLayoutCharacter`, see
// module/settings.js). MODERN heads the Moves tab with it, so the other pages don't pay its
// ~270px; CLASSIC pins it above the tabs on every page, which is where it lived before the
// redesign. Either way the portrait, playbook, name, appearance and wounds line stay pinned.
//
// It is ONE partial mounted in two places, under complementary guards. That is not tidiness:
// every field in it is a named input, so a double mount gives FormDataExtended two
// `system.attributes.*` entries per field, it collapses them into arrays, and the next submit
// writes garbage. Renders fine, corrupts on save.
//
// These guard the wiring that makes that true. Layout is verified in a browser, not here.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const read = rel => fs.readFileSync(path.resolve(HERE, "../../..", rel), "utf8");

const CHARACTER_HBS = read("templates/actor/character.hbs");
const MOVES_HBS = read("templates/actor/partials/tab-moves.hbs");
const STAT_BLOCK_HBS = read("templates/actor/partials/stat-block.hbs");
const STONETOP_JS = read("stonetop.js");
const CSS = read("styles/stonetop.css");

/** Everything the template renders BEFORE `.sheet-main` — i.e. what is always on screen. */
const alwaysVisible = CHARACTER_HBS.slice(0, CHARACTER_HBS.indexOf('<section class="sheet-main'));

describe("character sheet stat block", () => {
	it("keeps the block itself in one partial", () => {
		expect(STAT_BLOCK_HBS).toContain('{{> "stonetop.actor-stats"}}');
		expect(STAT_BLOCK_HBS).toContain('{{> "stonetop.actor-vitals"}}');
		expect(STAT_BLOCK_HBS).toContain("stonetop-debilities");

		// Neither mount may inline the sub-partials instead of including stonetop.stat-block —
		// two copies of this markup is the corruption case above.
		expect(alwaysVisible).not.toContain("stonetop.actor-stats");
		expect(alwaysVisible).not.toContain("stonetop.actor-vitals");
		expect(alwaysVisible).not.toContain("stonetop-debilities");
		expect(MOVES_HBS).not.toContain("stonetop.actor-stats");
		expect(MOVES_HBS).not.toContain("stonetop.actor-vitals");
	});

	// The invariant that matters: exactly one of the two mounts is live for any given user.
	it("mounts above the tabs in classic and in the Moves tab in modern, never both", () => {
		expect(alwaysVisible).toContain('{{#if stonetop.classicLayout}}{{> "stonetop.stat-block"}}{{/if}}');
		expect(MOVES_HBS).toContain('{{#unless stonetop.classicLayout}}{{> "stonetop.stat-block"}}{{/unless}}');

		// One reference each, so neither guard can be bypassed by a second unguarded include.
		expect(CHARACTER_HBS.match(/stonetop\.stat-block/g)).toHaveLength(1);
		expect(MOVES_HBS.match(/stonetop\.stat-block/g)).toHaveLength(1);
	});

	// The classic mount goes ABOVE the wounds line: at HEAD one `.sheet-top` box held both, and
	// putting the block below would invert the reading order and divorce the wounds line from
	// the HP cell whose "add wound" control it belongs to.
	it("puts the classic mount above the wounds line", () => {
		expect(alwaysVisible.indexOf('{{> "stonetop.stat-block"}}'))
			.toBeLessThan(alwaysVisible.indexOf("stonetop-wounds"));
	});

	// The stats a player rolls with should be the first thing on the page they roll from,
	// above the love letters and every move group.
	it("heads the page, above the move groups", () => {
		expect(MOVES_HBS.indexOf('{{> "stonetop.stat-block"}}'))
			.toBeLessThan(MOVES_HBS.indexOf("stonetop-love-letters-section"));
		expect(MOVES_HBS.indexOf('{{> "stonetop.stat-block"}}'))
			.toBeLessThan(MOVES_HBS.indexOf("stonetop.movelist.playbookMoves"));
	});

	// pbta's own stylesheet skins the vitals through `.pbta.sheet .sheet-wrapper .sheet-top
	// .sheet-attributes-top …` chains, and our 2:1 HP/XP width rule matches that specificity
	// on purpose. Descendant selectors, so they still resolve from inside the tab — but only
	// while the wrapper keeps the class.
	it("keeps the .sheet-top wrapper pbta's stylesheet skins the vitals through", () => {
		expect(STAT_BLOCK_HBS).toMatch(/<section class="sheet-top/);
	});

	it("keeps the portrait header and the wounds line always visible", () => {
		expect(alwaysVisible).toContain('{{> "stonetop.actor-header"}}');
		expect(alwaysVisible).toContain("stonetop-wounds");
	});

	it("registers the partial", () => {
		expect(STONETOP_JS).toContain('"stonetop.stat-block":');
	});

	// There is no Overview page any more: no panel, no rail tab, no CSS reaching for one.
	// `[data-tab="overview"]` still exists as a STEADING key, which is why the check is scoped.
	it("leaves no Overview tab behind on the character sheet", () => {
		expect(CHARACTER_HBS).not.toContain("tab-overview");
		expect(CHARACTER_HBS).not.toContain('tab="overview"');
		expect(STONETOP_JS).not.toContain("stonetop.tab-overview");
		expect(CSS).not.toContain(".pbta.sheet.actor.character .tab.overview");
		expect(CSS).not.toContain('.pbta.sheet.actor.character .stonetop-tab-rail .item[data-tab="overview"]');
		expect(fs.existsSync(path.resolve(HERE, "../../..", "templates/actor/partials/tab-overview.hbs"))).toBe(false);
	});

	// The level-up cue lived in the vitals row, which the modern layout put behind a tab, so it
	// has to reach the rail there or a player reading any other page never learns they can
	// advance. (Classic pins the vitals above the tabs and draws the cue there, so it needs no
	// dot; the attention class is still stamped on the classic anchor for a future rule.)
	//
	// The regex is LINE-ANCHORED, so the nav must stay in character.hbs with one entry per line.
	it("raises the level-up cue on the Moves rail tab", () => {
		expect(CHARACTER_HBS).toMatch(/tab="moves"[^\n]*attention=stonetop\.canLevelUp/);
		expect(read("templates/actor/partials/tab-rail-item.hbs")).toContain("stonetop-tab-attention");
		expect(read("templates/actor/partials/tab-nav-item.hbs")).toContain("stonetop-tab-attention");
		expect(CSS).toContain(".stonetop-tab-attention::after");
	});

	// One <nav>, not two behind {{#if}}/{{else}}: the nine-entry list carries four conditionals,
	// and two copies of that is exactly what drifts. Only the rail CLASS is conditional.
	it("renders a single nav whose rail class is the only conditional part", () => {
		expect(CHARACTER_HBS.match(/<nav class="sheet-tabs/g)).toHaveLength(1);
		expect(CHARACTER_HBS).toContain('<nav class="sheet-tabs tabs{{#unless stonetop.classicLayout}} stonetop-tab-rail{{/unless}}"');
	});
});

describe("tab order merge", () => {
	const sheet = () => {
		const Base = class {
			get actor() { return { getFlag: () => null }; }
			get isEditable() { return true; }
		};
		return new (createStonetopCharacterSheetClass(Base))();
	};
	const TEMPLATE = ["moves", "inventory", "details", "special-moves"];

	// A saved order is a snapshot of the rail on the day it was dragged, so a tab added since
	// is missing from it. Appending those at the end would bury every new page at the bottom
	// of the rail for exactly the players who reorder.
	it("drops a brand-new tab into its template position, not at the end", () => {
		const saved = ["special-moves", "inventory", "details"]; // pre-Moves
		expect(sheet()._mergeTabOrder(saved, TEMPLATE)).toEqual(["moves", "special-moves", "inventory", "details"]);
	});

	it("keeps a new tab beside the template neighbour above it", () => {
		const saved = ["special-moves", "moves", "details"]; // no `inventory` yet
		expect(sheet()._mergeTabOrder(saved, TEMPLATE)).toEqual(["special-moves", "moves", "inventory", "details"]);
	});

	it("leaves a saved order that covers every tab alone", () => {
		const saved = ["special-moves", "details", "inventory", "moves"];
		expect(sheet()._mergeTabOrder(saved, TEMPLATE)).toEqual(saved);
	});

	// Arcana, Followers and Post-Death come and go with the character.
	it("drops keys whose tab is not rendered", () => {
		const saved = ["arcana", "details", "post-death", "moves"];
		expect(sheet()._mergeTabOrder(saved, ["moves", "details"])).toEqual(["details", "moves"]);
	});

	// Notes is the last page about the character ALWAYS (user's call, 2026-10-10), and Settings sits
	// below even Notes (user's call, 2026-10-03): not where either was dragged, and not under a
	// Timeline that a saved order holds below Notes.
	it("pins Notes, then Settings, last whatever the saved order says", () => {
		const template = ["moves", "timeline", "notes", "preferences"];
		expect(sheet()._mergeTabOrder(["preferences", "notes", "moves", "timeline"], template))
			.toEqual(["moves", "timeline", "notes", "preferences"]);
		expect(sheet()._mergeTabOrder(["moves", "notes", "timeline"], template))
			.toEqual(["moves", "timeline", "notes", "preferences"]);
		expect(sheet()._mergeTabOrder(["timeline", "moves"], template))
			.toEqual(["timeline", "moves", "notes", "preferences"]);
		expect(sheet()._mergeTabOrder(["notes", "moves"], ["moves", "notes"])).toEqual(["moves", "notes"]);
	});

	// The rail and the template agree: Timeline is written above Notes, so a fresh sheet needs no
	// merge to read the same way.
	it("writes Notes as the last character page in the template", () => {
		const hbs = CHARACTER_HBS;
		const navKeys = [...hbs.matchAll(/tab-nav-item" tab="([\w-]+)"/g)].map(m => m[1]);
		expect(navKeys.slice(-2)).toEqual(["notes", "preferences"]);
		const panels = [...hbs.matchAll(/\{\{> "stonetop\.tab-([\w-]+)"\}\}/g)].map(m => m[1]);
		expect(panels.slice(-2)).toEqual(["notes", "preferences"]);
	});
});
