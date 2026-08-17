// The GM Toolkit's two prep tabs: Threats & Dangers, and Sites.
//
// These lived on the STEADING sheet until they moved here. The steading is the village the
// players share; a threat and a site are the GM's own prep, written for one pair of eyes, so
// they belong on the GM's own sheet beside the GM moves. Both tabs are GM-only, which the
// toolkit already is by ownership.
//
// ⚠ THE ONE THING TO GET RIGHT: the STORAGE did not move, and must not.
//
// A threat, hazard or site is a JournalEntryPage inside a hidden per-steading JournalEntry, and
// the pointer to that entry is a flag on the STEADING actor
// (`flags.<scope>.steading.{threatsEntryId,hazardsEntryId,sitesEntryId}` — see
// module/journal/gm-prep-page-store.js). Every store function therefore takes the STEADING, not
// "the actor whose sheet you are looking at". Passing `this.actor` from here is the silent
// data-loss path: `resolvedFlagProperty(toolkit, "steading")` is undefined, so `listThreatPages`
// returns [] and the tab renders empty, and the next "write up a threat" calls `ensureEntry`,
// which mints a SECOND journal named "GM Toolkit Threats" and strands the world's real prep in
// the first one. Nothing errors. That is why every call below goes through `_prepSteading()` and
// why the tabs say so out loud when there is no steading yet.
//
// Storage staying on the steading is also correct on its own terms: a world has one set of
// threats whoever is running it, and a second GM opening their own toolkit sees the same prep.
import { listThreatPages, createThreat } from "../../threats/threat-store.js";
import { buildThreatCardVM, wireThreatDoomChange, wireThreatCardDrag } from "../../threats/threat-view.js";
import { THREAT_PROXIMITIES, THREAT_TYPES } from "../../threats/threat-types.js";
import { threatGuidanceSections } from "../../threats/threat-guidance.js";
import { CreateThreatDialog } from "../../threats/create-threat-dialog.js";
import { ThreatEditorDialog } from "../../threats/threat-editor-dialog.js";
import { STONETOP_THREAT_SEED_DRAG_TYPE } from "../../threats/threat-seed-cards.js";
import { listHazardPages, createHazard } from "../../hazards/hazard-store.js";
import { buildHazardCardVM } from "../../hazards/hazard-view.js";
import { CreateHazardDialog } from "../../hazards/create-hazard-dialog.js";
import { listSitePages } from "../../sites/site-store.js";
import { openSiteWizard, createSiteFlow } from "./gm-prep-actions.js";
import { buildSiteCardVM } from "../../sites/site-view.js";
import {
	wireGmPrepCardExtras, gmPrepEntryIds, deleteGmPrepPage, GM_PREP_KIND_IDS,
	gmPrepKindNoun, gmPrepStartsCollapsed,
} from "../../journal/gm-prep-page.js";
import { getStonetopSteadingActor, getStonetopSteadingActorOrWarn } from "../../utils/world.js";
import { wireCardDropZone } from "../../utils/card-drop-zone.js";
import { escHtml } from "../../utils/strings.js";
import { localize, format } from "../../utils/i18n.js";
import { localizedOnce } from "../../utils/localized-once.js";
import { toggleDisclosure } from "../../utils/disclosure.js";

/** Sections on these tabs that carry their own edit pencil. Read by `_addGmPrepContext`. */
const GM_PREP_EDIT_SECTIONS = ["threats", "sites"];

/**
 * The Threats tab's static reference, localized once.
 *
 * Every input is a module constant or an i18n key, so the finished shape is the same on every
 * render — but this tab re-renders on EVERY prep-page write in the world (see `_wirePrepPageSync`),
 * so rebuilding it meant re-allocating a dozen objects and re-running a dozen `localize` lookups
 * each time a doom track ticked on some other client.
 *
 * Built lazily rather than at import: `game.i18n` is not ready when this module loads. Not
 * invalidated, because the language cannot change without a reload. `localizedOnce` is what makes
 * "not ready yet" safe rather than permanent, and freezes the result — see its header.
 */
const threatReference = localizedOnce(() => ({
	guidance: threatGuidanceSections().map(section => ({
		key:        section.key,
		title:      localize(section.titleKey),
		note:       localize(section.noteKey),
		collapseId: section.collapseId,
		ordered:    !!section.ordered,
		// Empty string rather than undefined for the sections without one: the template
		// branches on `{{#if caution}}`, and both read the same there, but a string keeps
		// the published shape identical across all four sections.
		caution:    section.cautionKey ? localize(section.cautionKey) : "",
		groups:     section.groups.map(group => ({
			label: group.labelKey ? localize(group.labelKey) : "",
			items: group.items,
		})),
	})),
	// The one bit of chrome the reference block needs that isn't per-section.
	optionalLabel: localize("stonetop.gmToolkit.threats.optional"),
	// The eight types: blurb, and the type's own GM moves behind a disclosure. The catalog is
	// the same one the Write-Up-a-Threat dialog offers, read straight rather than copied, so a
	// type cannot come to mean two different things on two screens.
	//
	// The MOVES are here as well as in that dialog because the two answer different questions.
	// There you are writing a threat up and picking which of its moves to keep; here you have
	// a threat already on the table and are asking what it would do next, which is the
	// question a GM has mid-scene and the one the book prints these lists for (Book I p.283:
	// "use a threat's special moves whenever the threat is involved, on screen or off").
	types: THREAT_TYPES.map(t => ({
		id: t.id, label: t.label, blurb: t.blurb, accent: t.accent, moves: t.suggestedMoves,
	})),
	// The disclosure's tooltip, once for all eight rather than once per row.
	typeMovesLabel: localize("stonetop.gmToolkit.threats.guide.typeMoves"),
}));

/**
 * Which family a card element belongs to.
 *
 * The modifier class cannot answer this: a threat card's is `threat-card--{{type.id}}`, which
 * carries the threat's TYPE rather than the word "threat". The data attribute is the one thing
 * all three spell the same way, and reading it means a fourth kind needs no new branch.
 */
function cardKind(card) {
	return GM_PREP_KIND_IDS.find(kind => `${kind}Id` in card.dataset) ?? "threat";
}

/**
 * Adds the Threats & Dangers and Sites tabs to a sheet.
 *
 * Expects the host to provide `isEditable`, `_editMode`, `render`, and the
 * `withSectionEditing` mixin (for `isSectionEditable` / `_wireSectionEditToggle`).
 *
 * @template {new (...args: any[]) => object} T
 * @param {T} Base
 */
export function withGmPrepTabs(Base) {
	return class GmPrepTabs extends Base {
		// Per-kind collapse state, surviving re-renders. Keyed off the shared kind list rather
		// than a hand-written row per kind: `_cardVMsFor` indexes `_cardVMs` unguarded, so a
		// kind these two maps disagree about is a TypeError mid-render rather than a default.
		_cardCollapse = Object.fromEntries(GM_PREP_KIND_IDS.map(kind =>
			[kind, { defaultCollapsed: gmPrepStartsCollapsed(kind), overrides: new Set() }]));

		// Card view-models from an earlier render, by kind then page uuid, each stamped with its
		// page's last-modified time. Building one is a walk of async enrichHTML round trips (a
		// site with six areas is thirteen of them), and this sheet re-renders for reasons that
		// have nothing to do with any given card.
		_cardVMs = Object.fromEntries(GM_PREP_KIND_IDS.map(kind => [kind, new Map()]));

		/**
		 * The actor these tabs READ AND WRITE THROUGH: the steading, never `this.actor`.
		 * See the file header for what goes wrong otherwise. Null in a world with no steading
		 * yet, which the tabs render an explanation for rather than an empty grid.
		 */
		_prepSteading() {
			return getStonetopSteadingActor();
		}

		/**
		 * The three journal entries these tabs draw from, by id.
		 *
		 * Used to decide whether a page write anywhere in the world is one of OURS. Recomputed
		 * per event rather than cached: the ids are flags on the steading, and the first threat
		 * ever written mints the entry and sets the flag, so a cache built at first render would
		 * be permanently empty on a fresh world.
		 */
		_prepEntryIds() {
			return gmPrepEntryIds(this._prepSteading());
		}

		/**
		 * Re-render when one of our pages is created, changed or deleted, wherever it happened.
		 *
		 * These tabs render JournalEntryPages, and a sheet is not told about documents it does
		 * not own. Without this, every path that writes prep has to remember to nudge the sheet:
		 * seven `render(false)` calls lived in this file, the Create-Content dialog had to reach
		 * across and re-render every open toolkit by hand, and anything else (a macro, a second
		 * GM at the table, an edit made in the journal sidebar) simply left the tab stale and
		 * looking correct. Observing the documents is the thing that makes all of those work,
		 * including the ones nobody has written yet.
		 *
		 * Registered on FIRST RENDER and dropped on close, the shape ThreatEditorDialog uses and
		 * for the reason its comment gives: `close()` only ever runs on a sheet that rendered, so
		 * binding in the constructor leaks a live hook holding this sheet if it is dropped before
		 * rendering. `== null` rather than a truth test, because a hook id of 0 is a valid
		 * registration that a falsy check would re-register on every re-render.
		 */
		_wirePrepPageSync() {
			if (this._prepSyncHooks) return;
			// DEBOUNCED, because the commonest write through here is a doom-track tick, and the
			// browser has already painted that checkbox. Walking a threat's three grim portents
			// plus its impending doom would otherwise be four full rebuilds of all four tabs —
			// each one a steading lookup, three page-list walks and a re-enrich of the changed
			// card — for a checkbox that is already showing the right thing. A burst coalesces
			// into one render; a lone event still lands within the frame.
			// The `rendered` check is INSIDE the debounced callback, not only in `onChange`
			// below: the window between arming the timer and its firing is long enough to close
			// the sheet in, and a `render(false)` on a closed sheet is what re-registers these
			// hooks on a dead one (see the gate in StonetopGmToolkitSheet#_render).
			const rerender = foundry.utils.debounce(() => { if (this.rendered) this.render(false); }, 100);
			const onChange = (doc, event) => {
				if (!this.rendered) return;
				// Page TYPE first, and deliberately so. Every JournalEntryPage write in the world
				// arrives here — every saved edit to every gazetteer, lore and bestiary page — and
				// the entry-id test below resolves the steading, which is an unindexed scan of
				// `game.actors`. Our three page types are the cheap discriminator that keeps a
				// world's ordinary journal editing down to one string comparison.
				if (!GM_PREP_KIND_IDS.includes(doc?.type)) return;
				const parentId = doc?.parent?.id ?? null;
				if (!parentId || !this._prepEntryIds().includes(parentId)) return;
				// A card you have just written opens EXPANDED, whichever surface wrote it —
				// you will want to read back what the walkthrough produced. Only sites are
				// affected in practice (the one kind that defaults to collapsed), and doing it
				// here rather than in the create flow is what makes it true of the sidebar's
				// Create-Content path as well, which has no sheet to say it on.
				if (event === "createJournalEntryPage" && doc.uuid) {
					this._setCardCollapsed(doc.type, doc.uuid, false);
				}
				rerender();
			};
			this._prepSyncHooks = ["createJournalEntryPage", "updateJournalEntryPage", "deleteJournalEntryPage"]
				.map(event => ({ event, id: Hooks.on(event, doc => onChange(doc, event)) }));
		}

		/** Drop the page-sync hooks. Call from the host's close. */
		_unwirePrepPageSync() {
			for (const { event, id } of this._prepSyncHooks ?? []) {
				if (id != null) Hooks.off(event, id);
			}
			this._prepSyncHooks = null;
		}

		/** Is this card drawn collapsed? Its kind's default, unless the user has said otherwise. */
		_isCardCollapsed(kind, uuid) {
			const state = this._cardCollapse[kind];
			if (!state) return false;
			return state.overrides.has(uuid) ? !state.defaultCollapsed : state.defaultCollapsed;
		}

		/** Record that this card is now collapsed (or not), as an override of its kind's default. */
		_setCardCollapsed(kind, uuid, collapsed) {
			const state = this._cardCollapse[kind];
			if (!state) return;
			if (collapsed === state.defaultCollapsed) state.overrides.delete(uuid);
			else state.overrides.add(uuid);
		}

		/**
		 * One kind's card view-models, built concurrently and reused while their pages sit still.
		 * What is CACHED is the expensive half (the enriched prose); the per-render chrome is
		 * re-applied to the same object on the way out, so a cached card still draws at its
		 * current collapse state.
		 *
		 * Decoration happens here rather than in the callers because this method already holds
		 * both the kind and the page each view-model came from — re-pairing the two arrays by
		 * index at every call site is the same three lines three times, each an off-by-one
		 * waiting to happen.
		 */
		async _cardVMsFor(kind, pages, build) {
			const cache = this._cardVMs[kind];
			const vms = await Promise.all(pages.map(async page => {
				const sig = `${page._stats?.modifiedTime ?? 0}`;
				const hit = cache.get(page.uuid);
				const fresh = hit?.sig === sig;
				const vm = fresh ? hit.vm : await build(page);
				if (!fresh) cache.set(page.uuid, { sig, vm });
				// Shared card chrome: draggable, collapsible, drawn at its remembered state.
				vm.canDrag = vm.isOwner;
				vm.collapsible = true;
				vm.collapsed = this._isCardCollapsed(kind, page.uuid);
				return vm;
			}));
			// Forget cards whose page is gone, so deleting prep doesn't hold its VM for the life
			// of the sheet.
			const live = new Set(pages.map(page => page.uuid));
			for (const uuid of [...cache.keys()]) if (!live.has(uuid)) cache.delete(uuid);
			return vms;
		}

		/** Threat + hazard cards, grouped by proximity. */
		async _buildThreatsContext(steading) {
			const pages = listThreatPages(steading);
			// Hazards render as one flat section after the proximity groups: they have no
			// proximity, they belong to places and expeditions (Book I, "Dangers").
			const hazardPages = listHazardPages(steading);
			// Both batches are independent, so enrich them concurrently rather than serially.
			const [threats, hazards] = await Promise.all([
				this._cardVMsFor("threat", pages, buildThreatCardVM),
				this._cardVMsFor("hazard", hazardPages, buildHazardCardVM),
			]);
			// Grouped by proximity (Homefront / Nearby / Distant, Book I p.288) in book order.
			// All three headers always show, each with its own "write up" button.
			const threatGroups = THREAT_PROXIMITIES.map(p => ({
				id: p.id,
				label: p.label,
				// What the tracker means, in the book's terms (p.288). The catalog has carried
				// this line all along and the Write-Up-a-Threat dialog has always shown it; the
				// tab printed the bare label, so the one surface where you decide which of three
				// piles a threat belongs in was the one that didn't say.
				hint: p.hint,
				// Both strings are INTERPOLATED rather than glued together from a label and a
				// suffix. Word order around a name is not portable ("Homefront Threats" is
				// adjective-then-noun), so a template that concatenated would be untranslatable
				// even with every part in the language file.
				//
				// The proximity itself still comes from the catalog, which is not localized: it
				// feeds the create dialog, the editor, the card view and the Things Below
				// dialogs, so translating it is its own pass across all of them.
				heading:  format("stonetop.gmToolkit.threats.proximityHeading", { proximity: p.label }),
				addLabel: format("stonetop.gmToolkit.threats.addThreat", { proximity: p.label.toLowerCase() }),
				threats: threats.filter(t => t.proximity.id === p.id),
			}));
			return { threatGroups, hazards };
		}

		/**
		 * Publish both tabs' context. Call from the host's getData.
		 *
		 * `steading` is a parameter so a host that has already resolved it can hand it down:
		 * `getStonetopSteadingActor` is an unindexed scan of `game.actors`, and a caller that
		 * needs the steading for its own context would otherwise make this the second one of
		 * the same render. Defaults to resolving it here, so a host with no use for it is
		 * unchanged.
		 */
		async _addGmPrepContext(context, steading = this._prepSteading()) {
			const st = context.stonetop;
			// Per-section edit flags, built here rather than by the host: these two tabs are the
			// only sections that carry a pencil, so the list of them is the mixin's own business.
			// A section missing from `stonetop.edit` renders permanently read-only with no error,
			// which is not a thing to leave to a caller remembering to iterate an export.
			//
			// MERGED, never assigned over: this is a mixin, and a host that publishes edit flags
			// of its own would have them silently dropped by an `=` here — read-only sections
			// with nothing logged, which is the very failure the paragraph above is about.
			st.edit = {
				...(st.edit ?? {}),
				...Object.fromEntries(
					GM_PREP_EDIT_SECTIONS.map(section => [section, this.isSectionEditable(section)])
				),
			};
			// Resolved ONCE and passed down. Both builders used to ask for it themselves, which
			// was two `game.actors` scans and two places to state the no-steading branch.
			// One flag for both tabs: with no steading in the world there is nowhere to file
			// prep, so each tab says that instead of drawing an empty grid with a dead
			// "write up a threat" button.
			st.hasSteading = !!steading;
			// The Threats tab's prep reference (Book I, "Threats"), published ABOVE the early
			// return and rendered outside the template's has-a-steading branch. It is static
			// reference rather than anything read off a card, and it is most useful in exactly
			// the state that return covers: a world with no prep filed yet is a GM about to
			// write their first threat.
			//
			// Localized HERE rather than in the template, the shape the sheet already uses for
			// its move sections: the template then gets plain strings, and the tests can assert
			// on the finished sections without standing up a Handlebars environment. Built once
			// for the life of the page — see `threatReference`.
			const reference = threatReference();
			st.threatGuidance      = reference.guidance;
			st.threatOptionalLabel = reference.optionalLabel;
			st.threatTypeReference = reference.types;
			st.threatTypeMovesLabel = reference.typeMovesLabel;
			// Stated once, here, rather than as an empty-shape literal per builder that has to
			// keep matching the keys this method reads back.
			st.threatGroups = [];
			st.hazards      = [];
			st.sites        = [];
			if (!steading) return context;

			const [threatsCtx, sites] = await Promise.all([
				this._buildThreatsContext(steading),
				this._cardVMsFor("site", listSitePages(steading), buildSiteCardVM),
			]);
			st.threatGroups = threatsCtx.threatGroups;
			st.hazards      = threatsCtx.hazards;
			st.sites        = sites;
			return context;
		}

		/**
		 * Both tabs' interactions: doom tracks, the prep tools, card collapse, drag-to-scene.
		 * Self-gated per action (page ownership / GM), so this is independent of the section
		 * edit-mode gate; delegated on the sheet root.
		 */
		_activateGmPrepListeners(root) {
			if (!root) return;

			wireThreatDoomChange(root, chk => fromUuid(chk.closest(".threat-card")?.dataset.pageUuid ?? ""));

			// Every prep tool on these two tabs, one row per kind. The three kinds' edit / remove
			// / add handling was the same six-line `closest` chain three times over, differing
			// only in the selector words.
			// What is left here is only what a TAB knows and the kind table cannot: which panel a
			// kind's cards are drawn in, and which of this sheet's methods its two buttons call.
			// Everything that is a fact ABOUT a kind rather than about this sheet — including the
			// noun in the delete prompt — is read off gm-prep-page.js, so a fourth kind adds one
			// row here and one there instead of one in each of six tables.
			//
			// There is no `remove` column: the three kinds' deletes are one function (see
			// deleteGmPrepPage), so a column would present one behaviour as three.
			const prepTools = [
				{ scope: ".steading-threats", kind: "threat",
					edit: page => this._openThreatEditor(page),
					// Threats are added per proximity band; the button says which.
					add: btn => this._onCreateThreat(btn.dataset.proximity) },
				{ scope: ".steading-threats", kind: "hazard",
					edit: page => this._onEditHazard(page),
					add: () => this._onCreateHazard() },
				{ scope: ".steading-sites", kind: "site",
					edit: page => this._onEditSite(page),
					add: () => this._onCreateSite() },
			];

			root.addEventListener("click", async ev => {
				// A threat type in the reference block, opening its own list of GM moves. First,
				// because it is reference chrome rather than a prep tool and matches none of the
				// selectors below: a threat already on the table has a type, and this is where a
				// GM asks what one of those would do next.
				const typeToggle = ev.target.closest?.(".steading-threat-type-toggle");
				if (typeToggle) {
					ev.preventDefault();
					toggleDisclosure(typeToggle, ".steading-threat-type-moves");
					return;
				}

				for (const tool of prepTools) {
					const add = ev.target.closest?.(`${tool.scope} .${tool.kind}-add-btn`);
					if (add) { ev.preventDefault(); tool.add(add); return; }
					const edit = ev.target.closest?.(`${tool.scope} .${tool.kind}-edit-open`);
					if (edit) { ev.preventDefault(); const page = await fromUuid(edit.dataset.pageUuid); if (page) tool.edit(page); return; }
					const remove = ev.target.closest?.(`${tool.scope} .${tool.kind}-remove`);
					if (remove) {
						ev.preventDefault();
						// Deleting is the one control on these tabs that destroys a write-up, and
						// the per-section pencil is this sheet's whole write gate (there is no
						// global edit wrench). The stylesheet says the same thing by leaving
						// `<kind>-remove` off the `.stonetop-readonly` allow-list, but a gate that
						// exists only in CSS is one `!important` from being gone, so the handler
						// states it too rather than trusting `pointer-events`.
						if (remove.closest(".stonetop-readonly")) return;
						const page = await fromUuid(remove.dataset.pageUuid);
						// AWAITED, and its failure said out loud. A rejection here — a journal the
						// GM cannot delete, a write that fails — used to close the confirm dialog,
						// leave the card sitting there and report nothing, so the trash read as a
						// dead button and only the console knew why.
						if (page) {
							try {
								await this._confirmDeletePrepPage(page, `Delete ${gmPrepKindNoun(tool.kind)}`);
							} catch (err) {
								console.error("Stonetop | failed to delete GM prep page", err);
								ui.notifications?.error?.("Couldn't delete that. See the console for details.");
							}
						}
						return;
					}
				}

				// Collapse / expand a card down to its title + Instinct. Any header click toggles
				// it; the edit / remove tools are handled and returned above. A drag suppresses
				// the click, so grabbing the header to pin it doesn't also collapse it. State
				// lives in _cardCollapse so it survives re-renders; no re-render, just a class flip.
				const head = ev.target.closest?.(".steading-threats .threat-card__head--collapsible, .steading-sites .threat-card__head--collapsible");
				if (head) {
					const card = head.closest(".threat-card");
					if (!card) return;
					const collapsed = card.classList.toggle("is-collapsed");
					card.querySelector(".threat-collapse-btn")?.setAttribute("aria-expanded", String(!collapsed));
					const uuid = card.dataset.pageUuid;
					if (!uuid) return;
					this._setCardCollapsed(cardKind(card), uuid, collapsed);
				}
			});

			// Whatever controls each kind's own card carries (a site's random tables, Book I p.369).
			wireGmPrepCardExtras(root, target => fromUuid(target.closest(".threat-card")?.dataset.pageUuid ?? ""));

			// The whole card is the drag handle (no separate grip): grab it anywhere to drop a
			// pinned Note on a scene. A plain click still toggles collapse. Shares the one
			// drag-wiring helper with the page sheet so the selector can't diverge.
			wireThreatCardDrag(root, {
				selector: ".steading-threats .threat-card[draggable='true'], .steading-sites .threat-card[draggable='true']",
			});

			// Drop a "Threat" card dragged out of a journal onto the Threats tab to create the
			// steading's own threat from its seed. Same helper the steading's Improvements tab
			// uses, so the drag-over highlight and the dragleave containment test can't diverge.
			wireCardDropZone(root.querySelector(".tab.threats"),
				STONETOP_THREAT_SEED_DRAG_TYPE, data => this._onDropThreatSeed(data.seed));
		}

		/** Open a threat's editor (a proper movable dialog, not the page sheet standalone). */
		_openThreatEditor(page) {
			if (page) new ThreatEditorDialog(page).render(true);
		}

		/**
		 * Nothing can be written up before there is a steading to file it under, because the
		 * journal that holds it is minted from the steading and pointed at by a flag on it.
		 * Say so rather than failing somewhere inside the store.
		 *
		 * Through the shared warner, so pressing "Create a site" here and pressing it in the
		 * sidebar's Create-Content picker say the same thing.
		 */
		_requireSteading() {
			return getStonetopSteadingActorOrWarn({ because: "there is nowhere to file GM prep" });
		}

		// Confirm-and-delete a GM-prep page: identical card + scene-pin cleanup for all three
		// kinds, and only the noun differs — the deletion itself is one function (deleteGmPrepPage).
		async _confirmDeletePrepPage(page, title) {
			const ok = await Dialog.confirm({
				title,
				content: `<p>Delete <strong>${escHtml(page.name)}</strong>? This removes its card and any pins placed on scenes.</p>`,
				options: { classes: ["dialog", "stonetop", "stonetop-delete-threat-dialog"] },
			});
			if (!ok) return;
			await deleteGmPrepPage(page);
		}

		// None of the flows below re-render: the page write itself is what the sheet is watching
		// (see _wirePrepPageSync), so the card appears, changes or goes on its own — and does so
		// for a second GM's open toolkit too, which a `this.render()` here never could.

		async _onCreateThreat(defaultProximity) {
			const steading = this._requireSteading();
			if (!steading) return;
			const seed = await new CreateThreatDialog(steading, { defaultProximity }).promise();
			if (!seed) return;
			const page = await createThreat(steading, seed);
			if (page) this._openThreatEditor(page);
		}

		// The Make-a-Hazard walkthrough collects the whole write-up, so unlike threats nothing
		// needs an editor to open afterwards; edits reopen the wizard pre-filled.
		async _onCreateHazard() {
			const steading = this._requireSteading();
			if (!steading) return;
			const seed = await new CreateHazardDialog().promise();
			if (!seed) return;
			await createHazard(steading, seed);
		}

		async _onEditHazard(page) {
			await new CreateHazardDialog({ page }).promise();
		}

		async _onCreateSite() {
			const steading = this._requireSteading();
			if (!steading) return;
			// Shared with the sidebar's Create-Content picker, so the two cannot drift.
			await createSiteFlow(steading);
		}

		async _onEditSite(page) {
			await openSiteWizard({ page });
		}

		/**
		 * Create the steading's own threat from a dropped homebrew threat card's seed (the
		 * reusable "Create Item -> Threat" path). Same result as the guided creator, minus the
		 * dialog: the fuller doom track / stakes / prose are still authored in the editor that
		 * opens right after.
		 */
		async _onDropThreatSeed(seed) {
			if (!seed?.name) return;
			const steading = this._requireSteading();
			if (!steading) return;
			const page = await createThreat(steading, seed);
			if (!page) return;
			globalThis.ui?.notifications?.info?.(`Added threat: ${page.name}.`);
			this._openThreatEditor(page);
		}
	};
}
