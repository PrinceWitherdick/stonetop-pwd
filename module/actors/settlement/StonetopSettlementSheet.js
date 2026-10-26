// The settlement sheet: a steading that is not Stonetop.
//
// What Book II prints for a place (Size, Population, Prosperity, Defenses, who it trades with, its
// Resources and the Defenses list), the people who run it, its Residents (each an NPC, on Stonetop's
// own Residents table, following each NPC's Home: settlement-residents.js), the four homefront moves its stats are for (Book I p.508), and a Notes tab with Stonetop's Plans (Make a Plan, p.530) above a notes box. Stonetop's standing with the place is not shown here: it is
// STORED on Stonetop (`system.relationships`, actors/settlement/settlement-actor.js#standingKey) and
// rated on Stonetop's Other Settlements table alone (the user's call, 2026-10-19).
//
// IT LOOKS LIKE STONETOP'S SHEET, on purpose and by reuse rather than imitation: the templates wear
// Stonetop's own classes (the `.steading-header` banner, the `.steading-stats-bar` slate tracks,
// the `.steading-card` spiral lists, the Moves tab's `.stonetop-item` cards with the same book
// text), so a change to Stonetop's look reaches every other steading too. Like Stonetop's, the
// banner carries no picture; the actor's image (its map or the village icon, settlement-portrait.js)
// is the sidebar's.
//
// AN AppV1 SHEET, like every other actor sheet in the system (it was briefly an ActorSheetV2; the
// user's call, 2026-10-14, was to keep one framework until the planned V1 -> V2 migration moves them
// all together). So it wears the parchment `.stonetop` skin and the shared tab rail on the window's
// right edge (utils/tab-rail.js), the way the NPC and GM Toolkit sheets do. Three things follow:
//  • V1 has no `data-action` dispatch. The buttons still carry `data-action`, and one delegated
//    listener looks each up in ACTIONS below and runs the sheet method it names; an action not in
//    that table (a ProseMirror menu button inside the notes editor) is left alone.
//  • Core disables EVERY form control for a reader who cannot edit, buttons included
//    (FormApplication#_disableFields). A player reading Marshedge must still be able to roll its
//    moves, open the gazetteer and follow a link, so those controls carry `data-reader-ok` and are
//    switched back on in activateListeners.
//  • The notes editor is a `<prose-mirror>` with no `name`, saved by its own change listener (the
//    NPC sheet's way), and is drawn only for an editor: a reader gets the enriched text.
//
// LIST ROWS ARE NOT FORM FIELDS. An ArrayField is written whole, and a form submit would rebuild
// each row from whatever inputs it happened to name, dropping the row's id and its lacking tick.
// So row inputs carry `data-row-field` and no `name`; _onChangeInput writes them itself, by row id,
// and only the plain fields (name, kind, stats, region, government) go through core's submit.

import { STEADING_SIZES } from "../../utils/improvement-def.js";
import { rollAdjustments } from "../steading/improvement-rolls.js";
import { localize } from "../../utils/i18n.js";
import { sign } from "../../utils/roll-engine.js";
import { getStonetopSteadingActor } from "../../utils/world.js";
import { ACTOR_LINK_MISSING, openLinkedActorSheet } from "../../utils/actor-link.js";
import { openGazetteerEntry } from "../../utils/gazetteer-notes.js";
import { mountTabRail } from "../../utils/tab-rail.js";
import { withSheetSizeMemory } from "../../utils/sheet-size.js";
import { promptRoll } from "../../dialogs/RollDialog.js";
import { injectHeaderToggle, stripHeaderChrome } from "../../utils/sheet-chrome.js";
import { getOpenSheetsInEditMode } from "../../settings.js";
import { readCurrentSeason } from "../../seasons/current-season.js";
import { homesteadFieldsHtml, homesteadMoveFlow, homesteadMoveText } from "../steading/homestead-moves.js";
import { ContentPickerDialog } from "../../dialogs/content-picker.js";
import { rosterSettlement, settlementHiddenFromPlayers, settlementsBySlug, tradePartnerSlug } from "./settlement-actor.js";
import { SETTLEMENT_MOVES, rollSettlementMove, settlementIsLacking, settlementRolledStat } from "./settlement-rolls.js";
import { SETTLEMENT_LISTS, isSettlementList, settlementRow } from "./settlement-rows.js";
import { escHtml } from "../../utils/strings.js";
import { deletionEntry, imagePopout } from "../../utils/foundry-compat.js";
import { format } from "../../utils/i18n.js";
import { AddSteadingMemberDialog } from "../../dialogs/AddSteadingMemberDialog.js";
import { HOMES, OCCUPATIONS, TRAITS } from "../../data/steading-members.js";
import { HOME_STONETOP, createPersonNpc, ensureNamedActorFolder, personFieldPath, personRowActor, resolvePersonRow } from "../steading/steading-people.js";
import { editSettlementList, homeKey, isWorldNpc, ownsItsName, settlementForHome, settlementResolver, syncResidentHome } from "./settlement-residents.js";
import { settlementActors } from "./settlement-type.js";
import { confirmOutcome } from "../../utils/ask-with-buttons.js";
import { StonetopAutocomplete } from "../../utils/autocomplete.js";
import { openNpcNotesDialog } from "../steading/npc-notes-dialog.js";
import { withLinkedActor } from "../../utils/actor-link.js";
import { wireTabSearch } from "../../utils/tab-search.js";
import { makeColumnsResizable } from "../../utils/resizable-columns.js";
import { makeColumnsSortable } from "../../utils/sortable-columns.js";
import { wireAvatarPreview, removeAvatarPreview } from "../../utils/avatar-preview.js";
import { displayPortraitSrc } from "../../book2-art/people-portraits.js";
import { plansView, wireSteadingNotesTab } from "../steading/steading-plans.js";
import { editSteadingPlan } from "../steading/SteadingPlanDialog.js";
import { settlementPlanStore } from "./settlement-plans.js";
import { wireKeyboardButtons } from "../../utils/keyboard-buttons.js";

// Plain literals, not built from SYSTEM_ID: the template checks in tests find paths by searching
// the source for them.
// The banner and the four tabs are partials of this one (registered in stonetop.js).
const TEMPLATE = "systems/stonetop-pwd/templates/actor/settlement.hbs";

const KEY = "stonetop.settlement";

/** Each `data-action` on the sheet, and the name of the sheet method it runs. */
const ACTIONS = {
	addRow:        "_onAddRow",
	deleteRow:     "_onDeleteRow",
	rollMove:      "_onRollMove",
	openGazetteer: "_onOpenGazetteer",
	openActor:     "_onOpenActor",
	dismissSetup:  "_onDismissSetup",
	toggleHidden:  "_onToggleHidden",
	unlinkLeader:  "_onUnlinkLeader",
	addResident:   "_onAddResident",
	editResidentNotes: "_onEditResidentNotes",
	editRow:       "_onEditRow",
	editGovernment: "_onEditGovernment",
};

/**
 * The Overview lists' fields, as the row window asks for them: each column and its label's key
 * under stonetop.settlement. The first is the row's name, which a row must have. A column left out
 * (a trade partner's slug, a notable person's linked sheet) is kept as it is.
 */
const ROW_FIELDS = {
	resources:      [["name", "resourcePlaceholder"], ["detail", "detailPlaceholder"], ["lacking", "lacking"]],
	fortifications: [["name", "fortificationPlaceholder"], ["detail", "detailPlaceholder"]],
	tradeWith:      [["partner", "partnerPlaceholder"], ["goods", "goodsPlaceholder"]],
	groups:         [["name", "groupName"], ["count", "groupCount"], ["notes", "groupNotes"]],
	leaders:        [["name", "personName"], ["role", "personRole"], ["instinct", "personInstinct"]],
};

/** The Actor folder a settlement's residents are filed in, like Stonetop's "Residents of Stonetop". */
const RESIDENTS_FOLDER_COLOR = "#5c6b7a";

/**
 * A Residents row as steading-people.js reads one: the NPC's uuid and the cached name. Not the row
 * itself, whose `id` is the row's own (the sheet addresses rows by it), where a Stonetop roster
 * row's `id` is the NPC's and would be looked up as one.
 */
const residentPointer = row => ({ uuid: row?.uuid ?? "", name: row?.name ?? "" });

/** A settlement's three stats. Fortunes and Surplus are Stonetop's alone (Book I p.508). */
const STATS = ["population", "prosperity", "defenses"];

/**
 * @param {typeof ActorSheet} Base  core's V1 actor sheet
 */
export function createStonetopSettlementSheetClass(Base) {
	// withSheetSizeMemory: reopen at the size this user last left a settlement sheet at.
	return class StonetopSettlementSheet extends withSheetSizeMemory(Base) {
		/**
		 * The window header's wrench, as on every other Stonetop actor sheet (utils/sheet-chrome.js).
		 * Off, an owner reads the sheet as a player does, with only the things that change in play
		 * still live (rolls, hearts, notes); on, the lists, stats and banner open up.
		 * Owners only: the "Open Sheets in Edit Mode" preference is per client, and a player who
		 * set it must not start a sheet they can only read in a mode they cannot leave.
		 */
		_editMode = this.actor?.isOwner ? getOpenSheetsInEditMode() : false;

		static get defaultOptions() {
			return foundry.utils.mergeObject(super.defaultOptions, {
				// "settlement" is what the frame rules in stonetop.css hang off; "stonetop" is what
				// gets the window chrome and the parchment.
				classes:   ["stonetop", "sheet", "actor", "settlement", "stonetop-settlement-sheet"],
				// Wide enough for Stonetop's stat bar to sit on one row and its cards three-up, as on
				// Stonetop's own sheet; a narrower window wraps both.
				width:     900,
				height:    780,
				minWidth:  520,
				minHeight: 420,
				resizable: true,
				submitOnChange: true,
				tabs: [{ navSelector: ".stonetop-tab-rail", contentSelector: ".stonetop-settlement-body", initial: "overview" }],
			});
		}

		get template() {
			return TEMPLATE;
		}

		/** @inheritDoc */
		async getData(options) {
			const context = await super.getData(options);
			const actor = this.actor;
			const system = actor.system;
			// `editable` is the EDIT VIEW (the wrench on); `canWrite` is whether this user may write at
			// all, which is what the always-live controls (notes, the setup note) follow, as on Stonetop's.
			const canWrite = this.isEditable;
			const editable = canWrite && this._editMode;
			const ranges = system.statRanges ?? {};
			const lacking = settlementIsLacking(system);

			// Each stat as one of Stonetop's slate tracks (-1 to +3) draws it, in the Overview's stat bar.
			const statsByKey = Object.fromEntries(STATS.map(key => [key, {
				key,
				label: localize(`${KEY}.stat.${key}`),
				name: `system.stats.${key}.value`,
				value: system.stats?.[key]?.value ?? 0,
				range: ranges[key] ?? "",
				// Book I p.510: a lacking steading treats Prosperity as 1 lower. Said under the track,
				// because the box ticked is the one the GM chose and the dice read one less.
				note: key === "prosperity" && lacking ? localize(`${KEY}.lackingNote`) : "",
			}]));

			// Built only when a Trade-with row names a partner to link.
			const sheetsBySlug = (system.tradeWith ?? []).some(row => row.slug) ? settlementsBySlug() : new Map();

			Object.assign(context, {
				actor,
				system,
				editable,
				canWrite,
				isGM: !!game.user?.isGM,
				hidden: this.#isHidden(),
				// `option` is the radio's word, lower case as Stonetop's Size radios print it ("hamlet").
				sizes: STEADING_SIZES.map(id => {
					const label = localize(`${KEY}.size.${id}`);
					return { id, label, option: label.toLocaleLowerCase(), selected: id === system.size };
				}),
				statsByKey,
				resources:      system.resources ?? [],
				fortifications: system.fortifications ?? [],
				tradeWith: (system.tradeWith ?? []).map(row => {
					// Linked only when this user can see the partner's sheet; a hidden one stays plain text.
					const partner = row.slug ? sheetsBySlug.get(row.slug) : null;
					return { ...row, partnerUuid: (partner?.visible && partner.uuid) || "" };
				}),
				groups:   system.groups ?? [],
				leaders:  system.leaders ?? [],
				// Each Residents row as Stonetop's table draws it, read live off its NPC. `rowId` is the
				// row's own id, which edits and removals address it by; `id` is the NPC's. Resolved by
				// uuid alone: a Stonetop row's `id` is the NPC's, and this row's is not.
				// `cellsEditable`: the row's cells write its NPC, so they open only for a user who may
				// write that NPC as well as this sheet; anyone else reads them as text, wrench or no.
				residents: await Promise.all((system.residents ?? []).map(async row => {
					const resolved = await resolvePersonRow(residentPointer(row));
					const npc = resolved.unresolved ? null : game.actors?.get(resolved.id);
					return { ...resolved, rowId: row.id, cellsEditable: editable && !!npc?.isOwner };
				})),
				occupationSuggestions: OCCUPATIONS,
				traitSuggestions: TRAITS,
				canGazetteer: !!system.journalId,
				blurb: rosterSettlement(system.sourceSlug)?.blurb ?? "",
				moves: SETTLEMENT_MOVES.map(slug => this.#moveContext(slug, system)),
				plans: plansView(system.plans),
				enrichedNotes: await foundry.applications.ux.TextEditor.implementation.enrichHTML(system.notes ?? "", {
					relativeTo: actor, secrets: actor.isOwner,
				}),
			});
			return context;
		}

		/** @inheritDoc */
		async _render(force, options) {
			await super._render(force, options);
			injectHeaderToggle(this, "settlement");
			stripHeaderChrome(this);
			this.element[0]?.classList.toggle("stonetop-edit-mode", this._editMode);
		}

		/**
		 * One move's card on the Moves tab: Stonetop's card for it (the book text and the "+STAT"
		 * chip), with the stat's value HERE on the chip and a line for what this place's Size does
		 * to the roll.
		 */
		#moveContext(slug, system) {
			const flow = homesteadMoveFlow(slug);
			const text = homesteadMoveText(slug);
			// The Size's say on this roll, as the dice will hear it (improvement-rolls.js#rollAdjustments).
			const { adv, dis } = rollAdjustments({ moveName: flow.label, statKey: flow.stat, size: system.size });
			const sizeNote = adv.length ? localize(`${KEY}.moveTown`)
				: dis.length ? localize(`${KEY}.moveHamlet`)
				: "";
			return {
				slug,
				label: flow.label,
				statLabel: flow.statLabel,
				statChipLabel: text?.statChipLabel ?? flow.statLabel,
				statValue: sign(settlementRolledStat(system, flow.stat).statValue),
				description: text?.description ?? "",
				// Winter is not said again here: Trade & Barter's own text already says it.
				notes: sizeNote ? [sizeNote] : [],
			};
		}

		/** @inheritDoc */
		activateListeners(html) {
			super.activateListeners(html);
			// Hang the tab rail off the window's right edge (module/utils/tab-rail.js).
			mountTabRail(this, html);
			const root = html[0];
			if (!root) return;

			// A reader may still roll, read and follow links (see the head of this file), and filter the
			// Residents: the search box is the shared partial, so it is named here rather than marked.
			if (!this.isEditable) {
				for (const el of root.querySelectorAll("[data-reader-ok], .stonetop-tab-search-toggle, .stonetop-tab-search-input")) el.disabled = false;
			}

			// The Residents table, wired as Stonetop's is (StonetopSteadingSheet#activateListeners): a
			// filter whose term lives on the sheet so it outlasts the re-render every write makes,
			// rows kept A-Z by name, and faces that preview on hover and open on a click.
			wireTabSearch(root.querySelector(".steading-residents-section--residents"), {
				itemSel: ".steading-residents-row",
				textFor: row => [...row.querySelectorAll(".steading-resident-input, .steading-person-text")]
					.map(el => el.value ?? el.textContent).join(" "),
				memory: (this._tabSearchTerms ??= {}), key: "residents",
			});
			for (const table of root.querySelectorAll(".steading-residents-table[data-resize-key]")) {
				makeColumnsResizable(table, table.dataset.resizeKey);
				makeColumnsSortable(table, table.dataset.resizeKey);
			}
			wireAvatarPreview(root, ".steading-member-avatar-img");
			root.addEventListener("click", event => {
				const box = event.target.closest?.(".steading-member-avatar");
				if (!box) return;
				event.stopPropagation();
				this.#openResidentPortrait(box);
			}, true);

			root.addEventListener("click", event => this.#dispatch(event, "[data-action]"));
			// A move's NAME rolls it, as on Stonetop's Moves tab. It is a <strong role="button">, not a
			// <button> (core would disable that for a reader): Enter and Space press it (utils/keyboard-buttons.js).
			wireKeyboardButtons(root);

			// The notes: saved whole on the editor's own change (it carries no `name`).
			root.querySelector(".stonetop-settlement-notes prose-mirror")?.addEventListener("change", event => {
				if (!this.isEditable) return;
				this.actor.update({ "system.notes": event.currentTarget.value ?? "" });
			});

			// The Notes tab's Plans, wired as Stonetop's are (steading-plans.js), for anyone who may write.
			if (this.isEditable) {
				const store = settlementPlanStore(this.actor);
				wireSteadingNotesTab(root, store, { editPlan: planId => editSteadingPlan(store, planId) });
			}
		}

		/** Run the ACTIONS method for the `selector` element the event came from, if it names one. */
		#dispatch(event, selector) {
			const target = event.target?.closest?.(selector);
			const method = target && ACTIONS[target.dataset.action];
			if (!method || target.disabled) return;
			event.preventDefault();
			this[method](event, target);
		}

		/**
		 * Hidden from the players: what the header chip shows and flips (settlement-actor.js
		 * #settlementHiddenFromPlayers). A player who OWNS the place is left out of the question, as
		 * _onToggleHidden leaves them owning it, so the chip still says, and sets, what everyone else sees.
		 */
		#isHidden() {
			return settlementHiddenFromPlayers(this.actor.ownership, game.users ?? []);
		}

		/** @inheritDoc: list rows are written here, by id; everything else is core's submit. */
		async _onChangeInput(event) {
			const cell = event.target?.closest?.("[data-resident-field]");
			if (cell) return this.#onResidentFieldChange(cell);
			const input = event.target?.closest?.("[data-row-field]");
			if (!input) return super._onChangeInput(event);
			const row = input.closest("[data-row-id]");
			const list = row?.closest("[data-list]")?.dataset.list;
			if (!row || !isSettlementList(list) || !this.isEditable) return;
			const field = input.dataset.rowField;
			const value = input.type === "checkbox" ? input.checked : input.value;
			this.#editList(list, rows => {
				const target = rows.find(r => r.id === row.dataset.rowId);
				if (!target) return false;
				target[field] = value;
			});
		}

		/**
		 * Read a list, change it, write it whole; `edit` returning false skips the write. Queued per
		 * settlement with the Residents sync's own writes (settlement-residents.js#editSettlementList).
		 */
		#editList(list, edit) {
			return editSettlementList(this.actor, list, edit);
		}

		/**
		 * A settlement holds no Items or effects: core would make a dropped Item (or every Item in a
		 * dropped folder, or an effect) an embedded document of the place that no tab ever shows.
		 */
		async _onDropItem() { return false; }

		async _onDropFolder() { return false; }

		async _onDropActiveEffect() { return false; }

		/**
		 * @inheritDoc: an NPC dropped on the People tab becomes a resident, as on Stonetop's (open to
		 * anyone who may write the sheet, wrench or no). An NPC or character dropped on the Overview's
		 * Notable people card joins them, with the wrench on.
		 */
		async _onDropActor(event, data) {
			if (!this.isEditable) return false;
			const onPeopleTab = !!event.target?.closest?.(".tab.people");
			const onLeaders = !!event.target?.closest?.("[data-list='leaders']");
			if (!onPeopleTab && !(onLeaders && this._editMode)) return false;
			const actor = await getDocumentClass("Actor").fromDropData(data);
			if (!actor || actor.id === this.actor.id) return false;
			if (onPeopleTab) return this.#addResident(actor);
			if (!["npc", "character"].includes(actor.type)) return false;
			const onto = event.target?.closest?.("[data-list='leaders'] [data-row-id]")?.dataset.rowId;
			await this.#editList("leaders", rows => {
				if (rows.some(r => r.uuid === actor.uuid)) return false;
				// Dropped onto a row: that row is this person, so link it rather than add a second.
				const target = onto ? rows.find(r => r.id === onto) : null;
				if (target) {
					target.uuid = actor.uuid;
					target.name ||= actor.name;
				} else {
					rows.push(settlementRow("leaders", { name: actor.name, uuid: actor.uuid }));
				}
			});
			return actor;
		}

		// ── Residents ───────────────────────────────────────────────────────────

		/**
		 * File an NPC here. The table follows Home (settlement-residents.js), so this sets their Home to
		 * this place and lets the sync list them, and take them off any other settlement's table. A
		 * blank Home is filled in without asking; a Home somewhere else is asked about first. Only a
		 * world NPC has a Home the table can follow, and a place sharing its name with an earlier
		 * settlement can't take anyone (the earlier one would).
		 */
		async #addResident(actor, { quiet = false } = {}) {
			if (actor?.type !== "npc") return false;
			if (!isWorldNpc(actor)) {
				ui.notifications?.warn?.(format(`${KEY}.residentNotInWorld`, { name: actor.name }));
				return false;
			}
			if (!this.#takesResidents()) return false;
			const home = String(actor.system?.home ?? "").trim();
			const livesHere = settlementForHome(home) === this.actor;
			if (livesHere && (this.actor.system.residents ?? []).some(r => r.uuid === actor.uuid)) {
				// Quiet (a resident just made here): the primary GM's hook may have listed them first.
				if (!quiet) ui.notifications?.info?.(format(`${KEY}.alreadyResident`, { name: actor.name }));
				return quiet ? actor : false;
			}
			if (!livesHere) {
				if (!actor.isOwner) {
					ui.notifications?.warn?.(format(`${KEY}.cannotRehome`, { name: actor.name }));
					return false;
				}
				if (home && !await this.#confirmMoveHere(actor, home)) return false;
				if (!await this.#writeHome(actor, this.actor.name)) return false;
			}
			// The primary GM's hook files them too; the sync is queued and idempotent, so filing here as
			// well puts them on the table before the toast says so.
			await syncResidentHome(actor);
			if (!quiet) ui.notifications?.info?.(format(`${KEY}.linkedResident`, { name: actor.name }));
			return actor;
		}

		/**
		 * Whether this place's own name finds it. One sharing its name with an earlier settlement can't
		 * take anyone (a Home saying that name files them on the earlier one), and says so.
		 */
		#takesResidents() {
			if (ownsItsName(this.actor)) return true;
			ui.notifications?.warn?.(format(`${KEY}.residentSharedName`, { place: this.actor.name }));
			return false;
		}

		/** An NPC who lives somewhere else, dropped here: move their Home? */
		#confirmMoveHere(actor, home) {
			const from = settlementForHome(home);
			const name = escHtml(actor.name), here = escHtml(this.actor.name), there = escHtml(home);
			const offTable = from ? " " + format(`${KEY}.moveHereOffTable`, { place: escHtml(from.name) }) : "";
			return confirmOutcome({
				title: format(`${KEY}.moveHereTitle`, { name: actor.name, place: this.actor.name }),
				content: `<p>${format(`${KEY}.moveHereBody`, { name, from: there, to: here })}${offTable}</p>`,
				yes: { label: format(`${KEY}.moveHereYes`, { place: this.actor.name }), icon: "fa-house-chimney" },
				no: { label: format(`${KEY}.moveHereNo`, { place: home }) },
				defaultYes: true,
			});
		}

		/**
		 * The remove cross on a Residents row. Someone who lives here leaves the table by moving away,
		 * so this asks where they live now and writes that Home; the sync takes them off (and onto the
		 * new place's table, when it has a sheet). A row whose NPC is gone, or whose Home is already
		 * somewhere else, is just removed.
		 */
		async #removeResident(rowId) {
			const row = (this.actor.system.residents ?? []).find(r => r.id === rowId);
			if (!row) return;
			const npc = personRowActor(residentPointer(row));
			const dropRow = () => this.#editList("residents", rows => {
				const at = rows.findIndex(r => r.id === rowId);
				if (at < 0) return false;
				rows.splice(at, 1);
			});
			if (!npc || settlementForHome(npc.system?.home) !== this.actor) return dropRow();
			if (!npc.isOwner) {
				ui.notifications?.warn?.(format(`${KEY}.cannotRehome`, { name: npc.name }));
				return;
			}
			const home = await this.#askNewHome(npc);
			if (!home || !await this.#writeHome(npc, home)) return;
			await syncResidentHome(npc);
		}

		/** Write an NPC's Home, saying so if it can't be: resolves to whether it was written. */
		#writeHome(npc, home) {
			return npc.update({ "system.home": home }).then(() => true, err => {
				console.warn("Stonetop | Could not change the Home of", npc.name, err);
				ui.notifications?.error?.(format(`${KEY}.rehomeFailed`, { name: npc.name }));
				return false;
			});
		}

		/** Where does this resident live now? The Home choices the worksheet offers, and the other sheets. */
		#askNewHome(npc) {
			// "Here" is any Home that files them back on this table: its name, or a former name some
			// NPC's Home still says (settlement-residents.js#settlementForHome).
			const resolve = settlementResolver();
			const isHere = place => resolve(place) === this.actor;
			const seen = new Set();
			// Only the sheets this user can see: a place the GM hides is not named to a player.
			const choices = [HOME_STONETOP, ...HOMES, ...settlementActors().filter(s => s.visible).map(s => s.name)]
				.filter(place => {
					const key = homeKey(place);
					if (!key || isHere(place) || seen.has(key)) return false;
					seen.add(key);
					return true;
				});
			return ContentPickerDialog.ask({
				title: format(`${KEY}.newHomeTitle`, { name: npc.name }),
				width: 420,
				body: `<p>${format(`${KEY}.newHomeBody`, { name: escHtml(npc.name), place: escHtml(this.actor.name) })}</p>
					<div class="stonetop-homestead-fields"><label class="stonetop-homestead-field">
						<span>${escHtml(localize(`${KEY}.newHomeLabel`))}</span>
						<input type="text" name="home" autocomplete="off">
					</label></div>`,
				buttonLabel: localize(`${KEY}.newHomeSave`),
				wire: form => {
					const input = form.elements.namedItem("home");
					StonetopAutocomplete.attach(input, choices);
					// Bound before the window's own submit, so a blank Home, or this place again, keeps
					// the window open and says why rather than closing it having done nothing.
					form.addEventListener("submit", event => {
						if (homeKey(input?.value) && !isHere(input.value)) return;
						event.preventDefault();
						event.stopImmediatePropagation();
						ui.notifications?.warn?.(format(`${KEY}.newHomeSame`, { name: npc.name, place: this.actor.name }));
						input?.focus();
					});
				},
				onShow: form => form.querySelector("input[name=home]")?.focus(),
				read: form => {
					const home = String(form.elements.namedItem("home")?.value ?? "").trim();
					return home && !isHere(home) ? home : null;
				},
			});
		}

		/**
		 * A Residents cell, written to its NPC: the NPC is the row's source of truth, as on Stonetop's
		 * table. A rename also refreshes the name the row keeps for a deleted NPC's row. Notes are not
		 * a cell; they open in the pop-up editor (_onEditResidentNotes).
		 */
		async #onResidentFieldChange(cell) {
			if (!this.isEditable) return;
			const field = cell.dataset.residentField;
			const path = personFieldPath("residents", field);
			const rowId = cell.closest("[data-row-id]")?.dataset.rowId;
			const row = (this.actor.system.residents ?? []).find(r => r.id === rowId);
			const npc = row && personRowActor(residentPointer(row));
			if (!path || field === "notes" || !npc) return;
			const value = field === "name" ? String(cell.value ?? "").trim() : (cell.value ?? "");
			// Refused before the write, the cell redrawn to what the NPC says: a non-owner's write would
			// only throw, and Foundry refuses a nameless actor.
			const refuse = key => {
				ui.notifications?.warn?.(format(`${KEY}.${key}`, { name: npc.name }));
				this.render(false);
			};
			if (!npc.isOwner) return refuse("cannotEditResident");
			if (field === "name" && !value) return refuse("residentNeedsName");
			const wrote = await npc.update({ [path]: value }).then(() => true, err => {
				console.warn("Stonetop | Could not write a resident's", field, err);
				this.render(false);
				return false;
			});
			if (wrote && field === "name") {
				await this.#editList("residents", rows => {
					const target = rows.find(r => r.id === rowId);
					if (!target || target.name === value) return false;
					target.name = value;
				});
			}
		}

		/** A face: enlarged in core's image window, as Stonetop's roster opens one when read. */
		#openResidentPortrait(box) {
			removeAvatarPreview();
			const src = box.querySelector(".steading-member-avatar-img")?.getAttribute("src");
			if (!src) return;
			imagePopout({ src: displayPortraitSrc(src), title: box.dataset.name ?? "" })?.render(true);
		}

		// ── Actions, called through ACTIONS (`this` is the sheet) ──────────────────

		/**
		 * Stonetop's Add Resident worksheet, with this place's name pool where the book prints one.
		 * The NPC is made at once and filed in this place's own Residents folder, OBSERVER to the
		 * table like Stonetop's residents, since this sheet shows them to everyone who can read it.
		 */
		async _onAddResident() {
			if (!this.isEditable) return;
			// Before anything is made: a Home of this name would file the new NPC on an earlier sheet.
			if (!this.#takesResidents()) return;
			const data = await new AddSteadingMemberDialog("resident", { home: this.actor.name }).promise();
			if (!data || !this.#takesResidents()) return;
			const folder = await ensureNamedActorFolder({
				name: format(`${KEY}.residentsFolder`, { name: this.actor.name }),
				color: RESIDENTS_FOLDER_COLOR,
			});
			const npc = await createPersonNpc(null, { ...data, home: this.actor.name }, { folder: folder?.id ?? null, shared: true });
			if (npc) await this.#addResident(npc, { quiet: true });
		}

		_onEditResidentNotes(_event, target) {
			return withLinkedActor(target, openNpcNotesDialog, ACTOR_LINK_MISSING.npc);
		}

		/** A list's Add button: the row window, empty; a row is added only if it is given a name. */
		async _onAddRow(_event, target) {
			const list = target.dataset.list;
			if (!ROW_FIELDS[list] || !this.isEditable) return;
			const values = await this.#askRow(list, settlementRow(list), target.textContent.trim());
			if (!values) return;
			// A trade partner the roster knows by that name links to its sheet (settlement-actor.js#tradePartnerSlug).
			if (list === "tradeWith") values.slug = tradePartnerSlug(values.partner);
			return this.#editList(list, rows => { rows.push(settlementRow(list, values)); });
		}

		/** A row's text, with the wrench on: the row window, filled in. Emptying its name removes nothing. */
		async _onEditRow(_event, target) {
			const list = target.closest("[data-list]")?.dataset.list;
			const id = target.closest("[data-row-id]")?.dataset.rowId;
			const row = id && (this.actor.system[list] ?? []).find(r => r.id === id);
			if (!ROW_FIELDS[list] || !row || !this.isEditable) return;
			const name = row[ROW_FIELDS[list][0][0]] || localize(`${KEY}.editRowTitle`);
			const values = await this.#askRow(list, row, name);
			if (!values) return;
			return this.#editList(list, rows => {
				const at = rows.find(r => r.id === id);
				if (!at) return false;
				// A renamed trade partner takes the link of the place it names now, or none, rather
				// than still opening the old one's sheet.
				if (list === "tradeWith") values.slug = tradePartnerSlug(values.partner, at);
				Object.assign(at, values);
			});
		}

		/**
		 * The row window: one labelled field per column (ROW_FIELDS), Stonetop's Trade & Barter
		 * window's field look. Resolves to the columns' values, or null when dismissed or nameless.
		 */
		#askRow(list, row, title) {
			const fields = ROW_FIELDS[list];
			const body = fields.map(([column, label]) => {
				const text = escHtml(localize(`${KEY}.${label}`));
				if (typeof SETTLEMENT_LISTS[list][column] === "boolean") {
					return `<label class="stonetop-homestead-field stonetop-homestead-field--check">
						<input type="checkbox" class="stonetop-check" name="${column}"${row[column] ? " checked" : ""}>
						<span>${text}</span>
					</label>`;
				}
				return `<label class="stonetop-homestead-field">
					<span>${text}</span>
					<input type="text" name="${column}" value="${escHtml(row[column] ?? "")}">
				</label>`;
			}).join("");
			return ContentPickerDialog.ask({
				title: `${this.actor.name}: ${title}`,
				width: 420,
				body: `<div class="stonetop-homestead-fields">${body}</div>`,
				buttonLabel: localize(`${KEY}.saveRow`),
				onShow: form => form.querySelector("input[type=text]")?.focus(),
				read: form => {
					const values = Object.fromEntries(fields.map(([column]) => {
						const input = form.elements.namedItem(column);
						return [column, input?.type === "checkbox" ? !!input.checked : String(input?.value ?? "").trim()];
					}));
					return values[fields[0][0]] ? values : null;
				},
			});
		}

		/** Who runs it, with the wrench on: its text in a window, as the rows are. */
		async _onEditGovernment() {
			if (!this.isEditable) return;
			const label = localize(`${KEY}.government`);
			const government = await ContentPickerDialog.ask({
				title: `${this.actor.name}: ${label}`,
				width: 460,
				body: `<div class="stonetop-homestead-fields"><label class="stonetop-homestead-field">
					<span>${escHtml(label)}</span>
					<textarea name="government" rows="4" placeholder="${escHtml(localize(`${KEY}.governmentPlaceholder`))}">${escHtml(this.actor.system.government ?? "")}</textarea>
				</label></div>`,
				buttonLabel: localize(`${KEY}.saveRow`),
				onShow: form => form.querySelector("textarea")?.focus(),
				read: form => String(form.elements.namedItem("government")?.value ?? "").trim(),
			});
			if (government === null || government === undefined) return;
			return this.actor.update({ "system.government": government });
		}

		_onDeleteRow(_event, target) {
			const list = target.closest("[data-list]")?.dataset.list;
			const id = target.closest("[data-row-id]")?.dataset.rowId;
			if (!isSettlementList(list) || !id || !this.isEditable) return;
			if (list === "residents") return this.#removeResident(id);
			return this.#editList(list, rows => {
				const at = rows.findIndex(r => r.id === id);
				if (at < 0) return false;
				rows.splice(at, 1);
			});
		}

		_onUnlinkLeader(_event, target) {
			const id = target.closest("[data-row-id]")?.dataset.rowId;
			if (!id || !this.isEditable) return;
			return this.#editList("leaders", rows => {
				const row = rows.find(r => r.id === id);
				if (!row?.uuid) return false;
				row.uuid = "";
			});
		}

		async _onRollMove(event, target) {
			const slug = target.dataset.move;
			const flow = homesteadMoveFlow(slug);
			if (!flow) return;
			let value = 0, winter = false;
			if (flow.rollFields) {
				const asked = await this.#askTradeAndBarter(flow);
				if (!asked) return;
				({ value, winter } = asked);
			}
			const prompted = await promptRoll({ title: flow.label, shiftKey: !!event?.shiftKey });
			if (!prompted) return;
			await rollSettlementMove(this.actor, slug, {
				rollMode: prompted.rollMode ?? "normal",
				situational: prompted.situational ?? 0,
				value, winter,
			});
		}

		/**
		 * Trade & Barter's two controls, the only ones its dice read: the item's Value, subtracted,
		 * and whether it is winter (disadvantage). Stonetop's own window's fields (homesteadFieldsHtml),
		 * so the winter box opens ticked while the world's clock, which lives on Stonetop, says winter.
		 */
		#askTradeAndBarter(flow) {
			const clockSeason = readCurrentSeason(getStonetopSteadingActor())?.season ?? "";
			return ContentPickerDialog.ask({
				title: `${this.actor.name}: ${flow.label}`,
				width: 420,
				body: `<p class="stonetop-homestead-trigger"><em>${escHtml(flow.trigger)}</em></p>
					<div class="stonetop-homestead-fields">${homesteadFieldsHtml(flow, clockSeason)}</div>`,
				buttonLabel: localize(`${KEY}.continue`),
				read: form => ({
					value: Math.max(0, parseInt(form.elements.namedItem("value")?.value, 10) || 0),
					winter: !!form.elements.namedItem("winter")?.checked,
				}),
			});
		}

		/** The place's gazetteer entry: the world's own copy when it was seeded, else the compendium's. */
		async _onOpenGazetteer() {
			const journalId = this.actor.system.journalId;
			if (!journalId) return;
			if (!await openGazetteerEntry(journalId)) ui.notifications?.warn?.(localize(`${KEY}.gazetteerMissing`));
		}

		_onOpenActor(_event, target) {
			return openLinkedActorSheet(target, ACTOR_LINK_MISSING.npc);
		}

		_onDismissSetup() {
			if (!this.isEditable) return;
			return this.actor.update({ "system.setupNote": "" });
		}

		/**
		 * GM: hide this place from the players, or show it again (OBSERVER). Hiding also drops a
		 * player's own LIMITED or OBSERVER entry, or it would keep them seeing it (dropped, not set to
		 * INHERIT: core reads a stored INHERIT on a world actor as NONE, which would outlast the next
		 * Show). A player who OWNS the place is left owning it.
		 */
		_onToggleHidden() {
			if (!game.user?.isGM) return;
			const { NONE, OBSERVER, OWNER } = CONST.DOCUMENT_OWNERSHIP_LEVELS;
			if (this.#isHidden()) return this.actor.update({ "ownership.default": OBSERVER });
			const update = { "ownership.default": NONE };
			for (const [id, level] of Object.entries(this.actor.ownership ?? {})) {
				if (id === "default" || level <= NONE || level >= OWNER) continue;
				if (game.users?.get(id)?.isGM) continue;
				const [key, value] = deletionEntry(`ownership.${id}`);
				update[key] = value;
			}
			return this.actor.update(update);
		}
	};
}
