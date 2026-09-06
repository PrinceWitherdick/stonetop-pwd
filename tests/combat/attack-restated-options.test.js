import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { buildTierActions } from "../../module/combat/attack-flow.js";
import { tierActionsRestateOptions } from "../../module/utils/chat.js";
import { moveCardBody } from "../../module/utils/move-tiers.js";

// The SHIPPED text, not a paraphrase of it. The whole rule is that the tier controls and the
// move's printed bullets say the same words, so a test that retyped either side would go on
// passing after a reword had already broken the thing in the world.
const move = (file) => JSON.parse(
	fs.readFileSync(path.resolve("packs/src/stonetop-items/basic-moves", file), "utf8")).system;

const CLASH   = move("clash.json");
const LET_FLY = move("let-fly.json");

const CLASH_ACTIONS   = buildTierActions({ key: "clash" }, null);
const LET_FLY_ACTIONS = buildTierActions({ key: "let-fly" }, { ammo: true });

describe("tierActionsRestateOptions", () => {
	it("Clash: the pick radios cover both printed bullets, so the checklist stands down", () => {
		expect(tierActionsRestateOptions(CLASH_ACTIONS, CLASH.description)).toBe(true);
	});

	it("Let Fly: three of four options exist nowhere but the printed list, so it keeps them", () => {
		// The ammo add-on restates ONE of the four bullets. Covering part of a list is not
		// covering it, and a card that dropped the boxes here would leave "hold steady" and
		// "rush the shot" with nothing to tick.
		expect(tierActionsRestateOptions(LET_FLY_ACTIONS, LET_FLY.description)).toBe(false);
	});

	it("says no when there are no tier controls at all — the ordinary move card", () => {
		expect(tierActionsRestateOptions(null, CLASH.description)).toBe(false);
		expect(tierActionsRestateOptions({}, CLASH.description)).toBe(false);
	});

	it("says no for a move that prints no options, whatever the controls say", () => {
		expect(tierActionsRestateOptions(CLASH_ACTIONS, "<p>Roll +STR.</p>")).toBe(false);
	});

	it("hands the list back when a world rewords one of the options", () => {
		// The self-checking half of the design: a reworded Clash no longer matches, so the
		// player gets tickable bullets rather than a card silently offering only the two
		// options the radios still know about.
		const reworded = CLASH.description.replace("Avoid, prevent, or counter", "Dodge");
		expect(tierActionsRestateOptions(CLASH_ACTIONS, reworded)).toBe(false);
	});

	it("hands the list back when a world adds a third option", () => {
		const extended = CLASH.description.replace(
			"</ul>", "<li>Disarm them and take the weapon</li></ul>");
		expect(tierActionsRestateOptions(CLASH_ACTIONS, extended)).toBe(false);
	});

	it("is not fooled by the apostrophe: the label is escaped, the bullet is not", () => {
		// buildTierActions writes "enemy&#x27;s" through escHtml; the pack writes "enemy's".
		expect(CLASH_ACTIONS.success).toContain("&#x27;");
		expect(CLASH.description).toContain("enemy's attack");
		expect(tierActionsRestateOptions(CLASH_ACTIONS, CLASH.description)).toBe(true);
	});
});

describe("the Clash card body it produces", () => {
	const restated = tierActionsRestateOptions(CLASH_ACTIONS, CLASH.description);
	const body = moveCardBody(CLASH.description, CLASH.moveResults, { pickable: !restated });

	it("prints the options as plain bullets, with no second set of boxes", () => {
		expect(body).not.toContain("stonetop-picklist");
		expect(body).toContain("<li>Avoid, prevent, or counter your enemy's attack</li>");
	});

	it("still lays the outcomes out as the ladder, with the lead-in intact", () => {
		expect(body).toContain("stonetop-move-tiers");
		expect(body).toContain("and pick 1:");
	});

	it("still hangs the list UNDER the ladder that sends the reader to it", () => {
		expect(body.indexOf("stonetop-move-tiers")).toBeLessThan(body.indexOf("<li>Avoid"));
	});

	it("leaves Let Fly's boxes exactly where they were", () => {
		const letFly = moveCardBody(LET_FLY.description, LET_FLY.moveResults,
			{ pickable: !tierActionsRestateOptions(LET_FLY_ACTIONS, LET_FLY.description) });
		expect(letFly).toContain("stonetop-picklist");
		expect(letFly).toContain('data-pick-max-partial="1"');
	});
});
