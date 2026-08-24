import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { withSectionEditing } from "../../module/utils/section-editing.js";
import { readCss, ownRule } from "../fakes/css.js";

// Just enough DOM for the mixin: class toggling, ancestor lookup, a forward
// descendant query, sibling walking, and delegated listeners on the root.
class FakeEl {
	constructor(className = "", parent = null) {
		this.classes = new Set(className.split(" ").filter(Boolean));
		this.dataset = {};
		this.attrs = {};
		this.parentElement = parent;
		this.children = [];
		this.listeners = {};
		parent?.children.push(this);
		this.classList = {
			toggle: (c, on) => { if (on) this.classes.add(c); else this.classes.delete(c); },
			contains: c => this.classes.has(c),
		};
	}
	get folded() { return this.classes.has("stonetop-section-folded"); }
	get nextElementSibling() {
		const sibs = this.parentElement?.children ?? [];
		return sibs[sibs.indexOf(this) + 1] ?? null;
	}
	matches(selector) {
		return selector.split(",").some(s => this.classes.has(s.trim().slice(1)));
	}
	setAttribute(name, value) { this.attrs[name] = value; }
	closest(selector) {
		for (let node = this; node; node = node.parentElement) if (node.matches(selector)) return node;
		return null;
	}
	querySelectorAll(selector) {
		const found = [];
		const walk = node => {
			for (const child of node.children) {
				if (child.matches(selector)) found.push(child);
				walk(child);
			}
		};
		walk(this);
		return found;
	}
	querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
	addEventListener(type, handler) { (this.listeners[type] ??= []).push(handler); }
	fire(type, event) { for (const handler of this.listeners[type] ?? []) handler(event); }
}

const HEADINGS = ".stonetop-details-heading-row, .stonetop-move-group-title";

// The character sheet's pencil-bearing shape: a heading row with the caret beside
// the pencil, and the section body as the row's following siblings.
function buildSheetDom(ids) {
	const root = new FakeEl("sheet-wrapper");
	const carets = {};
	const bodies = {};
	for (const id of ids) {
		const section = new FakeEl("details-section", root);
		const heading = new FakeEl("stonetop-details-heading-row", section);
		new FakeEl("stonetop-move-group-title", heading);
		const caret = new FakeEl("stonetop-section-collapse", heading);
		caret.dataset.section = id;
		bodies[id] = new FakeEl("stonetop-item", section);
		carets[id] = caret;
	}
	return { html: [root], carets, bodies };
}

const click = caret => ({ target: caret, preventDefault() {}, stopPropagation() {} });
const key = (caret, k) => ({ target: caret, key: k, preventDefault() {}, stopPropagation() {} });

const Sheet = withSectionEditing(class {
	constructor(actorId) {
		this.actor = { id: actorId };
		this._editMode = false;
	}
	render() {}
});

const originalSettings = globalThis.game.settings;
let store;

beforeEach(() => {
	store = {};
	globalThis.game.settings = {
		get: (_scope, key) => store[key] ?? {},
		set: (_scope, key, value) => { store[key] = value; },
	};
});

afterEach(() => { globalThis.game.settings = originalSettings; });

describe("section collapse", () => {
	it("folds a section on click and unfolds it on the next", () => {
		const sheet = new Sheet("actor1");
		const { html, carets, bodies } = buildSheetDom(["background"]);
		sheet._wireSectionCollapse(html, HEADINGS);

		expect(bodies.background.folded).toBe(false);
		expect(carets.background.attrs["aria-expanded"]).toBe("true");

		html[0].fire("click", click(carets.background));
		expect(bodies.background.folded).toBe(true);
		expect(carets.background.classes.has("stonetop-section-collapsed")).toBe(true);
		expect(carets.background.attrs["aria-expanded"]).toBe("false");
		expect(carets.background.attrs.title).toBe("Expand section");

		html[0].fire("click", click(carets.background));
		expect(bodies.background.folded).toBe(false);
		expect(carets.background.attrs.title).toBe("Collapse section");
	});

	it("folds from the keyboard too, and ignores other keys", () => {
		const sheet = new Sheet("actor1");
		const { html, carets, bodies } = buildSheetDom(["origin"]);
		sheet._wireSectionCollapse(html, HEADINGS);

		html[0].fire("keydown", key(carets.origin, "Tab"));
		expect(bodies.origin.folded).toBe(false);

		html[0].fire("keydown", key(carets.origin, "Enter"));
		expect(bodies.origin.folded).toBe(true);
	});

	it("re-applies the fold to a fresh render without a click", () => {
		const sheet = new Sheet("actor1");
		const first = buildSheetDom(["instinct", "appearance"]);
		sheet._wireSectionCollapse(first.html, HEADINGS);
		first.html[0].fire("click", click(first.carets.instinct));

		// Foundry replaces the whole element on a re-render: same sheet, new DOM.
		const second = buildSheetDom(["instinct", "appearance"]);
		sheet._wireSectionCollapse(second.html, HEADINGS);
		expect(second.bodies.instinct.folded).toBe(true);
		expect(second.bodies.appearance.folded).toBe(false);
	});

	it("folds each caret independently, by its own id", () => {
		const sheet = new Sheet("actor1");
		// Both move groups share the "moves" edit section but fold on their own ids.
		const { html, carets, bodies } = buildSheetDom(["playbookMoves", "learnedMoves"]);
		sheet._wireSectionCollapse(html, HEADINGS);

		html[0].fire("click", click(carets.playbookMoves));
		expect(bodies.playbookMoves.folded).toBe(true);
		expect(bodies.learnedMoves.folded).toBe(false);
		expect(store.sheetSectionsCollapsed.actor1).toEqual(["playbookMoves"]);
	});

	it("keeps each actor's folds to that actor", () => {
		const one = new Sheet("actor1");
		const domOne = buildSheetDom(["stats"]);
		one._wireSectionCollapse(domOne.html, HEADINGS);
		domOne.html[0].fire("click", click(domOne.carets.stats));

		const two = new Sheet("actor2");
		const domTwo = buildSheetDom(["stats"]);
		two._wireSectionCollapse(domTwo.html, HEADINGS);
		expect(domTwo.bodies.stats.folded).toBe(false);
		expect(store.sheetSectionsCollapsed).toEqual({ actor1: ["stats"] });
	});

	it("stops at the next heading, so a flat column folds one section not the rest", () => {
		// Inventory's shape: heading, body, heading, body — all one flat run.
		const sheet = new Sheet("actor1");
		const column = new FakeEl("stonetop-inventory-regular");
		const firstHead = new FakeEl("stonetop-move-group-title", column);
		const caret = new FakeEl("stonetop-section-collapse", firstHead);
		caret.dataset.section = "invRegular";
		const firstBody = new FakeEl("stonetop-inv-item", column);
		const secondHead = new FakeEl("stonetop-move-group-title", column);
		const secondBody = new FakeEl("stonetop-inv-item", column);

		sheet._wireSectionCollapse([column], HEADINGS);
		column.fire("click", click(caret));
		expect(firstBody.folded).toBe(true);
		expect(secondHead.folded).toBe(false);
		expect(secondBody.folded).toBe(false);
	});

	it("finds the heading ahead of a caret that sits in the section's corner", () => {
		// The steading's shape: pencil and caret in the card corner, heading after.
		const sheet = new Sheet("stonetop");
		const card = new FakeEl("steading-card steading-edit-section");
		const caret = new FakeEl("stonetop-section-collapse", card);
		caret.dataset.section = "resources";
		new FakeEl("steading-list-heading", card);
		const list = new FakeEl("steading-list", card);

		sheet._wireSectionCollapse([card], ".steading-list-heading");
		card.fire("click", click(caret));
		expect(list.folded).toBe(true);
		expect(caret.folded).toBe(false); // the corner controls stay put
	});

	// A control inside the HEADING is not inside the content, so the fold misses it unless it
	// says so. It says so with one marker class rather than by being named in the mixin, which
	// is what lets a new heading-resident control opt in without editing shared infrastructure.
	it("folds a heading control that marks itself, since it acts on what went away", () => {
		const sheet = new Sheet("actor1");
		const { html, carets } = buildSheetDom(["followers"]);
		const title = carets.followers.parentElement.children[0];
		const search = new FakeEl("stonetop-tab-search stonetop-section-heading-control", title);

		sheet._wireSectionCollapse(html, HEADINGS);
		html[0].fire("click", click(carets.followers));
		expect(search.folded).toBe(true);

		html[0].fire("click", click(carets.followers));
		expect(search.folded).toBe(false);
	});

	it("leaves an unmarked heading control alone, so the caret and title stay put", () => {
		const sheet = new Sheet("actor1");
		const { html, carets } = buildSheetDom(["followers"]);
		const title = carets.followers.parentElement.children[0];
		const decoration = new FakeEl("stonetop-section-badge", title);

		sheet._wireSectionCollapse(html, HEADINGS);
		html[0].fire("click", click(carets.followers));
		expect(decoration.folded).toBe(false);
	});
});

// A section can opt into starting SHUT (the GM Toolkit's prep reference: five screens of
// chapter that would otherwise sit under the cards on every open). What is stored is therefore
// the set of sections sitting AGAINST their default, not the set that is collapsed — the two
// readings coincide for every default-expanded section, which is what keeps older saved
// preferences meaning exactly what they meant.
describe("sections that default to collapsed", () => {
	/** Same shape as buildSheetDom, with `data-default-collapsed` on the named carets. */
	function buildWithDefaults(ids, defaultCollapsed = []) {
		const dom = buildSheetDom(ids);
		for (const id of defaultCollapsed) dom.carets[id].dataset.defaultCollapsed = "true";
		return dom;
	}

	it("starts folded for a user who has never touched it", () => {
		const sheet = new Sheet("actor1");
		const { html, carets, bodies } = buildWithDefaults(["guide", "cards"], ["guide"]);
		sheet._wireSectionCollapse(html, HEADINGS);

		expect(bodies.guide.folded).toBe(true);
		expect(carets.guide.attrs["aria-expanded"]).toBe("false");
		// ...and its neighbour, which did not opt in, is unaffected.
		expect(bodies.cards.folded).toBe(false);
	});

	it("opens on click, and records that it was opened", () => {
		const sheet = new Sheet("actor1");
		const { html, carets, bodies } = buildWithDefaults(["guide"], ["guide"]);
		sheet._wireSectionCollapse(html, HEADINGS);

		html[0].fire("click", click(carets.guide));
		expect(bodies.guide.folded).toBe(false);
		expect(carets.guide.attrs.title).toBe("Collapse section");
		// The stored id means "against its default", which for this section is OPEN.
		expect(store.sheetSectionsCollapsed.actor1).toEqual(["guide"]);
	});

	it("survives a re-render open, then shuts again and stores nothing", () => {
		const sheet = new Sheet("actor1");
		const first = buildWithDefaults(["guide"], ["guide"]);
		sheet._wireSectionCollapse(first.html, HEADINGS);
		first.html[0].fire("click", click(first.carets.guide));

		// Foundry replaces the whole element on a re-render: same sheet, new DOM.
		const second = buildWithDefaults(["guide"], ["guide"]);
		sheet._wireSectionCollapse(second.html, HEADINGS);
		expect(second.bodies.guide.folded).toBe(false);

		// Shutting it again puts it back at its default, so the override is dropped rather
		// than inverted. Otherwise the list grows an entry for every section left alone.
		second.html[0].fire("click", click(second.carets.guide));
		expect(second.bodies.guide.folded).toBe(true);
		expect(store.sheetSectionsCollapsed.actor1).toEqual([]);
	});

	// The whole point of storing the override rather than the state: a preference saved by an
	// older build lists sections the user COLLAPSED, and every one of those was default-expanded.
	it("reads a list saved before defaults existed the same way it always did", () => {
		store.sheetSectionsCollapsed = { actor1: ["stats"] };
		const sheet = new Sheet("actor1");
		const { html, bodies } = buildWithDefaults(["stats", "guide"], ["guide"]);
		sheet._wireSectionCollapse(html, HEADINGS);

		expect(bodies.stats.folded).toBe(true);   // collapsed, as it was saved
		expect(bodies.guide.folded).toBe(true);   // collapsed, because that is its default
	});
});

// A folded section is a heading with nothing under it, and a reader who never thought to
// hover a heading reads that as a section with nothing IN it. So the caret stops hiding the
// moment its section is shut, and only goes back to hover-only once the section is open.
//
// Asserted against the STYLESHEET, because the failure is silent in both directions: the
// caret still lays out, still hovers, still clicks, and every behaviour test above still
// passes whether it is painted at 0.8 or at 0. What actually breaks it is a per-host reveal
// out-specifying the shut rule and putting the caret back to invisible, which is why the
// specificity is measured here rather than trusted to source order.
describe("the caret while its section is shut", () => {
	const css = readCss();
	const SHUT = ".stonetop-section-collapse.stonetop-section-collapsed:not(:hover):not(:focus-visible)";
	const ARCANA_SHUT = ".stonetop-arcana-collapsible.is-collapsed > .stonetop-arcana-summary .stonetop-section-caret";

	/**
	 * Class-level specificity of one selector: classes, attribute selectors and pseudo-CLASSES.
	 * `:not(...)` counts once (CSS scores it as its argument, and every argument here is itself
	 * class-level), and the lookbehind keeps a `::pseudo-element` out of the count.
	 */
	function classParts(selector) {
		return (selector.match(/\.[A-Za-z_-][\w-]*|\[[^\]]*\]|(?<!:):[A-Za-z-]+(?:\([^)]*\))?/g) ?? []).length;
	}

	/** Every whole comma-separated selector in the sheet matching `pattern`. */
	function selectorsMatching(pattern) {
		const found = [];
		for (const [, prelude] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
			for (const entry of prelude.split(",").map(s => s.trim())) if (pattern.test(entry)) found.push(entry);
		}
		return found;
	}

	/** The opacity a rule body paints, as a number. */
	function opacityOf(body) {
		return Number(body?.match(/opacity:\s*([\d.]+)/)?.[1]);
	}

	it("hides both carets while the section is OPEN, as before", () => {
		expect(opacityOf(ownRule(css, ".stonetop-section-collapse"))).toBe(0);
		expect(opacityOf(ownRule(css, ".stonetop-section-caret"))).toBe(0);
	});

	it("paints the shut caret with no hover anywhere near it", () => {
		expect(opacityOf(ownRule(css, SHUT))).toBeGreaterThanOrEqual(0.6);
		expect(opacityOf(ownRule(css, ARCANA_SHUT))).toBeGreaterThanOrEqual(0.6);
	});

	// Every host heading reveals the caret its own way (`.steading-edit-section:hover > …`,
	// `.stonetop-details-heading-row:hover > …`, and so on), and several of those rules sit
	// LATER in the file than the shut rule. Ties would go to them.
	it("outranks every heading-hover reveal, wherever in the file that heading sits", () => {
		const reveals = selectorsMatching(/:hover\s*>\s*\.stonetop-section-collapse$/);
		expect(reveals.length).toBeGreaterThan(2);
		for (const reveal of reveals) expect(classParts(SHUT)).toBeGreaterThan(classParts(reveal));

		const arcanaReveal = ".stonetop-arcana-summary:hover .stonetop-section-caret";
		expect(selectorsMatching(/^\.stonetop-arcana-summary:hover \.stonetop-section-caret$/)).toHaveLength(1);
		expect(classParts(ARCANA_SHUT)).toBeGreaterThan(classParts(arcanaReveal));
	});

	// …but the caret still has somewhere brighter to go when you actually reach for it, or tab
	// onto it. Both of those are excluded from the shut rule rather than out-specified by it.
	it("leaves hover and keyboard focus their full-ink rules", () => {
		expect(SHUT).toContain(":not(:hover)");
		expect(SHUT).toContain(":not(:focus-visible)");
		expect(opacityOf(ownRule(css, ".stonetop-section-collapse:hover"))).toBe(1);
		expect(opacityOf(ownRule(css, ".stonetop-section-collapse:focus-visible"))).toBe(1);
	});
});
