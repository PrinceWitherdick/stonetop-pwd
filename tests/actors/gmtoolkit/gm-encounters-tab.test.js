import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readRepo as read, readCss, repoFileExists, declarations } from "../../fakes/css.js";
import {
	withGmEncountersTab,
	resolveEncounterEntry,
	normalizeEncounter,
	normalizeEntry,
	moveWithin,
	insertionIndexIn,
	ENCOUNTER_DOC_TYPES,
	STONETOP_ENCOUNTER_DRAG_TYPE,
} from "../../../module/actors/gmtoolkit/gm-encounters-tab.js";
import { clusterPoint } from "../../../module/utils/token-drop.js";
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
const TAB_HBS     = read("templates/actor/partials/gm-toolkit-tab-encounters.hbs");
const SHEET_JS    = read("module/actors/gmtoolkit/StonetopGmToolkitSheet.js");
const MODEL_JS    = read("module/data-models/GmToolkitModel.js");
const FIELDS_JS   = read("module/data-models/fields.js");

/** Markup with the Handlebars comments stripped, so prose cannot answer for the template. */
const TAB_MARKUP = TAB_HBS.replace(/\{\{!--[\s\S]*?--\}\}/g, "");

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
});

/* ══ wiring ═══════════════════════════════════════════════════════════════════ */

describe("the Encounters tab: wiring", () => {
	// Each of these is a silent failure on its own, exactly as for the tabs beside it.
	it("is registered, mounted, and has a rail button", () => {
		expect(STONETOP_JS).toContain('"stonetop.gm-toolkit-tab-encounters"');
		expect(SHEET_HBS).toContain('{{> "stonetop.gm-toolkit-tab-encounters"}}');
		expect(SHEET_HBS).toMatch(/\{\{>\s*"stonetop\.tab-rail-item"\s+tab="encounters"/);
	});

	it("binds to the same tab group as the rest of the sheet", () => {
		expect(TAB_HBS).toMatch(/<div class="tab encounters\b[^"]*"[^>]*data-group="primary"/);
		expect(TAB_HBS).toContain('data-tab="encounters"');
	});

	// The user asked for it beside the other prep tabs. The rail's order is the source order of
	// these partial calls, and the body's is a second list that has to agree: a mismatch is
	// invisible, because the panels are shown one at a time.
	it("sits between Sites and I Wonder, in the rail and in the body", () => {
		const order = ["homefront", "moves", "threats", "sites", "encounters", "wonder", "loop"];
		expect([...SHEET_HBS.matchAll(/tab-rail-item"\s+tab="(\w+)"/g)].map(m => m[1])).toEqual(order);
		expect([...SHEET_HBS.matchAll(/\{\{>\s*"stonetop\.gm-toolkit-tab-(\w+)"\}\}/g)].map(m => m[1])).toEqual(order);
	});

	// A data-tab with no row in the icon table gets a mask with no image, which resolves to FULL
	// coverage: a solid block where the glyph belongs, and nothing logged.
	it("earns a rail glyph from the icon table, and the file it names exists", () => {
		expect(CSS).toMatch(/\.stonetop-tab-rail \.item\[data-tab="encounters"\]\s*\{\s*--st-tab-icon:/);
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

	it("gets its panel gutter from the shared tab-padding rule", () => {
		expect(declarations(CSS, ".stonetop-gm-toolkit-sheet .sheet-body > .tab")).toMatch(/padding:/);
	});

	// The pencil is `position: absolute` against its section, and this panel only BECOMES that
	// section's containing block by joining the shared `:is()`. Left out, the pencil floats
	// against whatever positioned ancestor is next up the frame, with nothing logged.
	it("is the positioning context its corner pencil floats in", () => {
		expect(CSS).toMatch(/\.sheet-body > :is\(\.tab\.threats, \.tab\.sites, \.tab\.encounters\)\s*\{\s*position: relative/);
		expect(TAB_HBS).toContain('class="tab encounters steading-edit-section"');
	});

	// Every field here is written by hand to `system.encounters`. A `name` on any of them would
	// put it in core's form submit data, where the array indices expand into an OBJECT keyed "0",
	// "1", ... and replace the list with it — no error, and the list is gone.
	it("gives no form field a name, so the sheet's submit cannot rewrite the list", () => {
		expect(TAB_MARKUP).not.toMatch(/<(?:input|textarea|prose-mirror)[^>]*\sname=/);
	});

	// The sheet declares no drop targets of its own on purpose (ActorSheet's default entry would
	// make the whole window a silent Item drop target), so this tab wires raw listeners instead.
	it("leaves the sheet's dragDrop empty, so core still attaches nothing of its own", () => {
		expect(SHEET_JS).toMatch(/dragDrop:\s*\[\]/);
	});

	// In Chromium a `draggable` ancestor takes the mousedown from every input inside it, so a
	// draggable row would leave its own note box impossible to put a caret in.
	it("puts the drag handle on the name control, not on the row that holds the note box", () => {
		expect(TAB_MARKUP).toMatch(/<button[^>]*stonetop-gm-encounter-entry-open[^>]*draggable=/);
		expect(TAB_MARKUP).not.toMatch(/<li[^>]*stonetop-gm-encounter-entry[^>]*draggable=/);
	});

	// `_wireSectionCollapse` binds a CAPTURE-phase click on this class and folds by walking
	// heading siblings, so a per-row caret wearing it would be swallowed and fold the wrong run.
	it("keeps its per-row expander off the shared section-collapse class", () => {
		expect(TAB_MARKUP).not.toContain("stonetop-section-collapse");
		expect(TAB_MARKUP).toContain("stonetop-gm-encounter-toggle");
	});

	// There is no <img> on this tab, so the `draggable="false"` opt-out every portrait in the
	// system carries has nothing to apply to. Pinned so that adding one without it is a failure
	// rather than a Gecko drag that hands over the image instead of the document.
	it("has no portrait, which is why nothing here carries the image drag opt-out", () => {
		expect(TAB_MARKUP).not.toMatch(/<img/);
	});

	it("is composed into the sheet, and flushed before every paint and every close", () => {
		expect(SHEET_JS).toMatch(/withGmEncountersTab\(withGmWonderTab\(/);
		expect(SHEET_JS).toContain("await this._addGmEncountersContext(context);");
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
		const field = FIELDS_JS.slice(FIELDS_JS.indexOf("export const encountersField"));
		const body = field.slice(0, field.indexOf("simpleMoveSchema"));
		expect(body.match(/trim: false/g)?.length).toBe(3);
	});

	// The uuid, plus the two things that stay useful once it resolves to nothing. An `img` would
	// be a cached field with no reader: the only row that needs one is the broken row, and that
	// shows its type icon instead.
	it("stores the type and the name of an entry, and no img", () => {
		const field = FIELDS_JS.slice(FIELDS_JS.indexOf("export const encountersField"));
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

	// The keyboard half of the reorder, so a list can still be arranged without a mouse.
	it("nudges an encounter and an entry with alt and the arrow keys", async () => {
		const { host, actor } = makeHost(withEntries());
		await host._nudgeEncounter("e2", -1);
		expect(ids(actor)).toEqual(["e2", "e1"]);
		await host._nudgeEntry("e1", "x1", 1);
		expect(listOf(actor).find(e => e.id === "e1").entries.map(e => e.id)).toEqual(["x2", "x1", "x3"]);
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
		expect(context.stonetop.encounters[0].entries.map(e => e.id)).toEqual(["x1", "x2"]);
		expect(context.stonetop.encounters[0].entries[0].unresolved).toBe(true);
		expect(context.stonetop.encounters[0].entries[1].unresolved).toBe(false);
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
		expect(context.stonetop.encounters[0]).toMatchObject({ entryCount: 2 });
	});
});

/* ══ notes, used, delete ══════════════════════════════════════════════════════ */

describe("the Encounters tab: notes, used and delete", () => {
	const one = () => [{ id: "e1", name: "Crypt", notes: "", used: false, entries: [
		{ id: "x1", uuid: "Actor.a", type: "Actor", name: "Rust-Hound", note: "" },
	] }];

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
		let content = "";
		global.Dialog = { confirm: vi.fn(async opts => { content = opts.content; return true; }) };
		await host._onEncounterRemove("e1");
		expect(content).toContain("&lt;b&gt;Crypt&lt;/b&gt;");
		expect(listOf(actor)).toEqual([]);
	});

	it("keeps the encounter when the confirm is declined", async () => {
		const { host, actor } = makeHost([{ id: "e1", name: "Crypt", entries: [] }]);
		global.Dialog = { confirm: vi.fn(async () => false) };
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

	// A block one grid square apart, centred on the view: a deploy is something you do to the bit
	// of map in front of you.
	it("clusters the tokens on distinct points around the view centre", async () => {
		const { host } = makeHost([{ id: "e1", name: "C", entries: [1, 2, 3, 4].map(n => (
			{ id: `x${n}`, uuid: "Actor.a", type: "Actor", name: "A", note: "" }
		)) }]);
		const placed = fakeCanvas();
		globalThis.fromUuid = vi.fn(async () => ({ documentName: "Actor", uuid: "Actor.a", name: "A" }));
		await host._deployEncounter("e1");
		const points = placed.map(p => `${p.x},${p.y}`);
		expect(new Set(points).size).toBe(4);
		// Centred: the mean of a symmetric block is the pivot it was built around.
		expect(placed.reduce((s, p) => s + p.x, 0) / 4).toBe(1000);
		expect(placed.reduce((s, p) => s + p.y, 0) / 4).toBe(1000);
	});

	// Core returns FALSE for a point outside the scene rect and places nothing, silently.
	it("counts a point outside the scene rect as skipped rather than placed", () => {
		globalThis.canvas = {
			grid: { size: 100 }, stage: { pivot: { x: 0, y: 0 } },
			dimensions: { rect: { contains: () => false } },
		};
		expect(clusterPoint(globalThis.canvas, 0, 1)).toBeNull();
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
		global.Dialog = { confirm: vi.fn(async () => true) };
		await root.emit("click", el.rows.x1.remove);
		await root.emit("click", el.remove);
		expect(updates).toEqual([]);
		expect(global.Dialog.confirm).not.toHaveBeenCalled();
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
