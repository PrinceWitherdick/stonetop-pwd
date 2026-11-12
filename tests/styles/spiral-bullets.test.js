import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readCss, readRepo, stripComments, declarations } from "../fakes/css.js";

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

// The question spiral is a DIFFERENT SHAPE from the spiral it stands in for, and every family
// that draws a bullet sizes its marker box square. Swapping the picture and leaving the box drew
// the wide glyph a fifth short: `contain` fits it by its width, so it lost the height it should
// have shared with the mark beside it, and it read as a faint speck rather than a bullet. Nothing
// reports this: the list lays out, the row reads, and the only symptom is a glyph that looks
// underfed next to its neighbours.
describe("the question spiral is given a box built for its shape", () => {
	const viewBox = (file) => {
		const svg = readRepo(`assets/icons/steading/${file}`);
		const [, w, h] = svg.match(/viewBox="[\d.-]+ [\d.-]+ ([\d.-]+) ([\d.-]+)"/).map(Number);
		return { w, h, ratio: w / h };
	};

	/** Every rule in the sheet, as {selectors, body}. */
	const rules = [...stripComments(CSS).matchAll(/([^{}]+)\{([^{}]*)\}/g)]
		.map(([, prelude, body]) => ({ selectors: prelude.split(",").map(x => x.trim()), body }));

	// The premise the widening rests on. If the art is ever re-cropped square, the multiplier
	// below stops being a fit and starts being a distortion, and this says so first.
	it("stands on the art: one glyph square, the other wide", () => {
		expect(viewBox("check-spiral.svg").ratio).toBeCloseTo(1, 1);
		expect(viewBox("question-spiral.svg").ratio).toBeGreaterThan(1.2);
	});

	it("widens the box by the glyph's own ratio, not by a number someone liked", () => {
		const widths = rules.flatMap(r => [...r.body.matchAll(/width:\s*calc\(var\(--stonetop-bullet-size, 10px\) \* ([\d.]+)\)/g)])
			.map(m => Number(m[1]));
		expect(widths.length, "no widened marker box found at all").toBeGreaterThan(0);
		for (const factor of widths) expect(factor).toBeCloseTo(viewBox("question-spiral.svg").ratio, 2);
	});

	// The coupling, and the whole point: a rule that hands a marker this picture hands it the box
	// too. Five rules do the swap today (the sheets' shared one, the journal bodies, the monster
	// rich text, and the two GM playbook lists), each because the one before it loses the cascade
	// where it lands -- and a sixth added later would shrink the glyph again on that surface alone.
	it("sizes the box in the same rule that swaps the picture, every time", () => {
		const swaps = rules.filter(r => /question-spiral\.svg|--stonetop-question-spiral-icon/.test(r.body)
			&& r.selectors.some(sel => sel.includes("question-bullet")));
		expect(swaps.length, "the swap rules are gone or renamed").toBeGreaterThanOrEqual(5);
		for (const rule of swaps) {
			expect(rule.body, rule.selectors.join(", ")).toMatch(/width:\s*calc\(var\(--stonetop-bullet-size/);
		}
	});

	// And back the other way. The Setting Overview opts a page out of the swap (a principle that
	// ends on a rhetorical "...who will?" is not a prompt); putting the square glyph back into the
	// widened box would draw it a quarter BIGGER than the bullets around it.
	it("puts the square box back wherever it puts the square glyph back", () => {
		const optOut = rules.find(r => r.selectors.some(sel => sel.includes("no-question-spiral")));
		expect(optOut, "the opt-out rule is gone").toBeTruthy();
		expect(optOut.body).toMatch(/width:\s*var\(--stonetop-bullet-size/);
	});

	// Two lists hang a CHARACTER in their marker (the follower moves list draws the rulebook's
	// arrow, the numbered threats guide draws its step number). They are tagged like any other row
	// ending in "?", so the swap reaches them: it paints a picture nobody can see behind the
	// character, and the box it asks for pushes a flex-laid marker's text off the list's edge.
	it("leaves the two lists whose marker is a character out of it", () => {
		for (const sel of [".stonetop-follower-moves-list li.question-bullet::before",
			".stonetop .steading-threats-guide-list.is-ordered > li.question-bullet::before"]) {
			const rule = declarations(CSS, sel);
			expect(rule, `${sel} is no longer opted out of the picture swap`).toBeTruthy();
			expect(rule).toMatch(/background-image:\s*none/);
			expect(rule).toMatch(/width:\s*auto/);
		}
	});
});

// Every spiral bullet sits on its entry's FIRST line by one formula, (1lh - its height) / 2 less the
// face's caps nudge. Each list used to carry its own em offset (0.1-0.3em) under a bullet sized in px,
// tuned at one UI size: at a 20px root the bullets sat 2-4.5px high (measured 2026-11-11 with
// z:/tmp/foundry-verify/bullet-family-centre.mjs; with the formula all 53 within 1.5px in all three
// faces at roots 16 and 20).
describe("every spiral bullet is seated on its first line by 1lh", () => {
	const bulletRules = [...stripComments(CSS).matchAll(/([^{}]+)\{([^{}]*)\}/g)]
		.map(([, prelude, body]) => ({ prelude: prelude.trim().replace(/\s+/g, " "), body }))
		.filter(r => /::before/.test(r.prelude) && /bullet-size|spiral-icon|question-spiral/.test(r.body)
			&& /position:\s*absolute/.test(r.body) && /(^|[;\s])top\s*:/.test(r.body));

	it("finds the family", () => {
		expect(bulletRules.length).toBeGreaterThan(30);
	});

	// Not first-line bullets: the GM Toolkit's wonder head hangs its spiral off a question INPUT (the
	// line is inside the field's border and padding), and the empty "add" row centres its spiral in an
	// align-items: center row (50% less half its size).
	const NOT_ON_A_LINE = [".stonetop-gm-wonder-head::before", ".stonetop-gm-wonder-add::before"];

	it("places none of them a fixed em below the top", () => {
		const fixed = bulletRules
			.filter(r => !NOT_ON_A_LINE.includes(r.prelude))
			.map(r => ({ sel: r.prelude.slice(-80), top: r.body.match(/(?:^|[;\s])top\s*:\s*([^;]+);/)[1].trim() }))
			// A box one line tall, with the art centred inside it, needs no offset at all.
			.filter(({ top }) => top !== "0" && !(top.includes("(1lh - ") && top.endsWith(") / 2 - var(--st-caps-lift))")));
		expect(fixed).toEqual([]);
	});

	// A custom property resolves its var()s where it is DECLARED. Folded into a :root token, the formula
	// would freeze the bullet size and the caps nudge at :root's values: the sheets' scaled bullet size
	// and any bullet of another height would be placed for a 10px one.
	it("writes the formula out in each rule rather than as a :root token", () => {
		const root = declarations(CSS, ":root") ?? "";
		expect(root).not.toMatch(/1lh - var\(--stonetop-bullet-size/);
	});

	// The one part that IS a :root token, the capped caps nudge, is safe only while the nudge itself is
	// set on :root alone (here and settings.js#applySheetFont); set on a narrower element it would freeze.
	it("lifts by the capped caps nudge, a :root token over a :root-only nudge", () => {
		expect(declarations(CSS, ":root") ?? "").toMatch(/--st-caps-lift:\s*min\(var\(--st-caps-nudge, 0em\), 0\.08em\)/);
		const setters = [...stripComments(CSS).matchAll(/([^{}]+)\{([^{}]*)\}/g)]
			.filter(([, , body]) => /--st-caps-nudge\s*:/.test(body)).map(([, prelude]) => prelude.trim());
		expect(setters).toEqual([":root"]);
	});
});
