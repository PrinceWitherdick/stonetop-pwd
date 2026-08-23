import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Handlebars from "handlebars";
import { readRepo as read, readCss, repoFileExists, declarations } from "../../fakes/css.js";
import { withGmPrepTabs } from "../../../module/actors/gmtoolkit/gm-prep-tabs.js";
import { SITE_CARD_GROUP_IDS } from "../../../module/sites/site-view.js";

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

	it("wires the moved listeners", () => {
		expect(SHEET_JS).toContain("this._activateGmPrepListeners(html[0])");
		// Still wired, but no longer for these two tabs — Encounters and Wonder are the sheet's
		// remaining pencils. Asserted here anyway because dropping the call would take those
		// with it, and this file is where the selector string is spelled.
		expect(SHEET_JS).toContain('this._wireSectionEditToggle(html, ".steading-section-edit-toggle")');
	});

	// The shared `section-edit-toggle` partial reads both of these, and the Encounters and
	// Wonder tabs still draw through it. Leave either undefined and no pencil appears anywhere
	// on the sheet.
	it("publishes what the shared edit-pencil partial reads", () => {
		expect(SHEET_JS).toMatch(/context\.stonetop\.canEdit\s*=/);
		expect(SHEET_JS).toMatch(/context\.stonetop\.editMode\s*=/);
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
		// The trash carries the per-kind hook alone. That used to be load-bearing — no shared
		// look-class meant no line on the readonly allow-list, which is how it was kept dead —
		// and is now just the handler hook, since nothing gates it but its confirm dialog.
		expect(TOOLS_HBS).toContain('class="{{kind}}-remove"');
		expect(TOOLS_HBS).not.toContain("data-readonly-gated");
		expect(TOOLS_HBS).not.toContain("stonetop-prep-remove-btn");
		expect(ADD_BAR_HBS).toContain('class="stonetop-prep-add-btn {{kind}}-add-btn"');
		// The scoping ancestors the handlers pair those with.
		expect(stripComments(PREP_JS)).toContain('scope: ".steading-threats"');
		expect(stripComments(PREP_JS)).toContain('scope: ".steading-sites"');
	});

	// NOTHING from these tabs is on the readonly allow-list any more, because nothing on them
	// can be read-only. Seven exemptions used to live there, one per control that writes nothing,
	// and the list kept growing because the gate was upside down — the threat-type disclosure
	// spent its whole life mouse-dead for want of an eighth line. A prep selector back in that
	// block would be a rule nothing matches, read by the next person as proof the gate survives.
	it("keeps the prep tabs off the readonly allow-list entirely", () => {
		for (const cls of ["stonetop-prep-edit-btn", "stonetop-prep-add-btn", "site-table-roll",
			"threat-collapse-btn", "threat-portent", "steading-threat-type-toggle"]) {
			expect(CSS, `${cls} is still exempted from a lock that no longer reaches it`)
				.not.toMatch(new RegExp(`\\.stonetop-readonly \\.${cls}\\b`));
		}
		expect(CSS).not.toMatch(/\.stonetop-readonly \.(threat|hazard|site)-(edit-open|remove)/);
		// And the positive gate that had exactly one user — the trash — went with it.
		expect(CSS).not.toContain("data-readonly-gated");
	});

	// NEITHER tab has a pencil, and so neither may gate anything on one. Both carried a
	// `steading-edit-section` box with `{{#unless stonetop.edit.<tab>}} stonetop-readonly{{/unless}}`
	// on it, and on both the only thing that lock reached was the trash: the card is written and
	// re-edited in a wizard, the site tables only roll, the doom ticks are a tracker. So the trash
	// was drawn beside a live pencil, gave no hover feedback and swallowed clicks.
	//
	// Every half is asserted, because any one of them alone is a bug: the class without the flag
	// is PERMANENTLY readonly (`{{#unless}}` on a missing key is always true), the flag without
	// the class is a pencil that toggles nothing visible, and the list surviving in the mixin is
	// how the flag comes back.
	it.each([["sites", () => SITES_HBS], ["threats", () => THREATS_HBS]])(
		"leaves the %s tab ungated, with no pencil and no readonly class", (tab, hbs) => {
			const markup = stripComments(hbs());
			expect(markup).toContain(`<div class="tab ${tab}" data-group="primary" data-tab="${tab}">`);
			expect(markup).not.toContain("stonetop-readonly");
			expect(markup).not.toContain("steading-edit-section");
			expect(markup).not.toContain("steading-section-toggle");
			expect(markup).not.toContain(`stonetop.edit.${tab}`);
		});

	it("keeps the section-edit machinery out of the prep mixin", () => {
		const prep = stripComments(PREP_JS);
		expect(prep).not.toContain("GM_PREP_EDIT_SECTIONS");
		expect(prep).not.toContain("isSectionEditable");
		// The handler's own half of the old gate. Deleting is guarded by the confirm dialog now.
		expect(prep).not.toContain("stonetop-readonly");
		expect(prep).toMatch(/_confirmDeletePrepPage\(page,/);
	});

	// ...and the trash actually LOOKS destructive on all three. This rule named threats and
	// hazards only, so a site's trash stayed the same ink as the pencil beside it under the
	// pointer -- the third time a per-kind list in this stylesheet quietly skipped the newest
	// kind. Keyed on the class SUFFIX now, which a fourth kind cannot fall off.
	it("reddens the trash on every prep card, without naming the kinds", () => {
		const rule = CSS.match(/\.stonetop \.threat-card-tools [^{}\n]*-remove[^{}\n]*:hover\s*\{([^}]*)\}/);
		expect(rule, "no hover rule for the prep trash").toBeTruthy();
		expect(rule[1]).toMatch(/color:/);
		expect(CSS).not.toMatch(/\.threat-card-tools \.(threat|hazard|site)-remove:hover/);
	});

	// The find that settled the argument. The threat-type reference (eight types, each opening
	// its own list of GM moves) is a <button>, so the blanket
	// `.stonetop-readonly button { pointer-events: none }` caught it, and it was never given an
	// allow-list line. Those disclosures would not open while the pencil was shut -- the default,
	// and the only state anyone consults a reference block in. It needs no exemption now because
	// there is no lock; the assertion is that the button is still there and the tab still can't
	// be locked, which the ungated test above pins from the other side.
	it("leaves the threat-type reference openable", () => {
		expect(THREATS_HBS).toContain('class="steading-threat-type-toggle"');
		expect(stripComments(THREATS_HBS)).not.toContain("stonetop-readonly");
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

// ── A site card's four folds ─────────────────────────────────────────────────────────────────
// A fully written-up site (the barrow, with a timeline, areas and tables) runs to a page, and the
// Sites tab tiles several of them abreast, so everything past the foundation is drawn inside one
// of four <details>. WHICH sections cluster into which fold is site-view.js's to say and is
// tested there; what this file is about is the parts only this tab has — the sections really are
// inside the folds, the tab draws them shut, and opening one both survives the next re-render and
// tells the height packer the card changed.
describe("a site card folds its body into four", () => {
	const CARD = stripComments(read("templates/journal/partials/site-card.hbs"));
	// Comments stripped from both: the partial's own header explains that it deliberately has no
	// aria-expanded, so read raw it would answer the assertion below on its own rationale.
	// Comments stripped from both: the partial's own header explains that it deliberately has no
	// aria-expanded, so read raw it would answer the assertion below on its own rationale.
	const FOLD = stripComments(read("templates/journal/partials/site-group.hbs"));

	it("leaves no written-up section outside a fold", () => {
		// Cut every fold out of the card. What is left is the head matter, which is meant to hold
		// no .site-block at all: a block outside the folds is one no fold can hide, and it would
		// look perfectly correct sitting there at full height.
		const outsideFolds = CARD.replace(
			/\{\{#> "stonetop\.site-group"[\s\S]*?\{\{\/"stonetop\.site-group"\}\}/g, "");
		expect(outsideFolds).not.toMatch(/site-block/);
		// ...and the folds really are the four the view-model builds, named and ordered the same.
		const ids = [...CARD.matchAll(/\{\{#> "stonetop\.site-group" group=groups\.([a-z]+)\}\}/g)].map(m => m[1]);
		expect(ids).toEqual([...SITE_CARD_GROUP_IDS]);
	});

	it("draws all four folds from the one registered partial", () => {
		expect(CARD.match(/\{\{#> "stonetop\.site-group"/g)).toHaveLength(SITE_CARD_GROUP_IDS.length);
		expect(STONETOP_JS).toContain("stonetop.site-group");
		expect(repoFileExists("templates/journal/partials/site-group.hbs")).toBe(true);
		// The <details> and its body live in the partial, so the card never writes either.
		expect(CARD).not.toMatch(/<details/);
		// And `data-group` is the group's OWN id rather than a name typed beside it, so the tab's
		// collapse bookkeeping cannot end up keyed to a different fold than the one it folded.
		expect(FOLD).toMatch(/data-group="\{\{group\.id\}\}"/);
		expect(CARD).not.toMatch(/data-group=/);
		// A <summary> announces its own open state, so an aria-expanded here would say it twice —
		// and out of step, the moment the browser toggles the fold without us.
		expect(FOLD).not.toMatch(/aria-expanded/);
	});

	// RENDERED, not read. The fold's body is a partial block, and a partial block invoked with
	// its own context renders in THAT context - so passing the group as the context instead of as
	// `group=` compiles fine, reads fine, and quietly renders every section inside the fold empty.
	// No assertion above can see that: the card's source still names all four sections.
	it("renders the card's sections INSIDE their folds, not into an empty body", () => {
		const hbs = Handlebars.create();
		const cardSrc = read("templates/journal/partials/site-card.hbs");
		hbs.registerPartial("stonetop.site-group", read("templates/journal/partials/site-group.hbs"));
		// The card's other partials are the head matter and are not what this is about; stubbed to
		// nothing, read off the card itself so a newly mounted one does not break this.
		for (const [, name] of cardSrc.matchAll(/\{\{#?>\s*"([^"]+)"/g)) {
			if (name !== "stonetop.site-group") hbs.registerPartial(name, "");
		}
		const html = hbs.compile(cardSrc)({
			name: "The Sunken Barrow",
			hasTimeline: true, timeline: [{ when: "Long ago", text: "It sank." }],
			hasDenizens: true, denizens: [{ name: "Crinwin" }],
			groups: Object.fromEntries(SITE_CARD_GROUP_IDS.map(id => [id,
				{ id, label: id, holds: ["Something"], show: true, open: true }])),
		});
		// Every fold the view-model showed is drawn...
		expect(html.match(/<details class="site-group"/g)).toHaveLength(SITE_CARD_GROUP_IDS.length);
		// ...and the body really carries the card's own sections, which is the half that broke.
		const body = html.slice(html.indexOf('site-group__body'));
		expect(body).toMatch(/site-block site-timeline/);
		expect(body).toMatch(/It sank\./);
		expect(html).toMatch(/site-block site-denizens/);
	});

	it("hides the folds along with the rest of the body on a collapsed card", () => {
		expect(declarations(CSS, ".stonetop .steading-prep-cards .threat-card.is-collapsed .site-group"))
			.toMatch(/display:\s*none/);
	});

	it("turns the caret and drops the what's-inside line once a fold is open", () => {
		expect(declarations(CSS, ".stonetop .site-group[open] > .site-group__summary .site-group__caret"))
			.toMatch(/transform:\s*rotate\(90deg\)/);
		expect(declarations(CSS, ".stonetop .site-group[open] > .site-group__summary .site-group__holds"))
			.toMatch(/display:\s*none/);
		// The browser's own disclosure marker is suppressed both ways it can be: ours is the
		// caret, and a second triangle beside it reads as a broken row.
		expect(declarations(CSS, ".stonetop .site-group__summary")).toMatch(/list-style:\s*none/);
		expect(declarations(CSS, ".stonetop .site-group__summary::-webkit-details-marker"))
			.toMatch(/display:\s*none/);
	});

	it("lets the fold's own hairline be the only one above the first block inside it", () => {
		const first = declarations(CSS, ".stonetop .site-group__body > .site-block:first-child");
		expect(first).toMatch(/border-top:\s*0/);
		expect(first).toMatch(/padding-top:\s*0/);
		// ...which is why the air under an OPEN fold's title row is the body's own padding and
		// not that first block's: the two would otherwise be the same declaration arguing.
		expect(declarations(CSS, ".stonetop .site-group__body")).toMatch(/padding-top:\s*0\.35rem/);
	});
});

describe("the Sites tab remembers which folds are open", () => {
	/** The mixin over a bare host: the fold state needs no steading and no Foundry. */
	const makeHost = () => new (withGmPrepTabs(class { render = vi.fn(); }))();
	const UUID = "Journal.sites1.JournalEntryPage.barrow";

	it("draws every fold shut until this GM opens one", () => {
		const host = makeHost();
		expect(host._isCardGroupOpen(UUID, "place")).toBe(false);
		host._setCardGroupOpen(UUID, "place", true);
		expect(host._isCardGroupOpen(UUID, "place")).toBe(true);
		// Per card AND per fold: opening the barrow's areas says nothing about any other.
		expect(host._isCardGroupOpen(UUID, "story")).toBe(false);
		expect(host._isCardGroupOpen("Journal.sites1.JournalEntryPage.other", "place")).toBe(false);
		host._setCardGroupOpen(UUID, "place", false);
		expect(host._isCardGroupOpen(UUID, "place")).toBe(false);
	});

	// The state is only worth keeping if the view-model is drawn from it. `_cardVMsFor` re-applies
	// the cheap chrome to a CACHED card on every render, and a fold has to be part of that pass:
	// without it, any prep write anywhere in the world re-draws every fold shut under the cursor
	// of a GM who is mid-read.
	it("re-applies the remembered state to a cached card on every render", async () => {
		const host = makeHost();
		host._setCardGroupOpen(UUID, "place", true);
		const page = { uuid: UUID, _stats: { modifiedTime: 1 } };
		const build = vi.fn(async () => ({
			isOwner: true,
			groups: { story: { id: "story", open: true }, place: { id: "place", open: true } },
		}));

		const [first] = await host._cardVMsFor("site", [page], build);
		expect(first.collapsed).toBe(true);          // the kind's own default, untouched by folds
		expect(first.groups.story.open).toBe(false);
		expect(first.groups.place.open).toBe(true);

		// Second render: the enriched prose comes off the cache, and the fold shut in the meantime
		// is drawn shut anyway.
		host._setCardGroupOpen(UUID, "place", false);
		const [second] = await host._cardVMsFor("site", [page], build);
		expect(build).toHaveBeenCalledTimes(1);
		expect(second.groups.place.open).toBe(false);
	});

	it("leaves a card with no folds alone", async () => {
		const host = makeHost();
		const [vm] = await host._cardVMsFor("threat", [{ uuid: "u", _stats: {} }], async () => ({ isOwner: true }));
		expect(vm.groups).toBeUndefined();
		expect(vm.collapsible).toBe(true);
	});

	it("listens for the toggle in the capture phase, since <details> does not bubble it", () => {
		const wiring = stripComments(PREP_JS).match(/addEventListener\("toggle"[\s\S]*?\}, true\);/);
		expect(wiring, "no capture-phase toggle listener").not.toBe(null);
		// Both halves of what this tab owes a fold: the packer balances columns by MEASURED
		// height, so a card that just changed height invalidates the packing, and the state has
		// to outlive the re-render.
		expect(wiring[0]).toMatch(/_gmPrepMasonry\?\.repack\(fold\.closest\(GM_PREP_GRID_SELECTOR\)\)/);
		expect(wiring[0]).toMatch(/_setCardGroupOpen/);
		// Guarded on our own class, so the sheet's other <details> don't repack a grid they are
		// not in.
		expect(wiring[0]).toMatch(/site-group/);
	});
});
