import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { readCss, readRepo, declarations, ownRule } from "../fakes/css.js";
import { contrastRatio, parseColor, ratioText } from "../fakes/contrast.js";

/**
 * The accessibility palette, checked against the arithmetic it claims.
 *
 * This mode exists because a player who is around 90% blind could not read their sheet, and the
 * whole of what it does is move numbers: an ink ramp whose faintest step goes from 2.24:1 on a
 * Judge's paper to 7.57:1 on white, hairlines from 1.3:1 to 4.8:1, a primary button from 4.05:1
 * to 9.04:1. Every one of those is written into the stylesheet as a comment beside its value,
 * and a comment is precisely the wrong place to keep a promise: warm a hex two digits to taste
 * and the sentence beside it still says 7.57:1, in a mode whose entire reason to exist is that
 * the number is true.
 *
 * So none of the assertions below read those comments. They re-derive every ratio from the values
 * actually in the file, and they are written to fail on the two ways this can rot: a value edited
 * until it no longer clears its bar, and a rule quietly disappearing so a bar stops being checked
 * at all. Hence the count guards on every scan.
 *
 * The bar is AAA (7:1) for text and 3:1 for anything whose shape carries meaning, not AA. AA is
 * what NORMAL contrast should meet; a mode somebody has to go and turn on because the normal one
 * defeated them has to clear more than the floor that already failed them.
 */

const CSS = readCss();

const HIGH = ":root.stonetop-high-contrast";
const FLAT = ":root.stonetop-no-texture";

/**
 * The accessibility block: the flat-paper rule and everything after it, which is the whole
 * family. Sliced ONCE — four separate tests wanted it, and each was re-scanning the 740 KB
 * stylesheet for `FLAT` and taking its own copy of the tail.
 */
const BLOCK = CSS.slice(CSS.indexOf(FLAT));

/** Every `--custom-property: value` a rule declares, as a Map. */
function customProperties(body) {
	const out = new Map();
	if (!body) return out;
	for (const m of body.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/gi)) {
		out.set(m[1].trim(), m[2].trim());
	}
	return out;
}

const BASE = customProperties(declarations(CSS, ":root"));
const HC = customProperties(ownRule(CSS, HIGH));
const NOTEX = customProperties(ownRule(CSS, FLAT));

/**
 * The two grounds ink can land on, and the one everything below is measured against.
 *
 * `--st-page` is the sheet's paper; `--stonetop-bg` is the fill of the panels that sit on it and
 * read as slightly inset. Text appears on both, so the bar has to be cleared on the DARKER of the
 * two — measuring only against the page would pass an ink that fails everywhere it actually sits
 * in a stat box.
 */
const PAGE  = HC.get("--st-page");
const PANEL = HC.get("--stonetop-bg");
const PAPER = [PAGE, PANEL].filter(Boolean)
	.sort((a, b) => contrastRatio("#000", a) - contrastRatio("#000", b))[0];

/** Tokens whose job is to be read as TEXT. Core's `--color-text-*` names are ink too. */
const INK = name => /(^--st-text(-|$)|^--color-text-|-text$|-ink$|hyperlink)/.test(name);

/**
 * The scopes that paint black paper: the two death dialogs, a past-death sheet, the drip card.
 *
 * They are the second ground in this stylesheet, and a value pitched for the white one is wrong
 * on them by exactly as much as it is right everywhere else. Anything the block sets THERE is
 * measured against their paper instead.
 */
const BLACK_SCOPE = selector => /past-death|deaths-door-mood|death-drip/.test(selector);
const BLACK_PAPER = "#121212";   // |255 - 251| inverted, plus the --st-black-lift white wash

/** Every rule in the accessibility block, as [selector, body] pairs. (`readCss` has already taken
 *  the comments out, so a paragraph above a rule cannot be read as part of its selector list.) */
const RULES = [...BLOCK.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(m => [m[1].trim(), m[2]]);
/** Tokens whose job is to be a boundary or a mark: WCAG asks 3:1 of these, not 4.5:1. */
const BOUNDARY = name => /(-border$|-rule$|^--color-border-)/.test(name);

describe("the high-contrast palette", () => {
	it("parses the two accessibility blocks at all (guards every scan below)", () => {
		expect(HC.size, "the high-contrast block declares no custom properties").toBeGreaterThan(20);
		// Exactly one, and the paper test below pins WHICH one: the whole point of naming the page
		// apart from the panel tone is that "no grain" needs to move nothing but the grain.
		expect(NOTEX.size, "the no-texture block declares no custom properties").toBeGreaterThan(0);
		expect(BASE.size, "the base :root block did not parse").toBeGreaterThan(40);
		expect(PAGE, "the high-contrast block sets no page colour").toBeTruthy();
		expect(PANEL, "the high-contrast block sets no panel colour").toBeTruthy();
	});

	// The mode is a whole-skin override and the file is 39,000 lines long. Custom properties win
	// on specificity wherever they are written, but the plain rules in the block (the playbook
	// wash, the focus ring, the tab strip) beat rules of equal weight only by coming later — and
	// several of them deliberately weigh the same as what they correct rather than reaching for
	// `!important`. Anything appended after this block silently outranks them.
	it("sits last in the stylesheet, which is how its plain rules win", () => {
		const at = CSS.indexOf(HIGH);
		expect(at, "the high-contrast block is missing entirely").toBeGreaterThan(-1);

		// Every top-level rule from here to the end has to belong to this family. Asserting on
		// the text after the file's last `}` would be no assertion at all — that is "" for any
		// stylesheet ending in a rule, whatever was appended before it.
		const tail = CSS.slice(at);
		const preludes = [];
		for (let i = 0, depth = 0, start = 0; i < tail.length; i++) {
			if (tail[i] === "{") { if (depth === 0) preludes.push(tail.slice(start, i).trim()); depth++; }
			else if (tail[i] === "}") { if (--depth === 0) start = i + 1; }
		}
		expect(preludes.length, "the high-contrast block did not parse").toBeGreaterThan(4);
		const foreign = preludes.filter(prelude => !prelude.startsWith(":root.stonetop-"));
		expect(foreign, "a rule that is not part of the accessibility family was appended after "
			+ "the high-contrast block, and now outranks its plain rules").toEqual([]);

		// And the flat-paper block is one of them, sitting before this one. Order no longer decides
		// anything between the two — they stopped declaring a property in common when the palette
		// was uncoupled from the grain — but this one still has to be the LAST thing in the file
		// for the paragraph above to hold.
		expect(CSS.indexOf(FLAT), "the no-texture block is gone, or moved after the palette")
			.toBeGreaterThan(-1);
		expect(CSS.indexOf(FLAT)).toBeLessThan(at);
	});

	it("gives every step of the ink ramp AAA on its own paper", () => {
		const ramp = ["--st-text", "--st-text-body", "--st-text-secondary", "--st-text-muted",
			"--st-text-faint"];
		for (const name of ramp) {
			const value = HC.get(name);
			expect(value, `${name} is not re-pointed by the high-contrast block`).toBeTruthy();
			expect(contrastRatio(value, PAPER), `${name} (${value}) on ${PAPER} is ${ratioText(value, PAPER)}`)
				.toBeGreaterThanOrEqual(7);
		}
	});

	// Collapsing the ramp to five blacks would pass the test above and lose the reader the
	// structure of the page, which is the other half of what they need. It stays a ramp.
	it("keeps the ramp a ramp rather than five blacks", () => {
		const steps = ["--st-text", "--st-text-secondary", "--st-text-muted", "--st-text-faint"]
			.map(name => contrastRatio(HC.get(name), PAPER));
		for (let i = 1; i < steps.length; i++) {
			expect(steps[i], `step ${i} is not quieter than the one above it`).toBeLessThan(steps[i - 1]);
		}
		// And the whole ramp is worth having: top to bottom it spans a real distance.
		expect(steps[0] / steps[steps.length - 1]).toBeGreaterThan(1.5);
	});

	it("gives every ink it re-points AAA, and every boundary 3:1", () => {
		const inks = [];
		const bounds = [];
		for (const [name, value] of HC) {
			if (!parseColor(value)) continue;          // `none`, a url(), a calc()
			if (INK(name)) inks.push([name, value]);
			else if (BOUNDARY(name)) bounds.push([name, value]);
		}
		expect(inks.length, "no ink tokens found in the high-contrast block").toBeGreaterThan(8);
		expect(bounds.length, "no boundary tokens found in the high-contrast block").toBeGreaterThan(4);
		for (const [name, value] of inks) {
			expect(contrastRatio(value, PAPER), `${name} (${value}) is ${ratioText(value, PAPER)} on ${PAPER}`)
				.toBeGreaterThanOrEqual(7);
		}
		for (const [name, value] of bounds) {
			expect(contrastRatio(value, PAPER), `${name} (${value}) is ${ratioText(value, PAPER)} on ${PAPER}`)
				.toBeGreaterThanOrEqual(3);
		}
	});

	// The one thing this mode must never do. A token re-pointed to something WORSE than the value
	// it replaced is not a typo anybody would catch by eye: it still looks like a considered
	// colour, it is still in the right family, and the only sign is that the reader who turned the
	// mode on is worse off than the reader who did not.
	it("never re-points a colour to less contrast than it already had", () => {
		const paperBase = BASE.get("--stonetop-bg");
		let compared = 0;
		for (const [name, value] of HC) {
			const before = BASE.get(name);
			if (!before || !parseColor(before) || !parseColor(value)) continue;
			if (name === "--stonetop-bg") continue;                 // the paper itself, not ink on it
			if (!INK(name) && !BOUNDARY(name)) continue;
			compared++;
			const was = contrastRatio(before, paperBase);
			const now = contrastRatio(value, PAPER);
			expect(now, `${name}: ${before} was ${was.toFixed(2)}:1, ${value} is ${now.toFixed(2)}:1`)
				.toBeGreaterThanOrEqual(was);
		}
		expect(compared, "nothing was compared against the base palette").toBeGreaterThan(10);
	});

	// The semantic families keep their meaning: green still reads as done and red as destructive.
	// A mode that greyed them out would take a cue away rather than sharpen one, so the fills stay
	// coloured and it is the ink on them that has to be legible.
	it("keeps the semantic inks readable on their own fills", () => {
		for (const family of ["green", "blue", "red", "gold"]) {
			const ink = HC.get(`--st-${family}-text`) ?? BASE.get(`--st-${family}-text`);
			const fill = HC.get(`--st-${family}-bg`) ?? BASE.get(`--st-${family}-bg`);
			expect(ink, `no ink for the ${family} family`).toBeTruthy();
			expect(fill, `no fill for the ${family} family`).toBeTruthy();
			expect(contrastRatio(ink, fill), `${family}: ${ink} on ${fill} is ${ratioText(ink, fill)}`)
				.toBeGreaterThanOrEqual(7);
		}
	});

	it("darkens the primary button until its white label is readable", () => {
		const fill = HC.get("--st-btn-primary-bg");
		expect(fill, "the high-contrast block leaves the primary button alone").toBeTruthy();
		const label = HC.get("--st-btn-primary-text") ?? BASE.get("--st-btn-primary-text");
		expect(contrastRatio(label, fill), `${label} on ${fill} is ${ratioText(label, fill)}`)
			.toBeGreaterThanOrEqual(7);
		// The state this fixes: the same pair in the normal palette does not clear AA.
		expect(contrastRatio(BASE.get("--st-btn-primary-text"), BASE.get("--st-btn-primary-bg")))
			.toBeLessThan(4.5);
	});
});

describe("core's own colour names", () => {
	/**
	 * The names Foundry declares on `body.game .app` rather than on `:root`.
	 *
	 * Taken from foundry2.css's `@layer variables.base { body.game .app { … } }`. They are listed
	 * here rather than read off a Foundry install because a test cannot depend on one being on
	 * this machine, and because the point is not WHICH release declares them: it is that these
	 * particular names are declared on an ELEMENT by somebody else, and a custom property set on
	 * an element always beats one inherited from an ancestor, whatever the ancestor's specificity
	 * and whatever the layer.
	 *
	 * Which makes them a trap with no symptom. Setting one of these inside
	 * `:root.stonetop-high-contrast` reads exactly like setting any other token, passes every
	 * other assertion in this file, and does nothing at all inside a window. This system already
	 * fell into it once with `--color-shadow-primary`, and the repair near the top of the
	 * stylesheet is the pattern: re-declare on our own window roots. The high-contrast mode fell
	 * into it a second time, with the most-read ink token in the file.
	 */
	const DECLARED_ON_THE_APP = [
		"--color-text-dark-primary", "--color-text-dark-secondary", "--color-text-dark-inactive",
		"--color-text-primary", "--color-text-emphatic", "--color-text-hyperlink",
		"--color-border-dark", "--color-border-light-primary", "--color-border-light-secondary",
		"--color-border-light-tertiary", "--color-shadow-primary", "--color-shadow-highlight",
	];

	/** Every rule in the accessibility block, as [selector, body] pairs. */
	const accessibilityRules = () => RULES;

	/**
	 * Stated as a RULE rather than as a list of exceptions: the high-contrast `:root` block
	 * declares no `--color-*` name at all, except this system's own.
	 *
	 * The list above is a snapshot of one Foundry release's stylesheet, and a release that adds a
	 * thirteenth element-declared `--color-*` name would reintroduce the exact silent failure it
	 * exists to catch while the test went on passing. The rule below cannot go stale: every core
	 * token this mode needs is re-declared on the window roots and the chat card (the rule after
	 * this one proves that is where they are), so `:root` has no business naming one.
	 *
	 * `--color-the-*` are the carve-out and the only one: they are OURS, declared on `:root` by
	 * this stylesheet, so a `:root` re-point is exactly where they work.
	 */
	it("never sets a core colour name at :root, where it would be inert", () => {
		const ours = /^--color-the-/;
		const stranded = [...HC.keys()].filter(name => name.startsWith("--color-") && !ours.test(name));
		expect(stranded, `set on :root, so never seen inside a window: ${stranded.join(", ")}`).toEqual([]);

		// The list is still checked, so it keeps documenting the trap in concrete terms — but it
		// is now a second opinion rather than the whole guard.
		expect(DECLARED_ON_THE_APP.filter(name => HC.has(name))).toEqual([]);
	});

	/**
	 * The other half of the same trap, from our own side rather than core's.
	 *
	 * Four tokens are written by `settings.js` as INLINE styles on `document.documentElement`
	 * (`--font-stonetop`, `--st-caps-nudge`, `--stonetop-font-scale`, `--st-edit-reveal-delay`).
	 * An inline style beats every author rule that is not `!important`, so a scope block that
	 * re-points one of those is inert from the moment `ready` fires — which is always. The
	 * accessibility block briefly carried exactly that, for `--st-edit-reveal-delay`, with a
	 * comment beside it describing what it did.
	 */
	it("never re-points a token that settings.js writes as an inline style", () => {
		const settings = readRepo("module/settings.js");
		const inline = [...settings.matchAll(/documentElement\.style\.setProperty\("(--[a-z0-9-]+)"/g)]
			.map(m => m[1]);
		expect(inline.length, "settings.js sets no inline custom properties — did it reorganize?")
			.toBeGreaterThan(2);
		const stranded = inline.filter(name => new RegExp(`^\\s*${name}\\s*:`, "m").test(BLOCK));
		expect(stranded, `re-pointed in the accessibility block but written inline, so inert: ${stranded.join(", ")}`)
			.toEqual([]);
	});

	it("re-declares the ones it needs on the window roots and on the chat card", () => {
		const rules = accessibilityRules();
		expect(rules.length, "the accessibility block did not parse into rules").toBeGreaterThan(5);
		const tier = rules.filter(([, body]) =>
			DECLARED_ON_THE_APP.some(name => new RegExp(`${name}\\s*:`).test(body)));
		expect(tier.length, "no rule re-declares core's colour names outside :root").toBeGreaterThan(0);
		const selectors = tier.map(([sel]) => sel).join(" ");
		expect(selectors, "the window roots are not reached").toMatch(/\.stonetop\b/);
		expect(selectors, "the chat card is not reached").toMatch(/#chat/);
		// And what it sets there clears the same bars as everything else, on the paper that rule
		// actually sits on: the black-paper scopes get the same names repaired the other way up,
		// and measuring those against the white page would fail every one of them for being right.
		for (const [selector, body] of tier) {
			const paper = BLACK_SCOPE(selector) ? BLACK_PAPER : PAPER;
			for (const m of body.matchAll(/(--color-[a-z-]+)\s*:\s*([^;]+);/g)) {
				const [, name, value] = m;
				if (!parseColor(value)) continue;
				const bar = /border/.test(name) ? 3 : 7;
				expect(contrastRatio(value, paper), `${name} (${value}) is ${ratioText(value, paper)}`)
					.toBeGreaterThanOrEqual(bar);
			}
		}
	});
});

describe("the paper", () => {
	// sheet-bg.webp is opaque, so it does not tint the colour under it, it hides it: the surface a
	// reader has been looking at all along is the image, not the token. So the token the page is
	// painted from has to already BE the image's tone. Get that wrong and taking the grain off
	// hands the reader a darker page than the one they were struggling with, which is the exact
	// opposite of why anybody turns it off — and it was wrong, which is how a set of white
	// rectangles appeared behind the steading's currency labels the first time this shipped.
	it("paints the page from a token that already matches the grain's own tone", () => {
		const texture = "#fbfafa";      // the image's own mean, rgb(251, 250, 250)
		const page = BASE.get("--st-page");
		expect(page, "the base :root block names no page colour").toBeTruthy();
		expect(contrastRatio("#000", page), `the page token ${page} is darker than the grain over it`)
			.toBeGreaterThanOrEqual(contrastRatio("#000", texture) - 0.05);
		// Which is what lets the switch be a switch: it drops the image and moves no colour.
		expect(NOTEX.get("--stonetop-bg-texture"), "no-texture does not drop the grain").toBe("none");
		expect([...NOTEX.keys()].sort(), "no-texture moves something other than the two grains")
			.toEqual(["--st-inverted-paper", "--stonetop-bg-texture"]);
		// High contrast genuinely does repaint, and its page is no darker either.
		expect(contrastRatio("#000", PAGE)).toBeGreaterThanOrEqual(contrastRatio("#000", texture) - 0.05);
		// And it is not allowed to reach the grain. It used to, which made "Paper Texture" a switch
		// that saved a value and moved nothing while this mode was on, and decided for a reader who
		// wants the parchment AND the darker greys that they could not have both.
		expect(HC.get("--stonetop-bg-texture"), "the contrast palette turns the grain off again")
			.toBeUndefined();
		expect(HC.get("--st-inverted-paper"), "the contrast palette turns the black papers' grain off again")
			.toBeUndefined();
	});

	// What the uncoupling costs, since every other number in that block is written down. With the
	// grain left on under High Contrast the surface is the image rather than the white the palette
	// paints, so the ink is measured against the image instead. The bar is the same AAA 7:1 the
	// rest of the mode clears: if leaving the reader their parchment cost them AAA, the two
	// switches could not honestly be independent and the coupling would have to come back.
	it("keeps the ink at AAA on the grain, not only on the bare white under it", () => {
		const GRAIN_MEAN = "#fbfafa";   // rgb(251, 250, 250), the image's own mean
		const GRAIN_DARK = "#f8f8f8";   // its darkest pixel, relative luminance 0.936
		const inks = [...HC.keys()].filter(INK).filter(name => parseColor(HC.get(name)));
		expect(inks.length, "the high-contrast ink ramp did not parse").toBeGreaterThan(4);
		for (const name of inks) {
			const value = HC.get(name);
			for (const ground of [GRAIN_MEAN, GRAIN_DARK]) {
				expect(contrastRatio(value, ground), `${name} (${value}) is ${ratioText(value, ground)} on the grain`)
					.toBeGreaterThanOrEqual(7);
			}
		}
	});

	// The bug that prompted all of the above. A cut-out that notches its own border has to be the
	// colour of what it is DRAWN ON, and the currency legends sit on a `.steading-card`, which
	// washes the page. They painted `--stonetop-bg` instead, which only ever looked right by
	// coincidence, and stopped looking right the moment the page moved under them.
	it("draws a cut-out in the colour of the surface it is on, not of the paper", () => {
		const legend = ownRule(CSS, ".steading-currency-field-legend");
		expect(legend, "the currency legend rule is gone or renamed").toBeTruthy();
		expect(legend, "the legend still paints the panel tone rather than its surface")
			.not.toMatch(/background:\s*var\(--stonetop-bg/);
		expect(legend).toMatch(/background:\s*var\(--st-surface/);
		// And the card it sits on declares that surface, resolved from the same wash it paints.
		const card = declarations(CSS, ".steading-card");
		expect(card, "the steading card rule is gone").toBeTruthy();
		expect(card, "the card does not name the surface it presents").toMatch(/--st-surface:/);
		expect(card, "the wash and its resolved colour are not tied to one number")
			.toMatch(/--st-card-wash:\s*([\d.]+)/);
		const alpha = /--st-card-wash:\s*([\d.]+)/.exec(card)[1];
		expect(card, "the card's own fill does not read the shared alpha")
			.toMatch(new RegExp(`background:\\s*rgb\\(0 0 0 / var\\(--st-card-wash\\)`));
		expect(Number(alpha)).toBeGreaterThan(0);
	});

	// The switch works by re-pointing a token, so a surface that spells the url out again simply
	// ignores it. That is what the four black papers used to do, and it is the bug this guard was
	// written the wrong way round for: a past-death sheet, the Death's Door rooms and the two
	// death-drip cards were exempted here on the reasoning that they SUBTRACT the image from white
	// (`background-blend-mode: difference`) rather than laying it over a colour, so the literal
	// `#fff` beside it is the invert's reference and `--stonetop-bg-texture: none` would leave
	// `difference` nothing to invert and hand back WHITE paper under bone ink.
	//
	// The arithmetic was right and the conclusion was not: what those four need is not a literal,
	// it is a second token that is the image today and a flat white sheet when the grain is off,
	// because a flat white sheet inverts to a flat black one. So the exemption is gone. NOTHING
	// paints the grain from a literal now except the two token declarations themselves, and a
	// reader who turns the grain off gets it off the sheet they are actually reading.
	it("leaves no surface painting the grain behind the switch's back", () => {
		const literals = [...CSS.matchAll(/url\(['"]?[^)'"]*sheet-bg\.webp['"]?\)/g)];
		const declared = [...CSS.matchAll(/--(?:stonetop-bg-texture|st-inverted-paper):\s*url\(['"]?[^)'"]*sheet-bg\.webp['"]?\)/g)];
		expect(declared.length, "the two grain tokens are not both declared with the texture url").toBe(2);
		expect(literals.length, `${literals.length} literal texture urls; expected the 2 token declarations and nothing else`)
			.toBe(2);
		// Every surface that paints the paper reads whichever token its arithmetic needs.
		expect([...CSS.matchAll(/var\(--stonetop-bg-texture\)/g)].length).toBeGreaterThanOrEqual(4);
		const inverting = [...CSS.matchAll(/#fff\s+var\(--st-inverted-paper\)/g)];
		expect(inverting.length, "the inverting black-paper scopes are gone or no longer read the token")
			.toBe(4);
	});

	// ONE block takes the paper off, and it is the one the "Paper Texture" switch turns on. Any
	// other rule that sets the grain to `none` is a second setting deciding what the paper does,
	// which is precisely what the contrast palette was doing and no longer does.
	//
	// And the two tokens have to move together inside it. `--st-inverted-paper` is the same grain
	// seen through an invert, so dropping one and leaving the other is a reader who turned the
	// pattern off and still has it on a past-death sheet.
	it("turns the grain off in exactly one block, and both grains in that one", () => {
		const offs = [...CSS.matchAll(/([^{}]+)\{([^{}]*--stonetop-bg-texture:\s*none;[^{}]*)\}/g)];
		expect(offs.length, "the grain is turned off somewhere other than its own switch").toBe(1);
		const [, selector, body] = offs[0];
		expect(selector.trim(), "something other than the Paper Texture switch takes the grain off")
			.toBe(FLAT);
		expect(body, "the switch drops the grain but leaves the inverted papers grained")
			.toMatch(/--st-inverted-paper:\s*linear-gradient\(\s*#fff\s*,\s*#fff\s*\)/);
	});

	// Ten percent of the playbook's colour over the whole form is what turns the paper into a
	// Judge's #E5E3EA, and it is the single biggest reason the light greys failed on a real sheet.
	it("takes the playbook wash off the form", () => {
		const washes = [...CSS.matchAll(/\.pbta\.sheet\.playbook-the-[a-z-]+ form/g)];
		expect(washes.length, "the playbook washes are gone or renamed").toBe(9);
		const kill = ownRule(CSS, `${HIGH} .pbta.sheet form`);
		expect(kill, "the high-contrast block does not neutralise the playbook wash").toBeTruthy();
		expect(kill).toMatch(/background-color:\s*transparent/);
	});
});

describe("what a magnifier needs that is not colour", () => {
	// There is no focus indicator on a text field anywhere on these sheets today: Foundry's own
	// compatibility layer carries `body.game .app input:focus { outline: none }`, which beats the
	// `--input-focus-outline-color` this system re-points, and several of our own controls delete
	// their ring on purpose. For somebody driving a magnified viewport the ring is the only thing
	// on screen that answers "where am I".
	it("gives focus a ring that is actually visible", () => {
		const rule = [...CSS.matchAll(/:root\.stonetop-high-contrast[^{]*:focus-visible\s*\{([^}]*)\}/g)];
		expect(rule.length, "the high-contrast block declares no focus ring").toBeGreaterThan(0);
		const body = rule.map(m => m[1]).join("\n");
		const outline = /outline:\s*(\d+)px\s+solid\s+(\S+?)\s*;/.exec(body);
		expect(outline, `no solid outline in the focus rule: ${body}`).not.toBeNull();
		expect(Number(outline[1]), "a 1px focus ring is not a focus ring at magnification")
			.toBeGreaterThanOrEqual(2);
		expect(contrastRatio(outline[2], PAPER), `the focus ring is ${ratioText(outline[2], PAPER)} on the paper`)
			.toBeGreaterThanOrEqual(3);
	});

	// A link told apart from body text by hue alone is invisible to a reader who cannot resolve
	// the hue, whatever its contrast ratio says.
	it("underlines links rather than relying on their colour", () => {
		const at = CSS.indexOf(HIGH);
		const block = CSS.slice(at);
		expect(block).toMatch(/a\.content-link[^{]*\{[^}]*text-decoration:\s*underline/s);
	});

	// The token is right and the ground is the exception: the playbook picker's tooltip paints
	// itself #2a2a2a and letters one line in `--st-text-faint`, which works while that token is
	// #999 and falls to 1.99:1 the moment this mode darkens it. It is the only place in the file
	// where a ramp token sits on a dark literal, and it is pinned rather than left to rot.
	it("pins the one ramp token that sits on a dark ground", () => {
		const pin = ownRule(CSS, `${HIGH} .stonetop-playbook-picker-tooltip-complexity`);
		expect(pin, "the picker tooltip's complexity line is not pinned").toBeTruthy();
		const colour = /color:\s*([^;]+);/.exec(pin);
		expect(colour, `no colour in the pin: ${pin}`).not.toBeNull();
		expect(contrastRatio(colour[1].trim(), "#2a2a2a")).toBeGreaterThanOrEqual(7);
	});

	/**
	 * The classic layout's tab strip, which is the primary navigation of every sheet a table on
	 * the old layout opens and was white on #999 — 2.85:1, the worst-reading navigation in the
	 * system.
	 *
	 * Asserted through the TOKEN, not by finding a rule that names `.sheet-tabs`. This block used
	 * to repaint the strip by retyping the base rule's three-sheet selector list, which meant a
	 * fourth sheet type added to that list silently kept the 2.85:1 strip and nothing failed.
	 * Checking the token instead means the base rule can grow a fourth arm and stay covered.
	 */
	it("repaints the classic layout's tab strip", () => {
		const bg = HC.get("--st-tabstrip-bg");
		// The LABEL is not re-pointed and should not be: it sits on the chip, not on the paper,
		// so only the fill under it has to move — the same split as --st-btn-primary-bg/-text.
		const ink = HC.get("--st-tabstrip-ink") ?? BASE.get("--st-tabstrip-ink");
		expect(bg, "the tab strip's rest fill is not re-pointed").toBeTruthy();
		expect(ink, "--st-tabstrip-ink is not declared anywhere").toBeTruthy();
		expect(contrastRatio(ink, bg)).toBeGreaterThanOrEqual(4.5);

		// And the base rule actually reads them, or the re-point above paints nothing.
		const base = declarations(CSS,
			".pbta.sheet .sheet-tabs:not(.stonetop-tab-rail) .item");
		expect(base, "the classic tab strip's base rule is gone or renamed").toBeTruthy();
		expect(base, "the strip still paints a literal, which no scope can re-pitch")
			.toMatch(/background:\s*var\(--st-tabstrip-bg\)/);
		expect(base).toMatch(/color:\s*var\(--st-tabstrip-ink\)/);
	});

	// The ACTIVE tab needs no rule and no token of its own: it reads the primary-button pair,
	// which this block already re-points. It carried a duplicate override until that was noticed.
	it("carries the active tab on the button tokens it already re-points", () => {
		const active = declarations(CSS,
			".pbta.sheet .sheet-tabs:not(.stonetop-tab-rail) .item.active");
		expect(active, "the active-tab rule is gone or renamed").toBeTruthy();
		expect(active).toMatch(/background:\s*var\(--st-btn-primary-bg\)/);
		const fill = HC.get("--st-btn-primary-bg");
		expect(fill, "--st-btn-primary-bg is not re-pointed, so the active tab is not repainted")
			.toBeTruthy();
		expect(contrastRatio(BASE.get("--st-btn-primary-text"), fill)).toBeGreaterThanOrEqual(7);
	});

	// The black-paper sheets keep their own skin — the rule this block states for every other
	// scope it leaves alone. The strip overrides used to sit one class heavier than
	// `.stonetop-past-death`'s own rules and so reached inside it; a token cannot.
	it("leaves the past-death strip to its own colours", () => {
		const at = CSS.indexOf(HIGH);
		expect(CSS.slice(at), "the high-contrast block names the classic strip directly again")
			.not.toMatch(/\.sheet-tabs:not\(\.stonetop-tab-rail\)/);
	});
});

describe("the chat card", () => {
	// One scan for both tests below. `declarations` walks all ~5,000 rules and splits every
	// prelude, so the same lookup written out twice was that walk done twice.
	const card = declarations(CSS, ":is(#chat, #chat-notifications, #chat-popout) .message:has(.stonetop-roll-card)");

	// The card's paper is pinned parchment in every theme, so anything on it left to INHERIT its
	// colour takes core's, which goes bone-white under a dark interface. The file documents that
	// trap twice already; the three elements carrying the dice ANSWER were the ones missed, and
	// the total rendered at about 1.1:1. Declared once on the card so everything on it inherits.
	it("declares its own ink instead of inheriting the interface's", () => {
		expect(card, "the roll card's message rule is gone or renamed").toBeTruthy();
		expect(card, "the roll card does not declare a colour").toMatch(/color:\s*var\(--st-text/);
	});

	// `--stonetop-font-scale` is anchored on `.stonetop .window-content`, and a chat message is in
	// the sidebar. So Sheet Font Size reached every sheet and dialog and stopped at the log —
	// leaving the surface that answers a player's rolls pinned at 13px however large they asked.
	it("answers the reader's own text size", () => {
		expect(card).toMatch(/font-size:\s*calc\([^;]*--stonetop-font-scale/);
	});
});

describe("the slate the mode has to be able to reach", () => {
	// `color: slategrey` was written out 38 times as the system's quiet label ink and measures
	// 3.57:1 on the paper — under AA, and part of the "lighter grey text" that was written in
	// about. A literal cannot be re-pitched by any scope, so the whole of the fix is that it is
	// now a token. Both tokens still resolve to slategrey, so normal contrast is unchanged.
	it("routes the quiet slate ink and fill through tokens", () => {
		expect(BASE.get("--st-quiet-ink"), "--st-quiet-ink is not declared").toBe("slategrey");
		expect(BASE.get("--st-accent-fill"), "--st-accent-fill is not declared").toBe("slategrey");
		expect([...CSS.matchAll(/var\(--st-quiet-ink\)/g)].length,
			"nothing reads --st-quiet-ink; the literals were not converted").toBeGreaterThan(30);
		expect([...CSS.matchAll(/var\(--st-accent-fill\)/g)].length).toBeGreaterThan(5);
	});

	/**
	 * INK **AND** FILL. The first cut of this guard checked `color:` only, and so certified the
	 * sweep as finished while 9 `background: slategrey` fills sat in the file unreachable — one
	 * of them `.stonetop-so-nav-entry.is-active`, white-on-slate at 4.05:1, which is the exact
	 * failure `--st-accent-fill` was introduced for.
	 *
	 * Borders are deliberately NOT in here yet: ~57 slate borders remain literal, they want a
	 * rule token of their own rather than either of these two, and a guard that failed on them
	 * today would only be a guard nobody could keep green.
	 */
	it("leaves no bare slategrey ink or fill behind for the mode to miss", () => {
		const bare = [...CSS.matchAll(/(?<![-a-z])(?:color|background|background-color):\s*slategrey\s*(?:!important\s*)?;/g)];
		expect(bare.map(m => CSS.slice(Math.max(0, m.index - 90), m.index + 24)),
			"a bare slategrey ink or fill is unreachable by the accessibility scope").toEqual([]);
	});

	it("re-pitches both of them, and the ink stays recognisably slate", () => {
		const ink = HC.get("--st-quiet-ink");
		const fill = HC.get("--st-accent-fill");
		expect(ink, "--st-quiet-ink is not re-pitched").toBeTruthy();
		expect(fill, "--st-accent-fill is not re-pitched").toBeTruthy();
		expect(contrastRatio(ink, PAPER)).toBeGreaterThanOrEqual(7);
		expect(contrastRatio("#fff", fill)).toBeGreaterThanOrEqual(7);
		// Still blue-grey rather than a neutral: the accent means something and a mode that
		// flattened it to black would take that away in the name of contrast.
		const { rgb } = parseColor(ink);
		expect(rgb[2], `${ink} has lost its slate cast`).toBeGreaterThan(rgb[0]);
	});
});

describe("every selector in the block points at something real", () => {
	/**
	 * The failure this catches, which happened while the block was being written: a rule was added
	 * for `.stonetop-edit-pencil`, a class that appears nowhere in the markup, the stylesheet or
	 * the code. It parsed, it linted, it read like a considered fix, and it did nothing whatever.
	 *
	 * An override block is uniquely prone to it. Every other rule in this file is written next to
	 * the thing it styles, so a name that does not exist is obvious; these are written at the far
	 * end of a 39,000-line file against surfaces the author is recalling rather than reading. And
	 * the symptom is silence: the mode simply fails to improve one surface, which is exactly what
	 * nobody can see by looking at the mode.
	 *
	 * So: every class this block names has to be a class this system actually puts on an element.
	 * Checked against the whole repo, not just the stylesheet, since a class can legitimately be
	 * styled here and stamped from a template or from JS.
	 */
	/**
	 * Read on DEMAND, not at collection time. This walk is ~670 files and ~8 MB, and it is
	 * consulted only for a class that has already failed the cheaper stylesheet check — which on
	 * a passing run is no classes at all. Built eagerly it was 8 MB read, held for the life of
	 * the worker, and never looked at.
	 */
	let corpus = null;
	const CORPUS = () => (corpus ??= (() => {
		const root = path.resolve(__dirname, "../..");
		const skip = new Set(["node_modules", ".git", "packs", "tests"]);
		let text = "";
		(function walk(dir) {
			for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
				if (skip.has(entry.name)) continue;
				const full = path.join(dir, entry.name);
				if (entry.isDirectory()) walk(full);
				else if (/\.(js|hbs|json)$/.test(entry.name)) text += fs.readFileSync(full, "utf8");
			}
		})(root);
		return text;
	})());

	// Classes the block may name without them appearing in markup: core's own, pbta's, and the
	// three root classes this feature invents (set by `classList.toggle`, not written out).
	const FOREIGN = /^(app|application|window-app|window-content|window-header|sheet|item|active|message|tab|moves|notes|hint|pbta|stonetop|stonetop-themed|stonetop-high-contrast|stonetop-no-texture|stonetop-no-italics|stonetop-readonly|vtt|form)$/;

	it("names no class that does not exist anywhere in the system", () => {
		const classes = new Set();
		for (const m of BLOCK.matchAll(/([^{}]+)\{[^{}]*\}/g)) {
			for (const c of m[1].matchAll(/\.([a-z][a-z0-9-]*)/gi)) classes.add(c[1]);
		}
		expect(classes.size, "no classes found in the accessibility block").toBeGreaterThan(15);
		// Everything before the block. `includes` on this short-circuits and allocates nothing,
		// where the `split(…).length - 1` pair it replaces cut both the whole stylesheet and the
		// whole block into fragments once per class name, for a count only ever compared as
		// "does it appear before the block at all".
		const before = CSS.slice(0, CSS.indexOf(FLAT));
		const missing = [...classes]
			.filter(name => !FOREIGN.test(name))
			// Named in the stylesheet somewhere else, or stamped from a template or from code.
			.filter(name => !before.includes(`.${name}`) && !CORPUS().includes(name));
		expect(missing, `classes the accessibility block styles that nothing wears: ${missing.join(", ")}`)
			.toEqual([]);
	});
});

/**
 * The black-paper scopes, and the one way this mode can reach inside them.
 *
 * They declare their skin on their own `.window-content`, and a property declared on an element
 * always beats one inherited from an ancestor, so every token they NAME survives the root class
 * whatever it says. That covers most of them, and it is why the mode can leave them alone.
 *
 * What it does not cover is a token they never mention. That one inherits from the palette above
 * and lands a value picked for white paper on near-black, so the mode makes it worse than doing
 * nothing at all: the quiet slate went from 4.6:1 to 2.4:1 as ink and 2.1:1 as a pip fill, and
 * core's link colour from its own 6.4:1 orange to a 2.0:1 navy. The stylesheet answers with one
 * short carve-out, and this is what holds it honest: it exists, it reaches all three scopes, it
 * names every token that would otherwise inherit, every value clears its bar on THEIR paper, and
 * it stays a correction rather than growing into a second skin.
 */
describe("the black-paper scopes", () => {
	const carveOuts = RULES.filter(([selector]) => BLACK_SCOPE(selector))
		.map(([selector, body]) => [selector, customProperties(body)]);

	it("is one rule, and reaches all three scopes", () => {
		expect(carveOuts.length, "the accessibility block corrects no black-paper scope at all").toBe(1);
		const [selector] = carveOuts[0];
		for (const scope of [/deaths-door-mood/, /past-death/, /death-drip/]) {
			expect(selector, `${scope.source} is not among the corrected scopes`).toMatch(scope);
		}
		// And the blocks it corrects are still there, still turning the paper over: the carve-out
		// is worthless if the scopes it names stopped painting black.
		expect([...CSS.matchAll(/--st-text-faint:\s*hsl\(0 0% (\d+)%\)/g)].length,
			"the black-paper scopes no longer set their own --st-text-faint").toBeGreaterThanOrEqual(3);
	});

	// Named one at a time rather than derived, because the derivation (every token the palette
	// re-points that the black-paper blocks do not declare) sweeps in a dozen that never land on
	// that paper at all — the seasons' clock, the playbook colours, the semantic families those
	// blocks DO turn over. These five are the ones a reader meets there.
	it("corrects every token that would otherwise inherit a white-paper value", () => {
		const [, set] = carveOuts[0];
		for (const name of ["--st-text-faint", "--st-quiet-ink", "--st-accent-fill",
			"--color-text-hyperlink", "--color-text-dark-inactive"]) {
			expect(set.has(name), `${name} is re-pointed for white paper and left to inherit onto black`)
				.toBe(true);
		}
	});

	it("clears the bar on their own paper, ink at 7:1 and a mark at 3:1", () => {
		const [, set] = carveOuts[0];
		for (const [name, value] of set) {
			if (!parseColor(value)) continue;
			const bar = INK(name) ? 7 : 3;
			expect(contrastRatio(value, BLACK_PAPER),
				`${name} (${value}) is ${ratioText(value, BLACK_PAPER)} on their paper`)
				.toBeGreaterThanOrEqual(bar);
		}
	});

	// A carve-out that grows past a handful has stopped being a correction and become a second
	// palette maintained by hand, at which point the scopes' own blocks are the place to write it.
	it("stays a correction rather than a second skin", () => {
		expect(carveOuts[0][1].size).toBeLessThanOrEqual(8);
	});
});
