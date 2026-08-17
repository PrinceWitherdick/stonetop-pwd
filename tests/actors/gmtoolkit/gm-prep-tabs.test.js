import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readRepo as read, readCss, repoFileExists, declarations } from "../../fakes/css.js";
import { withGmPrepTabs } from "../../../module/actors/gmtoolkit/gm-prep-tabs.js";

// The Threats & Dangers and Sites tabs, moved off the steading sheet onto the GM Toolkit.
//
// The one that would hurt: the STORAGE did not move. A threat, hazard or site is a journal page
// filed under an entry whose id is a flag on the STEADING actor, so every store call has to be
// handed the steading. Passing the toolkit reads back an empty list and then mints a SECOND
// journal, stranding the world's real prep in the first one. Nothing throws, nothing warns, and
// a GM only finds out when their threats are gone. That is what most of this file is about.


const PREP_JS      = read("module/actors/gmtoolkit/gm-prep-tabs.js");
const SHEET_JS     = read("module/actors/gmtoolkit/StonetopGmToolkitSheet.js");
const STEADING_JS  = read("module/actors/steading/StonetopSteadingSheet.js");
const STEADING_HBS = read("templates/actor/steading.hbs");
const TOOLKIT_HBS  = read("templates/actor/gm-toolkit.hbs");
const THREATS_HBS  = read("templates/actor/partials/gm-toolkit-tab-threats.hbs");
const SITES_HBS    = read("templates/actor/partials/gm-toolkit-tab-sites.hbs");
// The three kind-agnostic partials both tabs render through, so the tool classes, the add bar
// and the no-steading sentence are each written once.
const TOOLS_HBS      = read("templates/actor/partials/gm-prep-card-tools.hbs");
const ADD_BAR_HBS    = read("templates/actor/partials/gm-prep-add-bar.hbs");
const NO_STEADING_HBS = read("templates/actor/partials/gm-prep-no-steading.hbs");
// The fourth bar the add-bar partial serves, and the only one that is not on this sheet.
const IMPROVEMENTS_HBS = read("templates/actor/partials/steading-tab-improvements.hbs");
const STONETOP_JS  = read("stonetop.js");
const CSS          = readCss();

const stripComments = src => src
	.replace(/\{\{!--[\s\S]*?--\}\}/g, "")
	.replace(/\/\*[\s\S]*?\*\//g, "")
	.replace(/\/\/[^\n]*/g, "");

describe("the prep tabs write through the STEADING, never the sheet's own actor", () => {
	const CODE = stripComments(PREP_JS);

	// Every store/dialog entry point that takes the actor whose prep this is.
	const STORE_CALLS = [
		"listThreatPages", "listHazardPages", "listSitePages",
		"createThreat", "createHazard", "createSite",
		"new CreateThreatDialog",
	];

	it.each(STORE_CALLS)("%s is never handed `this.actor`", (fn) => {
		const call = new RegExp(`${fn.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\(\\s*this\\.actor`);
		expect(CODE, `${fn} is being passed the toolkit, not the steading`).not.toMatch(call);
	});

	it("resolves the steading through one helper, so the rule lives in one place", () => {
		expect(CODE).toMatch(/_prepSteading\(\)\s*\{[^}]*getStonetopSteadingActor\(\)/);
		// Every read path goes through it.
		for (const fn of ["listThreatPages", "listHazardPages", "listSitePages"]) {
			expect(CODE).toMatch(new RegExp(`${fn}\\(steading\\)`));
		}
	});

	// A write with no steading would land in a journal minted from the wrong actor and named
	// after it. Better to say there is nowhere to file it.
	it("refuses to write anything when the world has no steading", () => {
		// Through the shared warner in utils/world.js, which owns the "not found" sentence, so
		// this tab and the sidebar's Create-Content picker say the same thing.
		expect(CODE).toMatch(/_requireSteading\(\)\s*\{[\s\S]*?getStonetopSteadingActorOrWarn\(/);
		for (const fn of ["_onCreateThreat", "_onCreateHazard", "_onCreateSite", "_onDropThreatSeed"]) {
			const body = CODE.match(new RegExp(`${fn}\\([^)]*\\)\\s*\\{([\\s\\S]*?)\\n\\t\\t\\}`))?.[1];
			expect(body, `${fn} not found`).toBeTruthy();
			expect(body, `${fn} writes without checking for a steading`).toMatch(/_requireSteading\(\)/);
		}
	});

	// The templates say so too, rather than drawing an empty grid with a dead add button. Both
	// reach the same shared partial through the `{{else}}` of their one `hasSteading` branch, so
	// the sentence is written once and neither tab can gain a body that draws without a steading.
	it("both tabs explain themselves when there is no steading", () => {
		for (const [name, hbs] of [["threats", THREATS_HBS], ["sites", SITES_HBS]]) {
			expect(hbs, name).toContain("{{#if stonetop.hasSteading}}");
			expect(hbs, name).toContain("{{else}}");
			expect(hbs, name).toContain('{{> "stonetop.gm-prep-no-steading"');
		}
		expect(NO_STEADING_HBS).toContain("has no Stonetop steading yet");
	});
});

describe("the steading really lost them", () => {
	// A move that only ADDS is a duplicate, and two sheets writing the same journal pages is
	// worse than either sheet owning them.
	it("has no threats or sites tab left in its template", () => {
		const hbs = stripComments(STEADING_HBS);
		expect(hbs).not.toContain('tab="threats"');
		expect(hbs).not.toContain('tab="sites"');
		expect(hbs).not.toContain("steading-tab-threats");
		expect(hbs).not.toContain("steading-tab-sites");
	});

	it("has no builders, listeners or handlers left in its sheet", () => {
		for (const symbol of [
			"_buildThreatsContext", "_buildSitesContext", "_activateThreatsListeners",
			"_onCreateThreat", "_onCreateHazard", "_onCreateSite", "_onDropThreatSeed",
			"canSeeThreats", "canSeeSites", "_cardCollapse", "_cardVMs",
		]) {
			expect(STEADING_JS, `${symbol} is still on the steading sheet`).not.toContain(symbol);
		}
	});

	it("no longer imports the threat, hazard or site modules", () => {
		for (const mod of ["threat-store", "threat-view", "threat-types", "create-threat-dialog",
			"threat-editor-dialog", "threat-seed-cards", "hazard-store", "hazard-view",
			"create-hazard-dialog", "site-store", "site-view", "gm-prep-page.js"]) {
			expect(STEADING_JS, `${mod} import survived`).not.toContain(mod);
		}
	});

	it("dropped both from its edit-section list", () => {
		const list = STEADING_JS.match(/const STEADING_EDIT_SECTIONS = \[([\s\S]*?)\];/)?.[1];
		expect(list).toBeTruthy();
		expect(stripComments(list)).not.toMatch(/"threats"|"sites"/);
	});

	it("left the old partials deleted, and the preload map agrees", () => {
		expect(repoFileExists("templates/actor/partials/steading-tab-threats.hbs")).toBe(false);
		expect(repoFileExists("templates/actor/partials/steading-tab-sites.hbs")).toBe(false);
		expect(STONETOP_JS).not.toContain("stonetop.steading-tab-threats");
		expect(STONETOP_JS).not.toContain("stonetop.steading-tab-sites");
	});

	it("no longer labels them as steading tabs", () => {
		const en = JSON.parse(read("languages/en.json"));
		expect(en.stonetop.steading.tabs.threats).toBeUndefined();
		expect(en.stonetop.steading.tabs.sites).toBeUndefined();
		expect(en.stonetop.gmToolkit.tabs.threats).toBe("Threats & Dangers");
		expect(en.stonetop.gmToolkit.tabs.sites).toBe("Sites");
	});
});

describe("the toolkit picked them up whole", () => {
	it("mounts both tabs and both rail buttons", () => {
		for (const tab of ["threats", "sites"]) {
			expect(TOOLKIT_HBS).toMatch(new RegExp(`tab-rail-item"\\s+tab="${tab}"`));
			expect(TOOLKIT_HBS).toContain(`{{> "stonetop.gm-toolkit-tab-${tab}"}}`);
			expect(STONETOP_JS).toContain(`"stonetop.gm-toolkit-tab-${tab}":`);
		}
	});

	// Both keys already had a glyph from when the steading carried them, and the icon table is
	// one flat unscoped list, so they follow the markup. Pin it: an unmapped data-tab paints a
	// solid block of currentColor where the glyph should be, and nothing is logged.
	it("both rail keys still map to a mask icon", () => {
		for (const [tab, icon] of [["threats", "hazard-sign"], ["sites", "site-mound"]]) {
			expect(CSS).toMatch(new RegExp(
				`\\.stonetop-tab-rail \\.item\\[data-tab="${tab}"\\]\\s*\\{\\s*--st-tab-icon:\\s*url\\('[^']*${icon}\\.svg'\\)`));
		}
	});

	// The steading's gutter came from `.steading-sheet .sheet-tab`, which this frame does not
	// match. Without a replacement the cards sit flush against the panel edge.
	//
	// The gutter reaches every panel through the bare `> .tab`, so there is no per-tab membership
	// left to assert — only that the rule stayed general. It used to be an `:is()` naming every
	// tab on the sheet while excluding none, which meant three separate test files each checking
	// that their own tab had been remembered. Declared once, none of them has anything to catch.
	it("gives every tab its own gutter, since the steading's no longer reaches", () => {
		expect(declarations(CSS, ".stonetop-gm-toolkit-sheet .sheet-body > .tab")).toMatch(/padding:/);
		expect(CSS).not.toMatch(/\.stonetop-gm-toolkit-sheet \.sheet-body > :is\([^)]*\)\s*\{[^}]*padding:/);
	});

	// The proximity and Hazards headings fold through the sheet's heading selector, which had
	// to learn the class the moved markup uses.
	it("folds the moved sections' headings too", () => {
		expect(SHEET_JS).toMatch(/HEADING_SELECTOR\s*=\s*"[^"]*\.steading-residents-heading/);
	});

	it("wires the moved listeners and the section pencil", () => {
		expect(SHEET_JS).toContain("this._activateGmPrepListeners(html[0])");
		expect(SHEET_JS).toContain('this._wireSectionEditToggle(html, ".steading-section-edit-toggle")');
	});

	// The shared `section-edit-toggle` partial hides every pencil while the GLOBAL wrench is on
	// and draws none at all unless `canEdit`. Leave either undefined and no pencil ever appears,
	// which locks the delete buttons out of reach.
	it("publishes what the shared edit-pencil partial reads", () => {
		expect(SHEET_JS).toMatch(/context\.stonetop\.canEdit\s*=/);
		expect(SHEET_JS).toMatch(/context\.stonetop\.editMode\s*=/);
		// The per-section flags are the mixin's own business — these two tabs are the only
		// sections carrying a pencil, so it publishes them rather than exporting its section
		// list for the host to iterate. A section missing from `stonetop.edit` renders
		// permanently read-only with no error, which is not a thing to leave to a caller.
		expect(PREP_JS).toMatch(/GM_PREP_EDIT_SECTIONS\.map/);
		expect(PREP_JS).toMatch(/st\.edit\s*=/);
	});

	// `steading-prep-cards` is the shared card chrome (the re-map from the standalone card's rem
	// sizes onto this sheet's --st-fs-* tokens) and `steading-threats` / `steading-sites` are the
	// scoping ancestors ~40 rules hang off. They are CSS hooks, kept deliberately: renaming them
	// means rewriting that block, and every rule that stopped matching would fail silently as an
	// oversized or unstyled card.
	it("keeps the class hooks the card CSS is written against", () => {
		expect(THREATS_HBS).toContain('class="sheet-tab steading-threats steading-prep-cards"');
		expect(SITES_HBS).toContain('class="sheet-tab steading-sites steading-prep-cards"');
		expect(CSS).toMatch(/\.stonetop \.steading-prep-cards \.threat-name\s*\{[^}]*font-size/);
	});

	// The handlers are scoped `.steading-threats .threat-add-btn` and friends, so the panel's
	// ancestor class and the tool classes have to agree with the mixin's `prepTools` table.
	//
	// The markup is now two kind-agnostic partials rather than three hand-copied blocks, so the
	// class WORDS are built from the `kind=` each tab passes. That is what makes this checkable
	// in one place: the partials below emit all three suffixes off `{{kind}}`, and each tab has
	// only to hand in the right kind.
	it.each([
		["threat", THREATS_HBS], ["hazard", THREATS_HBS], ["site", SITES_HBS],
	])("renders every %s tool the handler table listens for", (kind, hbs) => {
		expect(hbs, `card tools for ${kind}`).toContain(`{{> "stonetop.gm-prep-card-tools" kind="${kind}"`);
		expect(hbs, `add bar for ${kind}`).toContain(`{{> "stonetop.gm-prep-add-bar" kind="${kind}"`);
		expect(stripComments(PREP_JS)).toContain(`kind: "${kind}"`);
	});

	it("the shared prep partials emit every class word the handler table matches", () => {
		// Two classes: the shared LOOK/gate word, then the per-kind handler hook. Both on one
		// button. The pencil takes the same shape as the add bar below, so the readonly
		// allow-list keys on one class instead of naming every kind.
		expect(TOOLS_HBS).toContain('class="stonetop-prep-edit-btn {{kind}}-edit-open"');
		// The trash carries the per-kind hook ALONE, deliberately: no shared gate word is what
		// keeps it off the readonly allow-list and so dead while a section is only being read.
		expect(TOOLS_HBS).toContain('class="{{kind}}-remove"');
		expect(TOOLS_HBS).not.toContain("stonetop-prep-remove-btn");
		expect(ADD_BAR_HBS).toContain('class="stonetop-prep-add-btn {{kind}}-add-btn"');
		// The scoping ancestors the handlers pair those with.
		expect(stripComments(PREP_JS)).toContain('scope: ".steading-threats"');
		expect(stripComments(PREP_JS)).toContain('scope: ".steading-sites"');
	});

	// Every "add" button reads as one quiet affordance, and it is one class that says so, not a
	// list of kind names kept in the stylesheet. That list had already shipped once without
	// `.site-add-btn` on it, so the Sites tab drew a filled core button that read as the tab's
	// primary action, and nothing failed. With the class emitted by the shared partial there is
	// no per-kind list left to fall off.
	// Same argument, one control over: the pencil's "stays live outside edit mode" line was
	// itself a list of kind names in the stylesheet, so a fourth kind's pencil would have gone
	// dead with nothing to say so. It keys on the shared class now, and the TRASH still keys on
	// nothing at all, which is what keeps deleting gated.
	it("keeps every prep pencil live outside edit mode from one shared class", () => {
		expect(CSS).toMatch(/\.stonetop-readonly \.stonetop-prep-edit-btn\s*[,{]/);
		expect(CSS).not.toMatch(/\.stonetop-readonly \.(threat|hazard|site)-edit-open/);
		expect(CSS).not.toMatch(/\.stonetop-readonly \.(threat|hazard|site)-remove/);
	});

	it("draws every add bar from one shared dashed-entry class", () => {
		expect(CSS).toMatch(/\.stonetop-prep-add-btn\s*\{[^}]*border:\s*1px dashed/);
		// The `+` nudge and the hover wash are separate rules; the look is only complete with
		// all three, and a button with just the first draws dead-looking with an off-centre plus.
		expect(CSS).toMatch(/\.stonetop-prep-add-btn:hover\s*\{/);
		expect(CSS).toMatch(/\.stonetop-prep-add-btn > i\s*\{/);
	});

	// ...and the stylesheet no longer names the kinds at all, which is the part that kept
	// falling out of step with the templates.
	it("keeps the per-kind class words out of the add-bar styling", () => {
		for (const cls of ["threat-add-btn", "hazard-add-btn", "site-add-btn",
			"steading-improvement-add-btn"]) {
			expect(CSS, `${cls} is styled by name again`).not.toMatch(new RegExp(`\\.${cls}[\\s,:>]`));
		}
	});

	// One partial serves all four bars, so a new prep kind inherits the look by construction.
	it("routes every add bar through the one partial", () => {
		for (const [hbs, kind] of [[THREATS_HBS, "threat"], [THREATS_HBS, "hazard"],
			[SITES_HBS, "site"], [IMPROVEMENTS_HBS, "steading-improvement"]]) {
			expect(hbs, `${kind} add bar`).toContain(`{{> "stonetop.gm-prep-add-bar" kind="${kind}"`);
		}
	});
});

// ── The tabs watch their own documents ────────────────────────────────────────
// These cards are JournalEntryPages, and a sheet is not told about documents it does not own.
// Before this, every path that wrote prep had to remember to nudge the sheet by hand, and the
// ones that didn't (a macro, a second GM at the table, an edit made in the journal sidebar)
// left the tab stale and looking perfectly correct. That is the failure this section pins: it
// is silent, which is what makes it worth testing rather than eyeballing.
describe("the prep tabs re-render when their pages change", () => {
	let hooks, saved;

	// A Hooks fake that records registrations and can fire them. The shared setup's stub is
	// inert (its `on` returns undefined), so nothing could be fired or unregistered through it.
	function fakeHooks() {
		const registered = new Map();
		let nextId = 0;
		return {
			registered,
			on: vi.fn((event, fn) => {
				const id = nextId++;
				registered.set(id, { event, fn });
				return id;
			}),
			off: vi.fn((event, id) => { registered.delete(id); }),
			fire: (event, doc) => {
				for (const entry of [...registered.values()]) if (entry.event === event) entry.fn(doc);
			},
		};
	}

	/** The mixin over a stand-in host, with a steading whose three prep entries are known. */
	function makeHost({ rendered = true } = {}) {
		const steading = {
			id: "steading1",
			type: "stonetop",
			flags: { stonetop: { steading: {
				threatsEntryId: "threats1", hazardsEntryId: "hazards1", sitesEntryId: "sites1",
			} } },
		};
		globalThis.game = { ...globalThis.game, actors: [steading], user: { isGM: true } };
		const Base = class {
			rendered = rendered;
			render = vi.fn();
		};
		return new (withGmPrepTabs(Base))();
	}

	const pageIn = (entryId, over = {}) => ({ type: "threat", uuid: "u", parent: { id: entryId }, ...over });

	beforeEach(() => {
		saved = { Hooks: globalThis.Hooks, game: globalThis.game };
		hooks = fakeHooks();
		globalThis.Hooks = hooks;
		// The re-render is debounced, so every assertion about it has to run the clock.
		vi.useFakeTimers();
	});
	afterEach(() => {
		vi.useRealTimers();
		globalThis.Hooks = saved.Hooks;
		globalThis.game = saved.game;
	});

	/** Let the debounced re-render fall due. */
	const settle = () => vi.advanceTimersByTime(250);

	it("watches creation, change and deletion, not just one of the three", () => {
		makeHost()._wirePrepPageSync();
		const events = [...hooks.registered.values()].map(e => e.event).sort();
		expect(events).toEqual([
			"createJournalEntryPage", "deleteJournalEntryPage", "updateJournalEntryPage",
		]);
	});

	it("re-renders for a page in any of the three prep entries", () => {
		const host = makeHost();
		host._wirePrepPageSync();
		for (const entryId of ["threats1", "hazards1", "sites1"]) {
			host.render.mockClear();
			hooks.fire("updateJournalEntryPage", pageIn(entryId));
			settle();
			expect(host.render, entryId).toHaveBeenCalledWith(false);
		}
	});

	// The commonest write through here is a doom-track tick, which the browser has already
	// painted. Walking a threat's three grim portents plus its impending doom must not be four
	// rebuilds of all four tabs — each one a steading lookup, three page-list walks and a
	// re-enrich of the changed card.
	it("coalesces a burst of page writes into one re-render", () => {
		const host = makeHost();
		host._wirePrepPageSync();
		for (let i = 0; i < 4; i++) hooks.fire("updateJournalEntryPage", pageIn("threats1"));
		expect(host.render, "re-rendered before the debounce fell due").not.toHaveBeenCalled();
		settle();
		expect(host.render).toHaveBeenCalledTimes(1);
	});

	// Every JournalEntryPage write in the world reaches this handler, so an unfiltered one would
	// re-render the toolkit on every edit to any journal in the game. That render is a walk of
	// async enrichHTML round trips per card, so it is not a cheap mistake.
	it("ignores pages belonging to some other journal", () => {
		const host = makeHost();
		host._wirePrepPageSync();
		hooks.fire("updateJournalEntryPage", pageIn("some-lore-entry"));
		hooks.fire("updateJournalEntryPage", { type: "site", uuid: "u" }); // no parent at all
		settle();
		expect(host.render).not.toHaveBeenCalled();
	});

	// The type test has to come FIRST. Resolving the entry ids means resolving the steading,
	// which is an unindexed scan of game.actors — and this handler sees every page write in the
	// world, including every saved edit to every gazetteer, lore and bestiary page.
	it("rules out a page by type before going looking for the steading", () => {
		const host = makeHost();
		const scanned = vi.fn(() => []);
		Object.defineProperty(globalThis.game, "actors", { get: scanned, configurable: true });
		host._wirePrepPageSync();
		hooks.fire("updateJournalEntryPage", { type: "text", uuid: "u", parent: { id: "lore1" } });
		settle();
		expect(scanned, "resolved the steading for a page that could never be ours").not.toHaveBeenCalled();
		expect(host.render).not.toHaveBeenCalled();
	});

	it("stays quiet while the sheet is closed", () => {
		const host = makeHost({ rendered: false });
		host._wirePrepPageSync();
		hooks.fire("updateJournalEntryPage", pageIn("threats1"));
		settle();
		expect(host.render).not.toHaveBeenCalled();
	});

	// A site is a page-long write-up, so that kind opens COLLAPSED by default. One you have just
	// written is the exception, and this is the only place that can say so for BOTH creation
	// paths, since the sidebar's Create-Content picker has no sheet to say it on.
	it("opens a card you just wrote, whichever surface wrote it", () => {
		const host = makeHost();
		const uuid = "Journal.sites1.JournalEntryPage.new";
		host._wirePrepPageSync();
		expect(host._isCardCollapsed("site", uuid)).toBe(true);
		hooks.fire("createJournalEntryPage", pageIn("sites1", { type: "site", uuid }));
		expect(host._isCardCollapsed("site", uuid)).toBe(false);
	});

	it("registers once however many times it is rendered, and lets go on close", () => {
		const host = makeHost();
		host._wirePrepPageSync();
		host._wirePrepPageSync();
		host._wirePrepPageSync();
		expect(hooks.registered.size).toBe(3);
		host._unwirePrepPageSync();
		expect(hooks.registered.size).toBe(0);
		// ...and a second call is harmless, so closing a sheet that never rendered is fine.
		expect(() => host._unwirePrepPageSync()).not.toThrow();
	});

	// Foundry's Hooks.on can legitimately return 0. A truthiness check would read that
	// registration as absent: re-registering on every render, unregistering only one of them.
	it("treats a hook id of 0 as a real registration", () => {
		const host = makeHost();
		host._wirePrepPageSync();
		expect([...hooks.registered.keys()]).toContain(0);
		host._unwirePrepPageSync();
		expect(hooks.off).toHaveBeenCalledWith("createJournalEntryPage", 0);
	});
});
