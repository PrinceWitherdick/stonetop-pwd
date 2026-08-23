import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readCss, stripComments, declarations } from "../fakes/css.js";

/**
 * The standing rule for prose lists on these sheets: the bullet is the spiral, never the
 * browser's black disc and never a glyph standing in for one.
 *
 * This fails SILENTLY in the worst way a style bug can — the list renders, the text is
 * readable, and the only symptom is that one panel out of forty looks like it belongs to a
 * different game. Nobody notices until they happen to have the offending tab open, which is
 * how the six lists below survived several sweeps.
 *
 * TWO guards, and they answer different questions. The first is mechanical and open-ended: it
 * walks every classed <ul> in the templates and fails any whose classes no rule ever takes
 * `list-style` off, because that list is drawing native discs right now. The second pins the
 * specific lists that had a wrong marker, since a wrong marker is invisible to the first guard
 * (they all set `list-style: none` and then drew a dash, a caret or a chevron instead).
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const CSS  = readCss();

/** Every .hbs under templates/, recursively. */
function templateFiles(dir = path.join(ROOT, "templates")) {
	return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
		const full = path.join(dir, e.name);
		if (e.isDirectory()) return templateFiles(full);
		return e.name.endsWith(".hbs") ? [full] : [];
	});
}

/**
 * Every classed <ul> in the templates, as {file, classes}.
 *
 * CLASSED only. A bare <ul> is prose inside a body whose ancestor rule bullets it
 * (`.stonetop-journal-body li`, the monster rich text), and resolving an ancestor from a
 * template would mean parsing the whole enclosing markup — the guard would report where it
 * could not follow rather than where a bullet is missing.
 *
 * A class list carrying a handlebars expression is skipped for the same reason: the class is
 * decided at render, so there is no name here to look up.
 */
function classedLists() {
	const found = [];
	for (const file of templateFiles()) {
		const src = stripComments(fs.readFileSync(file, "utf8"));
		for (const [, cls] of src.matchAll(/<ul\b[^>]*\bclass="([^"]*)"/g)) {
			if (cls.includes("{{")) continue;
			const classes = cls.split(/\s+/).filter(Boolean);
			if (classes.length) found.push({ file: path.relative(ROOT, file), classes });
		}
	}
	return found;
}

/**
 * Is this list's marker accounted for? Either some rule reaching one of its classes takes
 * `list-style` off, or the <ul> itself is laid out as a flex/grid container, which blockifies
 * its children and suppresses `::marker` whether anyone asked for that or not.
 *
 * Any of the element's classes will do. Lists here are routinely a base plus a modifier
 * (`site-list site-denizen-list`, `stonetop-wound-list stonetop-wound-list--scars`) and it is
 * always the base that carries the layout.
 */
function markerHandled(classes) {
	return classes.some(c => {
		const decls = declarations(CSS, `.${c}`) ?? "";
		// ...and the scoped spellings of the same class, which is how the dialogs write theirs.
		const scoped = [...CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
			.filter(([, prelude]) => new RegExp(`\\.${c}(?![\\w-])`).test(prelude))
			.map(([, , body]) => body).join("\n");
		const all = decls + "\n" + scoped;
		return /list-style/.test(all) || /display:\s*(flex|grid|inline-flex|inline-grid)/.test(all);
	});
}

describe("no prose list is left drawing the browser's disc", () => {
	// The tell for one, from every instance found so far: a tightened indent
	// (`padding-left: 18px` / `1.1rem` / `1.4em`) and no `list-style: none` anywhere. A dev
	// pulling a native list in towards its heading, never having meant to keep the dot.
	it("takes list-style off every classed <ul> the templates render", () => {
		const lists = classedLists();
		// If this ever reads zero the walk has broken and every assertion below is vacuous.
		expect(lists.length).toBeGreaterThan(40);
		const bare = lists
			.filter(l => !markerHandled(l.classes))
			.map(l => `${l.file}: <ul class="${l.classes.join(" ")}">`);
		expect(bare, "these lists draw native discs").toEqual([]);
	});
});

// Each of these set `list-style: none` and then drew something that was not the spiral, so the
// guard above passes them and always would. Pinned by name because the fix is one line to undo.
describe("the lists whose marker was not a spiral", () => {
	const WAS_WRONG = [
		[".stonetop .steading-threats-guide-list:not(.is-ordered):not(.steading-threat-type-list) > li::before",
			"the threat guide's checklists drew a 1px grey dash"],
		[".stonetop .steading-threat-type-moves > li::before",
			"a threat type's moves drew the same caret that opens them"],
		[".stonetop .site-list li::before",
			"the site card's timeline/questions/denizens drew native discs"],
		[".stonetop-create-site-dialog .stonetop-cs-hint-list li::before",
			"the site wizard's prompt lists drew native discs"],
		[".stonetop-love-letter-read-options li::before",
			"the love letter's options drew native discs"],
		[".stonetop-pdi-crossed-list li::before",
			"the post-death crossed-off marks drew native discs"],
		[".undeath-summary li::before",
			"the undeath dialog's summary drew native discs"],
		[".stonetop-npc-impressions-list li::before",
			"an NPC's impressions drew a chevron"],
	];

	it.each(WAS_WRONG)("%s draws the spiral", (selector, was) => {
		const rule = declarations(CSS, selector);
		expect(rule, `no rule for ${selector} (${was})`).toBeTruthy();
		expect(rule, was).toMatch(/var\(--stonetop-spiral-icon\)/);
		// Through the VARIABLE, never the file path: the black-paper scopes (death's door, the
		// past-death sheet, the dark chat card) re-point it at the bone-filled twin, and a
		// hardcoded url() would go invisible on all three.
		expect(rule).not.toMatch(/check-spiral\.svg/);
		// Absolute in the row's own gutter — the block-flow model. A flex <li> makes its own
		// column of every inline run, which shatters an <em> mid-sentence into a lane.
		expect(rule).toMatch(/position:\s*absolute/);
	});

	// The one glyph in this family that is NOT a bullet and must keep its arrow: the disclosure
	// on a threat type's name. It rotates on expand and is shared with the GM Moves tab, so
	// spiralling it would turn a control into decoration on two tabs at once.
	it("leaves the disclosure caret alone", () => {
		const caret = declarations(CSS, ".stonetop .steading-threat-type-toggle::after");
		expect(caret).toMatch(/203A/);
		expect(caret).toMatch(/transition:\s*transform/);
	});
});
