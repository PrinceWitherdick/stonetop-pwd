import { describe, it, expect } from "vitest";
import Handlebars from "handlebars";
import { readRepo as read, readCss } from "../fakes/css.js";
import {
	THREAT_GUIDANCE_SECTIONS, threatGuidanceSections,
	THREAT_WRITEUP_STEPS, THREAT_WRITEUP_MOMENTS, THREAT_WRITEUP_CAUTION,
	GRIM_PORTENT_GUIDANCE, IMPENDING_DOOM_GUIDANCE, STAKES_GUIDANCE,
	THREAT_REVIEW_CHECKLIST,
} from "../../module/threats/threat-guidance.js";
import { THREAT_TYPES } from "../../module/threats/threat-types.js";
import { localize } from "../../module/utils/i18n.js";

// The Threats tab's prep reference (Book I, "Threats"). Reference only: nothing here is read
// off a card or written back to one, so what these tests protect is the wiring rather than any
// behaviour. Two things in particular fail SILENTLY, and both are what most of this file is for:
// a collapse id that collides with another section's folds two sections at once, and a section
// laid out as a flat sibling rather than its own box lets one caret swallow the sections below.

const THREATS_HBS = read("templates/actor/partials/gm-toolkit-tab-threats.hbs");
const GUIDE_ITEMS_HBS = read("templates/actor/partials/gm-prep-guide-items.hbs");
const PREP_JS     = read("module/actors/gmtoolkit/gm-prep-tabs.js");
const CSS         = readCss();

// Every fold caret this tab asks for, however it asks. A heading either invokes section-collapse
// directly (`defaultCollapsed`) or goes through section-heading (`startCollapsed`, which it
// forwards) — the two spellings mean exactly the same thing to the fold walk, so the checks below
// read both rather than pinning one.
//
// `startsCollapsed` is answered by RENDERING rather than by grepping the invocation, because the
// two are not the same question: Handlebars merges a partial's hash into the caller's context, so
// a section can start folded because of a field on the object being rendered and never say
// `startCollapsed=` anywhere. Grepping the text cannot see that; the emitted attribute can.
const foldCarets = (hbs) => [...hbs.matchAll(/\{\{>\s*"stonetop\.section-(?:collapse|heading)"([\s\S]*?)\}\}/g)]
	.map(m => m[1])
	.filter(body => /\bcollapse=/.test(body))
	.map(body => ({
		id: body.match(/\bcollapse=(\S+)/)[1],
		rest: body,
		startsCollapsed: renderHeading(body).includes('data-default-collapsed="true"'),
	}));

// One invocation, rendered through the REAL section-heading and section-collapse against an EMPTY
// context, so what comes out is what the invocation itself asked for.
const HEADING_HBS  = read("templates/actor/partials/section-heading.hbs");
const COLLAPSE_HBS = read("templates/actor/partials/section-collapse.hbs");
function renderHeading(body) {
	const hb = Handlebars.create();
	hb.registerPartial("stonetop.section-heading", HEADING_HBS);
	hb.registerPartial("stonetop.section-collapse", COLLAPSE_HBS);
	hb.registerHelper("localize", (k) => String(k));
	// The randomize / search controls are chrome these assertions do not care about.
	hb.registerPartial("stonetop.section-randomize", "");
	hb.registerPartial("stonetop.tab-search-control", "");
	// The context holds ONE key: whatever the invocation's `collapse=` names, so the caret is
	// emitted at all. Everything else is absent, so anything else in the output was asked for.
	const id = body.match(/\bcollapse=(\S+)/)?.[1] ?? "";
	const ctx = /^["']/.test(id) ? {} : { [id]: "x" };
	return hb.compile(`{{> "stonetop.section-heading" ${body}}}`)(ctx);
}

const ALL_ITEMS = [
	...THREAT_WRITEUP_STEPS, ...THREAT_WRITEUP_MOMENTS,
	...GRIM_PORTENT_GUIDANCE, ...IMPENDING_DOOM_GUIDANCE, ...STAKES_GUIDANCE,
	...THREAT_REVIEW_CHECKLIST,
];

describe("threat prep guidance (Book I, Threats)", () => {
	it("has the four reference sections in reading order", () => {
		expect(THREAT_GUIDANCE_SECTIONS.map(s => s.key)).toEqual([
			"writeup", "when", "portents", "review",
		]);
		expect(threatGuidanceSections()).toBe(THREAT_GUIDANCE_SECTIONS);
	});

	// A shared table treated as scratch space by one caller would corrupt every later read, and
	// this one is rebuilt on no render (see the module header).
	it("is frozen, table and all", () => {
		expect(Object.isFrozen(THREAT_GUIDANCE_SECTIONS)).toBe(true);
		for (const list of [THREAT_WRITEUP_STEPS, THREAT_WRITEUP_MOMENTS, GRIM_PORTENT_GUIDANCE,
			IMPENDING_DOOM_GUIDANCE, STAKES_GUIDANCE, THREAT_REVIEW_CHECKLIST]) {
			expect(Object.isFrozen(list)).toBe(true);
		}
	});

	it("gives every section a title key, a citation key and at least one group", () => {
		for (const s of THREAT_GUIDANCE_SECTIONS) {
			expect(s.titleKey, s.key).toMatch(/^stonetop\.gmToolkit\.threats\.guide\./);
			expect(s.noteKey, s.key).toMatch(/^stonetop\.gmToolkit\.threats\.guide\./);
			expect(s.groups.length, s.key).toBeGreaterThan(0);
			for (const g of s.groups) expect(g.items.length, s.key).toBeGreaterThan(0);
		}
	});

	// The setup loads the REAL en.json, so a key with no entry resolves to itself. Without this,
	// a typo'd or forgotten key ships as a literal "stonetop.gmToolkit.threats.guide.foo" in the
	// heading, which nothing else in the build would catch.
	it("has a real English string behind every key it declares", () => {
		const keys = THREAT_GUIDANCE_SECTIONS.flatMap(s => [
			s.titleKey, s.noteKey, s.cautionKey,
			...s.groups.map(g => g.labelKey),
		]).filter(Boolean);
		// Every section's title and note, the one caution, the three group labels.
		expect(keys.length).toBe(4 * 2 + 1 + 3);
		for (const key of keys) {
			expect(localize(key), key).not.toBe(key);
			expect(localize(key).trim(), key).toBeTruthy();
		}
	});

	// The citation is the whole point of condensing rather than reprinting: the chapter is where
	// the discussion and the worked examples live, and every section says which pages.
	it("cites a page range for every section", () => {
		for (const s of THREAT_GUIDANCE_SECTIONS) {
			expect(localize(s.noteKey), s.key).toMatch(/^Book I, pp?\.\d/);
		}
	});

	it("gives every prompt a name and a one-line gloss", () => {
		for (const item of ALL_ITEMS) {
			expect(item.name?.trim(), JSON.stringify(item)).toBeTruthy();
			expect(item.gloss?.trim(), item.name).toBeTruthy();
		}
	});

	// Project style rule, pinned the same way threat-types.test.js pins it for the move copy.
	// Covers the language file too, since that is where the section chrome now lives.
	it("has no em dashes anywhere in the shipped copy", () => {
		for (const item of ALL_ITEMS) {
			expect(item.name, item.name).not.toContain("—");
			expect(item.gloss, item.name).not.toContain("—");
		}
		for (const s of THREAT_GUIDANCE_SECTIONS) {
			expect(localize(s.titleKey), s.key).not.toContain("—");
			expect(s.cautionKey ? localize(s.cautionKey) : "", s.key).not.toContain("—");
		}
	});

	// Fold state is stored as one flat per-actor list of ids (settings.js
	// `sheetSectionsCollapsed`), shared with every other section on the sheet. A collision folds
	// two sections with one caret and nothing is logged.
	it("has unique collapse ids that can't collide with the proximity trackers", () => {
		const ids = THREAT_GUIDANCE_SECTIONS.map(s => s.collapseId);
		expect(new Set(ids).size).toBe(ids.length);
		for (const id of ids) expect(id).toMatch(/^threatGuide/);
		// The proximity sections fold under the bare proximity id, and Hazards under "hazards".
		expect(ids).not.toContain("homefront");
		expect(ids).not.toContain("hazards");
	});

	describe("the write-up steps", () => {
		it("are the chapter's eight, with the tail marked optional", () => {
			expect(THREAT_WRITEUP_STEPS).toHaveLength(8);
			// The load-bearing half of the list: a threat with a name, a type, a tracker and an
			// instinct is a finished threat. A GM who reads all eight as required writes four
			// times the prep the game asks for.
			expect(THREAT_WRITEUP_STEPS.slice(0, 5).some(s => s.optional)).toBe(false);
			expect(THREAT_WRITEUP_STEPS.slice(5).every(s => s.optional)).toBe(true);
		});

		it("are the only numbered section", () => {
			const ordered = THREAT_GUIDANCE_SECTIONS.filter(s => s.ordered).map(s => s.key);
			expect(ordered).toEqual(["writeup"]);
		});
	});

	it("keeps the caution that decides whether a thing is a threat at all", () => {
		// Attached to the "when to write one up" section, which is the one it qualifies, and
		// to no other: it is a standing caution over that whole list rather than a prompt in it.
		const withCaution = THREAT_GUIDANCE_SECTIONS.filter(s => s.cautionKey).map(s => s.key);
		expect(withCaution).toEqual(["when"]);
		expect(THREAT_GUIDANCE_SECTIONS.find(s => s.key === "when").cautionKey)
			.toBe(THREAT_WRITEUP_CAUTION);
	});

	it("splits the portents section into its three named parts", () => {
		const labels = THREAT_GUIDANCE_SECTIONS
			.find(s => s.key === "portents").groups.map(g => localize(g.labelKey));
		expect(labels).toEqual(["Grim portents", "Impending doom", "Stakes"]);
	});
});

describe("the tab renders the reference", () => {
	it("draws every section, each folding under its own id", () => {
		expect(THREATS_HBS).toContain("{{#each stonetop.threatGuidance}}");
		// Through the shared heading partial, which forwards both to section-collapse.
		expect(foldCarets(THREATS_HBS).find(c => c.id === "collapseId")).toBeDefined();
	});

	// EVERY section on this tab opens expanded, reference included. It is a long tab and the
	// reference is the bottom of it, but a section shut on first open is a section a GM never
	// learns is there, and the caret plus the remembered preference is the whole answer to length:
	// fold it once and it stays folded for that user.
	it("starts every section expanded, reference included", () => {
		const carets = foldCarets(THREATS_HBS);
		const reference = carets.filter(c => /collapseId|threatGuideTypes/.test(c.id));
		expect(reference).toHaveLength(2); // the guidance loop, plus the types section
		// Asserted on the RENDER, not on a grep for `startCollapsed=`: a section can start shut
		// because of an ambient context field that nothing here asked for, and that would fold the
		// GM's prep away with no invocation to grep for. See `foldCarets`.
		expect(carets.length).toBeGreaterThan(reference.length);
		for (const c of carets) expect(c.startsCollapsed, c.id).toBe(false);
	});

	// The fold walk claims a heading's FOLLOWING SIBLINGS until it meets the next heading
	// (utils/section-editing.js). Sections laid out in one flat run would let the first caret
	// swallow every one below it, so each has to be its own box.
	it("boxes each section, so one caret can't swallow the next", () => {
		expect(THREATS_HBS).toMatch(
			/\{\{#each stonetop\.threatGuidance\}\}\s*<div class="steading-threats-section steading-threats-guide">/);
	});

	// Only <h3> is a fold heading on this sheet (StonetopGmToolkitSheet's HEADING_SELECTOR). A
	// group's sub-label rendered as an <h3> would cut its own section's fold short.
	it("renders group sub-labels below heading level", () => {
		expect(THREATS_HBS).toContain('<h4 class="steading-threats-guide-label">');
	});

	// Reference about writing threats is most useful to the GM who has written none, which is
	// exactly the state the has-a-steading branch covers with "there is nowhere to file prep".
	it("sits outside the has-a-steading branch", () => {
		const afterBranch = THREATS_HBS.slice(THREATS_HBS.indexOf("{{/if}}", THREATS_HBS.indexOf('{{> "stonetop.gm-prep-no-steading"')));
		expect(afterBranch).toContain("stonetop.threatGuidance");
		expect(PREP_JS).toMatch(/st\.threatGuidance\s*=[\s\S]*?if \(!steading\) return context;/);
	});

	// One catalog, read straight rather than restated, so a type cannot come to mean two
	// different things on the tab and in the Write-Up-a-Threat dialog.
	it("reads the eight types from the one catalog", () => {
		// Built inside `threatReference()` (localized once per page rather than per render) and
		// published from there, so the assertion is that the list still comes off THREAT_TYPES.
		expect(PREP_JS).toMatch(/types:\s*THREAT_TYPES\.map/);
		expect(PREP_JS).toMatch(/st\.threatTypeReference\s*=\s*reference\.types/);
		expect(THREATS_HBS).toContain("{{#each stonetop.threatTypeReference}}");
		// Blurbs live in threat-types.js and nowhere else.
		for (const t of THREAT_TYPES.slice(0, 3)) {
			expect(THREATS_HBS, t.id).not.toContain(t.blurb);
		}
	});

	// Each type's own GM moves, behind a disclosure on its name. The create dialog offers the same
	// list as a checklist while you WRITE a threat up; this is where you read what one already on
	// the table would do next, which is the question the book prints these lists for (p.283).
	//
	// Silent both ways: a type row with no moves is a caret that opens nothing, and a panel that
	// renders open turns an eight-line reference into ninety.
	it("opens each type's own moves off its name", () => {
		expect(PREP_JS).toMatch(/moves:\s*t\.suggestedMoves/);
		expect(THREATS_HBS).toContain('class="steading-threat-type-toggle" aria-expanded="false"');
		expect(THREATS_HBS).toMatch(/<ul class="steading-threat-type-moves" hidden>/);
		expect(THREATS_HBS).toContain("{{#each moves}}");
		// Toggled by the shared helper, so the hidden/aria pair cannot drift from the Moves tab's.
		expect(PREP_JS).toContain('toggleDisclosure(typeToggle, ".steading-threat-type-moves")');
		// The caret matches the GM moves list: same size, same ink, same right edge. Two
		// disclosures on one sheet that open the same way should not read as two affordances.
		const caret = CSS.match(/\.stonetop \.steading-threat-type-toggle::after\s*\{([^}]*)\}/)?.[1];
		expect(caret, "no caret rule for a threat type").toBeTruthy();
		expect(caret).toMatch(/position:\s*absolute/);
		expect(caret).toMatch(/right:\s*0/);
		expect(caret).toMatch(/font-size:\s*1\.[2-9]/);
		expect(caret).toMatch(/color:\s*var\(--st-text\)/);
		// Positioned against the ROW, which is what has the right edge worth aligning to: the
		// button is only as wide as the type's name. The row has to stay the containing block.
		expect(CSS).toMatch(/\.stonetop \.steading-threats-guide-list > li \{[^}]*position:\s*relative/);
		// ...with the lane kept clear of the name and the blurb both.
		expect(CSS).toMatch(/\.stonetop \.steading-threat-type-list > li \{[^}]*padding-right:\s*1\.4em/);
		// Every type has moves to show; the catalog is the one place they live.
		for (const t of THREAT_TYPES) {
			expect(t.suggestedMoves.length, `${t.id} has no moves`).toBeGreaterThanOrEqual(6);
			expect(THREATS_HBS, t.id).not.toContain(t.suggestedMoves[0]);
		}
	});

	// The catalog has always carried these and the create dialog has always shown them; the tab,
	// the one surface where you choose which of three piles a threat goes in, printed the bare
	// label. Inline in the heading so a folded tracker still says what it means.
	it("prints each proximity's hint in its heading", () => {
		expect(PREP_JS).toMatch(/hint:\s*p\.hint/);
		// The hint rides in as the heading's `note`, which the shared partial renders as the
		// dimmed span beside the title.
		expect(THREATS_HBS).toMatch(/section-heading"[^}]*title=heading[^}]*note=hint/);
	});
});

// The Moves tab has always been localized and this one never was. Half-and-half is worse than
// either, so the tab's chrome moved into the language file wholesale.
describe("the tab's chrome is localized", () => {
	it("leaves no English sentences in the template", () => {
		const markup = THREATS_HBS.replace(/\{\{!--[\s\S]*?--\}\}/g, "");
		// Any run of three or more words outside a handlebars expression is copy that escaped.
		const stray = [...markup.matchAll(/>\s*([A-Za-z][A-Za-z',.]*(?:\s+[A-Za-z][A-Za-z',.]*){2,})\s*</g)]
			.map(m => m[1].trim());
		expect(stray).toEqual([]);
	});

	it("builds both interpolated strings rather than gluing a label to a suffix", () => {
		// Word order around a name is not portable, so a template that concatenated would be
		// untranslatable even with every part in the language file.
		expect(PREP_JS).toMatch(/format\("stonetop\.gmToolkit\.threats\.proximityHeading", \{ proximity/);
		expect(PREP_JS).toMatch(/format\("stonetop\.gmToolkit\.threats\.addThreat", \{ proximity/);
		expect(PREP_JS).not.toMatch(/`Write up a \$\{/);
	});

	it("resolves every key the template names", () => {
		const keys = [...THREATS_HBS.matchAll(/localize "([^"]+)"/g)].map(m => m[1]);
		expect(keys.length).toBeGreaterThanOrEqual(5);
		for (const key of keys) expect(localize(key), key).not.toBe(key);
	});

	// Generated content cannot be localized and is not reliably announced by screen readers, so
	// the one word saying a step can be skipped has to be a real element.
	it("marks optional steps with a real element, not CSS content", () => {
		// The guidance rows live in their own partial now (one copy for the ordered list and the
		// plain one alike), so the element is asserted where it is actually written.
		expect(GUIDE_ITEMS_HBS).toContain('<em class="steading-threats-guide-optional">{{../optionalLabel}}</em>');
		// Localized in `threatReference()` with the rest of the tab's static chrome, and published
		// from there — the point being that it is a localize() call and not a CSS `content:`.
		expect(PREP_JS).toMatch(/optionalLabel:\s*localize\(/);
		expect(PREP_JS).toMatch(/st\.threatOptionalLabel\s*=\s*reference\.optionalLabel/);
		expect(CSS).not.toMatch(/content:\s*"optional"/);
	});

	// The rows partial is named for every GM-prep kind, so the label it prints has to arrive as a
	// parameter. Reached for through `@root` it would resolve on this tab and nowhere else, and
	// the failure is an empty <em> with no error — the very tag the test above exists to protect.
	it("is handed the optional label rather than reaching for the sheet context", () => {
		// The MARKUP, not the docblock — which says the word while explaining why it is not used.
		expect(GUIDE_ITEMS_HBS.replace(/\{\{!--[\s\S]*?--\}\}/g, "")).not.toContain("@root");
		const calls = [...THREATS_HBS.matchAll(/\{\{>\s*"stonetop\.gm-prep-guide-items"([^}]*)\}\}/g)];
		expect(calls.length).toBeGreaterThan(0);
		for (const [, args] of calls) expect(args).toMatch(/\boptionalLabel=/);
	});

	// ...and handed the ROWS the same way, in the hash, which is the half that is not obvious.
	// Handlebars merges a partial's hash INTO its context, and merging anything into an ARRAY
	// flattens it to a plain object holding the indices plus the hash's keys — so passing the rows
	// as the context and the label in the hash made the partial's each walk `optionalLabel` as if
	// it were a row, emitting one nameless <li> per list: a lone dash under every checklist and a
	// stray final number under the write-up steps. Nothing errored.
	//
	// Asserted by RENDERING the real partial rather than by grepping the invocation, because the
	// invocation looked right: the failure is in what Handlebars does with it.
	it("emits exactly one row per item, with nothing trailing the list", () => {
		const hb = Handlebars.create();
		hb.registerPartial("stonetop.gm-prep-guide-items", GUIDE_ITEMS_HBS);
		const invocation = THREATS_HBS.match(/\{\{>\s*"stonetop\.gm-prep-guide-items"[^}]*\}\}/)[0]
			.replace(/@root\.stonetop\.threatOptionalLabel/, "@root.label");
		const render = hb.compile(`{{#each groups}}${invocation}{{/each}}`);
		for (const section of THREAT_GUIDANCE_SECTIONS) {
			const html = render({ groups: section.groups, label: "optional" });
			const rows = [...html.matchAll(/<li>([\s\S]*?)<\/li>/g)].map(m => m[1]);
			expect(rows.length, section.key).toBe(section.groups.reduce((n, g) => n + g.items.length, 0));
			// A row with no name is the shape the stray one took: the markers are drawn in CSS off
			// the <li> itself, so it is invisible to a count and visible on screen.
			for (const row of rows) expect(row, section.key).toMatch(/<strong>\S/);
		}
	});
});

// Both of these fail SILENTLY: the panel still renders, just wrong, and nothing is logged.
describe("the reference panel's layout", () => {
	// The type list carries BOTH `steading-threats-guide-list` and `steading-threat-type-list`,
	// so the checklist's grey dash rule matches it too. That selector outranks the accent-tick
	// rule (three classes to two), so without the exclusion every type row draws a grey dash and
	// the tick rule silently does nothing at all.
	it("keeps the checklist dash off the type list, so the accent tick survives", () => {
		expect(CSS).toContain(
			".stonetop .steading-threats-guide-list:not(.is-ordered):not(.steading-threat-type-list) > li::before");
	});

	// ...and having been excluded, the tick can no longer borrow `position` from that rule.
	// Un-positioned, it is an inline box and its left/top/bottom do nothing.
	it("gives the accent tick its own position", () => {
		const rule = CSS.match(/\.stonetop \.steading-threat-type-list > li::before \{([^}]*)\}/)?.[1];
		expect(rule, "accent tick rule").toBeTruthy();
		expect(rule).toMatch(/position:\s*absolute/);
		expect(rule).toMatch(/--threat-accent/);
	});

	// CreateThreatDialog's `_splitColumns` documents why its own two-column move list is not a
	// grid: one item wrapping to a second line stretches its whole ROW and leaves a gap under
	// its shorter neighbour. These glosses wrap constantly, so a grid would rag the panel.
	it("lays the lists out in columns rather than a grid", () => {
		const rule = CSS.match(/\.stonetop \.steading-threats-guide-list \{([^}]*)\}/)?.[1];
		expect(rule, "guide list rule").toBeTruthy();
		expect(rule).toMatch(/columns:/);
		expect(rule).not.toMatch(/display:\s*grid/);
		// A row split across a column break strands its gloss at the top of the next column.
		const item = CSS.match(/\.stonetop \.steading-threats-guide-list > li \{([^}]*)\}/)?.[1];
		expect(item).toMatch(/break-inside:\s*avoid/);
	});
});
