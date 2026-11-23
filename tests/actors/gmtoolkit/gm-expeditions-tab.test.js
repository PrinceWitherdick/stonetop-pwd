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

const { withGmExpeditionsTab, normalizeExpedition, markTripsOnTheRoad, tripMarksKey, redrawStaleTripMarks, EXPEDITIONS_TAB } =
	await import("../../../module/actors/gmtoolkit/gm-expeditions-tab.js");
const { ENCOUNTERS_TAB, withGmEncountersTab } =
	await import("../../../module/actors/gmtoolkit/gm-encounters-tab.js");
const { ExpeditionDialog } = await import("../../../module/dialogs/ExpeditionDialog.js");
const BUNDLE_TAB = await import("../../../module/actors/gmtoolkit/gm-bundle-tab.js");

const CSS         = readCss();
const STONETOP_JS = read("stonetop.js");
const SHEET_HBS   = read("templates/actor/gm-toolkit.hbs");
const PREP_HBS    = read("templates/actor/partials/gm-toolkit-tab-prep.hbs");
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
	// A pane of the PREP tab's group, which its switcher shows and hides. `tab expeditions` stays
	// its class because `.tab.expeditions` is the engine's `panel`: the scope of every listener
	// and the drop zone, and what keeps a drop here from being claimed by the Encounters engine.
	it("is a pane of the Prep tab's view group, registered as a partial", () => {
		expect(TAB_HBS).toMatch(/<div class="tab expeditions\b[^"]*"[^>]*data-group="prep"/);
		expect(TAB_HBS).toContain('data-tab="expeditions"');
		expect(TAB_HBS).not.toMatch(/data-group="primary"/);
		expect(TAB_HBS).toMatch(/role="tabpanel"/);
		expect(EXPEDITIONS_TAB.panel).toBe(".tab.expeditions");
		expect(STONETOP_JS).toContain('"stonetop.gm-toolkit-tab-expeditions"');
		expect(STONETOP_JS).toContain('"stonetop.gm-expedition-card"');
		expect(repoFileExists("templates/actor/partials/gm-toolkit-tab-expeditions.hbs")).toBe(true);
		expect(repoFileExists("templates/actor/partials/gm-expedition-card.hbs")).toBe(true);
	});

	// The Prep tab's switcher order is the source order of its pane partials and the order of
	// PREP_VIEWS; the rail carries Prep, and no button of this tab's own. Each mismatch is
	// invisible on its own, because the panes are shown one at a time.
	it("sits directly after Encounters inside the Prep tab, with no rail button of its own", () => {
		const order = ["homefront", "moves", "threats", "prep", "wonder", "loop"];
		expect([...SHEET_HBS.matchAll(/tab-rail-item"\s+tab="(\w+)"/g)].map(m => m[1])).toEqual([...order, "preferences"]);
		expect([...SHEET_HBS.matchAll(/\{\{>\s*"stonetop\.gm-toolkit-tab-(\w+)"\}\}/g)].map(m => m[1])).toEqual(order);
		expect([...strip(PREP_HBS).matchAll(/\{\{>\s*"stonetop\.gm-toolkit-tab-(\w+)"\}\}/g)].map(m => m[1]))
			.toEqual(["encounters", "expeditions", "sites"]);
	});

	// A data-tab with no row in the icon table gets a mask with no image, which resolves to FULL
	// coverage: a solid block where the glyph belongs, and nothing logged. The signpost moved from
	// the rail's table to the switcher's with the tab, and the rail row went with it.
	it("earns its signpost glyph on the switcher segment, and the file it names exists", () => {
		expect(CSS).toMatch(/\.stonetop-gm-prep-view\[data-tab="expeditions"\]\s*\{\s*--st-prep-icon:\s*url\('[^']*direction-signs\.svg'\)/);
		expect(CSS).not.toMatch(/\.stonetop-tab-rail \.item\[data-tab="expeditions"\]/);
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

	// SITES ARE A VIEW OF THEIR OWN NOW, the third segment of the switcher, having sat at the foot
	// of this pane under a full card list — the one place a GM had to scroll past every trip to
	// reach. The storage did NOT move with them — a site is still a JournalEntryPage on the
	// steading (gm-prep-tabs.js says at length what happens when that is forgotten) — and every
	// listener they need is scoped to `.steading-sites`, not to a panel, which is why the move
	// cost that mixin nothing.
	it("no longer carries the Sites section; Sites is the Prep tab's third view", () => {
		expect(TAB_MARKUP).not.toMatch(/gm-toolkit-(sites-section|tab-sites)/);
		expect(TAB_MARKUP).not.toContain("steading-sites");
		expect(strip(PREP_HBS).indexOf('"stonetop.gm-toolkit-tab-sites"'))
			.toBeGreaterThan(strip(PREP_HBS).indexOf('"stonetop.gm-toolkit-tab-expeditions"'));
		expect(read("module/actors/gmtoolkit/gm-prep-tabs.js")).toContain('scope: ".steading-sites"');
	});

	// The pencil is `position: absolute` against its section, and this panel only BECOMES that
	// section's containing block by joining the shared `:is()`. Left out, the pencil floats against
	// whatever positioned ancestor is next up the frame, with nothing logged.
	it("is the positioning context its corner pencil floats in", () => {
		expect(CSS).toMatch(/\.stonetop-gm-prep-panes > :is\([^)]*\.tab\.expeditions\)\s*\{\s*position: relative/);
		expect(TAB_HBS).toMatch(/class="tab expeditions steading-edit-section[{"]/);
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

	// A row's thumbnail is an <img> inside the draggable name button, so it carries the
	// `draggable="false"` opt-out every portrait in the system wears, or Gecko hands over the
	// picture instead of the document.
	it("puts the drag opt-out on every picture it draws", () => {
		const imgs = PANEL_MARKUP.match(/<img\b[^>]*>/g) ?? [];
		expect(imgs.length, "the row thumbnail went missing").toBeGreaterThan(0);
		for (const img of imgs) {
			expect(img).toContain('draggable="false"');
			expect(img).toContain('alt=""');
		}
	});

	// ON THE ROAD: a card bound to a trip says so on its shut row, before the pills, off the same
	// `tripId` that turns Run into "Open the walkthrough" -- and not once the card is filed.
	it("says a bound, live card is on the road", () => {
		expect(PANEL_MARKUP).toMatch(/\{\{#if this\.onTheRoad\}\}\{\{#unless used\}\}\s*<span class="stonetop-gm-expedition-road"/);
		const head = PANEL_MARKUP.slice(PANEL_MARKUP.indexOf("stonetop-gm-encounter-head"), PANEL_MARKUP.indexOf("stonetop-gm-encounter-body"));
		expect(head.indexOf("stonetop-gm-expedition-road")).toBeGreaterThan(-1);
		expect(head.indexOf("stonetop-gm-expedition-road")).toBeLessThan(head.indexOf("stonetop-gm-encounter-count"));
		const en = JSON.parse(read("languages/en.json")).stonetop.gmToolkit.expeditions;
		expect(en.onTheRoad).toBe("On the road");
		expect(en.onTheRoadTip).toBeTruthy();
		// The road's teal, as a mark: washed under the words, worn by the glyph.
		expect(declarations(CSS, ".stonetop-gm-expedition-road")).toMatch(/var\(--st-timeline-kind-expedition\)/);
	});

	// Quiet "Mark complete" first, then the primary Run at the right-hand end of the foot.
	it("ends the foot on Run, after the quiet toggle", () => {
		const foot = PANEL_MARKUP.slice(PANEL_MARKUP.indexOf('<div class="stonetop-gm-card-foot">'));
		expect(foot.indexOf("stonetop-gm-encounter-used")).toBeGreaterThan(-1);
		expect(foot.indexOf("stonetop-gm-encounter-used")).toBeLessThan(foot.indexOf("stonetop-gm-expedition-run"));
		expect(JSON.parse(read("languages/en.json")).stonetop.gmToolkit.expeditions.run).toBe("Run the expedition");
	});

	// The views' accent: the road's teal on this pane, the quiet slate on Encounters.
	it("edges its cards in the road's teal", () => {
		expect(declarations(CSS, ".stonetop-gm-prep-panes > .tab.expeditions"))
			.toMatch(/--st-bundle-accent:\s*var\(--st-timeline-kind-expedition\)/);
		expect(declarations(CSS, ".stonetop-gm-prep-panes > .tab.encounters"))
			.toMatch(/--st-bundle-accent:\s*var\(--st-quiet-ink\)/);
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
	// nothing. The pointer is repaired by being used, which is why nothing watches that log for
	// deletions.
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
		expect(CARD_MARKUP).toMatch(/\{\{#if this\.tripLogged\}\}[\s\S]*?expeditions\.reopen"[\s\S]*?\{\{else\}\}[\s\S]*?expeditions\.run"/);
		expect(CARD_MARKUP).not.toMatch(/\{\{#if tripId\}\}/);
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
	// A STALE `tripId` is normal (the GM deleted the trip from the walkthrough's log), and Run then
	// mints a fresh trip at step 0. So "Open" and "On the road" follow the LOG, not the field; and
	// "On the road" further needs the trip set out and not yet home (trip-progress.js `tripUnderWay`).
	// Setting out and coming home are pressed in the walkthrough, which redraws only itself. So
	// every write of its log asks each drawn Toolkit whether its cards' words are now wrong.
	it("relabels its card when the trip sets out, and stays still for a typed note", () => {
		const { GmBundleTab } = BUNDLE_TAB;
		const sheet = (key, rendered = true) => {
			const app = new (withGmExpeditionsTab(class {}))();
			Object.assign(app, { rendered, _tripMarksKey: key, render: vi.fn() });
			expect(app._expeditions).toBeInstanceOf(GmBundleTab);
			return app;
		};
		const spy = vi.spyOn(ExpeditionDialog, "loggedTrips")
			.mockReturnValue({ ids: new Set(["t1"]), underWay: new Set(["t1"]) });
		try {
			const now = tripMarksKey({ ids: new Set(["t1"]), underWay: new Set(["t1"]) });
			const before = tripMarksKey({ ids: new Set(["t1"]), underWay: new Set() });
			const stale = sheet(before), current = sheet(now), closed = sheet(before, false), undrawn = sheet(undefined);
			redrawStaleTripMarks([stale, current, closed, undrawn, { rendered: true, render: vi.fn() }]);
			expect(stale.render).toHaveBeenCalledWith(false);
			expect(current.render).not.toHaveBeenCalled();
			expect(closed.render).not.toHaveBeenCalled();
			expect(undrawn.render).not.toHaveBeenCalled();
		} finally {
			spy.mockRestore();
		}
		// Wired to the setting's change, after the walkthrough has folded the write in.
		expect(read("module/hooks/Ready.js"))
			.toMatch(/ExpeditionDialog\.onLogChanged\(value, userId\);\s*redrawStaleTripMarks\(\);/);
		// Order of ids does not matter to the key.
		expect(tripMarksKey({ ids: new Set(["b", "a"]), underWay: new Set() }))
			.toBe(tripMarksKey({ ids: new Set(["a", "b"]), underWay: new Set() }));
	});

	it("says Open while the log holds a card's trip, and On the road only while that trip is under way", () => {
		const published = {
			active:    [{ id: "a", tripId: "t1" }, { id: "b", tripId: "t2" }, { id: "c", tripId: "gone" }, { id: "e", tripId: "" }],
			completed: [{ id: "d", tripId: "t1" }],
		};
		markTripsOnTheRoad(published, { ids: new Set(["t1", "t2"]), underWay: new Set(["t1"]) });
		expect(published.active.map(c => c.tripLogged)).toEqual([true, true, false, false]);
		expect(published.active.map(c => c.onTheRoad)).toEqual([true, false, false, false]);
		expect(published.completed[0].onTheRoad).toBe(true);
		// A log that cannot be read (no game yet) is an empty one: every card says Run.
		const unread = { active: [{ id: "a", tripId: "t1" }], completed: [] };
		markTripsOnTheRoad(unread);
		expect(unread.active[0].tripLogged).toBe(false);
		expect(unread.active[0].onTheRoad).toBe(false);
	});

	it("leaves the walkthrough's own log in the world setting", () => {
		const DIALOG_JS = read("module/dialogs/ExpeditionDialog.js");
		expect(read("module/utils/expedition-log-core.js")).toContain('export const EXPEDITION_LOG_SETTING = "expeditionAnswers";');
		expect(DIALOG_JS).toContain("setWorldSetting(EXPEDITION_LOG_SETTING, log)");
		expect(DIALOG_JS).toContain("static async openOnTrip(");
		// An already-open window is SWITCHED rather than left where it was, through ITS OWN copy of
		// the log (audit WLK-2): dropping that copy for a re-read of the setting lost whatever the
		// GM had just typed, whose write was still on its way when Run was pressed.
		expect(DIALOG_JS).toMatch(/open\._switchExpedition\(tripId\)/);
		expect(DIALOG_JS).not.toMatch(/open\._logDraft = null/);
		// And the tab reaches that log ONLY through the dialog (`openOnTrip`, `loggedTrips`): no
		// settings read of its own, and no second opinion about the shape a trip is stored in.
		const TAB_JS = read("module/actors/gmtoolkit/gm-expeditions-tab.js");
		expect([...TAB_JS.matchAll(/^import .*?from "([^"]+)";$/gm)].map(m => m[1]))
			.toEqual(["./gm-bundle-tab.js", "../../dialogs/ExpeditionDialog.js", "../../utils/open-windows.js"]);
	});
});
