import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

// EVERY ROLL ON THIS SHEET IS MADE FROM THE THING ITSELF — a move from its title, a stat from
// its cell, the damage die from its readout. No dice icon stands beside any of them any more,
// and the switch that used to hide those icons is retired with them (the last section here).
//
// A MOVE IS ROLLED BY ITS TITLE, and by nothing else on the row.
//
// Every move row used to lead with a dice icon that carried the roll — `.rollable
// .move-rollable`, the stat on its `data-roll` — while the title beside it did something else
// entirely (posted the move's text to chat). Two doors onto one room, and the smaller one was
// the one that rolled. The name forwarded to the icon only when the "Hide Rollable Icon"
// setting had hidden it, so which door rolled depended on a checkbox in the settings window.
//
// Now the title IS the rollable: it carries the classes and the stat, the sheet's capture-phase
// rollable handler answers a click on it, and no move row draws a die at all. The rows that do
// not roll (a description-only move, an un-owned choice, an un-learned custom move) keep a plain
// name and fall through to the name handler, which posts their text.
//
// These pin the parts of that which are easy to undo by accident: an icon creeping back into one
// of the four templates, a title that lost the attributes the roll is read from, and the CSS rule
// that would hide the title outright.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const read = rel => fs.readFileSync(path.resolve(HERE, "../../..", rel), "utf8");

/** Markup only — the comments below the change discuss the icon that used to be there. */
const stripComments = hbs => hbs.replace(/\{\{!--[\s\S]*?--\}\}/g, "");

// The four places a character's moves are drawn: the Moves tab's playbook/basic cards, the
// classic Moves sidebar's one-line rows, and the two "other moves" lists (learned-from-elsewhere
// and player-authored). The steading's homefront moves are the same story on another sheet, and
// are guarded in tests/actors/steading/roll-prompt.test.js.
const MOVE_TEMPLATES = [
	["move card",       "templates/actor/partials/move-group.hbs"],
	["sidebar row",     "templates/actor/partials/sidebar-move-list.hbs"],
	["other-moves row", "templates/actor/partials/tab-moves.hbs"],
];

const SHEET_JS = read("module/actors/character/StonetopCharacterSheet.js");
const CSS = read("styles/stonetop.css");
const EN = JSON.parse(read("languages/en.json"));

describe("rolling a move from its title", () => {
	it("draws no dice icon on any move row", () => {
		for (const [what, rel] of MOVE_TEMPLATES) {
			const markup = stripComments(read(rel));
			expect(markup, `${what} still draws a die`).not.toContain("fa-dice-d6");
			// And not a bare wrapper either: a `.rollable` SPAN on a move row is the icon's
			// shape, whatever it has inside it.
			expect(markup, `${what} still wraps a rollable span`)
				.not.toMatch(/<span class="rollable move-rollable"/);
		}
	});

	// The gate is unchanged — a move rolls when it has a rollType and the row is owned/learned —
	// only what the gate DRESSES moved, from a sibling icon onto the title itself.
	it("puts the roll on the title instead", () => {
		for (const [what, rel] of MOVE_TEMPLATES) {
			const markup = stripComments(read(rel));
			const titles = [...markup.matchAll(/class="stonetop-(?:item|move)-name[^"]*"[^>]*/g)].map(m => m[0]);
			const rolling = titles.filter(t => t.includes("move-rollable"));
			expect(rolling.length, `${what} has no rollable title`).toBeGreaterThan(0);
			for (const title of rolling) {
				expect(title, `${what} title carries no stat`).toContain('data-roll="{{rollType}}"');
				// Both classes: `rollable` is what the sheet's handler finds, `move-rollable` is
				// what tells the pre-roll ladder this is a 2d6 move rather than a raw formula.
				expect(title, `${what} title is not a .rollable`).toMatch(/\brollable move-rollable\b/);
			}
		}
	});

	// The "+STAT" chip is the title's tail, not its prefix.
	it("keeps the stat chip to the right of the title", () => {
		for (const [what, rel] of MOVE_TEMPLATES) {
			for (const row of stripComments(read(rel)).split(/<li\b/).slice(1)) {
				if (!row.includes("stonetop-move-roll-chip")) continue;
				const titleAt = row.search(/class="stonetop-(?:item|move)-name/);
				expect(titleAt, `${what}: a chip on a row with no title`).toBeGreaterThan(-1);
				expect(row.indexOf("stonetop-move-roll-chip"), `${what}: chip leads its title`)
					.toBeGreaterThan(titleAt);
			}
		}
	});
});

// The one behaviour a single door could quietly lose. Requisition and Outfit open a bespoke
// dialog, and Forage a guided step, from the sidebar row's NAME — while the die beside it just
// rolled. Whichever surface a player aimed at decided which they got. With the name doing the
// rolling, that fork has to be resolved in favour of the name's answer, in ONE place both
// surfaces reach: the rollable handler (a tap on the title) and the row handler (a tap on the
// space beside it).
describe("an expedition move's own door", () => {
	it("is opened from one helper, by both surfaces", () => {
		// Takes the row both callers already hold, not the name element one of them had to
		// walk back out to.
		expect(SHEET_JS).toContain("_openExpeditionMoveDoor(li) {");
		expect((SHEET_JS.match(/this\._openExpeditionMoveDoor\(/g) ?? []).length,
			"both click surfaces must ask").toBe(2);
	});

	// A second copy of the lookup is how the two surfaces drifted apart in the first place.
	it("keeps the bespoke-dialog lookup in that one place", () => {
		expect((SHEET_JS.match(/EXPEDITION_MOVE_HANDLERS\[/g) ?? []).length).toBe(1);
	});
});

// The stats and the damage die lost their dice for the same reason the moves did: each icon
// sat on top of a click target that was already bigger than it. A stat's whole CELL is the
// `.rollable` and always was; the damage cell's anchor spans the row with the die readout
// click-through inside it. So the icons were a second, smaller aim at the same roll.
describe("the stat and damage rolls", () => {
	it("draw no dice icon", () => {
		for (const rel of ["templates/actor/partials/actor-stats.hbs", "templates/actor/partials/actor-vitals.hbs"]) {
			expect(stripComments(read(rel)), `${rel} still draws a die`).not.toContain("fa-dice-d6");
		}
	});

	// What actually rolls, which is what had to survive the icon's removal.
	it("keeps the cell itself as the roll", () => {
		expect(stripComments(read("templates/actor/partials/actor-stats.hbs")))
			.toMatch(/<li class="stat cell--stat rollable" data-stat="\{\{@key\}\}" data-roll="\{\{@key\}\}">/);
		expect(stripComments(read("templates/actor/partials/actor-vitals.hbs")))
			.toMatch(/<a class="rollable" data-roll="\{\{system\.attributes\.damage\.value\}\}" data-label="Damage">/);
	});

	// The damage readout is INSIDE that anchor and mouse-dead in play mode, which is what makes
	// clicking the number roll it. Enable those pointer events outside edit mode and the anchor
	// stops receiving the click that used to belong to the icon beside it.
	it("leaves the damage readout click-through in play mode", () => {
		const rule = CSS.slice(CSS.indexOf(".sheet-attributes-top .cell--Roll .cell__roll input.attr-value"));
		expect(rule.slice(0, 400)).toContain("pointer-events: none");
		expect(CSS).toContain(".stonetop-edit-mode .sheet-attributes-top .cell--Roll .cell__roll input.attr-value");
	});
});

// The switch that used to hide those dice went with them: with no icon anywhere on a move row,
// a stat row or the damage cell, all it could have hidden was the labels doing the rolling.
describe("the Hide Rollable Icon setting", () => {
	it("is gone, along with the class it drove", () => {
		expect(read("module/settings.js"), "still registered").not.toContain('"hideRollableIcon"');
		expect(read("module/settings.js")).not.toContain("export function applyHideRollableIcon");
		expect(read("module/hooks/Ready.js"), "still applied at boot").not.toContain("applyHideRollableIcon");
		expect(SHEET_JS).not.toContain("getHideRollableIconSetting");
		expect(EN.stonetop.settings.hideRollableIcon, "strings still shipped").toBeUndefined();
	});

	// A stylesheet rule for a class nothing sets is a rule that reads as live.
	it("leaves no rule behind that could hide a label", () => {
		expect(CSS).not.toMatch(/^\.stonetop-hide-rollable-icon[^{]*\{/m);
		expect(CSS, "the stat icon's own sizing rule outlived the icon").not.toMatch(/\.cell--stats \.stat-icon\s*\{/);
	});

	// The boot check walks `registerSettings` by naming settings along its length, so a marker
	// must be a key that IS still registered — a retired one reports as missing on every world.
	it("does not leave a retired key as a boot sentinel", () => {
		const guard = read("module/utils/boot-guard.js");
		expect(guard).not.toContain('"hideRollableIcon"');
		const settings = read("module/settings.js");
		const sentinels = [...guard.slice(guard.indexOf("BOOT_SENTINELS = Object.freeze(["), guard.indexOf("]);"))
			.matchAll(/"([^"]+)"/g)].map(m => m[1]);
		expect(sentinels.length).toBeGreaterThan(4);
		for (const key of sentinels) {
			expect(settings, `${key} is a sentinel but is never registered`)
				.toContain(`game.settings.register(SYSTEM_ID, "${key}"`);
		}
	});
});
