import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

// The suite runs on `environment: "node"` with no jsdom, so these are static guards on the
// template/handler pairing rather than a render test — which is exactly the part that
// drifted: the Player Characters table was built from the residents' markup but never got
// the `draggable`/`data-actor-uuid` attributes, so a PC row could not be dragged out of the
// steading sheet the way a resident or neighbor could.
const ROOT = path.resolve(__dirname, "../../..");
const TEMPLATE = fs.readFileSync(
	path.join(ROOT, "templates/actor/partials/steading-tab-neighbors.hbs"), "utf8");
const SHEET = fs.readFileSync(
	path.join(ROOT, "module/actors/steading/StonetopSteadingSheet.js"), "utf8");

// The opening tag carrying `class`, newlines and all — these handles wrap their attributes
// over several lines, so a line-wise match would miss half of them.
const tagWith = cls => TEMPLATE.match(
	new RegExp(`<[a-zA-Z]+\\b[^<>]*class="[^"]*\\b${cls}\\b[^"]*"[^<>]*>`, "s"))?.[0] ?? "";

// Portrait and name link both, for both tables: a row is grabbable by either one.
const HANDLES = [
	"steading-player-portrait", "steading-player-name-text",
	"steading-member-avatar", "steading-member-name-text",
];

describe("steading roster rows as Actor drag handles", () => {
	it.each(HANDLES)("marks .%s draggable and points it at an actor", cls => {
		const tag = tagWith(cls);
		expect(tag).not.toBe("");
		expect(tag).toContain('draggable="true"');
		expect(tag).toContain('data-actor-uuid="{{this.uuid}}"');
	});

	// One selector rather than a list of the four classes above: the handler matches on what a
	// handle IS — draggable, and carrying an actor pointer — which is the same pair the assertion
	// above makes of every template. A fifth actor-backed row is then draggable the day it is
	// written, instead of failing silently until somebody remembers to extend a list.
	it("matches every handle by the attributes rather than by class", () => {
		expect(SHEET).toContain(`closest?.("[draggable='true'][data-actor-uuid]")`);
	});

	// Gecko hands over an image payload instead of the Actor uuid if the <img> inside a
	// drag handle is itself draggable, so both portraits opt their image out.
	it.each(["steading-player-portrait-img", "steading-member-avatar-img"])(
		"leaves the inner <img>.%s undraggable", cls => {
			expect(tagWith(cls)).toContain('draggable="false"');
		});
});
