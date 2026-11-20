// @vitest-environment happy-dom
import { describe, it, expect, vi } from "vitest";
import { readRepo as read, readCss, declarations } from "../../fakes/css.js";
import { systemHandlebars } from "../../fakes/hbs.js";
import {
	PREP_VIEWS, PREP_TAB_GROUP, PREP_GROUP, PREP_INITIAL_VIEW, PREP_SWITCHER_SELECTOR, PREP_PANES_SELECTOR,
	prepViewCounts, prepViewsContext, syncPrepSwitcher, wirePrepSwitcherKeys,
} from "../../../module/actors/gmtoolkit/gm-prep-views.js";

// The GM Toolkit's Prep tab: one rail button over three views (Encounters, Expeditions, Sites),
// chosen by a switcher at the top of the tab that is a second core tab group nested inside the
// rail's Prep panel.
//
// Every way this breaks is quiet. A pane on the wrong `data-group` is either hidden by the rail's
// controller the moment Prep is shown or never shown by the switcher's; a pane that lost its
// `tab encounters` class draws perfectly and binds no listener; a count read off the wrong list
// tells a GM there is prep waiting that has already been run; and a switcher that only flips
// classes leaves a screen reader announcing the view the GM just left. So the markup is RENDERED
// here, through the real partials, and asked the questions core's controller and a keyboard ask.

const CSS      = readCss();
const SHEET_JS = read("module/actors/gmtoolkit/StonetopGmToolkitSheet.js");

/** The Prep tab, rendered through every real partial over a context shaped like the sheet's. */
function renderPrep({ active, encounters = [], expeditions = [], sites = [], hasSteading = true } = {}) {
	const hb = systemHandlebars();
	hb.registerHelper("localize", k => game.i18n.localize(String(k)));
	hb.registerHelper("format", (k, opts) => game.i18n.format(String(k), opts.hash));
	hb.registerHelper("eq", (a, b) => a === b);
	hb.registerHelper("or", (...a) => a.slice(0, -1).some(Boolean));
	hb.registerHelper("and", (...a) => a.slice(0, -1).every(Boolean));
	hb.registerHelper("not", v => !v);
	hb.registerHelper("concat", (...a) => a.slice(0, -1).join(""));
	const stonetop = {
		canEdit: true, editMode: false, isGM: true, hasSteading, edit: {}, struggle: null,
		encounters:  { active: encounters,  completed: [] },
		expeditions: { active: expeditions, completed: [] },
		sites,
	};
	stonetop.prep = prepViewsContext(stonetop, active, "app-7");
	const host = document.createElement("div");
	host.innerHTML = hb.compile('{{> "stonetop.gm-toolkit-tab-prep"}}')({ stonetop });
	return host;
}

describe("the Prep tab's views", () => {
	it("are the three bundle-and-site views, in switcher order, opening on Encounters", () => {
		expect(PREP_VIEWS.map(v => v.key)).toEqual(["encounters", "expeditions", "sites"]);
		expect(PREP_INITIAL_VIEW).toBe("encounters");
		expect(PREP_GROUP).toBe("prep");
		// The rail's group is `_tabs[0]`, read by name all over the system; this one is next.
		expect(PREP_TAB_GROUP).toBe(1);
		expect(Object.isFrozen(PREP_VIEWS) && PREP_VIEWS.every(Object.isFrozen)).toBe(true);
	});

	// LIVE ones for the bundle views: a completed card is history, and counting it would say there
	// was prep still waiting that has been run. Every site counts: a place has no "done".
	it("count what is live, off the lists the panes are drawn from", () => {
		expect(prepViewCounts({
			encounters:  { active: [1, 2, 3], completed: [4, 5] },
			expeditions: { active: [1], completed: [2, 3, 4] },
			sites: [1, 2],
		})).toEqual({ encounters: 3, expeditions: 1, sites: 2 });
		// A context the builders have not filled (no steading, a failed pack load) counts nothing
		// rather than throwing out of getData.
		expect(prepViewCounts({})).toEqual({ encounters: 0, expeditions: 0, sites: 0 });
		expect(prepViewCounts()).toEqual({ encounters: 0, expeditions: 0, sites: 0 });
	});

	it("localize each segment, and say what its number counts", () => {
		const { views, label } = prepViewsContext({ sites: [1] }, "encounters", "x");
		expect(views.map(v => v.label)).toEqual(["Encounters", "Expeditions", "Sites"]);
		expect(views.map(v => v.countTip)).toEqual(["0 to run", "0 to run", "1 written up"]);
		expect(label).toBe("Prep views");
		expect(game.i18n.localize("stonetop.gmToolkit.tabs.prep")).toBe("Prep");
	});

	// Core's controller falls back to its nav's first item for a name it does not carry, so the
	// stamped markup has to make the same choice or the first paint disagrees with the bind.
	it("mark exactly one view active, falling back to the first the way core does", () => {
		const on = a => prepViewsContext({}, a).views.filter(v => v.active).map(v => v.key);
		expect(on("sites")).toEqual(["sites"]);
		expect(on(undefined)).toEqual(["encounters"]);
		expect(on("moves")).toEqual(["encounters"]);
	});

	// Unique in the DOCUMENT, so prefixed with the application's id rather than the actor's.
	it("join each segment to its pane by ids prefixed with the window's own", () => {
		const { views, panes } = prepViewsContext({}, "expeditions", "app-7");
		expect(views[1]).toMatchObject({ tabId: "app-7-prep-expeditions-tab", paneId: "app-7-prep-expeditions" });
		expect(panes.expeditions).toEqual({ id: "app-7-prep-expeditions", tabId: "app-7-prep-expeditions-tab", active: true });
		expect(panes.encounters.active).toBe(false);
	});
});

describe("the Prep tab, rendered", () => {
	it("is one panel of the RAIL's group, holding the switcher and the three panes", () => {
		const host = renderPrep();
		const prep = host.querySelector(":scope > .tab.prep");
		expect(prep.dataset.group).toBe("primary");
		expect(prep.dataset.tab).toBe("prep");
		expect(prep.querySelector(":scope > nav" + PREP_SWITCHER_SELECTOR)).not.toBeNull();
		expect(prep.querySelector(":scope > " + PREP_PANES_SELECTOR)).not.toBeNull();
		// No other rail-group panel hides inside it: the rail's controller toggles every
		// `.tab[data-tab]` in the body whose group is its own.
		expect(prep.querySelectorAll('.tab[data-group="primary"]')).toHaveLength(0);
	});

	// What core's controller does with nested groups: it skips a panel whose `data-group` is not
	// its own. So every pane must be on the switcher's group, and must be one of its nav's names.
	it("puts every pane on the switcher's group, as siblings, under the class each engine scopes to", () => {
		const host = renderPrep();
		const panes = [...host.querySelectorAll(PREP_PANES_SELECTOR + " .tab[data-tab]")];
		expect(panes.map(p => p.dataset.tab)).toEqual(["encounters", "expeditions", "sites"]);
		expect(panes.every(p => p.dataset.group === "prep")).toBe(true);
		expect(panes.every(p => p.parentElement.matches(PREP_PANES_SELECTOR))).toBe(true);
		// The engines' `panel` selectors (gm-encounters-tab.js / gm-expeditions-tab.js) and the
		// site listeners' scope, each matching exactly one pane.
		expect(host.querySelectorAll(".tab.encounters")).toHaveLength(1);
		expect(host.querySelectorAll(".tab.expeditions")).toHaveLength(1);
		expect(host.querySelector(".tab.sites .steading-sites")).not.toBeNull();
		expect(host.querySelector(".tab.encounters .tab.expeditions, .tab.expeditions .tab.encounters")).toBeNull();
		// The two bundle panes keep their own pencils; Sites has none.
		expect(host.querySelector(".tab.encounters > .steading-section-edit-toggle, .tab.encounters > * .steading-section-edit-toggle")).not.toBeNull();
		expect(host.querySelector(".tab.sites .steading-section-edit-toggle")).toBeNull();
	});

	it("draws the switcher as a real tablist of buttons, joined to the panes both ways", () => {
		const host = renderPrep({ active: "expeditions" });
		const nav = host.querySelector(PREP_SWITCHER_SELECTOR);
		expect(nav.getAttribute("role")).toBe("tablist");
		expect(nav.getAttribute("aria-label")).toBe("Prep views");
		expect(nav.classList.contains("sheet-tabs")).toBe(false);
		const buttons = [...nav.querySelectorAll("[data-tab]")];
		expect(buttons.map(b => b.tagName)).toEqual(["BUTTON", "BUTTON", "BUTTON"]);
		expect(buttons.every(b => b.getAttribute("type") === "button" && b.getAttribute("role") === "tab")).toBe(true);
		expect(buttons.map(b => b.getAttribute("aria-selected"))).toEqual(["false", "true", "false"]);
		expect(buttons.map(b => b.getAttribute("tabindex"))).toEqual(["-1", "0", "-1"]);
		for (const button of buttons) {
			const pane = host.querySelector(`#${button.getAttribute("aria-controls")}`);
			expect(pane?.dataset.tab).toBe(button.dataset.tab);
			expect(pane.getAttribute("role")).toBe("tabpanel");
			expect(pane.getAttribute("aria-labelledby")).toBe(button.id);
		}
		// The first paint shows the chosen pane, before core binds anything.
		const shown = [...host.querySelectorAll(PREP_PANES_SELECTOR + " > .tab.active")].map(p => p.dataset.tab);
		expect(shown).toEqual(["expeditions"]);
		expect(nav.querySelector(".active").dataset.tab).toBe("expeditions");
	});

	it("labels each segment with its icon, its name and its live count", () => {
		const host = renderPrep({ encounters: [{}, {}], sites: [] });
		const enc = host.querySelector('[data-tab="encounters"].stonetop-gm-prep-view');
		expect(enc.querySelector(".stonetop-gm-prep-view-icon").getAttribute("aria-hidden")).toBe("true");
		expect(enc.querySelector(".stonetop-gm-prep-view-label").textContent).toBe("Encounters");
		expect(enc.querySelector(".stonetop-gm-prep-view-count").textContent).toBe("2");
		expect(enc.getAttribute("aria-label")).toBe("Encounters, 2 to run");
		expect(enc.dataset.tooltip).toBe("2 to run");
		// An empty view's pill is dimmed by a class, not dropped, so the label beside it holds still.
		const sites = host.querySelector('[data-tab="sites"].stonetop-gm-prep-view .stonetop-gm-prep-view-count');
		expect(sites.textContent).toBe("0");
		expect(sites.classList.contains("stonetop-gm-prep-view-count--zero")).toBe(true);
	});

	// Sites is a view of its own now: no section heading, no fold, and nothing left in Expeditions.
	it("gives Sites its own pane, out from under Expeditions, with no heading or fold of its own", () => {
		const host = renderPrep({ active: "sites" });
		expect(host.querySelector(".tab.expeditions .steading-sites")).toBeNull();
		const sites = host.querySelector(".tab.sites");
		expect(sites.querySelector("[data-collapse], .stonetop-section-collapse")).toBeNull();
		expect(sites.querySelector(".stonetop-gm-expedition-sites")).toBeNull();
		expect(sites.querySelector(".steading-sites.steading-prep-cards")).not.toBeNull();
	});

	// The Struggle as One bar is the move a journey reaches for most; it stays with the journeys.
	it("keeps the Struggle as One bar in the Expeditions pane", () => {
		const hb = read("templates/actor/partials/gm-toolkit-tab-expeditions.hbs");
		expect(hb).toContain('class="stonetop-gm-struggle-bar"');
		expect(read("templates/actor/partials/gm-toolkit-tab-sites.hbs")).not.toContain("struggle");
	});
});

describe("the switcher, between renders", () => {
	it("puts aria-selected and the roving tabindex back after core flips the classes", () => {
		const nav = renderPrep().querySelector(PREP_SWITCHER_SELECTOR);
		syncPrepSwitcher(nav, "sites");
		const buttons = [...nav.querySelectorAll("[data-tab]")];
		expect(buttons.map(b => b.getAttribute("aria-selected"))).toEqual(["false", "false", "true"]);
		expect(buttons.map(b => b.getAttribute("tabindex"))).toEqual(["-1", "-1", "0"]);
		expect(() => syncPrepSwitcher(null, "sites")).not.toThrow();
	});

	// Selection follows focus: a view switch is a class flip on panes already in the DOM.
	it("steps with the arrow keys, wrapping, and jumps with Home and End", () => {
		const host = renderPrep();
		document.body.replaceChildren(host);
		const activate = vi.fn();
		wirePrepSwitcherKeys(host, activate);
		const button = tab => host.querySelector(`${PREP_SWITCHER_SELECTOR} [data-tab="${tab}"]`);
		const press = (tab, key) => {
			const ev = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
			button(tab).dispatchEvent(ev);
			return ev;
		};

		expect(press("encounters", "ArrowRight").defaultPrevented).toBe(true);
		expect(activate).toHaveBeenLastCalledWith("expeditions");
		expect(document.activeElement).toBe(button("expeditions"));

		press("encounters", "ArrowLeft");
		expect(activate).toHaveBeenLastCalledWith("sites");
		press("sites", "ArrowRight");
		expect(activate).toHaveBeenLastCalledWith("encounters");
		press("expeditions", "End");
		expect(activate).toHaveBeenLastCalledWith("sites");
		press("sites", "Home");
		expect(activate).toHaveBeenLastCalledWith("encounters");

		// Anything else is the button's own: Enter and Space click it, Tab leaves the strip.
		activate.mockClear();
		for (const key of ["Enter", " ", "Tab", "ArrowDown"]) expect(press("encounters", key).defaultPrevented).toBe(false);
		expect(activate).not.toHaveBeenCalled();
	});

	it("is wired by the sheet onto core's controller for the switcher's group", () => {
		expect(SHEET_JS).toMatch(/wirePrepSwitcherKeys\(html\[0\], \(view\) => this\._tabs\?\.\[PREP_TAB_GROUP\]\?\.activate\(view, \{ triggerCallback: true \}\)\)/);
		expect(SHEET_JS).toMatch(/tabs === this\._tabs\?\.\[PREP_TAB_GROUP\]/);
	});
});

describe("the switcher's stylesheet", () => {
	// Nested panes are not children of `.sheet-body`, so the frame's show/hide rules never reach them.
	it("shows exactly the active pane, flush inside the Prep tab's gutter", () => {
		expect(declarations(CSS, ".stonetop-gm-toolkit-sheet .stonetop-gm-prep-panes > .tab")).toMatch(/display: none/);
		expect(declarations(CSS, ".stonetop-gm-toolkit-sheet .stonetop-gm-prep-panes > .tab.active")).toMatch(/display: block/);
	});

	// Core's button look must not leak in, in any theme: every property it sets is stated away.
	it("states away core's button look on every segment", () => {
		const seg = declarations(CSS, ".stonetop-gm-prep-switcher .stonetop-gm-prep-view");
		for (const prop of [/border: 0/, /background: transparent/, /box-shadow: none/, /width: auto/, /min-height: 0/, /margin: 0/]) {
			expect(seg).toMatch(prop);
		}
		expect(seg).toMatch(/flex: 1 1 0/);
	});

	// Tokens only, so dark and high contrast re-point it: no literal colour in the active state.
	it("marks the active segment and its keyboard focus in tokens the dark and high-contrast scopes re-point", () => {
		const active = declarations(CSS, ".stonetop-gm-prep-switcher .stonetop-gm-prep-view.active");
		expect(active).toMatch(/box-shadow: inset 0 -2px 0 var\(--st-quiet-ink\)/);
		expect(active).toMatch(/background: var\(--st-slate-hover-bg\)/);
		expect(declarations(CSS, ".stonetop-gm-prep-switcher .stonetop-gm-prep-view:focus-visible"))
			.toMatch(/outline: 2px solid var\(--st-quiet-ink\)/);
		// High contrast's heavier marks live in the accessibility family, which must stay last.
		const hc = CSS.indexOf(":root.stonetop-high-contrast .stonetop-gm-prep-switcher");
		expect(hc).toBeGreaterThan(CSS.indexOf(":root.stonetop-high-contrast {"));
	});
});
