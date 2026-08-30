import { describe, it, expect, vi, beforeEach } from "vitest";
import { readRepo as read, readCss, repoFileExists, declarations } from "../../fakes/css.js";
import { fakeEl, makeListHost, fakeRoot as sheetRoot } from "../../fakes/dom.js";

// The GM Toolkit's Expeditions tab: a trip prepped before the night it is run, in named cards —
// the map of the route, the sites along the way, whatever waits at the end.
//
// WHAT IS NOT TESTED HERE is most of what the tab does. The card, the two lists, the reorders, the
// drops, the deploy and the caret are ONE implementation shared with the Encounters tab
// (gm-bundle-tab.js), exercised at length in gm-encounters-tab.test.js, and a second copy of those
// assertions would be a second thing to update rather than a second guard. What is tested here is
// exactly what is new:
//
//   the WIRING, because every leg of adding a tab fails silently;
//   the SHARING, because two engines now bind to one sheet root and print one set of class names,
//     and the failure that buys is a click on one tab acting on the other's list;
//   the JOIN to the walkthrough, which is the one control this card has that the other has not.

// The dialog module pulls in the route step's art browser on import. Same fake as the sibling
// expedition suites.
vi.mock("../../../module/book2-art/travel-map-art.js", () => ({
	browseTravelMapArt: () => Promise.resolve({ has: () => false }),
	travelMapFile:      () => Promise.resolve(null),
	resolveTravelMap:   () => Promise.resolve(null),
}));

const { withGmExpeditionsTab, normalizeExpedition, EXPEDITIONS_TAB } =
	await import("../../../module/actors/gmtoolkit/gm-expeditions-tab.js");
const { ENCOUNTERS_TAB, withGmEncountersTab } =
	await import("../../../module/actors/gmtoolkit/gm-encounters-tab.js");
const { ExpeditionDialog } = await import("../../../module/dialogs/ExpeditionDialog.js");

const CSS         = readCss();
const STONETOP_JS = read("stonetop.js");
const SHEET_HBS   = read("templates/actor/gm-toolkit.hbs");
const SHEET_JS    = read("module/actors/gmtoolkit/StonetopGmToolkitSheet.js");
const MODEL_JS    = read("module/data-models/GmToolkitModel.js");
const FIELDS_JS   = read("module/data-models/fields.js");
const TAB_HBS     = read("templates/actor/partials/gm-toolkit-tab-expeditions.hbs");
const CARD_HBS    = read("templates/actor/partials/gm-expedition-card.hbs");
const ENC_CARD    = read("templates/actor/partials/gm-encounter-card.hbs");

/** Markup with the Handlebars comments stripped, so prose cannot answer for the template. */
const strip = hbs => hbs.replace(/\{\{!--[\s\S]*?--\}\}/g, "");
const TAB_MARKUP   = strip(TAB_HBS);
const CARD_MARKUP  = strip(CARD_HBS);
const PANEL_MARKUP = `${TAB_MARKUP}\n${CARD_MARKUP}`;

const makeHost = (rows = [], opts) => makeListHost(withGmExpeditionsTab, "system.expeditions", rows, opts);
const listOf = actor => actor.system.expeditions;

/** The rendered root, carrying the `.tab.expeditions` panel this tab's listeners scope to. */
const fakeRoot = () => sheetRoot({ panelClasses: ["tab", "expeditions"] });

/** One rendered card: only the controls these tests press. */
function makeCardEl(panel, row) {
	const li = fakeEl({ cls: ["stonetop-gm-encounter"], parent: panel, dataset: { encounterId: row.id } });
	return {
		li,
		name:   fakeEl({ cls: ["stonetop-gm-encounter-name"], value: row.name ?? "", parent: li }),
		remove: fakeEl({ cls: ["stonetop-gm-encounter-remove"], parent: li }),
		run:    fakeEl({ cls: ["stonetop-gm-expedition-run"], parent: li }),
	};
}

beforeEach(() => {
	global.ui = { notifications: { warn: () => {}, info: () => {}, error: () => {} } };
});

/* ══ wiring ═══════════════════════════════════════════════════════════════════ */

describe("the Expeditions tab: wiring", () => {
	it("is a panel of the toolkit's tab group, registered as a partial", () => {
		expect(TAB_HBS).toMatch(/<div class="tab expeditions\b[^"]*"[^>]*data-group="primary"/);
		expect(TAB_HBS).toContain('data-tab="expeditions"');
		expect(STONETOP_JS).toContain('"stonetop.gm-toolkit-tab-expeditions"');
		expect(STONETOP_JS).toContain('"stonetop.gm-expedition-card"');
		expect(repoFileExists("templates/actor/partials/gm-toolkit-tab-expeditions.hbs")).toBe(true);
		expect(repoFileExists("templates/actor/partials/gm-expedition-card.hbs")).toBe(true);
	});

	// The rail's order is the source order of these partial calls, and the body's is a second list
	// that has to agree: a mismatch is invisible, because the panels are shown one at a time.
	it("sits directly after Encounters, in the rail and in the body", () => {
		// The PANEL order. The rail carries one more entry after these seven — the shared
		// Preferences tab, whose panel comes from "stonetop.tab-preferences" rather than from a
		// gm-toolkit-tab partial, so it is absent from the body list this regex builds.
		const order = ["homefront", "moves", "threats", "encounters", "expeditions", "wonder", "loop"];
		expect([...SHEET_HBS.matchAll(/tab-rail-item"\s+tab="(\w+)"/g)].map(m => m[1])).toEqual([...order, "preferences"]);
		expect([...SHEET_HBS.matchAll(/\{\{>\s*"stonetop\.gm-toolkit-tab-(\w+)"\}\}/g)].map(m => m[1])).toEqual(order);
	});

	// A data-tab with no row in the icon table gets a mask with no image, which resolves to FULL
	// coverage: a solid block where the glyph belongs, and nothing logged.
	it("earns a rail glyph from the icon table, and the file it names exists", () => {
		expect(CSS).toMatch(/\.stonetop-tab-rail \.item\[data-tab="expeditions"\]\s*\{\s*--st-tab-icon:/);
		expect(repoFileExists("assets/icons/tabs/direction-signs.svg")).toBe(true);
	});

	// Worn as a MASK, so alpha may exist only where the ink is. The source file this was taken
	// from paints its background square OPAQUE BLACK, which as a mask is a solid slab.
	//
	// A SIGNPOST AND NOT THE MACRO'S TREASURE MAP, which would have tied the tab to the window it
	// opens. The map is four thick strokes short of legible at the 20px the rail scales to — its
	// route and its X are fine holes in a filled sheet and they close up — so the tie was the
	// cheaper thing to give up. Pinned, so a well-meant swap back has to read this first.
	it("ships a maskable glyph, credited like the rest of the rail", () => {
		const svg = read("assets/icons/tabs/direction-signs.svg");
		expect(svg).toContain('viewBox="0 0 512 512"');
		expect(svg).toMatch(/M0 0h512v512H0z[^>]*fill-opacity="0"/);
		expect(svg).not.toMatch(/M0 0h512v512H0z[^>]*fill-opacity="1"/);
		// `--` is illegal inside an XML comment and makes the whole file unparseable, which draws
		// nothing at all.
		expect(svg.match(/<!--[\s\S]*?-->/)?.[0]).not.toMatch(/[^!]--[^>]/);
		expect(read("assets/icons/tabs/ATTRIBUTION.md")).toContain("direction-signs.svg");
		expect(repoFileExists("assets/icons/tabs/treasure-map.svg")).toBe(false);
	});

	it("has a localized name", () => {
		expect(game.i18n.localize("stonetop.gmToolkit.tabs.expeditions")).toBe("Expeditions");
	});

	// SITES LIVE HERE NOW, folded in from a tab of their own: a site is what a trip is for, and a
	// rail-click between the two meant the sites for tonight's journey could never be read beside
	// the journey. The storage did NOT move with it — a site is still a JournalEntryPage on the
	// steading (gm-prep-tabs.js says at length what happens when that is forgotten) — and every
	// listener it needs is scoped to `.steading-sites`, not to a panel, which is why the move cost
	// that mixin nothing.
	it("carries the Sites section at its foot, outside the card list", () => {
		expect(TAB_MARKUP).toContain('{{> "stonetop.gm-toolkit-sites-section"}}');
		// AFTER the section holding the expedition cards, not inside it: that section is what the
		// tab's pencil locks and what spaces the cards, and sites are gated by neither.
		expect(TAB_MARKUP.indexOf("gm-toolkit-sites-section"))
			.toBeGreaterThan(TAB_MARKUP.lastIndexOf("</section>"));
		expect(read("module/actors/gmtoolkit/gm-prep-tabs.js")).toContain('scope: ".steading-sites"');
	});

	// The pencil is `position: absolute` against its section, and this panel only BECOMES that
	// section's containing block by joining the shared `:is()`. Left out, the pencil floats against
	// whatever positioned ancestor is next up the frame, with nothing logged.
	it("is the positioning context its corner pencil floats in", () => {
		expect(CSS).toMatch(/\.sheet-body > :is\([^)]*\.tab\.expeditions\)\s*\{\s*position: relative/);
		expect(TAB_HBS).toContain('class="tab expeditions steading-edit-section"');
	});

	// The JOIN the pencil stands on: the template reads `stonetop.edit.expeditions` and the tab's
	// config is keyed by the same string. A typo in either half gives a section that can never be
	// unlocked, with nothing logged.
	it("names one edit section, spelled the same in the template and in the config", () => {
		expect(TAB_MARKUP).toContain('section="expeditions"');
		expect(TAB_MARKUP).toContain("stonetop.edit.expeditions");
		expect(EXPEDITIONS_TAB.section).toBe("expeditions");
	});

	it("is composed into the sheet, and flushed before every paint and every close", () => {
		expect(SHEET_JS).toMatch(/withGmExpeditionsTab\(withGmEncountersTab\(/);
		// Inside the `Promise.all` gather in `_getData` rather than awaited on a line of its own:
		// this builder and the two beside it can each be waiting on a pack load, so the sheet
		// runs them together. The trailing comma is what says it is still IN the gather.
		expect(SHEET_JS).toContain("this._addGmExpeditionsContext(context),");
		expect(SHEET_JS).toContain("this._activateGmExpeditionsListeners(html[0]);");
		// Once in `_render` and once in `close`: Escape shuts an AppV1 window straight from the
		// focused field, so its `change` never fires.
		expect(SHEET_JS.match(/await this\._flushGmExpeditionEdits\(\);/g)).toHaveLength(2);
	});

	it("is stored on the toolkit actor, beside the encounters it was modelled on", () => {
		expect(MODEL_JS).toContain("expeditions: expeditionsField(),");
		expect(FIELDS_JS).toContain("export const expeditionsField");
		expect(EXPEDITIONS_TAB.path).toBe("system.expeditions");
	});

	// A `name` on an input inside this sheet's <form> puts it in core's submit data, where the
	// array indices would expand into an OBJECT keyed "0", "1", … and quietly replace the list.
	it("keeps every field out of the form's submit data", () => {
		expect(PANEL_MARKUP).not.toMatch(/<(?:input|textarea|prose-mirror)[^>]*\sname=/);
	});

	// There is no <img> on this tab, so the `draggable="false"` opt-out every portrait in the
	// system carries has nothing to apply to. Pinned so that adding one without it is a failure
	// rather than a Gecko drag that hands over the image instead of the document.
	it("has no portrait, which is why nothing here carries the image drag opt-out", () => {
		expect(PANEL_MARKUP).not.toMatch(/<img/);
	});

	// The fold's open/shut state is stored per user against the id in `collapse=`. Shared with the
	// Encounters tab's fold, one caret would fold both.
	it("gives its Completed fold a collapse key of its own", () => {
		expect(TAB_MARKUP).toContain('collapse="gm-expeditions-completed"');
		expect(read("templates/actor/partials/gm-toolkit-tab-encounters.hbs"))
			.toContain('collapse="gm-encounters-completed"');
	});
});

/* ══ one card, two tabs ═══════════════════════════════════════════════════════ */

describe("the Expeditions tab: sharing the encounter card", () => {
	// The whole reason there is no second stylesheet block: the two cards print the same hooks, so
	// one set of rules dresses both. A class renamed on one side alone would leave this card
	// unstyled, and nothing would log.
	it("wears the encounter card's class names, so one stylesheet dresses both", () => {
		for (const cls of [
			"stonetop-gm-encounter-head", "stonetop-gm-encounter-body", "stonetop-gm-encounter-grip",
			"stonetop-gm-encounter-name", "stonetop-gm-encounter-peek", "stonetop-gm-encounter-count",
			"stonetop-gm-encounter-tally", "stonetop-gm-encounter-toggle", "stonetop-gm-encounter-tools",
			"stonetop-gm-encounter-remove", "stonetop-gm-encounter-notes-block", "stonetop-gm-encounter-notes",
			"stonetop-gm-encounter-notes-edit", "stonetop-gm-entry-card", "stonetop-gm-entry-card-head",
			"stonetop-gm-encounter-entries", "stonetop-gm-encounter-entry", "stonetop-gm-encounter-entry-open",
			"stonetop-gm-encounter-entry-remove", "stonetop-gm-encounter-entry-note",
			"stonetop-gm-encounter-dropzone", "stonetop-gm-encounter-used", "stonetop-gm-encounter-deploy",
		]) {
			expect(CARD_MARKUP).toContain(cls);
			expect(strip(ENC_CARD)).toContain(cls);
		}
		// And the panel wears the list's own wrapper classes, which is what the pencil's
		// `--reading` rule and the list's layout hang off.
		expect(TAB_MARKUP).toContain("stonetop-gm-encounters--reading");
		expect(TAB_MARKUP).toContain("stonetop-gm-encounter-list");
	});

	// Every label on this card is the Expeditions block's. A copy that kept the encounter strings
	// would read "Delete this encounter" on a trip, which is the failure a shared partial would
	// have made impossible and a copied one makes easy.
	it("says expedition, never encounter, in every string it shows", () => {
		const keys = [...CARD_MARKUP.matchAll(/stonetop\.gmToolkit\.(\w+)\./g)].map(m => m[1]);
		expect(keys.length).toBeGreaterThan(10);
		expect([...new Set(keys)]).toEqual(["expeditions"]);
	});

	// The two lists print the same card, and its one two-state button reads off `used` — the very
	// flag the context split the lists by, so the card cannot disagree with the list it is in.
	it("prints one card into both lists, and lets it say which list it is in", () => {
		expect(TAB_MARKUP.match(/\{\{>\s*"stonetop\.gm-expedition-card"\}\}/g)).toHaveLength(2);
		// No hash arguments: Handlebars MERGES a partial's hash into the context, where it would
		// also be a bare lookup against the card's own fields.
		expect(TAB_MARKUP).not.toMatch(/\{\{>\s*"stonetop\.gm-expedition-card"\s+\w/);
		expect(CARD_MARKUP).toMatch(/\{\{#if used\}\}fa-rotate-left\{\{else\}\}fa-check\{\{\/if\}\}/);
		expect(TAB_MARKUP).toMatch(/\{\{#if stonetop\.expeditions\.completed\.length\}\}/);
	});
});

/* ══ two engines, one sheet root ══════════════════════════════════════════════ */

describe("the Expeditions tab: not stepping on the Encounters tab", () => {
	// The two tabs must not share a storage path, a panel, or a drag type. The panel is the scope
	// of every listener; the drag type is what stops a card being dragged from one list into the
	// other, where its id names nothing.
	it("differs from the Encounters tab in every field that keeps them apart", () => {
		for (const key of ["path", "contextKey", "panel", "i18n", "dragType"]) {
			expect(EXPEDITIONS_TAB[key]).not.toBe(ENCOUNTERS_TAB[key]);
		}
		expect(EXPEDITIONS_TAB.panel).toBe(".tab.expeditions");
	});

	// THE FAILURE THIS TAB INTRODUCED. Both engines bind delegated listeners to the SAME sheet
	// root and both tabs print the same class names, so without the panel gate a press of the
	// trash on an encounter card runs the expeditions engine's handler too — which looks up an id
	// its own list has never heard of. Most such lookups answer null and do nothing, which is the
	// worst failure available: silent, and dependent on which tab happens to be on screen.
	it("ignores a click that landed on the other tab's panel", async () => {
		const { host, actor, updates } = makeHost([{ id: "x1", name: "To the Pass", entries: [] }]);
		const root = fakeRoot();
		// A second panel on the same root, with a card wearing the SAME classes and — the sharpest
		// case — the SAME id as the one on this tab.
		const other = fakeEl({ cls: ["tab", "encounters"], parent: root });
		const stranger = makeCardEl(other, { id: "x1", name: "The ford" });
		host._activateGmExpeditionsListeners(root);

		await root.emit("click", stranger.remove);
		expect(updates).toEqual([]);
		expect(listOf(actor)).toHaveLength(1);

		stranger.name.value = "renamed from the other tab";
		await root.emit("change", stranger.name);
		expect(listOf(actor)[0].name).toBe("To the Pass");
	});

	// And the same gate the other way round, since it is the encounters engine that was there
	// first and has the most to lose.
	it("is ignored in turn by the Encounters tab's own listeners", async () => {
		const { host, actor, updates } = makeListHost(
			withGmEncountersTab, "system.encounters", [{ id: "e1", name: "The ford", entries: [] }]);
		const root = sheetRoot({ panelClasses: ["tab", "encounters"] });
		const other = fakeEl({ cls: ["tab", "expeditions"], parent: root });
		const stranger = makeCardEl(other, { id: "e1", name: "To the Pass" });
		host._activateGmEncountersListeners(root);

		await root.emit("click", stranger.remove);
		expect(updates).toEqual([]);
		expect(listOf({ system: { expeditions: [] } })).toEqual([]);
		expect(actor.system.encounters).toHaveLength(1);
	});

	// Its own controls still work, which is the other half of the gate being right rather than
	// merely being off.
	it("still acts on a click that landed on its own panel", async () => {
		const { host, actor } = makeHost([{ id: "x1", name: "To the Pass", entries: [] }]);
		const root = fakeRoot();
		const card = makeCardEl(root.panel, listOf(actor)[0]);
		host._activateGmExpeditionsListeners(root);

		card.name.value = "To the Barrier Pass";
		await root.emit("change", card.name);
		expect(listOf(actor)[0].name).toBe("To the Barrier Pass");
	});

	// The flush searches for whatever holds `:focus`, and both tabs' boxes wear the same class
	// names — so it has to search its OWN panel or it writes the other tab's typing into its list.
	it("flushes only the box being typed in on its own panel", async () => {
		const { host, actor, updates } = makeHost([{ id: "x1", name: "To the Pass", entries: [] }]);
		const root = fakeRoot();
		const other = fakeEl({ cls: ["tab", "encounters"], parent: root });
		const stranger = makeCardEl(other, { id: "x1", name: "The ford" });
		Object.defineProperty(host, "element", { value: [root], configurable: true });

		stranger.name.value = "typed on the encounters tab";
		stranger.name.focused = true;
		await host._flushGmExpeditionEdits();
		expect(updates).toEqual([]);

		const mine = makeCardEl(root.panel, listOf(actor)[0]);
		mine.name.value = "To the Barrier Pass";
		mine.name.focused = true;
		await host._flushGmExpeditionEdits();
		expect(listOf(actor)[0].name).toBe("To the Barrier Pass");
	});
});

/* ══ the join to the walkthrough ══════════════════════════════════════════════ */

describe("the Expeditions tab: running one", () => {
	// Foundry diffs an ArrayField by REPLACEMENT, so every write is the whole list: a normalizer
	// that dropped `tripId` would unbind every OTHER card the moment any one of them was renamed.
	it("keeps the trip a card is bound to through every write", () => {
		expect(normalizeExpedition({ id: "x1", name: "N", tripId: "t7" }).tripId).toBe("t7");
		expect(normalizeExpedition({ id: "x1", name: "N" }).tripId).toBe("");
		expect(normalizeExpedition({ id: "x1", name: "N", tripId: 7 }).tripId).toBe("");
	});

	it("carries the trip pointer in the stored schema", () => {
		const body = FIELDS_JS.slice(FIELDS_JS.indexOf("export const expeditionsField"));
		expect(body).toMatch(/tripId:\s*new fields\.StringField/);
	});

	/** The tab's Run button pressed, with the walkthrough stubbed out. */
	async function press(rows, opened) {
		const { host, actor } = makeHost(rows);
		const spy = vi.spyOn(ExpeditionDialog, "openOnTrip").mockImplementation(opened);
		const root = fakeRoot();
		const card = makeCardEl(root.panel, listOf(actor)[0]);
		host._activateGmExpeditionsListeners(root);
		await root.emit("click", card.run);
		spy.mockRestore();
		return { actor };
	}

	// The first press has no trip to open, so the walkthrough mints one — NAMED AFTER THE CARD, so
	// the log bar, the banner over every step and the label copied onto whatever the trip takes out
	// of the steading's stores all say what the GM called it here.
	it("opens the walkthrough on a new trip named after the card, and remembers it", async () => {
		const seen = [];
		const { actor } = await press(
			[{ id: "x1", name: "To the Barrier Pass", entries: [] }],
			args => { seen.push(args); return Promise.resolve("trip-1"); });

		expect(seen).toEqual([{ tripId: "", title: "To the Barrier Pass" }]);
		expect(listOf(actor)[0].tripId).toBe("trip-1");
	});

	// The second press has to reach the SAME trip, with everything the GM wrote into it still
	// there, rather than starting the night over.
	it("reopens the trip it is already bound to, and writes nothing", async () => {
		const seen = [];
		const { actor } = await press(
			[{ id: "x1", name: "To the Barrier Pass", tripId: "trip-1", entries: [] }],
			args => { seen.push(args); return Promise.resolve("trip-1"); });

		expect(seen).toEqual([{ tripId: "trip-1", title: "To the Barrier Pass" }]);
		expect(listOf(actor)[0].tripId).toBe("trip-1");
		// `setField` no-ops on an unchanged value, so the common press sends nothing at all.
		expect(actor.update).not.toHaveBeenCalled();
	});

	// A GM who deletes a trip out of the walkthrough's own log leaves this card pointing at
	// nothing. The pointer is repaired by being used, which is why nothing watches that log.
	it("takes a fresh trip when the one it named is gone from the log", async () => {
		const { actor } = await press(
			[{ id: "x1", name: "To the Barrier Pass", tripId: "deleted", entries: [] }],
			() => Promise.resolve("trip-2"));
		expect(listOf(actor)[0].tripId).toBe("trip-2");
	});

	// The button is the primary act on the card and says which of the two things it is about to
	// do, because a card bound to a half-written trip that still offered to start one would be
	// lying about it.
	it("turns from starting a trip into reopening one", () => {
		expect(CARD_MARKUP).toMatch(/stonetop-gm-expedition-run/);
		expect(CARD_MARKUP).toMatch(/\{\{#if tripId\}\}[\s\S]*?expeditions\.reopen"[\s\S]*?\{\{else\}\}[\s\S]*?expeditions\.run"/);
		// It shares the foot with the complete toggle, and the body is a flex COLUMN — so the row
		// is what keeps them side by side rather than stacked.
		expect(CARD_MARKUP).toContain("stonetop-gm-card-foot");
		expect(declarations(CSS, ".stonetop-gm-card-foot")).toMatch(/display:\s*flex/);
		// The slate CTA, against the quiet outline beside it.
		expect(declarations(CSS, ".stonetop-gm-expedition-run"))
			.toMatch(/background:\s*var\(--st-btn-primary-bg\)/);
	});

	// The walkthrough's own log stays where it is. What it records is what happened at the table,
	// which is a different thing from what was gathered beforehand — and a second store for it
	// here would be two records of one trip.
	it("leaves the walkthrough's own log in the world setting", () => {
		const DIALOG_JS = read("module/dialogs/ExpeditionDialog.js");
		expect(DIALOG_JS).toContain('const ANSWERS_SETTING = "expeditionAnswers";');
		expect(DIALOG_JS).toContain("static async openOnTrip(");
		// An already-open window is SWITCHED rather than left where it was, and its memoized draft
		// has to be dropped first or it looks for the trip just minted in a copy of the log taken
		// before it existed.
		expect(DIALOG_JS).toMatch(/open\._logDraft = null;[\s\S]{0,400}open\._switchExpedition\(id\)/);
		// And the tab reaches that log ONLY through `openOnTrip`: no settings read of its own, and
		// no second opinion about the shape a trip is stored in.
		const TAB_JS = read("module/actors/gmtoolkit/gm-expeditions-tab.js");
		expect([...TAB_JS.matchAll(/^import .*?from "([^"]+)";$/gm)].map(m => m[1]))
			.toEqual(["./gm-bundle-tab.js", "../../dialogs/ExpeditionDialog.js"]);
	});
});
