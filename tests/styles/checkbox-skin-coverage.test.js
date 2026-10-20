import { describe, it, expect } from "vitest";
import { readCss, declarations } from "../fakes/css.js";

// The checkboxes that joined the shared spiral skin (the master block near the top of
// styles/stonetop.css) in one pass, and the Plans requirement row whose tick sits on the caps.
//
// Why a list: Foundry v13's core stylesheet skins `body.game .app input[type=checkbox]` at (0,3,2),
// so a checkbox whose class falls off the master block renders as the browser's native box with no
// error anywhere (tests/styles/person-picker-checkbox.test.js tells the longer story). Each of these
// was that bug once; a class dropped from either selector list brings it back.

const CSS = readCss();

/** The selector list of the master block, empty and ticked: the rule that ends in `.steading-list-check`. */
const preludeOf = re => (CSS.match(re)?.[1] ?? "").split(",").map(s => s.trim()).filter(Boolean);
const EMPTY = preludeOf(/([^{}]*\.steading-list-check)\s*\{\s*appearance:\s*none/);
const TICKED = preludeOf(/([^{}]*\.steading-list-check:checked)\s*\{\s*background:\s*var\(--stonetop-checkbox-checked-icon\)/);

const SKINNED = [
	"steading-plan-check", "spe-req-done", "bt-monster", "bt-out-of-play",
	"stonetop-cu-trait", "stonetop-cu-move",
	"stonetop-tb-theme", "stonetop-tb-aspect", "stonetop-tb-gift", "stonetop-tb-mark", "stonetop-tb-req",
	"stonetop-tb-bind", "stonetop-tb-move",
	"stonetop-cf-group-toggle", "stonetop-mf-group-toggle", "stonetop-nf-group-toggle",
	"stonetop-ch-damage-effect", "stonetop-ch-certain-death", "stonetop-eos-personal-check", "stonetop-ff-let-go",
	"stonetop-of-balk", "stonetop-of-balk-presence", "stonetop-of-wall", "stonetop-of-command",
	"stonetop-poster-map-check", "road-mess-kit", "road-pack-animal", "undeath-forced-miss", "undeath-tether-destroyed",
	"stonetop-identify-adv", "stonetop-rest-follower-check", "stonetop-camp-extra-check", "stonetop-invoke-check",
	"stonetop-convalesce-wound-check", "stonetop-battle-hold-check", "stonetop-fight-targets-check",
];

describe("the shared spiral checkbox skin", () => {
	it("finds the master block's two selector lists, so the checks below mean something", () => {
		expect(EMPTY.length).toBeGreaterThan(SKINNED.length);
		expect(TICKED.length).toBe(EMPTY.length);
	});

	it.each(SKINNED)("skins .%s empty and ticked", cls => {
		expect(EMPTY).toContain(`.${cls}`);
		expect(TICKED).toContain(`.${cls}:checked`);
	});
});

describe("a plan's requirement row", () => {
	const LABEL = declarations(CSS, ".steading-plan-req > label");

	// Centred, the 15px tick sat 1.5px low against Caslon's line box; at the top of the row it sits on
	// the first line's caps, and stays there when a requirement wraps to a second line.
	it("puts the tick at the top of the row, on the first line's caps", () => {
		expect(LABEL, ".steading-plan-req > label reaches no rule").toBeTruthy();
		expect(LABEL).toMatch(/display:\s*flex/);
		expect(LABEL).toMatch(/align-items:\s*flex-start/);
		expect(LABEL).not.toMatch(/align-items:\s*center/);
		expect(LABEL).toMatch(/gap:\s*6px/);
	});
});
