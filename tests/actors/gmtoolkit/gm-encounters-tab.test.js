import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { stubConfirm } from "../../fakes/confirm.js";
import { readRepo as read, readCss, repoFileExists, declarations } from "../../fakes/css.js";
import {
	withGmEncountersTab,
	resolveEncounterEntry,
	normalizeEncounter,
	normalizeEntry,
	moveWithin,
	insertionIndexIn,
	ENCOUNTER_DOC_TYPES,
	ENCOUNTER_TALLY_KINDS,
	groupEncounterEntries,
	nudgeWithinGroup,
	STONETOP_ENCOUNTER_DRAG_TYPE,
	deployAndFight,
} from "../../../module/actors/gmtoolkit/gm-encounters-tab.js";
import { isPlaceholderArt, bundleEntryImage } from "../../../module/actors/gmtoolkit/gm-bundle-tab.js";
import { fakeEl, makeListHost, fakeRoot as sheetRoot } from "../../fakes/dom.js";

// The GM Toolkit's Encounters tab: named bundles of whatever a GM gathered for a session or a
// scene, each collected row a POINTER to a document rather than a copy of one.
//
// Two halves, guarding two different kinds of failure, exactly as the "I wonder..." tab beside it.
//
// The WIRING half asserts on source text, because every leg of adding a tab fails silently: an
// unregistered partial renders nothing, a missing include leaves the rail button pointing at a
// panel that does not exist, a `data-tab` with no icon row paints a solid block, and a panel left
// out of the pencil's `:is()` floats its pencil against some ancestor further up the frame.
//
// The BEHAVIOUR half exercises the mixin over a fake actor, because the ways this tab loses work
// are all quiet ones: a write that reads a stale list, a reorder that lands one place off, a
// compendium page whose uuid THROWS on the sync resolve and takes the render with it, and a deploy
// that mints a second copy of a monster the world already has.

const CSS         = readCss();
const STONETOP_JS = read("stonetop.js");
const SHEET_HBS   = read("templates/actor/gm-toolkit.hbs");
const PREP_HBS    = read("templates/actor/partials/gm-toolkit-tab-prep.hbs");
const TAB_HBS     = read("templates/actor/partials/gm-toolkit-tab-encounters.hbs");
const CARD_HBS    = read("templates/actor/partials/gm-encounter-card.hbs");
const SHEET_JS    = read("module/actors/gmtoolkit/StonetopGmToolkitSheet.js");
const MODEL_JS    = read("module/data-models/GmToolkitModel.js");
/**
 * Both halves of the tab's JS as one string, for the same reason `PANEL_MARKUP` below joins both
 * halves of its markup: the machinery was lifted out into gm-bundle-tab.js when the Expeditions
 * tab wanted the same card, and an assertion pinned to gm-encounters-tab.js alone would now pass
 * against a file holding nothing but a config object.
 */
const TAB_JS      = `${read("module/actors/gmtoolkit/gm-encounters-tab.js")}\n${read("module/actors/gmtoolkit/gm-bundle-tab.js")}`;
const FIELDS_JS   = read("module/data-models/fields.js");

/** Markup with the Handlebars comments stripped, so prose cannot answer for the template. */
const strip = hbs => hbs.replace(/\{\{!--[\s\S]*?--\}\}/g, "");
const TAB_MARKUP  = strip(TAB_HBS);
const CARD_MARKUP = strip(CARD_HBS);
/**
 * Both halves of the tab as one string, for the rules that are about what a GM ends up looking at
 * rather than about which file emits it. The card was lifted out of the tab when the Completed
 * fold arrived and both lists had to print the same one, so an assertion pinned to TAB_MARKUP
 * alone would now pass by rendering nothing at all.
 */
const PANEL_MARKUP = `${TAB_MARKUP}\n${CARD_MARKUP}`;

/**
 * The mixin over a stand-in actor whose `update` writes through. The harness itself is shared
 * with the "I wonder..." tab — see tests/fakes/dom.js for what it models and why it lives there.
 */
const makeHost = (encounters = [], opts) =>
	makeListHost(withGmEncountersTab, "system.encounters", encounters, opts);

/** The rendered root, carrying the `.tab.encounters` panel this tab's drop zone wires onto. */
const fakeRoot = () => sheetRoot({ panelClasses: ["tab", "encounters"] });

/** The stored list as it stands, which is what every mutation assertion reads. */
const listOf = actor => actor.system.encounters;


/** One rendered encounter: the head controls, plus a row per collected entry. */
function makeEncounterEl(root, enc) {
	const li = fakeEl({ cls: ["stonetop-gm-encounter"], parent: root.panel, dataset: { encounterId: enc.id } });
	const el = {
		li,
		grip:   fakeEl({ cls: ["stonetop-gm-encounter-grip"], dataset: { draggable: "true" }, parent: li }),
		toggle: fakeEl({ cls: ["stonetop-gm-encounter-toggle"], parent: li }),
		name:   fakeEl({ cls: ["stonetop-gm-encounter-name"], value: enc.name ?? "", parent: li }),
		deploy: fakeEl({ cls: ["stonetop-gm-encounter-deploy"], parent: li }),
		used:   fakeEl({ cls: ["stonetop-gm-encounter-used"], parent: li }),
		remove: fakeEl({ cls: ["stonetop-gm-encounter-remove"], parent: li }),
		notes:  fakeEl({ cls: ["stonetop-gm-encounter-notes-edit"], parent: li }),
		rows:   {},
	};
	for (const entry of enc.entries ?? []) {
		const row = fakeEl({ cls: ["stonetop-gm-encounter-entry"], parent: li, dataset: { entryId: entry.id } });
		el.rows[entry.id] = {
			row,
			open:   fakeEl({ cls: ["stonetop-gm-encounter-entry-open"], parent: row, dataset: { uuid: entry.uuid, docType: entry.type, draggable: "true" } }),
			remove: fakeEl({ cls: ["stonetop-gm-encounter-entry-remove"], parent: row }),
			note:   fakeEl({ cls: ["stonetop-gm-encounter-entry-note"], value: entry.note ?? "", parent: row }),
		};
	}
	return el;
}

/** The add bar at the foot of the tab. */
function makeAddBar(root) {
	return fakeEl({ cls: ["stonetop-prep-add-btn", "stonetop-gm-encounter-add-btn"], parent: root.panel });
}

/** A dataTransfer stand-in that records what a dragstart put on the wire. */
function fakeDataTransfer() {
	const dt = {
		effectAllowed: "", dropEffect: "", types: ["text/plain"], stored: {},
		setData: (fmt, val) => { dt.stored[fmt] = val; },
		getData: fmt => dt.stored[fmt] ?? "",
	};
	return dt;
}

/** What a dragstart emitted, parsed. */
const payloadOf = dt => JSON.parse(dt.stored["text/plain"] ?? "null");

let warned;
let infoed;

beforeEach(() => {
	warned = [];
	infoed = [];
	global.ui = { notifications: { warn: m => warned.push(m), info: m => infoed.push(m), error: m => warned.push(m) } };
	global.game = { ...(global.game ?? {}), user: { isGM: true, can: () => true } };
	globalThis.fromUuid = vi.fn(async () => null);
	globalThis.fromUuidSync = vi.fn(() => null);
	// What `getDragEventData` reaches for. Core's own returns {} for a payload that is not JSON,
	// which is the branch the "leave a plain text drag alone" test rides.
	globalThis.TextEditor = {
		getDragEventData(ev) {
			try { return JSON.parse(ev.dataTransfer.getData("text/plain")); } catch { return {}; }
		},
	};
});

afterEach(() => {
	delete globalThis.canvas;
	delete globalThis.Actor;
	// A fight one test set up must not be "already going on" in the next.
	if (global.game) delete global.game.combats;
});

/* ══ wiring ═══════════════════════════════════════════════════════════════════ */

describe("the Encounters tab: wiring", () => {
	// Each of these is a silent failure on its own, exactly as for the tabs beside it.
	// A VIEW of the Prep tab now, not a rail tab: mounted by the Prep panel rather than by the
	// sheet, and reached by the switcher's segment rather than by a rail button of its own. A rail
	// button left behind would point at a panel the rail's group no longer has.
	it("is registered, mounted in the Prep tab, and has a switcher segment rather than a rail button", () => {
		expect(STONETOP_JS).toContain('"stonetop.gm-toolkit-tab-encounters"');
		expect(strip(PREP_HBS)).toContain('{{> "stonetop.gm-toolkit-tab-encounters"}}');
		expect(SHEET_HBS).not.toContain('{{> "stonetop.gm-toolkit-tab-encounters"}}');
		expect(SHEET_HBS).not.toMatch(/\{\{>\s*"stonetop\.tab-rail-item"\s+tab="encounters"/);
		expect(read("module/actors/gmtoolkit/gm-prep-views.js")).toMatch(/key: "encounters"/);
	});

	// The Prep tab's own group, which is what its switcher's controller shows and hides. On the
	// rail's group it would be one more rail panel the rail has no button for — and the rail's
	// controller would hide it whenever the Prep tab itself was showing.
	it("binds to the Prep tab's view group, not the rail's", () => {
		expect(TAB_HBS).toMatch(/<div class="tab encounters\b[^"]*"[^>]*data-group="prep"/);
		expect(TAB_HBS).toContain('data-tab="encounters"');
		expect(TAB_HBS).not.toMatch(/data-group="primary"/);
		expect(TAB_HBS).toMatch(/role="tabpanel"/);
	});

	// The rail's order is the source order of these partial calls, and the body's is a second
	// list that has to agree: a mismatch is invisible, because the panels are shown one at a time.
	// Encounters sits inside Prep, which sits straight after Threats — the other half of "what is
	// waiting out there" — and Encounters is the first of its views.
	it("sits inside the Prep tab, between Threats and Wonder, as the first view", () => {
		// The PANEL order. The rail carries one more entry after these six — the shared
		// Preferences tab, whose panel comes from "stonetop.tab-preferences" rather than from a
		// gm-toolkit-tab partial, so it is absent from the body list this regex builds.
		const order = ["homefront", "moves", "threats", "prep", "wonder", "loop"];
		expect([...SHEET_HBS.matchAll(/tab-rail-item"\s+tab="(\w+)"/g)].map(m => m[1])).toEqual([...order, "preferences"]);
		expect([...SHEET_HBS.matchAll(/\{\{>\s*"stonetop\.gm-toolkit-tab-(\w+)"\}\}/g)].map(m => m[1])).toEqual(order);
		expect([...strip(PREP_HBS).matchAll(/\{\{>\s*"stonetop\.gm-toolkit-tab-(\w+)"\}\}/g)].map(m => m[1]))
			.toEqual(["encounters", "expeditions", "sites"]);
	});

	// A data-tab with no row in the icon table gets a mask with no image, which resolves to FULL
	// coverage: a solid block where the glyph belongs, and nothing logged. The stack is worn twice
	// now — by the Prep rail button and by this view's switcher segment — and the rail's table no
	// longer carries a row for a key no rail renders.
	it("earns its stack glyph on the switcher segment and the Prep rail button, and the file exists", () => {
		expect(CSS).toMatch(/\.stonetop-gm-prep-view\[data-tab="encounters"\]\s*\{\s*--st-prep-icon:\s*url\('[^']*prep-stack\.svg'\)/);
		expect(CSS).toMatch(/\.stonetop-tab-rail \.item\[data-tab="prep"\]\s*\{\s*--st-tab-icon:\s*url\('[^']*prep-stack\.svg'\)/);
		expect(CSS).not.toMatch(/\.stonetop-tab-rail \.item\[data-tab="encounters"\]/);
		expect(repoFileExists("assets/icons/tabs/prep-stack.svg")).toBe(true);
	});

	// Worn as a MASK, so alpha may exist only where the ink is.
	it("ships a maskable glyph, credited like the rest of the rail", () => {
		const svg = read("assets/icons/tabs/prep-stack.svg");
		expect(svg).toContain('viewBox="0 0 512 512"');
		expect(svg).toContain('fill-opacity="0"');
		// `--` is illegal inside an XML comment and makes the whole file unparseable, which draws
		// nothing at all: this file carries a long one, so the rule is worth pinning.
		expect(svg.match(/<!--[\s\S]*?-->/)?.[0]).not.toMatch(/[^!]--[^>]/);
		expect(read("assets/icons/tabs/ATTRIBUTION.md")).toContain("prep-stack.svg");
	});

	it("has a localized name", () => {
		expect(game.i18n.localize("stonetop.gmToolkit.tabs.encounters")).toBe("Encounters");
	});

	// The gutter comes from the Prep panel it sits in, which takes the frame's shared tab padding;
	// the pane itself is flush, or its cards would sit twice as far in as the Threats tab's.
	it("gets its panel gutter from the Prep tab around it, and adds none of its own", () => {
		expect(declarations(CSS, ".stonetop-gm-toolkit-sheet .sheet-body > .tab")).toMatch(/padding: 0 12px 12px/);
		expect(declarations(CSS, ".stonetop-gm-toolkit-sheet .stonetop-gm-prep-panes > .tab")).toMatch(/padding: 0;/);
		expect(declarations(CSS, ".stonetop-gm-toolkit-sheet .stonetop-gm-prep-panes > .tab")).toMatch(/display: none/);
		expect(declarations(CSS, ".stonetop-gm-toolkit-sheet .stonetop-gm-prep-panes > .tab.active")).toMatch(/display: block/);
	});

	// The pencil is `position: absolute` against its section, and this panel only BECOMES that
	// section's containing block by joining the shared `:is()`. Left out, the pencil floats
	// against whatever positioned ancestor is next up the frame, with nothing logged.
	it("is the positioning context its corner pencil floats in", () => {
		expect(CSS).toMatch(/\.stonetop-gm-prep-panes > :is\(\.tab\.encounters, \.tab\.expeditions\)\s*\{\s*position: relative/);
		expect(TAB_HBS).toMatch(/class="tab encounters steading-edit-section[{"]/);
	});

	// Every field here is written by hand to `system.encounters`. A `name` on any of them would
	// put it in core's form submit data, where the array indices expand into an OBJECT keyed "0",
	// "1", ... and replace the list with it — no error, and the list is gone.
	it("gives no form field a name, so the sheet's submit cannot rewrite the list", () => {
		expect(PANEL_MARKUP).not.toMatch(/<(?:input|textarea|prose-mirror)[^>]*\sname=/);
	});

	// The sheet declares no drop targets of its own on purpose (ActorSheet's default entry would
	// make the whole window a silent Item drop target), so this tab wires raw listeners instead.
	it("leaves the sheet's dragDrop empty, so core still attaches nothing of its own", () => {
		expect(SHEET_JS).toMatch(/dragDrop:\s*\[\]/);
	});

	// In Chromium a `draggable` ancestor takes the mousedown from every input inside it, so a
	// draggable row would leave its own note box impossible to put a caret in.
	it("puts the drag handle on the name control, not on the row that holds the note box", () => {
		expect(CARD_MARKUP).toMatch(/<button[^>]*stonetop-gm-encounter-entry-open[^>]*draggable=/);
		expect(CARD_MARKUP).not.toMatch(/<li[^>]*stonetop-gm-encounter-entry[^>]*draggable=/);
	});

	// `_wireSectionCollapse` binds a CAPTURE-phase click on this class and folds by walking
	// heading siblings, so a per-row caret wearing it would be swallowed and fold the wrong run.
	it("keeps its per-row expander off the shared section-collapse class", () => {
		expect(CARD_MARKUP).not.toContain("stonetop-section-collapse");
		expect(CARD_MARKUP).toContain("stonetop-gm-encounter-toggle");
		// AT THE RIGHT-HAND END OF THE BREAKDOWN. It is the badges a GM reads a shut column by, and
		// the caret asks the same question they answer: three monsters and a map, now show me them.
		const head = CARD_MARKUP.slice(
			CARD_MARKUP.indexOf("stonetop-gm-encounter-head"),
			CARD_MARKUP.indexOf("stonetop-gm-encounter-body"));
		expect(head.indexOf("stonetop-gm-encounter-toggle"))
			.toBeGreaterThan(head.indexOf("stonetop-gm-encounter-count"));
		// Still ahead of the trash, which stays at the very end of the row.
		expect(head.indexOf("stonetop-gm-encounter-toggle"))
			.toBeLessThan(head.indexOf("stonetop-gm-encounter-tools"));
		// OUTSIDE the badge row's conditional: an encounter with nothing gathered still has a body
		// to open, and a caret drawn only on encounters that hold something would strand it shut.
		expect(head.indexOf("stonetop-gm-encounter-toggle"))
			.toBeGreaterThan(head.lastIndexOf("{{/if}}", head.indexOf("stonetop-gm-encounter-toggle")));
		expect(head.slice(head.indexOf("{{#if groups.length}}"), head.indexOf("stonetop-gm-encounter-toggle")))
			.toContain("{{/if}}");
	});

	// Core paints a shadow on every button and the shared icon-button rule clears it only on hover,
	// so the bare caret clears it at rest itself (lost once, when the caret's rule was rewritten).
	it("draws the caret as a bare glyph, with core's button shadow off at rest", () => {
		expect(declarations(CSS, ".stonetop-gm-encounter-toggle")).toMatch(/box-shadow:\s*none/);
	});

	// A row's thumbnail is an <img> INSIDE the draggable name button, so it carries the
	// `draggable="false"` opt-out every portrait in the system wears: without it Gecko hands over
	// the picture instead of the document. Every <img> the panel draws, not just the first.
	it("puts the drag opt-out on every picture it draws", () => {
		const imgs = PANEL_MARKUP.match(/<img\b[^>]*>/g) ?? [];
		expect(imgs.length, "the row thumbnail went missing").toBeGreaterThan(0);
		for (const img of imgs) {
			expect(img).toContain('draggable="false"');
			// Decoration beside the name it illustrates, so it says nothing to a screen reader.
			expect(img).toContain('alt=""');
		}
	});

	it("is composed into the sheet, and flushed before every paint and every close", () => {
		expect(SHEET_JS).toMatch(/withGmEncountersTab\(withGmWonderTab\(/);
		// Inside the `Promise.all` gather in `_getData` rather than awaited on a line of its own:
		// this builder and the two beside it can each be waiting on a pack load, so the sheet
		// runs them together. The trailing comma is what says it is still IN the gather.
		expect(SHEET_JS).toContain("this._addGmEncountersContext(context),");
		expect(SHEET_JS).toContain("this._activateGmEncountersListeners(html[0]);");
		// Once in `_render` and once in `close`: Escape shuts an AppV1 window straight from the
		// focused field, so its `change` never fires.
		expect(SHEET_JS.match(/await this\._flushGmEncounterEdits\(\);/g)).toHaveLength(2);
	});
});

/* ══ storage ══════════════════════════════════════════════════════════════════ */

describe("the Encounters list: storage", () => {
	// Additive, with an `initial`, so a toolkit made before this field loads with an empty list
	// and no migration runs. The alternative fails on OPEN, for every existing world.
	it("is an additive array field on the toolkit's own data model", () => {
		expect(FIELDS_JS).toMatch(/export const encountersField = \(\) => new fields\.ArrayField/);
		expect(MODEL_JS).toContain("encounters: encountersField()");
		const field = FIELDS_JS.slice(FIELDS_JS.indexOf("export const encountersField"));
		expect(field.slice(0, field.indexOf("simpleMoveSchema"))).toContain("{ required: false, initial: [] }");
	});

	// The sheet writes these on blur WITHOUT re-rendering, so a field the model silently trimmed
	// would leave the box holding one string and the document holding another.
	it("does not trim the prose it stores", () => {
		// From the factory both bundle lists are built out of, not from `encountersField`
		// itself: that is now one line long, and a slice taken at it would read as empty and
		// pass against nothing.
		const field = FIELDS_JS.slice(FIELDS_JS.indexOf("const bundleSchema"));
		const body = field.slice(0, field.indexOf("simpleMoveSchema"));
		expect(body.match(/trim: false/g)?.length).toBe(3);
	});

	// The uuid, plus the two things that stay useful once it resolves to nothing. An `img` would
	// be a cached field with no reader: the only row that needs one is the broken row, and that
	// shows its type icon instead.
	it("stores the type and the name of an entry, and no img", () => {
		// From the factory both bundle lists are built out of, not from `encountersField`
		// itself: that is now one line long, and a slice taken at it would read as empty and
		// pass against nothing.
		const field = FIELDS_JS.slice(FIELDS_JS.indexOf("const bundleSchema"));
		const body = field.slice(0, field.indexOf("simpleMoveSchema"));
		expect(body).toMatch(/uuid:\s*new fields\.StringField/);
		expect(body).toMatch(/type:\s*new fields\.StringField/);
		expect(body).not.toMatch(/\bimg:/);
	});

	it("reads an absent or malformed list as empty rather than throwing", () => {
		expect(makeHost(undefined).host._encounterList()).toEqual([]);
		const { host } = makeHost([]);
		host.actor.system.encounters = "not a list";
		expect(host._encounterList()).toEqual([]);
	});

	it("normalizes a partial encounter, and a partial entry inside it", () => {
		const enc = normalizeEncounter({ id: "e1", entries: [{ id: "x1" }] });
		expect(enc).toMatchObject({ id: "e1", name: "", notes: "", used: false });
		expect(enc.entries[0]).toMatchObject({ id: "x1", uuid: "", type: "", name: "", note: "" });
	});

	it("mints an id for a new encounter and for a new entry", () => {
		expect(normalizeEncounter({ name: "x" }).id).toBeTruthy();
		expect(normalizeEntry({ uuid: "Actor.a" }, { keepId: false }).id).toBeTruthy();
		expect(normalizeEncounter({ id: "keep" }).id).toBe("keep");
	});
});

/* ══ adding and dropping ══════════════════════════════════════════════════════ */

describe("the Encounters tab: adding and dropping", () => {
	it("appends an encounter with an id of its own, open, with the caret claimed for its name", async () => {
		const { host, actor } = makeHost([]);
		const id = await host._addEncounter("The bridge at dusk");
		expect(listOf(actor)).toHaveLength(1);
		expect(listOf(actor)[0]).toMatchObject({ id, name: "The bridge at dusk", entries: [] });
		expect(host._encounterOpen.has(id)).toBe(true);
		expect(host._encounterFocus).toEqual({ id, select: true });
	});

	it("makes a new encounter named after a document dropped on empty tab space", async () => {
		const { host, actor } = makeHost([]);
		globalThis.fromUuid = vi.fn(async () => ({ name: "Rust-Hound", documentName: "Actor" }));
		await host._onEncounterDrop({ type: "Actor", uuid: "Compendium.p.bestiary.Actor.rh" }, null);
		expect(listOf(actor)).toHaveLength(1);
		expect(listOf(actor)[0].name).toBe("Rust-Hound");
		expect(listOf(actor)[0].entries[0]).toMatchObject({ uuid: "Compendium.p.bestiary.Actor.rh", type: "Actor", name: "Rust-Hound" });
	});

	// ONE write, not add-then-add: two would leave a nameless empty encounter on screen if the
	// second failed, and would re-render the tab twice for one gesture.
	it("makes that encounter in a single write", async () => {
		const { host, updates } = makeHost([]);
		globalThis.fromUuid = vi.fn(async () => ({ name: "Rust-Hound" }));
		await host._onEncounterDrop({ type: "Actor", uuid: "Actor.rh" }, null);
		expect(updates).toHaveLength(1);
	});

	it("adds a dropped document to the encounter it landed on", async () => {
		const { host, actor } = makeHost([{ id: "e1", name: "Crypt", entries: [] }]);
		globalThis.fromUuid = vi.fn(async () => ({ name: "The Weeping Idol" }));
		const target = { closest: sel => (sel === "[data-encounter-id]" ? { dataset: { encounterId: "e1" } } : null) };
		await host._onEncounterDrop({ type: "Item", uuid: "Compendium.p.arcana.Item.idol" }, target);
		expect(listOf(actor)[0].entries).toHaveLength(1);
		expect(listOf(actor)[0].entries[0].name).toBe("The Weeping Idol");
	});

	// The bestiary, the arcana and the journals ARE packs, so a list that could not point into one
	// would be a list of almost nothing. This is the deliberate opposite of RosterDialog's drop.
	it("keeps a compendium uuid whole, unlike the roster's actor drop", async () => {
		const { host, actor } = makeHost([]);
		globalThis.fromUuid = vi.fn(async () => ({ name: "Rust-Hound", pack: "p.bestiary" }));
		await host._onEncounterDrop({ type: "Actor", uuid: "Compendium.p.bestiary.Actor.rh" }, null);
		expect(listOf(actor)[0].entries[0].uuid).toBe("Compendium.p.bestiary.Actor.rh");
	});

	// A fight with two of the same monster is a fight with two of the same monster.
	it("lets the same document be gathered twice", async () => {
		const { host, actor } = makeHost([{ id: "e1", name: "Crypt", entries: [] }]);
		globalThis.fromUuid = vi.fn(async () => ({ name: "Rust-Hound" }));
		const target = { closest: sel => (sel === "[data-encounter-id]" ? { dataset: { encounterId: "e1" } } : null) };
		await host._onEncounterDrop({ type: "Actor", uuid: "Actor.rh" }, target);
		await host._onEncounterDrop({ type: "Actor", uuid: "Actor.rh" }, target);
		expect(listOf(actor)[0].entries).toHaveLength(2);
		expect(listOf(actor)[0].entries[0].id).not.toBe(listOf(actor)[0].entries[1].id);
	});

	it("refuses a document type it does not collect", async () => {
		const { host, updates } = makeHost([]);
		await host._onEncounterDrop({ type: "Combat", uuid: "Combat.c1" }, null);
		expect(updates).toEqual([]);
	});

	// Reachable, not defensive: utils/treasure-drops.js emits `{type: "Item", data: {…}}` with the
	// item's data embedded and no uuid at all.
	it("refuses a payload with no uuid, and says so", async () => {
		const { host, updates } = makeHost([]);
		await host._onEncounterDrop({ type: "Item", data: { name: "A gold ring" } }, null);
		expect(updates).toEqual([]);
		expect(warned).toHaveLength(1);
	});

	it("names an entry from the payload when the document cannot be loaded", async () => {
		const { host, actor } = makeHost([]);
		globalThis.fromUuid = vi.fn(async () => null);
		await host._onEncounterDrop({ type: "Scene", uuid: "Scene.s1", name: "Crypt Level 1" }, null);
		expect(listOf(actor)[0].entries[0].name).toBe("Crypt Level 1");
	});

	it("falls back to a placeholder name when the payload carries none either", async () => {
		const { host, actor } = makeHost([]);
		await host._onEncounterDrop({ type: "Macro", uuid: "Macro.m1" }, null);
		expect(listOf(actor)[0].entries[0].name).toBe("Unnamed");
	});

	// On Gecko an uncancelled drop pastes its payload as raw JSON into whatever input is under the
	// pointer, and this tab is a field of note boxes whose change handlers would then SAVE it. The
	// cancel has to happen BEFORE anything is awaited, which is why it happens before the payload
	// is even classified.
	it("prevents the default before it looks at the payload", async () => {
		const { host } = makeHost([]);
		const root = fakeRoot();
		host._activateGmEncountersListeners(root);
		const dt = fakeDataTransfer();
		dt.setData("text/plain", JSON.stringify({ type: "Actor", uuid: "Actor.a" }));
		const ev = await root.panel.dropEvent(dt);
		expect(ev.defaultPrevented).toBe(true);
	});

	// The one case the zone must NOT claim: a text selection dragged into one of its own note
	// boxes, which has no `type` and belongs to the browser.
	it("leaves a plain text drag uncancelled, so it can land in a note box", async () => {
		const { host } = makeHost([]);
		const root = fakeRoot();
		host._activateGmEncountersListeners(root);
		const dt = fakeDataTransfer();
		dt.setData("text/plain", "some prose the GM dragged in");
		const ev = await root.panel.dropEvent(dt);
		expect(ev.defaultPrevented).toBe(false);
	});
});

/* ══ reorder and move ═════════════════════════════════════════════════════════ */

describe("the Encounters tab: reorder and move", () => {
	const three = () => [
		{ id: "a", name: "A", entries: [] },
		{ id: "b", name: "B", entries: [] },
		{ id: "c", name: "C", entries: [] },
	];
	const ids = actor => listOf(actor).map(e => e.id);

	it("moves an encounter to sit before the one it was dropped on", async () => {
		const { host, actor } = makeHost(three());
		await host._reorderEncounter("c", "b");
		expect(ids(actor)).toEqual(["a", "c", "b"]);
	});

	// The only place a drop naming no neighbour CAN mean something: there is no "before nothing".
	it("parks an encounter last when the drop named no neighbour", async () => {
		const { host, actor } = makeHost(three());
		await host._reorderEncounter("a", null);
		expect(ids(actor)).toEqual(["b", "c", "a"]);
	});

	it("writes nothing when an encounter is dropped on itself", async () => {
		const { host, updates } = makeHost(three());
		await host._reorderEncounter("b", "b");
		expect(updates).toEqual([]);
	});

	const withEntries = () => [
		{ id: "e1", name: "One", entries: [
			{ id: "x1", uuid: "Actor.1", type: "Actor", name: "One", note: "" },
			{ id: "x2", uuid: "Actor.2", type: "Actor", name: "Two", note: "" },
			{ id: "x3", uuid: "Actor.3", type: "Actor", name: "Three", note: "" },
		] },
		{ id: "e2", name: "Two", entries: [] },
	];
	const entryIds = (actor, i) => listOf(actor)[i].entries.map(e => e.id);

	it("moves an entry within its encounter, inserting before the row it hit", async () => {
		const { host, actor } = makeHost(withEntries());
		await host._moveEntry("e1", "x3", "e1", "x1");
		expect(entryIds(actor, 0)).toEqual(["x3", "x1", "x2"]);
	});

	// THE off-by-one. Computing the destination against an array that still holds the dragged row
	// puts a downward move one place short: "before x3" is index 2 with the row still in and index
	// 1 once it is out, and only one of those is where the GM aimed.
	it("lands a downward move where it was aimed", async () => {
		const { host, actor } = makeHost(withEntries());
		await host._moveEntry("e1", "x1", "e1", "x3");
		expect(entryIds(actor, 0)).toEqual(["x2", "x1", "x3"]);
	});

	it("moves an entry into another encounter and takes it out of the first", async () => {
		const { host, actor } = makeHost(withEntries());
		await host._moveEntry("e1", "x2", "e2", null);
		expect(entryIds(actor, 0)).toEqual(["x1", "x3"]);
		expect(entryIds(actor, 1)).toEqual(["x2"]);
	});

	it("writes nothing when a row is dropped on itself", async () => {
		const { host, updates } = makeHost(withEntries());
		await host._moveEntry("e1", "x2", "e1", "x2");
		expect(updates).toEqual([]);
	});

	// THE BODY IS GROUPED, so an index in the stored array is no longer a place on screen. alt+Down
	// on a monster whose next STORED row is a map would swap two rows in two different cards and
	// move nothing a GM can see, which reads exactly like a key that did nothing.
	describe("reordering a row inside the card it is drawn in", () => {
		const rows = ids => ids.map(id => ({ id }));

		it("moves it past the next row of its OWN kind, however far away that is in storage", () => {
			// Stored a, MAP, b: in the Monsters card a sits directly above b.
			const list = rows(["a", "m", "b"]);
			expect(nudgeWithinGroup(list, ["a", "b"], "a", 1).map(r => r.id)).toEqual(["m", "b", "a"]);
			expect(nudgeWithinGroup(list, ["a", "b"], "b", -1).map(r => r.id)).toEqual(["b", "a", "m"]);
		});

		// Its own card, not the whole list: a row at the bottom of the Monsters card has nowhere
		// to go even though there are ten rows below it in other cards.
		it("clamps at the ends of its own card rather than writing", () => {
			const list = rows(["a", "m", "b"]);
			expect(nudgeWithinGroup(list, ["a", "b"], "a", -1)).toBeNull();
			expect(nudgeWithinGroup(list, ["a", "b"], "b", 1)).toBeNull();
		});

		it("falls back to the whole list when it is handed no card", async () => {
			const { host, actor } = makeHost(withEntries());
			await host._nudgeEntry("e1", "x1", 1, null);
			expect(listOf(actor).find(e => e.id === "e1").entries.map(e => e.id)).toEqual(["x2", "x1", "x3"]);
		});

		it("refuses a row the card does not hold, rather than guessing", () => {
			expect(nudgeWithinGroup(rows(["a", "b"]), ["a", "b"], "nope", 1)).toBeNull();
			expect(nudgeWithinGroup(rows(["a", "b"]), ["c"], "c", 1)).toBeNull();
		});
	});

	// The keyboard half of the reorder, so a list can still be arranged without a mouse.
	it("nudges an encounter and an entry with alt and the arrow keys", async () => {
		const { host, actor } = makeHost(withEntries());
		await host._nudgeEncounter("e2", -1);
		expect(ids(actor)).toEqual(["e2", "e1"]);
		await host._nudgeEntry("e1", "x1", 1);
		expect(listOf(actor).find(e => e.id === "e1").entries.map(e => e.id)).toEqual(["x2", "x1", "x3"]);
	});

	// A monster let go over a row in the Maps card has no place there to land: honouring that row
	// would move it in storage and draw it somewhere else entirely, which is a gesture that
	// appears to have done nothing at all.
	it("aims a dragged row only among its own kind", async () => {
		const { host, actor } = makeHost([{ id: "e1", name: "One", entries: [
			{ id: "x1", uuid: "Actor.a", type: "Actor", name: "A", note: "" },
			{ id: "x2", uuid: "Scene.s", type: "Scene", name: "S", note: "" },
			{ id: "x3", uuid: "Actor.b", type: "Actor", name: "B", note: "" },
		] }]);
		const over = (entryId, kind) => ({
			closest: sel => sel === "[data-encounter-id]" ? { dataset: { encounterId: "e1" } }
				: sel === "[data-entry-id]" ? { dataset: { entryId } }
				: sel === "[data-entry-kind]" ? { dataset: { entryKind: kind } } : null,
		});
		const drag = { type: "Actor", uuid: "Actor.b", stonetopEncounterId: "e1", stonetopEntryId: "x3", stonetopKind: "actor" };

		// Over the Maps card: it goes to the end of its own instead, which is where the
		// encounter's dropzone would have put it.
		await host._onEncounterDrop(drag, over("x2", "scene"));
		expect(listOf(actor)[0].entries.map(e => e.id)).toEqual(["x1", "x2", "x3"]);

		// Over a row in its OWN card, it lands there.
		await host._onEncounterDrop(drag, over("x1", "actor"));
		expect(listOf(actor)[0].entries.map(e => e.id)).toEqual(["x3", "x1", "x2"]);
	});

	// A drag from a build that does not send the key, or one let go over no card at all, must
	// behave exactly as it always did rather than being quietly refused.
	it("treats a payload with no kind, and a drop over no card, as it always did", async () => {
		const { host, actor } = makeHost([{ id: "e1", name: "One", entries: [
			{ id: "x1", uuid: "Actor.a", type: "Actor", name: "A", note: "" },
			{ id: "x2", uuid: "Actor.b", type: "Actor", name: "B", note: "" },
		] }]);
		const over = { closest: sel => sel === "[data-encounter-id]" ? { dataset: { encounterId: "e1" } }
			: sel === "[data-entry-id]" ? { dataset: { entryId: "x1" } } : null };
		await host._onEncounterDrop(
			{ type: "Actor", uuid: "Actor.b", stonetopEncounterId: "e1", stonetopEntryId: "x2" }, over);
		expect(listOf(actor)[0].entries.map(e => e.id)).toEqual(["x2", "x1"]);
	});

	it("clamps a nudge at either end rather than writing", async () => {
		const { host, updates } = makeHost(three());
		await host._nudgeEncounter("a", -1);
		await host._nudgeEncounter("c", 1);
		expect(updates).toEqual([]);
	});

	it("routes alt+Arrow off the focused control", async () => {
		const { host, actor } = makeHost(withEntries());
		const root = fakeRoot();
		host._activateGmEncountersListeners(root);
		const el = makeEncounterEl(root, listOf(actor)[0]);
		await root.emit("keydown", el.rows.x1.open, { key: "ArrowDown", altKey: true });
		expect(entryIds(actor, 0)).toEqual(["x2", "x1", "x3"]);
		await root.emit("keydown", el.name, { key: "ArrowDown", altKey: true });
		expect(ids(actor)).toEqual(["e2", "e1"]);
	});

	// Pure index arithmetic, so both the drag and the keyboard ride the same primitive.
	it("has index primitives that clamp and refuse a no-op", () => {
		expect(moveWithin([1, 2, 3], 0, 2)).toEqual([2, 3, 1]);
		expect(moveWithin([1, 2, 3], 0, 99)).toEqual([2, 3, 1]);
		expect(moveWithin([1, 2, 3], 1, 1)).toBeNull();
		expect(moveWithin([1, 2, 3], -1, 0)).toBeNull();
		expect(insertionIndexIn([{ id: "a" }, { id: "b" }], "b", 9)).toBe(1);
		expect(insertionIndexIn([{ id: "a" }], "gone", 9)).toBe(9);
		expect(insertionIndexIn([{ id: "a" }], null, 9)).toBe(9);
	});
});

/* ══ resolving ════════════════════════════════════════════════════════════════ */

describe("the Encounters tab: writes nobody asked for", () => {
	const two = () => [{ id: "e1", name: "Crypt", entries: [
		{ id: "x1", uuid: "Actor.a", type: "Actor", name: "A", note: "" },
		{ id: "x2", uuid: "Actor.b", type: "Actor", name: "B", note: "" },
		{ id: "x3", uuid: "Actor.c", type: "Actor", name: "C", note: "" },
	] }];

	// Dropping a row on the one immediately BELOW it puts it back where it started, and so does
	// dropping the last row on its own encounter's dropzone. Both used to write the whole array
	// and re-render the toolkit on every GM's client, for an order nobody changed. `moveWithin`
	// and `_reorderEncounter` have both always refused this; `_moveEntry` was the one that did not.
	it("writes nothing for a drop that puts a row back where it was", async () => {
		const { host, updates } = makeHost(two());
		await host._moveEntry("e1", "x1", "e1", "x2");
		expect(updates).toEqual([]);
		await host._moveEntry("e1", "x3", "e1", null);
		expect(updates).toEqual([]);
	});

	it("still writes for a drop that does move the row", async () => {
		const { host, actor, updates } = makeHost(two());
		await host._moveEntry("e1", "x1", "e1", "x3");
		expect(updates).toHaveLength(1);
		expect(listOf(actor)[0].entries.map(e => e.id)).toEqual(["x2", "x1", "x3"]);
	});

	// Moving a row to the same index of ANOTHER encounter is a real change, so the guard has to
	// be about the encounter the row started in and not about position alone.
	it("writes for a move into another encounter at the same index", async () => {
		const { host, actor, updates } = makeHost([
			{ id: "e1", name: "One", entries: [{ id: "x1", uuid: "Actor.a", type: "Actor", name: "A", note: "" }] },
			{ id: "e2", name: "Two", entries: [] },
		]);
		await host._moveEntry("e1", "x1", "e2", null);
		expect(updates).toHaveLength(1);
		expect(listOf(actor)[1].entries.map(e => e.id)).toEqual(["x1"]);
	});
});

describe("the Encounters tab: the caret over a keyboard reorder", () => {
	const two = () => [
		{ id: "e1", name: "One", entries: [
			{ id: "x1", uuid: "Actor.a", type: "Actor", name: "A", note: "" },
			{ id: "x2", uuid: "Actor.b", type: "Actor", name: "B", note: "" },
		] },
		{ id: "e2", name: "Two", entries: [] },
	];

	// alt+Arrow renders, so every name box is re-emitted and the input the GM is holding is
	// replaced. Without handing the caret on, focus falls to <body>: the second alt+ArrowDown
	// reaches the document instead of the row, and moving an encounter three places costs three
	// manual re-focuses.
	it("hands the caret back to the encounter that was nudged", async () => {
		const { host, actor } = makeHost(two());
		await host._nudgeEncounter("e1", 1);
		const root = fakeRoot();
		const moved = makeEncounterEl(root, listOf(actor).find(e => e.id === "e1"));
		makeEncounterEl(root, listOf(actor).find(e => e.id === "e2"));
		host._restoreGmEncounterFocus(root);
		expect(moved.name.focused).toBe(true);
		// A reorder is not a rename: the name is not handed over selected.
		expect(moved.name.selected).toBe(false);
	});

	it("hands it back to the collected row that was nudged, not to its encounter", async () => {
		const { host, actor } = makeHost(two());
		await host._nudgeEntry("e1", "x1", 1);
		const root = fakeRoot();
		const el = makeEncounterEl(root, listOf(actor)[0]);
		host._restoreGmEncounterFocus(root);
		expect(el.rows.x1.open.focused).toBe(true);
		expect(el.name.focused).toBe(false);
	});

	// Writes are queued, so a render belonging to an EARLIER write can land between the stash and
	// the write that creates the row: "mark used" and then "+ Add" is enough. A stash blanked by
	// that first paint left the new box with neither the caret nor the selection, and the GM
	// typed over whatever had focus before.
	it("survives a paint that lands before the row it names exists", async () => {
		const { host, actor } = makeHost([{ id: "e1", name: "One", entries: [] }]);
		host._encounterFocus = { id: "not-here-yet", select: true };
		// The paint from an earlier write: the row it is waiting for is not in this one.
		const early = fakeRoot();
		makeEncounterEl(early, listOf(actor)[0]);
		host._restoreGmEncounterFocus(early);
		expect(host._encounterFocus).toEqual({ id: "not-here-yet", select: true });

		// And the paint that does carry it claims the caret after all.
		const later = fakeRoot();
		const el = makeEncounterEl(later, { id: "not-here-yet", name: "New encounter", entries: [] });
		host._restoreGmEncounterFocus(later);
		expect(el.name.focused).toBe(true);
		expect(el.name.selected).toBe(true);
		expect(host._encounterFocus).toBeNull();
	});
});

/* ══ thumbnails ═══════════════════════════════════════════════════════════════ */

// A row wears its document's own picture beside its name, and a stock placeholder is NOT a
// picture: a column of identical mystery-men looks like information and is not, so every stand-in
// this world can hand over falls back to the kind-glyph medallion.
describe("the Encounters tab: a row's thumbnail", () => {
	afterEach(() => {
		delete globalThis.CONFIG?.RollTable;
	});

	it("treats core's whole generic glyph set, and no picture at all, as no art", () => {
		for (const src of ["icons/svg/mystery-man.svg", "/icons/svg/item-bag.svg", "icons/svg/d20-grey.svg",
			"icons/svg/dice-target.svg", "", "   ", null, undefined, 42]) {
			expect(isPlaceholderArt(src), String(src)).toBe(true);
		}
	});

	it("treats this system's stand-ins as no art: the people silhouette and a creature-type mark", () => {
		expect(isPlaceholderArt("systems/stonetop-pwd/assets/icons/people/default_profile.svg")).toBe(true);
		expect(isPlaceholderArt("systems/stonetop-pwd/assets/icons/bestiary/corrupted.svg")).toBe(true);
	});

	it("follows the document class's own default icon, read when it is asked", () => {
		globalThis.CONFIG = { ...(globalThis.CONFIG ?? {}), RollTable: { documentClass: { DEFAULT_ICON: "modules/x/table.webp" } } };
		expect(isPlaceholderArt("modules/x/table.webp", "RollTable")).toBe(true);
		expect(isPlaceholderArt("modules/x/table.webp", "Actor")).toBe(false);
	});

	it("keeps a picture somebody chose", () => {
		for (const src of ["worlds/w/art/hagr.webp", "systems/stonetop-pwd/assets/arcana/torc.webp", "https://x.test/a.png"]) {
			expect(isPlaceholderArt(src), src).toBe(false);
		}
	});

	it("reads a Scene's small thumb and never its full background", () => {
		expect(bundleEntryImage({ thumb: "worlds/w/thumbs/ford.webp", img: "worlds/w/maps/ford-4k.webp" }, "Scene"))
			.toBe("worlds/w/thumbs/ford.webp");
		expect(bundleEntryImage({ background: { src: "worlds/w/maps/ford-4k.webp" } }, "Scene")).toBe("");
		expect(bundleEntryImage({ img: "worlds/w/art/hagr.webp" }, "Actor")).toBe("worlds/w/art/hagr.webp");
		expect(bundleEntryImage({ img: "icons/svg/mystery-man.svg" }, "Actor")).toBe("");
		expect(bundleEntryImage({ name: "A page" }, "JournalEntryPage")).toBe("");
		expect(bundleEntryImage(null, "Actor")).toBe("");
	});

	// Off the SYNC path, so a pack index entry (which carries `img`, and `thumb` for a scene) is
	// enough: no pack load per row per render for a picture either.
	it("publishes the picture on the resolved row, from an index entry as from a document", async () => {
		globalThis.fromUuidSync = vi.fn(uuid => ({
			"Compendium.p.bestiary.Actor.a": { name: "Hagr", img: "systems/stonetop-pwd/art/hagr.webp", pack: "p.bestiary" },
			"Scene.s":                       { name: "Ford", thumb: "worlds/w/thumbs/ford.webp" },
			"Actor.m":                       { name: "Nobody", img: "icons/svg/mystery-man.svg" },
		}[uuid] ?? null));
		const rows = await Promise.all([
			{ id: "1", uuid: "Compendium.p.bestiary.Actor.a", type: "Actor", name: "Hagr" },
			{ id: "2", uuid: "Scene.s", type: "Scene", name: "Ford" },
			{ id: "3", uuid: "Actor.m", type: "Actor", name: "Nobody" },
			{ id: "4", uuid: "Actor.gone", type: "Actor", name: "Gone" },
		].map(resolveEncounterEntry));
		expect(rows.map(r => r.img)).toEqual(["systems/stonetop-pwd/art/hagr.webp", "worlds/w/thumbs/ford.webp", "", ""]);
		expect(rows[3].unresolved).toBe(true);
		expect(globalThis.fromUuid).not.toHaveBeenCalledWith("Scene.s");
	});

	// The template's three branches: a broken link for a row whose target is gone, the picture
	// when there is one, else the kind's glyph in a medallion. The picture rides INSIDE the name
	// button, so it is part of what is grabbed and clicked.
	it("draws the picture, the medallion or the broken link inside the name button", () => {
		const btn = CARD_MARKUP.slice(CARD_MARKUP.indexOf('class="stonetop-gm-encounter-entry-open"'));
		const inner = btn.slice(0, btn.indexOf("</button>"));
		expect(inner).toMatch(/\{\{#if unresolved\}\}<span class="stonetop-gm-entry-thumb stonetop-gm-entry-thumb--glyph"[^>]*><i class="fas fa-link-slash" aria-hidden="true"><\/i><\/span>\{\{else if img\}\}<img class="stonetop-gm-entry-thumb" src="\{\{this\.img\}\}"/);
		expect(inner).toMatch(/\{\{else\}\}<span class="stonetop-gm-entry-thumb stonetop-gm-entry-thumb--glyph"[^>]*><i class="\{\{this\.icon\}\}" aria-hidden="true"><\/i><\/span>\{\{\/if\}\}/);
		const thumb = declarations(CSS, ".stonetop-gm-entry-thumb");
		expect(thumb).toMatch(/object-fit:\s*cover/);
		expect(thumb).toMatch(/width:\s*var\(--st-entry-thumb, 28px\)/);
		// Grows with the reader's sheet font, so a picture never sits smaller than its name.
		expect(declarations(CSS, ".stonetop-gm-encounter-entries")).toMatch(/--st-entry-thumb:\s*calc\(28px \* var\(--stonetop-font-scale, 1\)\)/);
		expect(declarations(CSS, ".stonetop-gm-entry-thumb--glyph")).toMatch(/border-radius:\s*50%/);
	});

	// The row stores no picture: a cached path would go stale the moment the art changed.
	it("stores no picture on the row itself", () => {
		expect(Object.keys(normalizeEntry({ uuid: "Actor.a", type: "Actor", name: "A", img: "x.webp" }))).not.toContain("img");
	});
});

/* ══ the pane: its bar, its empty state, the card's head and a drag over it ═══════════════ */

describe("the Encounters tab: the pane around the cards", () => {
	const PANE_BAR = strip(read("templates/actor/partials/gm-prep-pane-bar.hbs"));
	const EMPTY    = strip(read("templates/actor/partials/gm-prep-empty.hbs"));

	// One muted line, a "?" that opens the full intro under it, and "New encounter" at the right:
	// the add button moved up from the foot of the list, still wearing the handler's hook.
	it("opens on a one-line bar, the old intro behind its \"?\"", () => {
		expect(TAB_MARKUP).not.toContain("steading-threats-intro");
		expect(TAB_MARKUP).toMatch(/\{\{> "stonetop\.gm-prep-pane-bar" kind="stonetop-gm-encounter"[^}]*lead=\(localize "stonetop\.gmToolkit\.encounters\.lead"\)[^}]*intro=\(localize "stonetop\.gmToolkit\.encounters\.intro"\)/);
		expect(TAB_MARKUP).not.toContain("stonetop.gm-prep-add-bar");
		expect(TAB_MARKUP).toContain("pane=stonetop.prep.panes.encounters");
		// The lead is words and nothing else now: no tooltip a keyboard could never open, no help
		// cursor promising one.
		expect(PANE_BAR).toMatch(/<p class="stonetop-gm-pane-lead">\{\{this\.lead\}\}<\/p>/);
		const lead = declarations(CSS, ".stonetop-gm-pane-lead");
		expect(lead).toMatch(/white-space:\s*nowrap/);
		expect(lead).toMatch(/text-overflow:\s*ellipsis/);
		expect(lead).not.toMatch(/cursor:\s*help/);
		const en = JSON.parse(read("languages/en.json")).stonetop.gmToolkit;
		expect(en.encounters.add).toBe("New encounter");
		expect(en.expeditions.add).toBe("New expedition");
		expect(en.sites.add).toBe("New site");
		for (const block of ["encounters", "expeditions", "sites"]) {
			expect(en[block].lead, `${block}.lead`).toBeTruthy();
			expect(en[block].intro.length, `${block}.intro is the long form`).toBeGreaterThan(en[block].lead.length);
		}
	});

	// A compact slate outline, not the full-width dashed strip the Threats tab's bars keep: two
	// classes' weight over the shared base, every core control default stated away.
	it("draws the bar's button compact, over the shared add-bar class, without moving Threats", () => {
		const btn = declarations(CSS, ".stonetop-prep-add-btn.stonetop-gm-pane-add");
		for (const re of [/width:\s*auto/, /height:\s*auto/, /border:\s*1px solid var\(--st-quiet-ink\)/,
			/background:\s*transparent/, /box-shadow:\s*none/, /flex:\s*0 0 auto/]) {
			expect(btn).toMatch(re);
		}
		expect(CSS).toMatch(/\.stonetop-prep-add-btn\s*\{[^}]*border:\s*1px dashed/);
		expect(strip(read("templates/actor/partials/gm-toolkit-tab-threats.hbs"))).not.toContain("stonetop-gm-pane-add");
	});

	// The pencil floats in the pane's corner, which is where the bar's button ends. The button
	// runs to the cards' right edge, and the pencil is anchored just LEFT of it, in a gap the bar
	// keeps there; only a browser without anchor positioning falls back to the reserved notch.
	it("puts the pane's pencil just left of the bar's button, not in a notch at its end", () => {
		const supports = CSS.slice(CSS.indexOf("@supports (anchor-name: --a)"));
		expect(supports).toMatch(/\.tab\.encounters\s+\.stonetop-gm-pane-bar > \.stonetop-gm-pane-add\s*\{\s*anchor-name:\s*--st-gm-encounters-add;/);
		expect(supports).toMatch(/\.tab\.expeditions\s+\.stonetop-gm-pane-bar > \.stonetop-gm-pane-add\s*\{\s*anchor-name:\s*--st-gm-expeditions-add;/);
		// Each pane's pencil reads its OWN pane's anchor, with a fallback for a bare bar.
		expect(supports).toMatch(/\.tab\.encounters > \.steading-section-edit-toggle\s*\{[^}]*right:\s*calc\(anchor\(--st-gm-encounters-add left, -?\d+px\)/);
		expect(supports).toMatch(/\.tab\.expeditions > \.steading-section-edit-toggle\s*\{[^}]*right:\s*calc\(anchor\(--st-gm-expeditions-add left, -?\d+px\)/);
		// The bar reserves nothing at its right while anchors work...
		const anchored = supports.slice(0, supports.indexOf("@supports not (anchor-name: --a)"));
		expect(anchored).not.toMatch(/padding-right/);
		// ...and the old notch is kept only for a browser without them.
		expect(CSS).toMatch(/@supports not \(anchor-name: --a\)\s*\{\s*\.stonetop-gm-prep-panes > :is\(\.tab\.encounters, \.tab\.expeditions\) \.stonetop-gm-pane-bar\s*\{\s*padding-right:\s*2\dpx;/);
	});

	// The full intro is a disclosure every reader can reach: a real button with aria-expanded and
	// aria-controls over a paragraph that is `hidden` until asked for, open where it was left.
	it("opens the full intro from a real button, for the keyboard and a screen reader too", () => {
		expect(PANE_BAR).toMatch(/<button type="button" class="stonetop-gm-pane-help" data-prep-intro="\{\{pane\.key\}\}"/);
		expect(PANE_BAR).toContain('aria-expanded="{{#if pane.introOpen}}true{{else}}false{{/if}}" aria-controls="{{pane.id}}-intro"');
		expect(PANE_BAR).toContain('aria-label="{{localize "stonetop.gmToolkit.prep.aboutView"}}"');
		expect(PANE_BAR).toMatch(/<p class="stonetop-gm-pane-intro" id="\{\{pane\.id\}\}-intro"\{\{#unless pane\.introOpen\}\} hidden\{\{\/unless\}\}>\{\{this\.intro\}\}<\/p>/);
		// No re-hide of its own: the one `[hidden]` rule near the top covers it
		// (tests/styles/hidden-hides.test.js).
		expect(CSS).not.toContain(".stonetop-gm-pane-intro[hidden]");
		expect(CSS).toMatch(/:is\([^)]*\.stonetop-gm-pane-help[^)]*\):focus-visible/);
		const en = JSON.parse(read("languages/en.json")).stonetop.gmToolkit;
		expect(en.prep.aboutView).toBeTruthy();
	});

	// A view that has never held anything: a centred block with the view's glyph, a heading, the
	// sentence, the kinds it takes, and the add button made primary; the bar above it goes `bare`.
	it("gives an untouched view a centred empty state, and drops the bar's own button", () => {
		expect(TAB_MARKUP).toContain("bare=(not (or stonetop.encounters.active.length stonetop.encounters.completed.length))");
		expect(PANE_BAR).toMatch(/\{\{#unless bare\}\}\s*<button/);
		expect(EMPTY).toMatch(/<h3 class="stonetop-gm-prep-empty-title">\{\{this\.title\}\}<\/h3>/);
		expect(EMPTY).toMatch(/<ul class="stonetop-gm-prep-empty-kinds" aria-hidden="true">/);
		expect(EMPTY).toContain("stonetop-gm-pane-add--primary");
		expect(TAB_MARKUP).toContain('title=(localize "stonetop.gmToolkit.encounters.emptyTitle")');
		expect(TAB_MARKUP).toContain("accepts=stonetop.encounters.accepts");
		for (const view of ["encounters", "expeditions", "sites"]) {
			expect(declarations(CSS, `.stonetop-gm-prep-empty--${view}`)).toMatch(/--st-prep-icon:\s*url\(/);
		}
		expect(declarations(CSS, ".stonetop-gm-prep-empty")).toMatch(/text-align:\s*center/);
	});

	// The kinds row is built from the table the drop filter and the pills read, so it cannot name
	// a kind the pane refuses; `unknown` is how a row is counted, not something to drag in.
	it("publishes the kinds a view takes, from the tally table, without unknown", async () => {
		const { host } = makeHost([]);
		const context = { stonetop: {} };
		await host._addGmEncountersContext(context);
		const accepts = context.stonetop.encounters.accepts;
		expect(accepts.map(k => k.key)).toEqual(ENCOUNTER_TALLY_KINDS.map(k => k.key).filter(k => k !== "unknown"));
		for (const kind of accepts) {
			expect(kind.icon).toMatch(/^fas fa-/);
			expect(kind.label).not.toMatch(/^stonetop\./);
		}
	});

	// The rest of a shut card's head is the caret too: a click on the note's first line or the
	// pills opens the card, in place. The name box and the grip keep their own gestures.
	it("opens a card from anywhere on its bare head, but not from the name or the grip", async () => {
		const { host, actor, updates } = makeHost([{ id: "e1", name: "C", entries: [] }]);
		const root = fakeRoot();
		host._activateGmEncountersListeners(root);
		const li = fakeEl({ cls: ["stonetop-gm-encounter", "is-collapsed"], parent: root.panel, dataset: { encounterId: "e1" } });
		const head = fakeEl({ cls: ["stonetop-gm-encounter-head"], parent: li });
		const grip = fakeEl({ cls: ["stonetop-gm-encounter-grip"], parent: head });
		const name = fakeEl({ cls: ["stonetop-gm-encounter-name"], parent: head });
		const peek = fakeEl({ cls: ["stonetop-gm-encounter-peek"], parent: head });
		const toggle = fakeEl({ cls: ["stonetop-gm-encounter-toggle"], parent: head });

		await root.emit("click", name);
		await root.emit("click", grip);
		expect(li.classes).toContain("is-collapsed");

		await root.emit("click", peek);
		expect(li.classes).not.toContain("is-collapsed");
		expect(toggle.attrs["aria-expanded"]).toBe("true");
		expect(host._encounterOpen.has("e1")).toBe(true);
		await root.emit("click", head);
		expect(li.classes).toContain("is-collapsed");
		expect(updates).toEqual([]);
		expect(listOf(actor)).toHaveLength(1);
	});

	// A click also ends a drag-select. Copying a line out of a shut card's peek must not fly the
	// card open under the selection; a click with nothing selected still opens it.
	it("leaves a card shut when the click on its head finished a text selection", async () => {
		const { host } = makeHost([{ id: "e1", name: "C", entries: [] }]);
		const root = fakeRoot();
		host._activateGmEncountersListeners(root);
		const li = fakeEl({ cls: ["stonetop-gm-encounter", "is-collapsed"], parent: root.panel, dataset: { encounterId: "e1" } });
		const head = fakeEl({ cls: ["stonetop-gm-encounter-head"], parent: li });
		const peek = fakeEl({ cls: ["stonetop-gm-encounter-peek"], parent: head });
		fakeEl({ cls: ["stonetop-gm-encounter-toggle"], parent: head });
		const text = { parent: peek };
		const was = globalThis.document;
		globalThis.document = { getSelection: () => ({ isCollapsed: false, anchorNode: text, focusNode: text, toString: () => "the reeds" }) };
		try {
			await root.emit("click", peek);
			expect(li.classes).toContain("is-collapsed");
			// A selection somewhere else on the page is not this head's business.
			const elsewhere = {};
			globalThis.document = { getSelection: () => ({ isCollapsed: false, anchorNode: elsewhere, focusNode: elsewhere, toString: () => "x" }) };
			await root.emit("click", peek);
			expect(li.classes).not.toContain("is-collapsed");
		} finally {
			globalThis.document = was;
		}
	});

	// `:hover` does not follow a drag, so the card under the pointer is marked by hand as the drag
	// moves, and unmarked when it leaves the pane or lands.
	it("lights the one card a drag is over, and clears it on the drop", async () => {
		const { host } = makeHost([{ id: "e1", name: "A", entries: [] }, { id: "e2", name: "B", entries: [] }]);
		const root = fakeRoot({ panelClasses: ["tab", "encounters"] });
		host._activateGmEncountersListeners(root);
		const a = fakeEl({ cls: ["stonetop-gm-encounter"], parent: root.panel, dataset: { encounterId: "e1" } });
		const b = fakeEl({ cls: ["stonetop-gm-encounter"], parent: root.panel, dataset: { encounterId: "e2" } });
		const inB = fakeEl({ cls: ["stonetop-gm-encounter-dropzone"], parent: b });
		const dt = { types: ["text/plain"], effectAllowed: "copy", dropEffect: "", getData: () => "" };

		await root.panel.dragoverEvent(dt, a);
		expect(a.classes).toContain("is-drop-target");
		await root.panel.dragoverEvent(dt, inB);
		expect(a.classes).not.toContain("is-drop-target");
		expect(b.classes).toContain("is-drop-target");
		await root.panel.dropEvent(dt, inB);
		expect(b.classes).not.toContain("is-drop-target");
		// In the system's drop colour, the gold every drop zone's outline is drawn in, not the
		// card's own accent: a lit card must not read as the card's edge, or as another cue.
		expect(declarations(CSS, ".stonetop-gm-encounter.is-drop-target")).toMatch(/border-color:\s*var\(--stonetop-improvement-accent\)/);
	});

	// ONE CUE AT A TIME. Over a card the card lights and the pane does not; over bare pane a
	// document from outside lights the pane (it will start a new card); a card dragged by its grip
	// lights neither, because it only reorders, and neither does one of our own rows over bare
	// pane, which `onDrop` ignores.
	it("lights the pane only when a drop will start a new card", async () => {
		const { host } = makeHost([{ id: "e1", name: "A", entries: [] }]);
		const root = fakeRoot();
		host._activateGmEncountersListeners(root);
		const card = fakeEl({ cls: ["stonetop-gm-encounter"], parent: root.panel, dataset: { encounterId: "e1" } });
		const head = fakeEl({ cls: ["stonetop-gm-encounter-head"], parent: card });
		const grip = fakeEl({ cls: ["stonetop-gm-encounter-grip"], parent: head });
		const bare = fakeEl({ cls: ["stonetop-gm-encounter-list"], parent: root.panel });
		const dt = () => ({ types: ["text/plain"], effectAllowed: "copy", dropEffect: "", getData: () => "", setData() {} });

		// From the sidebar: over bare pane, the pane; over a card, the card and not the pane.
		await root.panel.dragoverEvent(dt(), bare);
		expect(root.panel.classes).toContain("is-drop-new");
		expect(card.classes).not.toContain("is-drop-target");
		await root.panel.dragoverEvent(dt(), head);
		expect(root.panel.classes).not.toContain("is-drop-new");
		expect(card.classes).toContain("is-drop-target");
		await root.panel.dropEvent(dt(), head);
		expect(card.classes).not.toContain("is-drop-target");
		expect(root.panel.classes).not.toContain("is-drop-new");

		// A card by its grip: neither cue, over the card or off it.
		host._encounters.noteDragSource(grip, "card");
		await root.panel.dragoverEvent(dt(), head);
		expect(card.classes).not.toContain("is-drop-target");
		await root.panel.dragoverEvent(dt(), bare);
		expect(root.panel.classes).not.toContain("is-drop-new");
		// The source's own dragend clears it, even with the source already out of the page.
		for (const fn of grip.handlers.dragend ?? []) fn({});
		expect(host._encounters.dragFrom).toBe(null);

		// And when that dragend never comes (Firefox, a source repainted away mid-drag and let go off
		// the pane), the next drag to start anywhere clears it, before the next source sets its own.
		const docListeners = [];
		const realDoc = globalThis.document;
		globalThis.document = { addEventListener: (type, fn, opts) => docListeners.push({ type, fn, opts }) };
		try {
			host._encounters.noteDragSource(fakeEl({ cls: ["stonetop-gm-encounter-grip"] }), "card");
		} finally {
			globalThis.document = realDoc;
		}
		const next = docListeners.find(l => l.type === "dragstart");
		expect(next?.opts).toEqual({ once: true, capture: true });
		next.fn({});
		expect(host._encounters.dragFrom).toBe(null);

		// One of our own rows: lands IN a card, but over bare pane it lands nowhere.
		host._encounters.noteDragSource(grip, "entry");
		await root.panel.dragoverEvent(dt(), head);
		expect(card.classes).toContain("is-drop-target");
		await root.panel.dragoverEvent(dt(), bare);
		expect(card.classes).not.toContain("is-drop-target");
		expect(root.panel.classes).not.toContain("is-drop-new");
		await root.panel.dropEvent(dt(), bare);
		expect(host._encounters.dragFrom).toBe(null);

		// A drag that carries no text (a file) is not one the zone takes, and lights nothing.
		await root.panel.dragoverEvent({ types: ["Files"] }, bare);
		expect(root.panel.classes).not.toContain("is-drop-new");

		// The CSS half: the system's pane outline is suppressed unless the drop starts a new card.
		expect(declarations(CSS, ".stonetop-gm-prep-panes > .tab.stonetop-card-drag-over:not(.is-drop-new)"))
			.toMatch(/outline-color:\s*transparent/);
	});
});

describe("the Encounters tab: resolving what a row points at", () => {
	it("renders a deleted target under its cached name, still in its slot", async () => {
		globalThis.fromUuidSync = vi.fn(() => null);
		globalThis.fromUuid = vi.fn(async () => null);
		const row = await resolveEncounterEntry({ id: "x1", uuid: "Actor.gone", type: "Actor", name: "Rust-Hound", note: "n" });
		expect(row).toMatchObject({ id: "x1", name: "Rust-Hound", unresolved: true, note: "n" });
		expect(row.icon).toBe(ENCOUNTER_DOC_TYPES.Actor.icon);
	});

	// Every control on a row is addressed by an id read off the rendered node, so a list that
	// silently skipped its missing rows would leave those controls acting on the wrong one.
	it("keeps the resolved list index-aligned with the stored list", async () => {
		const { host } = makeHost([{ id: "e1", name: "One", entries: [
			{ id: "x1", uuid: "Actor.gone", type: "Actor", name: "Gone", note: "" },
			{ id: "x2", uuid: "Actor.here", type: "Actor", name: "Here", note: "" },
		] }]);
		globalThis.fromUuidSync = vi.fn(uuid => (uuid === "Actor.here" ? { name: "Here", documentName: "Actor" } : null));
		const context = { stonetop: {} };
		await host._addGmEncountersContext(context);
		expect(context.stonetop.encounters.active[0].entries.map(e => e.id)).toEqual(["x1", "x2"]);
		expect(context.stonetop.encounters.active[0].entries[0].unresolved).toBe(true);
		expect(context.stonetop.encounters.active[0].entries[1].unresolved).toBe(false);
	});

	it("prefers the live document's name over the cached one", async () => {
		globalThis.fromUuidSync = vi.fn(() => ({ name: "Renamed Since" }));
		const row = await resolveEncounterEntry({ id: "x", uuid: "Actor.a", type: "Actor", name: "Old Name", note: "" });
		expect(row.name).toBe("Renamed Since");
		expect(row.unresolved).toBe(false);
	});

	// THE reason `{strict: false}` is on that call. A compendium JournalEntryPage uuid is an
	// EMBEDDED document inside a pack, and core's `fromUuidSync` throws for exactly that — which
	// without the flag would take the whole render with it.
	it("reads a compendium page without letting fromUuidSync throw", async () => {
		globalThis.fromUuidSync = vi.fn(() => { throw new Error("fromUuidSync was invoked on an Embedded Document"); });
		globalThis.fromUuid = vi.fn(async () => ({ name: "The Crypt", pack: "p.journal" }));
		const row = await resolveEncounterEntry({
			id: "x", uuid: "Compendium.p.journal.JournalEntry.j.JournalEntryPage.p", type: "JournalEntryPage", name: "", note: "",
		});
		expect(row.name).toBe("The Crypt");
		expect(row.unresolved).toBe(false);
		expect(row.inPack).toBe(true);
	});

	// This sheet re-renders on every threat, hazard and site write anywhere in the world, so "no
	// pack load per row per render" is the difference between a tab and a stutter.
	it("resolves a world document with no await at all", async () => {
		globalThis.fromUuidSync = vi.fn(() => ({ name: "Rust-Hound" }));
		globalThis.fromUuid = vi.fn(async () => { throw new Error("should not have been reached"); });
		const row = await resolveEncounterEntry({ id: "x", uuid: "Actor.a", type: "Actor", name: "", note: "" });
		expect(row.name).toBe("Rust-Hound");
		expect(globalThis.fromUuid).not.toHaveBeenCalled();
	});

	it("gives every collected type an icon and a label, and an unknown type a fallback", async () => {
		for (const kind of Object.values(ENCOUNTER_DOC_TYPES)) {
			expect(kind.icon).toMatch(/^fa/);
			expect(game.i18n.localize(kind.labelKey)).not.toBe(kind.labelKey);
		}
		const row = await resolveEncounterEntry({ id: "x", uuid: "", type: "Cards", name: "?", note: "" });
		expect(row.icon).toBe("fas fa-circle-question");
		expect(game.i18n.localize("stonetop.gmToolkit.encounters.kind.unknown")).toBe("Unknown");
	});

	it("publishes a count of what is gathered, and of what can be deployed", async () => {
		const { host } = makeHost([{ id: "e1", name: "One", entries: [
			{ id: "x1", uuid: "Actor.a", type: "Actor", name: "A", note: "" },
			{ id: "x2", uuid: "Scene.s", type: "Scene", name: "S", note: "" },
		] }]);
		const context = { stonetop: {} };
		await host._addGmEncountersContext(context);
		expect(context.stonetop.encounters.active[0]).toMatchObject({ entryCount: 2 });
	});
});

/* == what is in it, by kind ==================================================== */

// "12 gathered" said how MUCH was in a bundle and nothing about what KIND, which is the one thing
// a GM reading a column of shut cards wants: three monsters and a map, not twelve of something.

describe("the Encounters tab: the breakdown on a shut card", () => {
	it("counts each kind, and leaves out the kinds it has none of", () => {
		const chips = groupEncounterEntries([
			{ tally: "actor" }, { tally: "actor" }, { tally: "actor" },
			{ tally: "journal" },
			{ tally: "scene" }, { tally: "scene" },
		]);
		expect(chips.map(c => [c.key, c.count])).toEqual([["actor", 3], ["journal", 1], ["scene", 2]]);
	});

	// The glyphs sit in the same places on every card, so a column of them is scanned DOWN rather
	// than read across. That only holds while the order is the table's and not the rows'.
	it("prints the kinds in the declared order however the rows were dropped in", () => {
		const chips = groupEncounterEntries([
			{ tally: "macro" }, { tally: "actor" }, { tally: "arcanum" }, { tally: "item" },
		]);
		expect(chips.map(c => c.key)).toEqual(["actor", "item", "arcanum", "macro"]);
		const declared = ENCOUNTER_TALLY_KINDS.map(k => k.key);
		expect(declared.indexOf("actor")).toBeLessThan(declared.indexOf("item"));
		expect(declared.indexOf("item")).toBeLessThan(declared.indexOf("arcanum"));
		expect(declared.at(-1)).toBe("unknown");
	});

	// A card whose badges say five over a body six rows long reads as a bug, so nothing may fall
	// out of the count -- including a row of a kind this build has no glyph for.
	it("counts a row of no known kind under unknown, so the badges add up to the rows", () => {
		const rows = [{ tally: "actor" }, { tally: "" }, {}, { tally: "actor" }];
		const chips = groupEncounterEntries(rows);
		expect(chips.reduce((n, c) => n + c.count, 0)).toBe(rows.length);
		expect(chips.find(c => c.key === "unknown").count).toBe(2);
	});

	it("gives every kind a glyph and both a singular and a plural name", () => {
		for (const kind of ENCOUNTER_TALLY_KINDS) {
			expect(kind.icon).toMatch(/^fas fa-/);
			for (const n of ["one", "other"]) {
				const key = `stonetop.gmToolkit.encounters.tally.${n}.${kind.key}`;
				expect(game.i18n.localize(key)).not.toBe(key);
			}
		}
	});

	it("says one of a kind in the singular and two in the plural", () => {
		const [one]  = groupEncounterEntries([{ tally: "actor" }]);
		const [many] = groupEncounterEntries([{ tally: "actor" }, { tally: "actor" }]);
		expect(one.tip).toBe("1 monster or NPC");
		expect(many.tip).toBe("2 monsters and NPCs");
	});

	it("draws no badge box at all on an encounter with nothing in it yet", async () => {
		const { host } = makeHost([{ id: "e1", name: "Empty", entries: [] }]);
		const context = { stonetop: {} };
		await host._addGmEncountersContext(context);
		expect(context.stonetop.encounters.active[0].groups).toEqual([]);
		// A bordered "0" says only what the empty body already says, on the very card a GM is
		// about to drop the first thing onto.
		expect(CARD_MARKUP).toMatch(/\{\{#if groups\.length\}\}/);
	});

	// An ARCANUM arrives as `type: "Item"` like a sword does, and on this tab it is the thing a
	// party is about to FIND. Only the resolved document can tell them apart.
	it("counts an arcanum apart from an item, and labels its row the same way", async () => {
		globalThis.fromUuidSync = vi.fn(uuid => (uuid === "Item.arc"
			? { name: "The Bell", type: "move", system: { moveType: "arcanum" } }
			: { name: "A Sword", type: "move", system: { moveType: "gear" } }));
		const { host } = makeHost([{ id: "e1", name: "One", entries: [
			{ id: "x1", uuid: "Item.arc",   type: "Item", name: "", note: "" },
			{ id: "x2", uuid: "Item.sword", type: "Item", name: "", note: "" },
		] }]);
		const context = { stonetop: {} };
		await host._addGmEncountersContext(context);
		const card = context.stonetop.encounters.active[0];
		expect(card.groups.map(c => [c.key, c.count])).toEqual([["item", 1], ["arcanum", 1]]);
		// The head and the body cannot disagree: the row wears the wand and says Arcanum too.
		expect(card.entries[0]).toMatchObject({ tally: "arcanum", typeLabel: "Arcanum", icon: "fas fa-wand-sparkles" });
		expect(card.entries[1]).toMatchObject({ tally: "item", typeLabel: "Item" });
	});

	// A page dragged out of the shipped journal pack and the entry it lives in are the same fact
	// to a GM reading a shut row, and two book glyphs side by side would say nothing extra.
	it("counts a journal entry and a journal page under the one book", async () => {
		globalThis.fromUuidSync = vi.fn(() => ({ name: "Something" }));
		const chips = groupEncounterEntries(await Promise.all([
			{ id: "x1", uuid: "JournalEntry.j",     type: "JournalEntry",     name: "", note: "" },
			{ id: "x2", uuid: "JournalEntry.j.JournalEntryPage.p", type: "JournalEntryPage", name: "", note: "" },
		].map(resolveEncounterEntry)));
		expect(chips).toHaveLength(1);
		expect(chips[0]).toMatchObject({ key: "journal", count: 2 });
		expect(chips[0].entries.map(e => e.type)).toEqual(["JournalEntry", "JournalEntryPage"]);
	});

	// The badge is a number and a picture; without the tooltip the picture has no name, and the
	// glyph itself is hidden from a screen reader precisely because the tooltip carries it.
	it("wires each badge to a tooltip and hides the glyph from the reader", () => {
		expect(CARD_MARKUP).toMatch(/class="stonetop-gm-encounter-tally[^"]*"[\s\S]{0,120}data-tooltip="\{\{this\.tip\}\}"/);
		expect(CARD_MARKUP).toMatch(/<span class="stonetop-chip-text">\{\{this\.count\}\}<\/span><i class="\{\{this\.icon\}\}" aria-hidden="true">/);
	});

	// ONE GROUPING, READ TWICE: the badges on the shut head and the cards in the open body are the
	// same fact at two sizes, so they are one array and cannot disagree about what an arcanum is.
	it("hands the head and the body the one grouping, rows and all", () => {
		const groups = groupEncounterEntries([
			{ id: "a", tally: "actor" }, { id: "s", tally: "scene" }, { id: "b", tally: "actor" },
		]);
		expect(groups.map(g => [g.key, g.count])).toEqual([["actor", 2], ["scene", 1]]);
		// STORED ORDER WITHIN A GROUP, which is what keeps every reorder honest.
		expect(groups[0].entries.map(e => e.id)).toEqual(["a", "b"]);
		expect(groups[0].tip).toBe("2 monsters and NPCs");
		expect(groups[0].label).toBe("monsters and NPCs");
		// The CARD's heading is always the plural: it names a group, and the count is printed at
		// the far end of the same strip, so a singular would argue with the number beside it.
		expect(groupEncounterEntries([{ id: "s", tally: "scene" }])[0]).toMatchObject({
			label: "map", title: "maps", count: 1,
		});
	});

	it("draws one card per kind in the body, and none for a kind it has none of", () => {
		const body = CARD_MARKUP.slice(CARD_MARKUP.indexOf("stonetop-gm-encounter-body"));
		expect(body).toMatch(/\{\{#each groups\}\}[\s\S]*?class="stonetop-gm-entry-card"/);
		// The head says the kind once, which is what the rows below no longer repeat.
		expect(body).toContain("stonetop-gm-entry-card-title");
		expect(body).toMatch(/stonetop-gm-entry-card-title">\{\{this\.title\}\}/);
		expect(body).toContain("stonetop-gm-entry-card-count");
		// The rows of one card are one <ul>, which is exactly what alt+Arrow walks.
		expect(body).toMatch(/stonetop-gm-entry-card[\s\S]*?<ul class="stonetop-gm-encounter-entries">/);
	});

	// A row used to carry its own glyph and its own kind label, and under a card that has just
	// said "Monsters and NPCs" both were the same word twice.
	it("leaves a row its name, its note and its cross, and nothing that repeats the card", () => {
		expect(CARD_MARKUP).not.toContain("stonetop-gm-encounter-entry-icon");
		expect(CARD_MARKUP).not.toContain("stonetop-gm-encounter-entry-kind");
		expect(CARD_MARKUP).not.toContain("{{this.typeLabel}}");
		for (const cls of ["entry-open", "entry-remove", "entry-note"]) {
			expect(CARD_MARKUP).toContain(`stonetop-gm-encounter-${cls}`);
		}
		// And the CSS no longer describes two columns that are not emitted.
		expect(CSS).not.toContain(".stonetop-gm-encounter-entry-icon");
		expect(CSS).not.toContain(".stonetop-gm-encounter-entry-kind");
		// ONE LINE when the card is wide: [picture + name] [note] [cross]. The columns are declared
		// ONCE, on the card's body, and the group's <section>, its <ul> and each row are subgrids of
		// them, so every note IN THE CARD starts on one x -- not one x per group, which zig-zagged
		// down an open card from Monsters to Arcana to Journals.
		expect(declarations(CSS, ".stonetop-gm-encounter-body"))
			.toMatch(/grid-template-columns:\s*fit-content\(40%\) minmax\(0, 1fr\) auto/);
		for (const sel of [".stonetop-gm-entry-card", ".stonetop-gm-encounter-entries", ".stonetop-gm-encounter-entry"]) {
			expect(declarations(CSS, sel), sel).toMatch(/grid-template-columns:\s*subgrid/);
		}
		// Nothing below the body declares columns of its own (outside the no-subgrid fallback).
		expect(declarations(CSS, ".stonetop-gm-encounter-entries")).not.toMatch(/fit-content/);
		// Everything else in the body spans the three columns.
		expect(declarations(CSS, ".stonetop-gm-encounter-body > *")).toMatch(/grid-column:\s*1 \/ -1/);
		// NARROW (by the card's width, not the window's): the note wraps under the name.
		expect(declarations(CSS, ".stonetop-gm-encounter-body")).toMatch(/container-type:\s*inline-size/);
		expect(CSS).toMatch(/@container \(max-width: 520px\)\s*\{[\s\S]*?\.stonetop-gm-encounter-entry-note\s*\{[^}]*grid-row:\s*2/);
	});

	// The note READS AS TEXT: no box, no ring, no fill, italic and muted; a dotted line on row
	// hover, a solid slate one with upright ink on focus, and a placeholder only then.
	it("draws the row's note as text, not as a field", () => {
		const note = declarations(CSS, ".stonetop-gm-encounter-entry-note");
		expect(note).toMatch(/border:\s*0/);
		expect(note).toMatch(/background:\s*transparent/);
		// Core paints an inset ring on every input whatever its border says.
		expect(note).toMatch(/box-shadow:\s*none/);
		expect(note).toMatch(/font-style:\s*italic/);
		// The focus rule's slot, held at rest so the caret arriving moves nothing. Never dotted, and
		// never lit by a hover: the system draws no underline as a hover cue (STYLEGUIDE.md, States).
		expect(note).toMatch(/border-bottom:\s*1px solid transparent/);
		expect(declarations(CSS, ".stonetop-gm-encounter-entry-note::placeholder")).toMatch(/color:\s*transparent/);
		expect(declarations(CSS, ".stonetop-gm-encounter-entry:hover .stonetop-gm-encounter-entry-note") ?? "")
			.not.toMatch(/border/);
		const focus = declarations(CSS, ".stonetop-gm-encounter-entry-note:focus");
		expect(focus).toMatch(/border-bottom:\s*1px solid var\(--st-quiet-ink\)/);
		expect(focus).toMatch(/font-style:\s*normal/);
		// The short placeholder, in both blocks the card reads.
		const en = JSON.parse(read("languages/en.json")).stonetop.gmToolkit;
		expect(en.encounters.entryNotePlaceholder).toBe("Add a note…");
		expect(en.expeditions.entryNotePlaceholder).toBe("Add a note…");
	});

	// The cross is drawn only for the row being reached into, and by opacity, so it keeps its grid
	// cell and stays reachable by Tab, whose focus then reveals it.
	it("shows a row's cross only on hover or focus, without taking it out of the tab order", () => {
		expect(declarations(CSS, ".stonetop-gm-encounter-entry-remove")).toMatch(/opacity:\s*0/);
		const shown = declarations(CSS, ".stonetop-gm-encounter-entry:hover .stonetop-gm-encounter-entry-remove");
		expect(shown).toMatch(/opacity:\s*1/);
		expect(CSS).toContain(".stonetop-gm-encounter-entry:focus-within .stonetop-gm-encounter-entry-remove");
	});

	// In the encounter's own head it was a dragon glyph two buttons from the trash, on a row that
	// says nothing about whether there is anything to place: an encounter of nothing but journal
	// pages wore it too, and pressing it there got a warning instead of an act.
	it("puts 'place them all' on the heading of the card that holds them", () => {
		const head = CARD_MARKUP.slice(
			CARD_MARKUP.indexOf("stonetop-gm-entry-card-head"),
			CARD_MARKUP.indexOf("stonetop-gm-encounter-entries"));
		expect(head).toContain("stonetop-gm-encounter-deploy");
		expect(head).toMatch(/\{\{#if canDeploy\}\}/);
		// It left the encounter's own head entirely.
		const row = CARD_MARKUP.slice(
			CARD_MARKUP.indexOf("stonetop-gm-encounter-head"),
			CARD_MARKUP.indexOf("stonetop-gm-encounter-body"));
		expect(row).not.toContain("stonetop-gm-encounter-deploy");
		// Drawn ONCE, so a card of five kinds does not carry five of them. Matched on the class
		// ATTRIBUTE, because the glyph's own class has this one as a prefix.
		expect(CARD_MARKUP.match(/class="stonetop-gm-encounter-deploy"/g)).toHaveLength(1);
		// AT THE END OF THE EYEBROW: glyph, title, count, the hairline, then the buttons.
		const order = ["stonetop-gm-entry-card-title", "stonetop-gm-entry-card-count",
			"stonetop-gm-entry-card-rule", "stonetop-gm-encounter-deploy"].map(c => head.indexOf(c));
		expect(order.every(i => i >= 0)).toBe(true);
		expect([...order].sort((a, b) => a - b)).toEqual(order);
	});

	// A bare 16px glyph was the one control on the card nobody could name without hovering. It
	// wears its word now; the long form stays the tooltip, in both blocks the cards read.
	it("labels Deploy in words, keeping the long form as the tooltip", () => {
		const btn = CARD_MARKUP.slice(CARD_MARKUP.indexOf('class="stonetop-gm-encounter-deploy"'));
		const inner = btn.slice(0, btn.indexOf("</button>"));
		expect(inner).toContain('{{localize "stonetop.gmToolkit.encounters.deploy"}}');
		expect(inner).toMatch(/class="stonetop-gm-encounter-deploy-label">\{\{localize "stonetop\.gmToolkit\.encounters\.deployShort"\}\}/);
		const en = JSON.parse(read("languages/en.json")).stonetop.gmToolkit;
		expect(en.encounters.deployShort).toBe("Deploy");
		expect(en.expeditions.deployShort).toBe("Deploy");
		expect(en.encounters.deployAndFightShort).toBe("Deploy & fight");
	});

	// Only actors can become tokens, and the button now exists only where it can do something.
	it("offers it on the actors' card and on no other", () => {
		const of = tally => groupEncounterEntries([{ id: "a", tally }])[0];
		expect(of("actor").canDeploy).toBe(true);
		for (const tally of ENCOUNTER_TALLY_KINDS.map(k => k.key).filter(k => k !== "actor")) {
			expect(of(tally).canDeploy).toBe(false);
		}
	});

	// What the button ACTS on is `_deployEncounter`'s business, and it filters on "Actor" itself.
	// Two places deciding "is this deployable" in two different ways is how they come to disagree.
	//
	// The flag is read off the kind's own row rather than named in the grouper, so a second
	// per-kind affordance is a field on ENCOUNTER_TALLY_KINDS and not another `key === ...`.
	it("still lets the deploy path decide what it places, not the flag", () => {
		expect(TAB_JS).toMatch(/canDeploy:\s*!!kind\.deployable/);
		expect(TAB_JS).not.toMatch(/canDeploy:\s*kind\.key ===/);
		expect(TAB_JS).toContain('=== "Actor"');
	});

	// A MASK over `currentColor`, not an <i>: one file then takes this button's resting ink, its
	// blue hover and both themes, where an <img> would need a second copy and a filter to fight.
	it("wears the pounce glyph as a mask rather than a font glyph", () => {
		expect(CARD_MARKUP).toContain("stonetop-gm-encounter-deploy-icon");
		// No Font Awesome left inside the button.
		const btn = CARD_MARKUP.slice(CARD_MARKUP.indexOf('class="stonetop-gm-encounter-deploy"'));
		expect(btn.slice(0, btn.indexOf("</button>"))).not.toContain("fa-");
		expect(repoFileExists("assets/icons/pounce.svg")).toBe(true);
		const icon = declarations(CSS, ".stonetop-gm-encounter-deploy-icon");
		expect(icon).toMatch(/background-color:\s*currentColor/);
		// Both spellings: -webkit-mask is still load-bearing on the Electron build.
		expect(icon).toMatch(/-webkit-mask:\s*url\([^)]*pounce\.svg[^)]*\)/);
		expect(icon).toMatch(/[^-]mask:\s*url\([^)]*pounce\.svg[^)]*\)/);
	});

	// A mask reads ALPHA, so the repo original's fill-less `<path d="M0 0h512v512H0z"/>` would mask
	// in the whole tile and the glyph would vanish into a filled square. It has to be punched
	// transparent, and nothing else about the artwork may change.
	it("punches the backing square out of the sourced file", () => {
		const svg = read("assets/icons/pounce.svg");
		expect(svg).toContain('viewBox="0 0 512 512"');
		expect(svg).not.toMatch(/<path d="M0 0h512v512H0z"\s*\/>/);
		expect(svg).toContain('<path d="M0 0h512v512H0z" fill="#fff" fill-opacity="0"/>');
		// An XML comment may not contain two hyphens in a row, and a strict parse kills the file.
		expect(svg).not.toMatch(/<!--[\s\S]*--[\s\S]*-->/);
	});

	// CC BY requires the credit, by name, in the folder the file lives in.
	it("credits the artist in its folder's attribution table", () => {
		const table = read("assets/icons/ATTRIBUTION.md");
		expect(table).toMatch(/\|\s*pounce\.svg\s*\|\s*pounce\s*\|\s*sbed\s*\|\s*http/);
	});

	// game-icons art is drawn with generous margins inside its 512 square, so `contain` gives back
	// less ink than a Font Awesome glyph at the same box size; and a `contain` mask needs a
	// definite, SQUARE box, because narrowing it shrinks the whole glyph rather than its margins.
	it("gives the mask a square box of its own beside the label", () => {
		const icon = declarations(CSS, ".stonetop-gm-encounter-deploy-icon");
		expect(icon).toMatch(/width:\s*16px/);
		expect(icon).toMatch(/height:\s*16px/);
		expect(icon).toMatch(/display:\s*block/);
		expect(icon).toMatch(/flex:\s*0 0 auto/);
	});

	// A labelled pill at the end of the eyebrow: its own outline and padding, every scrap of core's
	// button chrome stated away, and the eyebrow's capitals and spacing turned off inside it.
	it("draws Deploy as a compact outlined pill in the sheet's own voice", () => {
		const deploy = declarations(CSS, ".stonetop-gm-entry-card-head > .stonetop-gm-encounter-deploy");
		expect(deploy).toMatch(/border:\s*1px solid/);
		expect(deploy).toMatch(/border-radius:\s*999px/);
		expect(deploy).toMatch(/background:\s*transparent/);
		expect(deploy).toMatch(/box-shadow:\s*none/);
		expect(deploy).toMatch(/width:\s*auto/);
		expect(deploy).toMatch(/height:\s*auto/);
		expect(deploy).toMatch(/text-transform:\s*none/);
		expect(deploy).toMatch(/letter-spacing:\s*normal/);
		// A ~22px hit target at the least.
		expect(Number(/min-height:\s*(\d+)px/.exec(deploy)?.[1])).toBeGreaterThanOrEqual(22);
		expect(declarations(CSS, ".stonetop-gm-entry-card-head > .stonetop-gm-encounter-deploy:hover"))
			.toMatch(/background:\s*var\(--st-slate-hover-bg\)/);
	});

	// THE EYEBROW: the site card's label voice (IM Fell, capitals, spaced), a step DOWN from the
	// rows it names, so the eye lands on the names; the glyph in the card's accent.
	it("names each group with an eyebrow in the site card's label voice", () => {
		const head = declarations(CSS, ".stonetop-gm-entry-card-head");
		expect(head).toMatch(/font-family:\s*"IM Fell English"/);
		expect(head).toMatch(/text-transform:\s*uppercase/);
		expect(head).toMatch(/letter-spacing:\s*0\.08em/);
		expect(head).toMatch(/color:\s*var\(--st-text-secondary\)/);
		expect(declarations(CSS, ".stonetop-gm-entry-card-head > i")).toMatch(/color:\s*var\(--st-bundle-edge\)/);
		// Secondary, not muted: muted ink is under 4.5:1 on the card's paper in the light theme.
		expect(declarations(CSS, ".stonetop-gm-entry-card-count")).toMatch(/color:\s*var\(--st-text-secondary\)/);
		// The hairline to the edge, a span of its own in the markup.
		expect(CARD_MARKUP).toContain('<span class="stonetop-gm-entry-card-rule" aria-hidden="true"></span>');
		expect(declarations(CSS, ".stonetop-gm-entry-card-rule")).toMatch(/height:\s*1px/);
	});

	// FA7 carries a tall ascent and almost no descent, so its ink sits high inside its own em box:
	// flex-centred beside the title's caps it overshot the cap line by 3.38px above and the
	// baseline by only 1.75px below, which is what reads as "not centred" while `align-items:
	// center` is centring both BOXES exactly. Scanned off the real paint, not eyeballed.
	it("nudges the glyph onto the title's cap band, sub-pixel and in em", () => {
		const glyph = declarations(CSS, ".stonetop-gm-entry-card-head > i");
		// A TRANSFORM, not `top`: a transform can land sub-pixel where `top` rounds to a whole one.
		// The dismiss/release/lift buttons take the same half of the same problem the same way.
		expect(glyph).toMatch(/transform:\s*translateY\(0?\.0\d+em\)/);
		expect(glyph).not.toMatch(/^\s*top:/m);
		// In em, because the figure comes from the font's metrics and has to hold at every UI
		// font scale, not just the one it was measured at.
		expect(glyph).not.toMatch(/translateY\([\d.]+px\)/);
		// Core spaces an <i> from the label that follows it in its own components; the gap on this
		// line is the flex gap's to set.
		expect(glyph).toMatch(/margin:\s*0/);
	});

	// NO GROUP BOXES: the card is the frame, and a bordered group with a filled strip inside it
	// was a third frame deep. The group is an eyebrow and its rows, and nothing round them.
	it("draws a group with no box, no fill and no strip of its own", () => {
		const card = declarations(CSS, ".stonetop-gm-entry-card");
		expect(card).toMatch(/border:\s*0/);
		expect(card).not.toMatch(/^\s*background:/m);
		expect(declarations(CSS, ".stonetop-gm-entry-card-head")).not.toMatch(/^\s*(background|border-bottom):/m);
	});

	// The shortest thing on the head and the only one that cannot be read at half length: wrapped
	// it pushes the row to two lines, clipped mid-glyph it lies about the contents.
	it("keeps the whole breakdown on one line and unshrunk", () => {
		const box = declarations(CSS, ".stonetop-gm-encounter-count");
		expect(box).toMatch(/white-space:\s*nowrap/);
		expect(box).toMatch(/flex:\s*0 0 auto/);
		expect(box).toMatch(/display:\s*flex/);
		// NO FRAME. The head already carries the name's input and the card's own border; a fourth
		// box round a run of numbers read as a toolbar of controls rather than a line of contents.
		expect(box).not.toMatch(/border(-radius)?:/);
	});
});

/* ══ notes, used, delete ══════════════════════════════════════════════════════ */

describe("the Encounters tab: notes, used and delete", () => {
	const one = () => [{ id: "e1", name: "Crypt", notes: "", used: false, entries: [
		{ id: "x1", uuid: "Actor.a", type: "Actor", name: "Rust-Hound", note: "" },
	] }];

	// WHAT THE ENCOUNTER IS comes before the documents it points at, and at the same place on
	// every card: after the collected rows the note sat two lines down on one card and twelve
	// on the next, which is a thing you hunt for rather than read.
	// A RULED PASSAGE, not a box: the card is already the frame, and a well inside it was a second
	// frame round the one thing on the card that is prose. A 2px rule down its left in the card's
	// accent (softened), a little indent, and nothing round it.
	it("rules the notes down their left rather than boxing them", () => {
		const notes = declarations(CSS, ".stonetop-gm-encounter-notes");
		expect(notes).toMatch(/border-left:\s*2px solid color-mix\(in srgb, var\(--st-bundle-edge\)/);
		expect(notes).not.toMatch(/^\s*background:/m);
		expect(notes).not.toMatch(/^\s*border:/m);
		// No hover well either: the passage does not light up as a field would.
		expect(CSS).not.toContain(".stonetop-gm-encounter-notes-block:hover .stonetop-gm-encounter-notes {");
	});

	// An empty note is one muted line, "Add notes…", that is ITSELF the pencil: it wears the
	// pencil's class, so the one delegated handler opens the dialog from either.
	it("offers an empty note as its own 'Add notes…' button", () => {
		expect(CARD_MARKUP).toMatch(/class="stonetop-gm-encounter-notes-edit stonetop-gm-encounter-notes-add"[\s\S]*?\{\{localize "stonetop\.gmToolkit\.encounters\.notesAdd"\}\}/);
		expect(TAB_JS).toContain('ev.target.closest(".stonetop-gm-encounter-notes-edit")');
		const add = declarations(CSS, ".stonetop-gm-encounter-notes-edit.stonetop-gm-encounter-notes-add");
		expect(add).toMatch(/position:\s*static/);
		expect(add).toMatch(/display:\s*inline-flex/);
		expect(add).toMatch(/font-style:\s*italic/);
		const en = JSON.parse(read("languages/en.json")).stonetop.gmToolkit;
		expect(en.encounters.notesAdd).toBe("Add notes…");
		expect(en.expeditions.notesAdd).toBe("Add notes…");
		// The old "No notes on this encounter yet." sentence is gone, not left dead in the file.
		expect(en.encounters.notesEmpty).toBeUndefined();
		expect(en.expeditions.notesEmpty).toBeUndefined();
	});

	// No heading: the box and its corner control are what say "notes", exactly as they do on the
	// character sheet, and a card three boxes deep does not need a fourth label inside it.
	it("gives the block no heading of its own", () => {
		expect(CARD_MARKUP).not.toContain("<h3");
		expect(CARD_MARKUP).not.toContain("notesHeading");
		const full = "stonetop.gmToolkit.encounters.notesHeading";
		expect(game.i18n.localize(full)).toBe(full);
	});

	// Parked where core parks `<prose-mirror toggled>`'s own toggle, and revealed the same way.
	it("parks one pencil in the passage's corner, hidden until the block is hovered", () => {
		// One per branch: the corner pencil over written notes, the "Add notes…" line in place of
		// none. Never both on one card.
		expect(CARD_MARKUP.match(/class="stonetop-gm-encounter-notes-edit[" ]/g)).toHaveLength(2);
		const block = CARD_MARKUP.slice(CARD_MARKUP.indexOf("stonetop-gm-encounter-notes-block"));
		const written = block.slice(0, block.indexOf("{{else}}"));
		// AFTER the passage it sits over.
		expect(written.indexOf("stonetop-gm-encounter-notes-edit"))
			.toBeGreaterThan(written.indexOf('class="stonetop-gm-encounter-notes"'));
		expect(declarations(CSS, ".stonetop-gm-encounter-notes-block")).toMatch(/position:\s*relative/);
		const pencil = declarations(CSS, ".stonetop-gm-encounter-notes-edit");
		expect(pencil).toMatch(/position:\s*absolute/);
		expect(pencil).toMatch(/display:\s*none/);
		// `flex` and not `inline-flex`: an absolutely positioned box is blockified, so the inline
		// form would compute to this anyway and the rule would be describing a fiction.
		expect(declarations(CSS, ".stonetop-gm-encounter-notes-block:hover .stonetop-gm-encounter-notes-edit"))
			.toMatch(/display:\s*flex/);
		// A glyph alone, and the tooltip says the rest.
		expect(CARD_MARKUP).not.toContain("notesEditShort");
		expect(block).toContain("stonetop.gmToolkit.encounters.notesEdit");
	});

	// The passage has to leave the corner control its room, or a long first line runs under it.
	it("keeps the note's text clear of the corner control", () => {
		const pencil = Number(/width:\s*(\d+)px/.exec(declarations(CSS, ".stonetop-gm-encounter-notes-edit"))?.[1]);
		const right = Number(/padding:\s*\d+(?:px)?\s+(\d+)px/.exec(declarations(CSS, ".stonetop-gm-encounter-notes"))?.[1]);
		expect(pencil).toBeGreaterThanOrEqual(22);
		expect(right).toBeGreaterThanOrEqual(pencil);
	});

	// NOT a live editor, whatever the box is borrowed from. This sheet re-renders on every prep
	// write anywhere in the world, so one open here would be torn out from under a GM mid-sentence.
	it("still writes in a dialog rather than in place", () => {
		expect(CARD_MARKUP).not.toContain("prose-mirror");
		expect(SHEET_JS + TAB_JS).toContain("openBundleNotesDialog");
	});

	it("draws the note above the collected rows, not after them", () => {
		const notes = CARD_MARKUP.indexOf("stonetop-gm-encounter-notes-block");
		const rows  = CARD_MARKUP.indexOf("stonetop-gm-encounter-entries");
		expect(notes).toBeGreaterThan(-1);
		expect(rows).toBeGreaterThan(-1);
		expect(notes).toBeLessThan(rows);
	});

	// A column of shut cards says only what each one is CALLED, and two bundles are routinely
	// both called "the bridge". The head of the note rides the row to tell them apart. Only
	// while it is shut: open, the real note is two pixels below it.
	it("rides the head of the note beside the name, and only while the row is shut", () => {
		expect(CARD_MARKUP).toMatch(/stonetop-gm-encounter-peek"[^>]*><span class="stonetop-gm-encounter-peek-text">\{\{this\.notesPeek\}\}<\/span><\/span>/);
		const peek = declarations(CSS, ".stonetop-gm-encounter-peek");
		expect(peek).toMatch(/display:\s*none/);
		expect(peek).toMatch(/white-space:\s*nowrap/);
		expect(peek).toMatch(/text-overflow:\s*ellipsis/);
		// WITHOUT field-sizing it neither grows nor shrinks and is capped by a max-width. Core sizes
		// a form input `width: 100%`, so the name beside it is a flex item whose basis is the whole
		// row, and every shrinkable item in the head gives up a proportional share of that
		// overflow -- which clipped a ten-word note with half the row still empty beside it.
		expect(peek).toMatch(/flex:\s*0 0 auto/);
		expect(peek).toMatch(/max-width:\s*\d+%/);
		// WITH it, the name is as wide as its words and the peek takes the rest of the row.
		expect(CSS).toMatch(/@supports \(field-sizing: content\)\s*\{[\s\S]*?\.stonetop-gm-encounter-peek\s*\{[^}]*flex:\s*1 1 0/);
		// Squeezed to a sliver it hides its words rather than drawing one letter: the peek is a size
		// container for them, inside that `@supports` only (a container's content does not size it,
		// which would collapse the fallback's content-sized peek to nothing).
		const sized = CSS.slice(CSS.indexOf("@supports (field-sizing: content)"));
		expect(sized).toMatch(/\.stonetop-gm-encounter-peek\s*\{[^}]*container-type:\s*inline-size/);
		expect(sized).toMatch(/@container \(max-width: \d+em\)\s*\{\s*\.stonetop-gm-encounter-peek-text\s*\{\s*visibility:\s*hidden/);
		expect(CSS.slice(0, CSS.indexOf("@supports (field-sizing: content)")))
			.not.toMatch(/\.stonetop-gm-encounter-peek\s*\{[^}]*container-type/);
		expect(declarations(CSS, ".stonetop-gm-encounter-peek-text")).toMatch(/text-overflow:\s*ellipsis/);
		expect(declarations(CSS, ".stonetop-gm-encounter.is-collapsed .stonetop-gm-encounter-peek"))
			.toMatch(/display:\s*block/);
	});

	// One line of PLAIN text: the markup would be drawn as source in a span, and a paragraph
	// boundary that dropped to nothing would run two sentences together at the one place the
	// reader needs the break.
	it("publishes the peek as one plain line, with the paragraph breaks kept as spaces", async () => {
		const { host } = makeHost([{ id: "e1", name: "Crypt", used: false, entries: [], notes:
			"<p>They cross at <strong>dusk</strong>.</p><p>The ford is watched.</p>" }]);
		const context = { stonetop: {} };
		await host._addGmEncountersContext(context);
		expect(context.stonetop.encounters.active[0].notesPeek).toBe("They cross at dusk. The ford is watched.");
	});

	// The clip is the column's job, not a character count's; this cap only keeps a note of any
	// length out of the flex row, whose basis is the span's whole untruncated text.
	it("caps a long note rather than putting the whole of it in the row", async () => {
		const { host } = makeHost([{ id: "e1", name: "Crypt", used: false, entries: [], notes: "<p>" + "word ".repeat(400) + "</p>" }]);
		const context = { stonetop: {} };
		await host._addGmEncountersContext(context);
		expect(context.stonetop.encounters.active[0].notesPeek.length).toBeLessThanOrEqual(240);
	});

	it("leaves the peek empty for an encounter nobody has written about", async () => {
		const { host } = makeHost(one());
		const context = { stonetop: {} };
		await host._addGmEncountersContext(context);
		expect(context.stonetop.encounters.active[0].notesPeek).toBe("");
	});
	// A text write that re-rendered would tear out the node that just took focus.
	it("writes a rename and an entry note without asking for a render", async () => {
		const { host, updates } = makeHost(one());
		await host._setEncounterField("e1", "name", "The crypt beneath Marshedge");
		await host._setEntryNote("e1", "x1", "opens the door on round two");
		expect(updates.map(([, o]) => o.render)).toEqual([false, false]);
	});

	it("re-renders for a structural change, and only for those", async () => {
		const { host, updates } = makeHost(one());
		await host._setEncounterUsed("e1", true);
		await host._removeEntry("e1", "x1");
		expect(updates.every(([, o]) => o.render === undefined)).toBe(true);
	});

	it("writes nothing at all when a field is unchanged", async () => {
		const { host, updates } = makeHost(one());
		await host._setEncounterField("e1", "name", "Crypt");
		await host._setEntryNote("e1", "x1", "");
		await host._setEncounterUsed("e1", false);
		expect(updates).toEqual([]);
	});

	it("marks an encounter used and back again", async () => {
		const { host, actor } = makeHost(one());
		await host._setEncounterUsed("e1", true);
		expect(listOf(actor)[0].used).toBe(true);
		await host._setEncounterUsed("e1", false);
		expect(listOf(actor)[0].used).toBe(false);
	});

	it("takes one collected row out and leaves the rest", async () => {
		const { host, actor } = makeHost([{ id: "e1", name: "C", entries: [
			{ id: "x1", uuid: "Actor.a", type: "Actor", name: "A", note: "" },
			{ id: "x2", uuid: "Actor.b", type: "Actor", name: "B", note: "" },
		] }]);
		await host._removeEntry("e1", "x1");
		expect(listOf(actor)[0].entries.map(e => e.id)).toEqual(["x2"]);
	});

	// The only irreversible button on the tab, and NOT the one a GM reaches for after running
	// something: that is "mark used", which is one click both ways.
	it("asks before deleting an encounter, and escapes its name in the prompt", async () => {
		const { host, actor } = makeHost([{ id: "e1", name: "<b>Crypt</b>", entries: [] }]);
		const asked = stubConfirm(true);
		await host._onEncounterRemove("e1");
		const { content, buttons } = asked.mock.calls[0][0];
		expect(content).toContain("&lt;b&gt;Crypt&lt;/b&gt;");
		// The buttons say what they do, and Enter keeps the encounter.
		expect(buttons.map(b => b.label)).toEqual(["Delete the encounter", "Keep it"]);
		expect(buttons.find(b => b.default).action).toBe("no");
		expect(listOf(actor)).toEqual([]);
	});

	it("keeps the encounter when the confirm is declined", async () => {
		const { host, actor } = makeHost([{ id: "e1", name: "Crypt", entries: [] }]);
		stubConfirm(false);
		await host._onEncounterRemove("e1");
		expect(listOf(actor)).toHaveLength(1);
	});

	// Clicking a button BLURS whatever field had focus, so the browser fires `change` (one async
	// write) and then `click` (a second) with nothing between them. Read against the same starting
	// list, the second to land would win and the note just typed would vanish with no error.
	it("serializes concurrent writes, so an in-flight note is not clobbered", async () => {
		const { host, actor } = makeHost(one());
		await Promise.all([
			host._setEntryNote("e1", "x1", "opens the door"),
			host._setEncounterUsed("e1", true),
		]);
		expect(listOf(actor)[0].entries[0].note).toBe("opens the door");
		expect(listOf(actor)[0].used).toBe(true);
	});

	it("survives a failed write and keeps taking the next one", async () => {
		const { host, actor } = makeHost(one());
		const err = vi.spyOn(console, "error").mockImplementation(() => {});
		actor.update.mockRejectedValueOnce(new Error("no permission"));
		await host._setEncounterUsed("e1", true);
		expect(warned).toHaveLength(1);
		await host._setEncounterField("e1", "name", "Still works");
		expect(listOf(actor)[0].name).toBe("Still works");
		err.mockRestore();
	});
});

/* ══ drag out ═════════════════════════════════════════════════════════════════ */

describe("the Encounters tab: dragging back out", () => {
	const one = () => [{ id: "e1", name: "Crypt", entries: [
		{ id: "x1", uuid: "Compendium.p.bestiary.Actor.rh", type: "Actor", name: "Rust-Hound", note: "" },
	] }];

	// Core's own payload, so the canvas places a token, the hotbar makes a macro, and this
	// system's own sheets route it exactly as they route a sidebar drag.
	it("emits core's own type and uuid off an entry handle", async () => {
		const { host, actor } = makeHost(one());
		const root = fakeRoot();
		host._activateGmEncountersListeners(root);
		const el = makeEncounterEl(root, listOf(actor)[0]);
		const dt = fakeDataTransfer();
		await root.emit("dragstart", el.rows.x1.open, { dataTransfer: dt });
		expect(payloadOf(dt)).toMatchObject({ type: "Actor", uuid: "Compendium.p.bestiary.Actor.rh" });
	});

	// No core drop target reads an unknown key, so these ride along invisibly everywhere else and
	// mean "move me" only here.
	it("rides its own encounter and entry ids alongside, which no core target reads", async () => {
		const { host, actor } = makeHost(one());
		const root = fakeRoot();
		host._activateGmEncountersListeners(root);
		const el = makeEncounterEl(root, listOf(actor)[0]);
		const dt = fakeDataTransfer();
		await root.emit("dragstart", el.rows.x1.open, { dataTransfer: dt });
		expect(payloadOf(dt)).toMatchObject({ stonetopEncounterId: "e1", stonetopEntryId: "x1" });
	});

	it("emits the encounter drag type off a grip", async () => {
		const { host, actor } = makeHost(one());
		const root = fakeRoot();
		host._activateGmEncountersListeners(root);
		const el = makeEncounterEl(root, listOf(actor)[0]);
		const dt = fakeDataTransfer();
		await root.emit("dragstart", el.grip, { dataTransfer: dt });
		expect(payloadOf(dt)).toEqual({ type: STONETOP_ENCOUNTER_DRAG_TYPE, encounterId: "e1" });
	});

	it("cancels a drag from a handle carrying no uuid", async () => {
		const { host } = makeHost([]);
		const root = fakeRoot();
		host._activateGmEncountersListeners(root);
		const orphan = fakeEl({ cls: ["stonetop-gm-encounter-entry-open"], dataset: { uuid: "", docType: "Actor", draggable: "true" }, parent: root.panel });
		const dt = fakeDataTransfer();
		const ev = await root.emit("dragstart", orphan, { dataTransfer: dt });
		expect(ev.defaultPrevented).toBe(true);
		expect(dt.stored["text/plain"]).toBeUndefined();
	});

	// THE DROP EFFECT IS A NEGOTIATION, not decoration. The browser intersects the source's
	// `effectAllowed` with the target's `dropEffect` and resolves an incompatible pair to "none",
	// at which point it converts the drop into a dragleave and never fires `drop` at all. A grip
	// that honestly says "move" met a zone that always answered "copy", and reordering an
	// encounter by its grip did nothing whatever, silently, in both engines.
	it("answers a move drag with a move, so the drop actually fires", async () => {
		const { host } = makeHost([]);
		const root = fakeRoot();
		host._activateGmEncountersListeners(root);
		const dt = fakeDataTransfer();
		dt.effectAllowed = "move";
		const ev = await root.panel.dragoverEvent(dt);
		expect(ev.defaultPrevented).toBe(true);
		expect(dt.dropEffect).toBe("move");
	});

	it("still prefers copy wherever the source permits it", async () => {
		const { host } = makeHost([]);
		const root = fakeRoot();
		host._activateGmEncountersListeners(root);
		for (const allowed of ["copyMove", "all", "uninitialized", ""]) {
			const dt = fakeDataTransfer();
			dt.effectAllowed = allowed;
			await root.panel.dragoverEvent(dt);
			expect(dt.dropEffect).toBe("copy");
		}
	});

	// The grip's own half of the same contract: it says "move" because that is what a reorder is.
	it("declares the reorder drag a move", async () => {
		const { host, actor } = makeHost(one());
		const root = fakeRoot();
		host._activateGmEncountersListeners(root);
		const el = makeEncounterEl(root, listOf(actor)[0]);
		const dt = fakeDataTransfer();
		await root.emit("dragstart", el.grip, { dataTransfer: dt });
		expect(dt.effectAllowed).toBe("move");
	});

	// One of our own rows, dropped back on the tab: a move, not a second copy.
	it("treats its own payload as a move rather than a fresh collect", async () => {
		const { host, actor } = makeHost([
			{ id: "e1", name: "One", entries: [{ id: "x1", uuid: "Actor.a", type: "Actor", name: "A", note: "" }] },
			{ id: "e2", name: "Two", entries: [] },
		]);
		const target = { closest: sel => (sel === "[data-encounter-id]" ? { dataset: { encounterId: "e2" } } : null) };
		await host._onEncounterDrop({ type: "Actor", uuid: "Actor.a", stonetopEncounterId: "e1", stonetopEntryId: "x1" }, target);
		expect(listOf(actor)[0].entries).toEqual([]);
		expect(listOf(actor)[1].entries.map(e => e.id)).toEqual(["x1"]);
	});

	it("ignores its own payload dropped on empty space, rather than copying it", async () => {
		const { host, updates } = makeHost([
			{ id: "e1", name: "One", entries: [{ id: "x1", uuid: "Actor.a", type: "Actor", name: "A", note: "" }] },
		]);
		await host._onEncounterDrop({ type: "Actor", uuid: "Actor.a", stonetopEncounterId: "e1", stonetopEntryId: "x1" }, null);
		expect(updates).toEqual([]);
	});
});

/* ══ deploy ═══════════════════════════════════════════════════════════════════ */

describe("the Encounters tab: deploying to the map", () => {
	const mixed = () => [{ id: "e1", name: "Crypt", entries: [
		{ id: "x1", uuid: "Actor.a", type: "Actor", name: "Rust-Hound", note: "" },
		{ id: "x2", uuid: "Scene.s", type: "Scene", name: "Crypt Level 1", note: "" },
		{ id: "x3", uuid: "JournalEntryPage.p", type: "JournalEntryPage", name: "Read aloud", note: "" },
	] }];

	/** A canvas whose token layer records every placement instead of making one. */
	function fakeCanvas() {
		const placed = [];
		globalThis.canvas = {
			scene: { id: "scene1" },
			grid: { size: 100 },
			stage: { pivot: { x: 1000, y: 1000 } },
			dimensions: { rect: { contains: () => true } },
			tokens: { _onDropActorData: vi.fn(async (ev, data) => { placed.push(data); return true; }) },
		};
		return placed;
	}

	it("places one token per Actor entry and skips everything else", async () => {
		const { host } = makeHost(mixed());
		const placed = fakeCanvas();
		globalThis.fromUuid = vi.fn(async uuid => (uuid === "Actor.a" ? { documentName: "Actor", uuid: "Actor.a", name: "Rust-Hound" } : null));
		await host._deployEncounter("e1");
		expect(placed).toHaveLength(1);
		expect(placed[0]).toMatchObject({ type: "Actor", uuid: "Actor.a" });
	});

	it("places one token per row, duplicates included", async () => {
		const { host } = makeHost([{ id: "e1", name: "C", entries: [
			{ id: "x1", uuid: "Actor.a", type: "Actor", name: "Rust-Hound", note: "" },
			{ id: "x2", uuid: "Actor.a", type: "Actor", name: "Rust-Hound", note: "" },
		] }]);
		const placed = fakeCanvas();
		globalThis.fromUuid = vi.fn(async () => ({ documentName: "Actor", uuid: "Actor.a", name: "Rust-Hound" }));
		await host._deployEncounter("e1");
		expect(placed).toHaveLength(2);
	});

	// Core's own canvas drop imports a pack actor UNCONDITIONALLY, and this world seeds the whole
	// bestiary into game.actors on ready — so without this check every deploy of every encounter
	// would mint another copy of a monster the world already has, for the life of the campaign.
	it("prefers a world copy of a pack actor over importing a second one", async () => {
		const { host } = makeHost([{ id: "e1", name: "C", entries: [
			{ id: "x1", uuid: "Compendium.stonetop-pwd.bestiary.Actor.rh", type: "Actor", name: "Rust-Hound", note: "" },
		] }]);
		const placed = fakeCanvas();
		globalThis.fromUuid = vi.fn(async () => ({
			documentName: "Actor", uuid: "Compendium.stonetop-pwd.bestiary.Actor.rh", pack: "stonetop-pwd.bestiary", name: "Rust-Hound",
		}));
		global.game.actors = [{
			uuid: "Actor.world1", name: "Rust-Hound",
			_stats: { compendiumSource: "Compendium.stonetop-pwd.bestiary.Actor.rh" },
		}];
		globalThis.Actor = { create: vi.fn(), canUserCreate: () => true };
		await host._deployEncounter("e1");
		expect(globalThis.Actor.create).not.toHaveBeenCalled();
		expect(placed[0].uuid).toBe("Actor.world1");
	});

	// The package id is stripped from both sides, so a world seeded under an older system id
	// still counts as having the monster.
	it("matches that copy across a system-id rename", async () => {
		const { host } = makeHost([{ id: "e1", name: "C", entries: [
			{ id: "x1", uuid: "Compendium.stonetop-pwd.bestiary.Actor.rh", type: "Actor", name: "Rust-Hound", note: "" },
		] }]);
		const placed = fakeCanvas();
		globalThis.fromUuid = vi.fn(async () => ({
			documentName: "Actor", uuid: "Compendium.stonetop-pwd.bestiary.Actor.rh", pack: "stonetop-pwd.bestiary", name: "Rust-Hound",
		}));
		global.game.actors = [{
			uuid: "Actor.world1", name: "Rust-Hound",
			flags: { core: { sourceId: "Compendium.stonetop_pwd.bestiary.Actor.rh" } },
		}];
		globalThis.Actor = { create: vi.fn(), canUserCreate: () => true };
		await host._deployEncounter("e1");
		expect(globalThis.Actor.create).not.toHaveBeenCalled();
		expect(placed[0].uuid).toBe("Actor.world1");
	});

	// The index of world copies is built on the FIRST question and the deploy that asked it goes
	// on to import what it could not find. Without telling the index about that import, the second
	// row pointing at the same pack Actor misses against a snapshot taken before it and mints a
	// second copy into the sidebar from one press.
	it("imports a pack actor once even when the encounter lists it twice", async () => {
		const { host } = makeHost([{ id: "e1", name: "C", entries: [
			{ id: "x1", uuid: "Compendium.p.bestiary.Actor.rh", type: "Actor", name: "Raider", note: "" },
			{ id: "x2", uuid: "Compendium.p.bestiary.Actor.rh", type: "Actor", name: "Raider", note: "" },
			{ id: "x3", uuid: "Compendium.p.bestiary.Actor.rh", type: "Actor", name: "Raider", note: "" },
		] }]);
		const placed = fakeCanvas();
		const packDoc = { documentName: "Actor", uuid: "Compendium.p.bestiary.Actor.rh", pack: "p.bestiary", name: "Raider" };
		globalThis.fromUuid = vi.fn(async () => packDoc);
		global.game.actors = [];
		global.game.actors.fromCompendium = vi.fn(d => ({ name: d.name }));
		globalThis.Actor = {
			canUserCreate: () => true,
			create: vi.fn(async () => ({
				uuid: "Actor.world1", name: "Raider",
				_stats: { compendiumSource: "Compendium.p.bestiary.Actor.rh" },
			})),
		};
		await host._deployEncounter("e1");
		expect(globalThis.Actor.create).toHaveBeenCalledTimes(1);
		// Three tokens all the same, from one imported actor: the rows are three raiders, not one.
		expect(placed).toHaveLength(3);
		expect(placed.every(p => p.uuid === "Actor.world1")).toBe(true);
	});

	it("imports a pack actor once when the world has no copy, and says that it did", async () => {
		const { host } = makeHost([{ id: "e1", name: "C", entries: [
			{ id: "x1", uuid: "Compendium.p.bestiary.Actor.rh", type: "Actor", name: "Rust-Hound", note: "" },
		] }]);
		const placed = fakeCanvas();
		const packDoc = { documentName: "Actor", uuid: "Compendium.p.bestiary.Actor.rh", pack: "p.bestiary", name: "Rust-Hound" };
		globalThis.fromUuid = vi.fn(async () => packDoc);
		global.game.actors = [];
		global.game.actors.fromCompendium = vi.fn(d => ({ name: d.name }));
		globalThis.Actor = {
			canUserCreate: () => true,
			create: vi.fn(async () => ({ uuid: "Actor.imported", name: "Rust-Hound" })),
		};
		await host._deployEncounter("e1");
		expect(globalThis.Actor.create).toHaveBeenCalledTimes(1);
		expect(placed[0].uuid).toBe("Actor.imported");
		expect(infoed.join(" ")).toContain("Brought 1 into this world");
	});

	it("places nothing and says so when the user cannot create actors", async () => {
		const { host } = makeHost([{ id: "e1", name: "C", entries: [
			{ id: "x1", uuid: "Compendium.p.bestiary.Actor.rh", type: "Actor", name: "Rust-Hound", note: "" },
		] }]);
		const placed = fakeCanvas();
		globalThis.fromUuid = vi.fn(async () => ({ documentName: "Actor", uuid: "Compendium.p.bestiary.Actor.rh", pack: "p.bestiary", name: "Rust-Hound" }));
		global.game.actors = [];
		globalThis.Actor = { canUserCreate: () => false, create: vi.fn() };
		await host._deployEncounter("e1");
		expect(placed).toEqual([]);
		expect(warned.join(" ")).toContain("Rust-Hound");
	});

	/**
	 * A 40x40-square scene whose view is the whole window at 1:1 (so the view's middle is the window's),
	 * holding whatever tokens are passed. Records drops and token moves.
	 */
	function sceneCanvas({ tokens = [], combats = [] } = {}) {
		const placed = [];
		const moved = [];
		global.game.combats = combats;
		globalThis.canvas = {
			scene: {
				id: "scene1",
				grid: { size: 100, type: 1 },
				tokens,
				moveTokens: vi.fn(async plan => { for (const [id, m] of Object.entries(plan)) moved.push({ id, ...m.waypoints[0] }); }),
			},
			grid: { size: 100 },
			stage: { pivot: { x: 2000, y: 2000 }, worldTransform: { applyInverse: p => ({ x: p.x, y: p.y }) } },
			dimensions: { size: 100, rect: { x: 0, y: 0, width: 4000, height: 4000, contains: () => true } },
			tokens: { _onDropActorData: vi.fn(async (ev, data) => { placed.push(data); return true; }) },
		};
		return { placed, moved };
	}

	const pc = (id, x, y) => ({ id, _source: { x, y, width: 1, height: 1 }, actor: { id: `a-${id}`, type: "character", uuid: `Actor.a-${id}` } });
	const middle = () => (globalThis.innerWidth ?? 1920) / 2;

	// The user's rule: the party on the left, what was deployed against them on the right.
	it("puts the deployed monsters right of the view's middle, each on its own square", async () => {
		const { host } = makeHost([{ id: "e1", name: "C", entries: [1, 2, 3, 4].map(n => (
			{ id: `x${n}`, uuid: "Actor.a", type: "Actor", name: "A", note: "" }
		)) }]);
		const { placed } = sceneCanvas();
		globalThis.fromUuid = vi.fn(async () => ({ documentName: "Actor", uuid: "Actor.a", name: "A", type: "monster" }));
		await host._deployEncounter("e1");
		expect(placed).toHaveLength(4);
		expect(new Set(placed.map(p => `${p.x},${p.y}`)).size).toBe(4);
		for (const p of placed) expect(p.x).toBeGreaterThan(middle());
	});

	it("lines the party's tokens up left of the view's middle, facing what was deployed", async () => {
		const { host } = makeHost([{ id: "e1", name: "C", entries: [
			{ id: "x1", uuid: "Actor.a", type: "Actor", name: "A", note: "" },
		] }]);
		const { placed, moved } = sceneCanvas({ tokens: [pc("p1", 3500, 3500), pc("p2", 100, 100)] });
		globalThis.fromUuid = vi.fn(async () => ({ documentName: "Actor", uuid: "Actor.a", name: "A", type: "monster" }));
		await host._deployEncounter("e1");
		expect(moved.map(m => m.id).sort()).toEqual(["p1", "p2"]);
		for (const m of moved) expect(m.x + 50).toBeLessThan(middle());
		for (const m of moved) expect(m.x).toBeLessThan(placed[0].x);
		// In the order they stood, top first.
		expect(moved.find(m => m.id === "p2").y).toBeLessThan(moved.find(m => m.id === "p1").y);
	});

	// Moving someone out of a running fight would end whatever engagement they are in.
	it("leaves anyone already in a fight on this map where they stand", async () => {
		const { host } = makeHost([{ id: "e1", name: "C", entries: [
			{ id: "x1", uuid: "Actor.a", type: "Actor", name: "A", note: "" },
		] }]);
		const fight = { id: "c1", scene: { id: "scene1" }, flags: { "stonetop-pwd": { fight: true } }, combatants: [{ sceneId: "scene1", tokenId: "p1" }] };
		const { moved } = sceneCanvas({ tokens: [pc("p1", 3500, 3500), pc("p2", 100, 100)], combats: [fight] });
		globalThis.fromUuid = vi.fn(async () => ({ documentName: "Actor", uuid: "Actor.a", name: "A", type: "monster" }));
		await host._deployEncounter("e1");
		expect(moved.map(m => m.id)).toEqual(["p2"]);
	});

	it("moves nobody when nothing was placed, or for a player", async () => {
		const { host } = makeHost([{ id: "e1", name: "C", entries: [
			{ id: "x1", uuid: "Actor.a", type: "Actor", name: "A", note: "" },
		] }]);
		let { moved } = sceneCanvas({ tokens: [pc("p1", 3500, 3500)] });
		globalThis.fromUuid = vi.fn(async () => null);
		await host._deployEncounter("e1");
		expect(moved).toEqual([]);

		({ moved } = sceneCanvas({ tokens: [pc("p1", 3500, 3500)] }));
		globalThis.fromUuid = vi.fn(async () => ({ documentName: "Actor", uuid: "Actor.a", name: "A", type: "monster" }));
		global.game.user.isGM = false;
		await host._deployEncounter("e1");
		expect(moved).toEqual([]);
	});

	// A follower in an encounter joins the party's column rather than the foes'.
	it("puts a deployed follower on the party's side", async () => {
		const { host } = makeHost([{ id: "e1", name: "C", entries: [
			{ id: "x1", uuid: "Actor.f", type: "Actor", name: "Hound", note: "" },
			{ id: "x2", uuid: "Actor.a", type: "Actor", name: "A", note: "" },
		] }]);
		const { placed } = sceneCanvas();
		globalThis.fromUuid = vi.fn(async uuid => (uuid === "Actor.f"
			? { documentName: "Actor", uuid, name: "Hound", type: "npc", flags: { "stonetop-pwd": { followerOrigin: { ftype: "crew" } } } }
			: { documentName: "Actor", uuid, name: "A", type: "monster" }));
		await host._deployEncounter("e1");
		expect(placed[0].x).toBeLessThan(middle());
		expect(placed[1].x).toBeGreaterThan(middle());
	});

	it("says so and places nothing when there is no scene", async () => {
		const { host } = makeHost(mixed());
		globalThis.canvas = { scene: null };
		await host._deployEncounter("e1");
		expect(warned).toHaveLength(1);
	});

	it("says so and places nothing without TOKEN_CREATE", async () => {
		const { host } = makeHost(mixed());
		fakeCanvas();
		global.game.user.can = () => false;
		await host._deployEncounter("e1");
		expect(warned).toHaveLength(1);
	});

	// Everything else in an encounter is opened rather than deployed, so a bundle with no monsters
	// in it is a button press that should explain itself rather than doing nothing.
	it("says so when there is nothing in the encounter to place", async () => {
		const { host } = makeHost([{ id: "e1", name: "C", entries: [
			{ id: "x1", uuid: "Scene.s", type: "Scene", name: "S", note: "" },
		] }]);
		fakeCanvas();
		await host._deployEncounter("e1");
		expect(warned).toHaveLength(1);
	});

	it("reports what it could not place", async () => {
		const { host } = makeHost(mixed());
		fakeCanvas();
		globalThis.fromUuid = vi.fn(async () => null);
		await host._deployEncounter("e1");
		expect(warned.join(" ")).toContain("Rust-Hound");
	});
});

/* ══ flush ════════════════════════════════════════════════════════════════════ */

describe("the Encounters tab: saving what is being typed", () => {
	// `_wirePrepPageSync` re-renders this sheet on every threat, hazard and site write anywhere in
	// the WORLD — a redraw no blur precedes.
	function hostWithSheet(encounters) {
		const { host, actor, updates } = makeHost(encounters);
		const root = fakeRoot();
		const el = makeEncounterEl(root, listOf(actor)[0]);
		Object.defineProperty(host, "element", { value: [root], configurable: true });
		return { host, actor, updates, root, el };
	}

	it("saves the encounter name being typed", async () => {
		const { host, actor, el } = hostWithSheet([{ id: "e1", name: "Crypt", entries: [] }]);
		el.name.value = "The crypt beneath Marshedge";
		el.name.focused = true;
		await host._flushGmEncounterEdits();
		expect(listOf(actor)[0].name).toBe("The crypt beneath Marshedge");
	});

	it("saves the entry note being typed", async () => {
		const { host, actor, el } = hostWithSheet([{ id: "e1", name: "C", entries: [
			{ id: "x1", uuid: "Actor.a", type: "Actor", name: "A", note: "" },
		] }]);
		el.rows.x1.note.value = "opens the door on round two";
		el.rows.x1.note.focused = true;
		await host._flushGmEncounterEdits();
		expect(listOf(actor)[0].entries[0].note).toBe("opens the door on round two");
	});

	// A row with no name is unreadable and cannot be told apart from a rendering fault; removing
	// an encounter is what the trash is for.
	it("declines to save an emptied name", async () => {
		const { host, actor, el } = hostWithSheet([{ id: "e1", name: "Crypt", entries: [] }]);
		el.name.value = "   ";
		el.name.focused = true;
		await host._flushGmEncounterEdits();
		expect(listOf(actor)[0].name).toBe("Crypt");
	});

	it("writes nothing when no field has focus, or when there is no sheet yet", async () => {
		const { host, updates } = hostWithSheet([{ id: "e1", name: "Crypt", entries: [] }]);
		await host._flushGmEncounterEdits();
		expect(updates).toEqual([]);
		const bare = makeHost([]).host;
		await expect(bare._flushGmEncounterEdits()).resolves.toBeUndefined();
	});
});

/* ══ the pencil ═══════════════════════════════════════════════════════════════ */

describe("the Encounters tab: what the edit pencil gates", () => {
	const one = () => [{ id: "e1", name: "Crypt", entries: [
		{ id: "x1", uuid: "Actor.a", type: "Actor", name: "A", note: "" },
	] }];

	// `_addGmPrepContext` and `_addGmWonderContext` publish into this same object, and whichever
	// ran last with an `=` would drop the others — permanently read-only sections, nothing logged.
	it("publishes an edit flag, and leaves the other tabs' flags where it finds them", async () => {
		const { host } = makeHost(one());
		const context = { stonetop: { edit: { threats: true, wonderOpen: false } } };
		await host._addGmEncountersContext(context);
		expect(context.stonetop.edit).toEqual({ threats: true, wonderOpen: false, encounters: true });
	});

	it("refuses to delete an encounter or an entry while the pencil is off", async () => {
		const { host, actor, updates } = makeHost(one(), { editing: false });
		const root = fakeRoot();
		host._activateGmEncountersListeners(root);
		const el = makeEncounterEl(root, listOf(actor)[0]);
		const asked = stubConfirm(true);
		await root.emit("click", el.rows.x1.remove);
		await root.emit("click", el.remove);
		expect(updates).toEqual([]);
		expect(asked).not.toHaveBeenCalled();
	});

	// The reason this tab exists is to be dropped into and noted on mid-session, and one that has
	// to be unlocked first is one nobody uses.
	it("still adds, renames, notes, marks used and collects while the pencil is off", async () => {
		const { host, actor } = makeHost(one(), { editing: false });
		const root = fakeRoot();
		host._activateGmEncountersListeners(root);
		const el = makeEncounterEl(root, listOf(actor)[0]);

		await root.emit("click", makeAddBar(root));
		expect(listOf(actor)).toHaveLength(2);

		el.name.value = "Renamed";
		await root.emit("change", el.name);
		expect(listOf(actor)[0].name).toBe("Renamed");

		el.rows.x1.note.value = "a note";
		await root.emit("change", el.rows.x1.note);
		expect(listOf(actor)[0].entries[0].note).toBe("a note");

		await root.emit("click", el.used);
		expect(listOf(actor)[0].used).toBe(true);

		globalThis.fromUuid = vi.fn(async () => ({ name: "Dropped" }));
		await host._onEncounterDrop({ type: "Item", uuid: "Item.i" }, el.rows.x1.open);
		expect(listOf(actor)[0].entries).toHaveLength(2);
	});
});

/* ══ expanding ════════════════════════════════════════════════════════════════ */

describe("the Encounters tab: expanding a row", () => {
	// A class toggle rather than a render: the body is in the DOM either way, so there is nothing
	// to fetch, and a render here is one that could land while a note box two rows down had focus.
	it("toggles the row in place without writing to the document", async () => {
		const { host, actor, updates } = makeHost([{ id: "e1", name: "C", entries: [] }]);
		const root = fakeRoot();
		host._activateGmEncountersListeners(root);
		const el = makeEncounterEl(root, listOf(actor)[0]);
		el.li.classes.push("is-collapsed");

		await root.emit("click", el.toggle);
		expect(el.li.classes).not.toContain("is-collapsed");
		expect(host._encounterOpen.has("e1")).toBe(true);
		expect(el.toggle.attrs["aria-expanded"]).toBe("true");
		// Set by hand, because nothing re-renders: the markup's own conditional never runs again.
		expect(el.toggle.attrs["aria-label"]).toBe("Hide what is in this encounter");

		await root.emit("click", el.toggle);
		expect(el.li.classes).toContain("is-collapsed");
		expect(host._encounterOpen.has("e1")).toBe(false);
		expect(updates).toEqual([]);
	});

	// The stash is what carries the caret over a render kicked off from inside Document.update:
	// focusing the node we already had would focus one that has been replaced.
	it("hands the caret to the new encounter's name box, once", async () => {
		const { host, actor } = makeHost([]);
		await host._addEncounter("New encounter");
		const root = fakeRoot();
		const el = makeEncounterEl(root, listOf(actor)[0]);
		host._restoreGmEncounterFocus(root);
		expect(el.name.focused).toBe(true);
		expect(el.name.selected).toBe(true);
		expect(host._encounterFocus).toBeNull();

		el.name.focused = false;
		host._restoreGmEncounterFocus(root);
		expect(el.name.focused).toBe(false);
	});
});

/* ══ completed ════════════════════════════════════════════════════════════════ */

// The tab's second list: what has been RUN, filed under the live one rather than deleted, with
// everything gathered into it still there.
//
// The failures worth guarding are the quiet ones. The split is made in JS off `used` and the card
// draws its one two-state button off the SAME flag, so the two can only disagree if someone gives
// the card a "which list am I in" parameter — which Handlebars would then also resolve against the
// encounter's own fields. And the flat array now renders as two lists, which is what makes an
// unguarded reorder move a card in storage and nowhere on screen.
describe("the Encounters tab: the Completed section", () => {
	const mixed = () => [
		{ id: "a", name: "Ford",  used: false, entries: [] },
		{ id: "b", name: "Crypt", used: true,  entries: [] },
		{ id: "c", name: "Camp",  used: false, entries: [] },
	];

	/** The context both lists are rendered from. */
	const contextOf = async host => {
		const context = { stonetop: {} };
		await host._addGmEncountersContext(context);
		return context.stonetop.encounters;
	};

	const namesIn = lane => lane.map(e => e.id);

	it("prints one card in both lists, from a partial that is registered", () => {
		expect(STONETOP_JS).toContain('"stonetop.gm-encounter-card"');
		expect(repoFileExists("templates/actor/partials/gm-encounter-card.hbs")).toBe(true);
		expect(TAB_MARKUP.match(/\{\{>\s*"stonetop\.gm-encounter-card"\}\}/g)).toHaveLength(2);
	});

	// Handlebars MERGES a partial's hash into the caller's context, so a `completed=true` passed
	// down here would ALSO be a bare lookup against the encounter view-model the `{{#each}}` is
	// standing on. The card reads the flag the split was made from instead, which is the one thing
	// that cannot drift from the list it was printed into.
	it("passes the card no parameters, so it can only read the encounter it is standing on", () => {
		expect(TAB_MARKUP).not.toMatch(/\{\{>\s*"stonetop\.gm-encounter-card"\s+\w/);
		expect(CARD_MARKUP).toMatch(/\{\{#if used\}\}fa-rotate-left\{\{else\}\}fa-check\{\{\/if\}\}/);
		expect(CARD_MARKUP).toMatch(/encounters\.markUnused[\s\S]*?encounters\.markUsed/);
	});

	it("splits the one stored list into the two the template prints, in stored order", async () => {
		const { host } = makeHost(mixed());
		const lanes = await contextOf(host);
		expect(namesIn(lanes.active)).toEqual(["a", "c"]);
		expect(namesIn(lanes.completed)).toEqual(["b"]);
	});

	it("says nothing about a Completed section until something has been run", async () => {
		const { host } = makeHost([{ id: "a", name: "Ford", used: false, entries: [] }]);
		expect((await contextOf(host)).completed).toEqual([]);
		expect(TAB_MARKUP).toMatch(/\{\{#if stonetop\.encounters\.completed\.length\}\}/);
	});

	// The tick is the whole feature: one click takes a card out of the live list and files it
	// below, and one click brings it back.
	it("sends a card below on the tick and lifts it back on the arrow", async () => {
		const { host, actor } = makeHost(mixed());
		const root = fakeRoot();
		host._activateGmEncountersListeners(root);
		const el = makeEncounterEl(root, listOf(actor)[0]);

		await root.emit("click", el.used);
		let lanes = await contextOf(host);
		expect(namesIn(lanes.active)).toEqual(["c"]);
		expect(namesIn(lanes.completed)).toEqual(["a", "b"]);

		await host._setEncounterUsed("a", false);
		lanes = await contextOf(host);
		expect(namesIn(lanes.active)).toEqual(["a", "c"]);
	});

	// The card moves between two lists, which is a thing only a repaint can do — so this write
	// leaves core's own default alone, where the two text writes beside it pass `render: false`.
	// That split is the header of the file, and it is why the tick is the one control here that
	// can be seen to work.
	it("renders for the move, unlike the writes that only change prose", async () => {
		const { host, updates } = makeHost(mixed());
		await host._setEncounterUsed("a", true);
		await host._setEncounterField("a", "name", "Ford at dusk");
		expect(updates.map(([, o]) => o.render)).toEqual([undefined, false]);
	});

	// Eight expanded cards standing in the fold make a quiet record into the longest thing on the
	// page. Lifting one back does NOT re-open it: the GM asked for it on the list, not for its
	// twelve collected rows in their face.
	it("shuts a card as it is filed, and leaves it shut when it comes back", async () => {
		const { host } = makeHost(mixed());
		host._encounterOpen.add("a");
		await host._setEncounterUsed("a", true);
		expect(host._encounterOpen.has("a")).toBe(false);
		await host._setEncounterUsed("a", false);
		expect(host._encounterOpen.has("a")).toBe(false);
	});

	// The two lists are one flat array with the completed ones interleaved wherever they sit, so
	// `from + delta` stepped over a neighbour from the OTHER list: the card moved in storage and
	// nowhere on screen, and the GM pressed alt+Down to no effect at all.
	it("nudges a card past its own list's neighbour, not the array's", async () => {
		const { host, actor } = makeHost(mixed());
		await host._nudgeEncounter("a", 1);
		expect(listOf(actor).filter(e => !e.used).map(e => e.id)).toEqual(["c", "a"]);
		await host._nudgeEncounter("a", -1);
		expect(listOf(actor).filter(e => !e.used).map(e => e.id)).toEqual(["a", "c"]);
	});

	it("clamps a nudge at the end of its own list rather than crossing into the other", async () => {
		const { host, actor, updates } = makeHost(mixed());
		await host._nudgeEncounter("c", 1);        // last of the live list, with "b" below it
		await host._nudgeEncounter("b", -1);       // the only completed one
		expect(updates).toEqual([]);
		expect(listOf(actor).map(e => e.used)).toEqual([false, true, false]);
	});

	// Dropping a card from the fold onto one still to come is the same act as pressing its arrow,
	// and the only reading it can have. Without this the array moved and the card re-rendered
	// straight back into the fold it was dragged out of, with nothing logged.
	it("completes or reopens a card dragged across the boundary", async () => {
		const { host, actor } = makeHost(mixed());
		await host._reorderEncounter("b", "a");                 // out of the fold, above "Ford"
		expect(listOf(actor).map(e => e.id)).toEqual(["b", "a", "c"]);
		expect(listOf(actor)[0].used).toBe(false);

		await host._reorderEncounter("b", null);                // empty tab space: lane unchanged
		expect(listOf(actor).find(e => e.id === "b").used).toBe(false);
	});

	// The neighbour's own flag, not the DOM: it is exactly what the context split the lists by, so
	// there is nothing to keep in step.
	it("files a live card that is dropped onto a completed one", async () => {
		const { host, actor } = makeHost(mixed());
		await host._reorderEncounter("c", "b");
		expect(listOf(actor).find(e => e.id === "c").used).toBe(true);
	});

	// Completing is completing, whichever gesture did it: the drag has to shut the card the way
	// the tick does, or the same act leaves the fold tidy one way and eight cards deep the other.
	it("shuts a card dragged into the fold, exactly as the tick does", async () => {
		const { host } = makeHost(mixed());
		host._encounterOpen.add("c");
		await host._reorderEncounter("c", "b");
		expect(host._encounterOpen.has("c")).toBe(false);
	});

	// Lifting one back does NOT shut it — same as the arrow. The GM asked for the card on the
	// list, and whatever state it was in is the state it comes back in.
	it("leaves a card lifted back out of the fold as it found it", async () => {
		const { host } = makeHost(mixed());
		host._encounterOpen.add("b");
		await host._reorderEncounter("b", "a");
		expect(host._encounterOpen.has("b")).toBe(true);
	});

	// The order can be a no-op while the crossing is not, so the two are checked apart. A single
	// identity test on the array would have written nothing and left the card in the wrong list.
	it("still writes when only the lane changed, and not at all when neither did", async () => {
		const { host, updates } = makeHost([
			{ id: "a", name: "Ford",  used: true,  entries: [] },
			{ id: "b", name: "Crypt", used: false, entries: [] },
		]);
		await host._reorderEncounter("a", "b");   // already index 0; only the lane moves
		expect(updates).toHaveLength(1);
		await host._reorderEncounter("a", "b");   // now nothing at all is left to change
		expect(updates).toHaveLength(1);
	});

	// The fold hides the heading's FOLLOWING SIBLINGS up to the next heading, so the box around
	// the pair is load-bearing: without it the walk runs past the list and out of the tab, and a
	// SECOND heading inside it would stop the caret claiming at the first.
	it("folds as one section, with its heading and its list alone in the box", () => {
		const box = TAB_MARKUP.slice(TAB_MARKUP.indexOf('"stonetop-gm-encounters-completed"'));
		const end = box.indexOf("</div>");
		const inner = box.slice(0, end);
		expect(inner).toContain('collapse="gm-encounters-completed"');
		expect(inner.match(/\{\{>\s*"stonetop\.section-heading"/g)).toHaveLength(1);
		expect(inner).toContain("stonetop-gm-encounter-list--completed");
		// The heading partial's default stem, which is half of the sheet's HEADING_SELECTOR. A
		// section whose heading is not in it renders a caret that folds nothing.
		expect(SHEET_JS).toContain("stonetop-move-group-title");
	});

	it("names the section and both directions of its one button in the language file", () => {
		for (const key of ["completed", "emptyAllDone", "markUsed", "markUnused"]) {
			const full = `stonetop.gmToolkit.encounters.${key}`;
			expect(game.i18n.localize(full)).not.toBe(full);
		}
		expect(game.i18n.localize("stonetop.gmToolkit.encounters.completed")).toBe("Completed");
		// The heading's note is the COUNT now, so the old subtitle is gone from the file.
		const full = "stonetop.gmToolkit.encounters.completedNote";
		expect(game.i18n.localize(full)).toBe(full);
	});

	// AN EYEBROW, not a section title: capitals in the group lines' voice, the count in a pill as
	// the heading's note, and the hairline after it, while keeping the class the fold wiring
	// counts as a heading.
	it("heads the fold with an eyebrow and its count", () => {
		expect(TAB_MARKUP).toContain("note=stonetop.encounters.completed.length");
		expect(TAB_MARKUP).toContain('headingClass="stonetop-move-group-title stonetop-gm-fold-eyebrow"');
		const eyebrow = declarations(CSS, ".stonetop-move-group-title.stonetop-gm-fold-eyebrow");
		expect(eyebrow).toMatch(/text-transform:\s*uppercase/);
		expect(eyebrow).toMatch(/border:\s*0/);
		expect(declarations(CSS, ".stonetop-move-group-title.stonetop-gm-fold-eyebrow::after")).toMatch(/height:\s*1px/);
		expect(declarations(CSS, ".stonetop-gm-fold-eyebrow > .stonetop-section-note")).toMatch(/border-radius:\s*999px/);
	});

	// "Nothing gathered yet" is the wrong advice for a GM who has run everything they prepared:
	// what they most likely want is the card two inches below, not a drag from the sidebar.
	it("tells an emptied live list apart from an untouched one", () => {
		// Run everything: a quiet line pointing at the fold.
		expect(TAB_MARKUP).toMatch(/\{\{else if stonetop\.encounters\.completed\.length\}\}\s*<p class="stonetop-gm-encounter-empty">\{\{localize "stonetop\.gmToolkit\.encounters\.emptyAllDone"\}\}<\/p>/);
		// Never had anything: the centred empty state, with its own heading and the add button.
		expect(TAB_MARKUP).toMatch(/\{\{else\}\}\s*\{\{> "stonetop\.gm-prep-empty" view="encounters" kind="stonetop-gm-encounter"/);
	});

	// The pencil's `--reading` class sits on the <section> that wraps BOTH lists, so a delete
	// button in the fold is locked by the same one press. On the panel rather than on the live
	// list is the whole of that.
	it("locks the delete buttons in the fold with the same one pencil", () => {
		expect(TAB_MARKUP).toMatch(/<section class="sheet-tab stonetop-gm-encounters\{\{#unless stonetop\.edit\.encounters\}\} stonetop-gm-encounters--reading/);
		expect(CSS).toContain(".stonetop-gm-encounters--reading .stonetop-gm-encounter-remove");
	});

	// The tick's green must not carry over to the arrow that replaces it: it would be a button lit
	// in the colour of the state it undoes. Later in the file than the base hover, per the modifier
	// ordering, or a `--mod` rule that ties on specificity simply loses.
	// IN THE BODY, so it is reached only by opening the card it is about to file. In the head it
	// was a bare tick two pixels from a delete button, on every row of a shut column.
	it("keeps the two-state button out of the head, at the foot of the body", () => {
		const head = CARD_MARKUP.slice(
			CARD_MARKUP.indexOf("stonetop-gm-encounter-head"),
			CARD_MARKUP.indexOf("stonetop-gm-encounter-body"));
		expect(head).not.toContain("stonetop-gm-encounter-used");
		// The tools cluster is down to the one button that is about the encounter ITSELF rather
		// than about anything in it: throw it away.
		const tools = CARD_MARKUP.slice(CARD_MARKUP.indexOf("stonetop-gm-encounter-tools"));
		expect(tools.slice(0, tools.indexOf("</span>")).match(/<button/g)).toHaveLength(1);

		const body = CARD_MARKUP.slice(CARD_MARKUP.indexOf("stonetop-gm-encounter-body"));
		expect(body).toContain("stonetop-gm-encounter-used");
		// LAST in the body, under the dropzone: the strip above is where the gathering ends.
		expect(body.indexOf("stonetop-gm-encounter-used"))
			.toBeGreaterThan(body.indexOf("stonetop-gm-encounter-dropzone"));
	});

	// The body is emitted for every encounter and hidden by `.is-collapsed`, which is what makes
	// "only when expanded" a fact about the CSS rather than about the render.
	it("hides it with the rest of the body while the card is shut", () => {
		expect(CARD_MARKUP).toMatch(/class="stonetop-gm-encounter\{\{#if used\}\} is-used\{\{\/if\}\}\{\{#unless open\}\} is-collapsed/);
		expect(declarations(CSS, ".stonetop-gm-encounter.is-collapsed .stonetop-gm-encounter-body"))
			.toMatch(/display:\s*none/);
	});

	// In the head there was no room for a label and the glyph carried the whole meaning. At the
	// foot of a body there is room, and a button that says what it does needs no hover.
	it("wears its words now, in both directions, with the long form as the tooltip", () => {
		for (const key of ["markUsedShort", "markUnusedShort"]) {
			const full = `stonetop.gmToolkit.encounters.${key}`;
			expect(game.i18n.localize(full)).not.toBe(full);
			expect(CARD_MARKUP).toContain(full);
		}
		expect(game.i18n.localize("stonetop.gmToolkit.encounters.markUsedShort")).toBe("Mark complete");
		// Still one button read in either direction: one glyph, one tooltip, one label, each
		// turning on the same flag the two lists were split by.
		expect(CARD_MARKUP.match(/stonetop-gm-encounter-used/g)).toHaveLength(1);
	});

	// It is a labelled control in the card's body now, not one of the 22px squares on the head,
	// and it shares the notes button's shape rather than growing a second rule that can drift.
	it("takes the body button's shape and not the square tool's", () => {
		expect(CSS).not.toMatch(/\.stonetop-gm-encounter-tools > button,[\s\S]{0,200}\.stonetop-gm-encounter-used[,{]/);
		const shape = declarations(CSS, ".stonetop-gm-encounter-used");
		// A quiet outlined button of its own words, every bit of core's chrome stated away.
		expect(shape).toMatch(/width:\s*auto/);
		expect(shape).toMatch(/height:\s*auto/);
		expect(shape).toMatch(/border:\s*1px solid rgb\(var\(--st-ink-rgb\) \/ 0\.2\)/);
		expect(shape).toMatch(/background:\s*transparent/);
		expect(shape).toMatch(/box-shadow:\s*none/);
		expect(shape).not.toMatch(/margin-top:\s*auto/);
		// Green on hover, the tick's colour, because pressing it files the card as done.
		expect(declarations(CSS, ".stonetop-gm-encounter-used:hover")).toMatch(/color:\s*var\(--st-green-text\)/);
	});

	// The same foot on both cards: a hairline across the card and the actions at its right end.
	it("sets the button in the card's foot, right-aligned under a hairline", () => {
		expect(CARD_MARKUP).toMatch(/<div class="stonetop-gm-card-foot">\s*<button type="button" class="stonetop-gm-encounter-used"/);
		const foot = declarations(CSS, ".stonetop-gm-card-foot");
		expect(foot).toMatch(/justify-content:\s*flex-end/);
		expect(foot).toMatch(/border-top:\s*1px solid var\(--st-prep-card-line\)/);
	});

	it("gives the filed card's arrow the neutral hover, after the tick's green", () => {
		const undo = ".stonetop-gm-encounter.is-used .stonetop-gm-encounter-used:hover";
		expect(declarations(CSS, undo)).toMatch(/background:\s*var\(--st-slate-hover-bg\)/);
		expect(declarations(CSS, undo)).not.toMatch(/green/);
		expect(CSS.indexOf(undo)).toBeGreaterThan(CSS.indexOf(".stonetop-gm-encounter-used:hover"));
	});

	// No rule across the pane and no box: the eyebrow's own hairline is the boundary, and the cards
	// inside are already framed.
	it("marks the boundary with the eyebrow's hairline, not a rule or a box", () => {
		const box = declarations(CSS, ".stonetop-gm-encounters-completed");
		expect(box).not.toMatch(/border/);
		expect(box).toMatch(/padding-top:/);
	});

	// A FILED CARD: the green edge, its head at about three quarters ink, and a check where the
	// grip was until hovered (the grip stays the drag handle under it).
	it("marks a filed card with a green edge, quieter ink and a check in the grip's place", () => {
		expect(declarations(CSS, ".stonetop-gm-encounter.is-used")).toMatch(/--st-bundle-edge:\s*var\(--st-green-border\)/);
		expect(CSS).toMatch(/\.stonetop-gm-encounter\.is-used :is\(\.stonetop-gm-encounter-name[^)]*\)\s*\{[^}]*opacity:\s*0\.75/);
		expect(CARD_MARKUP).toMatch(/\{\{#if used\}\}<i class="fas fa-check stonetop-gm-encounter-done-mark" aria-hidden="true"><\/i>\{\{\/if\}\}/);
		expect(declarations(CSS, ".stonetop-gm-encounter-done-mark")).toMatch(/display:\s*none/);
	});
});

/* ══ deploy and fight ═════════════════════════════════════════════════════════ */

describe("the Encounters tab: deploy and fight", () => {
	const oneMonster = () => [{ id: "e1", name: "Crypt", entries: [
		{ id: "x1", uuid: "Actor.a", type: "Actor", name: "Rust-Hound", note: "" },
		{ id: "x2", uuid: "Actor.f", type: "Actor", name: "Hound", note: "" },
	] }];

	/** A canvas whose drops hand back real-looking tokens: a monster, then a follower. */
	function tokenCanvas({ returns = "tokens" } = {}) {
		const tokens = [];
		globalThis.canvas = {
			scene: { id: "scene1" },
			grid: { size: 100 },
			stage: { pivot: { x: 1000, y: 1000 } },
			dimensions: { rect: { contains: () => true } },
			tokens: {
				_onDropActorData: vi.fn(async (ev, data) => {
					if (returns !== "tokens") return false;
					const follower = data.uuid === "Actor.f";
					const token = {
						documentName: "Token",
						id: `t${tokens.length}`,
						actor: follower
							? { type: "npc", flags: { "stonetop-pwd": { followerOrigin: { ftype: "crew" } } } }
							: { type: "monster" },
						_source: { disposition: follower ? 1 : -1 },
					};
					tokens.push(token);
					return token;
				}),
			},
		};
		return tokens;
	}

	let savedGame;
	beforeEach(() => { savedGame = global.game; });
	afterEach(() => { global.game = savedGame; });

	it("answers with the tokens Deploy placed", async () => {
		const { host } = makeHost(oneMonster());
		tokenCanvas();
		globalThis.fromUuid = vi.fn(async uuid => ({ documentName: "Actor", uuid, name: uuid }));
		const result = await host._deployEncounter("e1");
		expect(result.placed.map(t => t.id)).toEqual(["t0", "t1"]);
		expect(result).toMatchObject({ missed: [], imported: 0, refused: null });
	});

	it("says which warning stopped it when it placed nothing", async () => {
		const { host } = makeHost(oneMonster());
		delete globalThis.canvas;
		expect(await host._deployEncounter("e1")).toMatchObject({ placed: [], refused: "noScene" });
	});

	it("starts a fight with exactly those tokens, the monster as a foe and the follower left as it is", async () => {
		const { host } = makeHost(oneMonster());
		tokenCanvas();
		globalThis.fromUuid = vi.fn(async uuid => ({ documentName: "Actor", uuid, name: uuid }));
		const openStart = vi.fn(async () => "opened");
		global.game = { ...global.game, stonetop: { fight: { openStart } } };
		expect(await deployAndFight(host._encounters, "e1")).toBe("opened");
		expect(openStart).toHaveBeenCalledWith({ preselect: ["t0", "t1"], preselectPcs: true, forceFoes: ["t0"] });
	});

	// A fight already going on this map used to send the press straight to "Add to the fight" with
	// nothing saying why, which read as a button that did nothing. Now it asks first.
	describe("with a fight already going on this map", () => {
		const running = () => ({
			id: "c1", scene: { id: "scene1" }, flags: { "stonetop-pwd": { fight: true } }, combatants: [],
			delete: vi.fn(async () => {}),
		});
		const setUp = fight => {
			const { host } = makeHost(oneMonster());
			const tokens = tokenCanvas();
			global.game = { ...global.game, combats: [fight], stonetop: { fight: { openStart: vi.fn(async () => "opened") } } };
			globalThis.fromUuid = vi.fn(async uuid => ({ documentName: "Actor", uuid, name: uuid }));
			return { host, tokens, openStart: global.game.stonetop.fight.openStart };
		};

		it("asks before placing anything, naming the encounter", async () => {
			const fight = running();
			const { host, tokens } = setUp(fight);
			const ask = vi.fn(async () => { expect(tokens).toHaveLength(0); return null; });
			await deployAndFight(host._encounters, "e1", { ask });
			expect(ask).toHaveBeenCalledWith("Crypt");
		});

		it("ends that fight and starts a new one when asked to", async () => {
			const fight = running();
			const { host, openStart } = setUp(fight);
			expect(await deployAndFight(host._encounters, "e1", { ask: async () => "end" })).toBe("opened");
			expect(fight.delete).toHaveBeenCalled();
			expect(openStart.mock.calls[0][0]).not.toHaveProperty("combat");
		});

		// Ending it used to come first, so a deploy that then found nothing to place had ended the
		// table's fight for nothing.
		it("leaves that fight alone when Deploy finds nothing to place", async () => {
			const fight = running();
			const { host, tokens, openStart } = setUp(fight);
			globalThis.fromUuid = vi.fn(async () => null);
			expect(await deployAndFight(host._encounters, "e1", { ask: async () => "end" })).toBeNull();
			expect(fight.delete).not.toHaveBeenCalled();
			expect(tokens).toHaveLength(0);
			expect(openStart).not.toHaveBeenCalled();
		});

		it("ends that fight before anything is placed, so the new one is laid out on a clear map", async () => {
			const fight = running();
			const { host, tokens } = setUp(fight);
			fight.delete = vi.fn(async () => { expect(tokens).toHaveLength(0); });
			await deployAndFight(host._encounters, "e1", { ask: async () => "end" });
			expect(fight.delete).toHaveBeenCalledTimes(1);
			expect(tokens).toHaveLength(2);
		});

		it("adds the encounter to that fight when asked to", async () => {
			const fight = running();
			const { host, openStart } = setUp(fight);
			await deployAndFight(host._encounters, "e1", { ask: async () => "add" });
			expect(fight.delete).not.toHaveBeenCalled();
			expect(openStart.mock.calls[0][0]).toMatchObject({ combat: fight, preselect: ["t0", "t1"] });
		});

		it("places nothing and opens nothing when the GM keeps things as they are", async () => {
			const fight = running();
			const { host, tokens, openStart } = setUp(fight);
			expect(await deployAndFight(host._encounters, "e1", { ask: async () => null })).toBeNull();
			expect(tokens).toHaveLength(0);
			expect(fight.delete).not.toHaveBeenCalled();
			expect(openStart).not.toHaveBeenCalled();
		});

		it("asks with buttons that say what they do, Enter on the one that changes nothing", () => {
			expect(TAB_JS).toMatch(/defaultKey:\s*"keep"/);
			const en = JSON.parse(read("languages/en.json")).stonetop.gmToolkit.encounters.fightRunning;
			expect(en.end).toMatch(/End/);
			expect(en.add).toMatch(/Add/);
			expect(en.body).toContain("{name}");
			// Ending moves the party (deploy-layout.js lines up anyone no longer in a fight), so the
			// question cannot borrow the Fight tab's End body, which says tokens stay where they are.
			expect(en.endBody).toContain("{name}");
			expect(en.endBody).not.toMatch(/stay where they are/i);
			expect(TAB_JS).toContain("fightRunning.endBody");
			expect(TAB_JS).not.toContain('"stonetop.fight.end.body"');
			// It ends the fight for every player: the destructive skin.
			expect(TAB_JS).toMatch(/key:\s*"end"[^\n]*className:\s*"stonetop-dialog-btn--danger"/);
		});
	});

	it("opens nothing when Deploy placed nothing", async () => {
		const { host } = makeHost(oneMonster());
		tokenCanvas({ returns: "nothing" });
		globalThis.fromUuid = vi.fn(async uuid => ({ documentName: "Actor", uuid, name: uuid }));
		const openStart = vi.fn();
		global.game = { ...global.game, stonetop: { fight: { openStart } } };
		expect(await deployAndFight(host._encounters, "e1")).toBeNull();
		expect(openStart).not.toHaveBeenCalled();
	});

	it("offers it only to a GM, and only with the Fight tab on", async () => {
		const { host } = makeHost(oneMonster());
		globalThis.fromUuidSync = vi.fn(() => ({ name: "Rust-Hound", documentName: "Actor" }));
		const canFight = async ({ on, gm }) => {
			global.game = {
				...savedGame,
				user: { isGM: gm, can: () => true },
				settings: { get: (scope, key) => (key === "fightTab" ? on : undefined) },
			};
			const context = { stonetop: {} };
			await host._addGmEncountersContext(context);
			return context.stonetop.encounters.active[0].groups.find(g => g.canDeploy)?.canFight;
		};
		expect(await canFight({ on: true, gm: true })).toBe(true);
		expect(await canFight({ on: false, gm: true })).toBe(false);
		expect(await canFight({ on: true, gm: false })).toBe(false);
	});

	it("draws the button after Deploy, at the end of the eyebrow, with words a screen reader says", () => {
		const head = CARD_MARKUP.slice(
			CARD_MARKUP.indexOf("stonetop-gm-entry-card-head"),
			CARD_MARKUP.indexOf("stonetop-gm-encounter-entries"));
		expect(head).toMatch(/\{\{#if canFight\}\}\s*<button type="button" class="stonetop-gm-encounter-fight"/);
		expect(head.indexOf("stonetop-gm-entry-card-count")).toBeLessThan(head.indexOf("stonetop-gm-encounter-deploy"));
		expect(head.indexOf("stonetop-gm-encounter-deploy")).toBeLessThan(head.indexOf("stonetop-gm-encounter-fight"));
		// Its accessible name is its visible label now ("Deploy & fight"); the long form is the tooltip.
		const fight = head.slice(head.indexOf('class="stonetop-gm-encounter-fight"'));
		const inner = fight.slice(0, fight.indexOf("</button>"));
		expect(inner).toContain('data-tooltip="{{localize "stonetop.gmToolkit.encounters.deployAndFight"}}"');
		expect(inner).toContain('{{localize "stonetop.gmToolkit.encounters.deployAndFightShort"}}');
		expect(inner).not.toContain("aria-label");
		// Core's own combat glyph, which the Fight tab wears (Font Awesome Pro).
		expect(inner).toContain('<i class="fas fa-swords" aria-hidden="true"></i>');
		expect(CARD_MARKUP.match(/class="stonetop-gm-encounter-deploy"/g)).toHaveLength(1);
		// The same pill as Deploy: one rule, so the pair cannot drift apart.
		expect(CSS).toMatch(/\.stonetop-gm-entry-card-head > \.stonetop-gm-encounter-deploy,\s*\.stonetop-gm-entry-card-head > \.stonetop-gm-encounter-fight\s*\{/);
	});
});
