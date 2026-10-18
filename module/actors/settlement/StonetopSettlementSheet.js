// The settlement sheet: a steading that is not Stonetop.
//
// What Book II prints for a place (Size, Population, Prosperity, Defenses, who it trades with, its
// Resources and the Defenses list), the people who run it, the four homefront moves its stats are
// for (Book I p.508), and a notes box. Stonetop's standing with the place is shown here too, but
// STORED on Stonetop (`system.relationships`, actors/settlement/settlement-actor.js#standingKey),
// so the hearts here and on Stonetop's Other Settlements table are one rating.
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
import { getStonetopSteadingActor, isSteadingActor } from "../../utils/world.js";
import { heartSlots, readRelationship, relationSummary, setRelationshipHearts } from "../../utils/relationship-hearts.js";
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
import { rosterSettlement, settlementsBySlug, standingKey } from "./settlement-actor.js";
import { SETTLEMENT_MOVES, rollSettlementMove, settlementIsLacking, settlementRolledStat } from "./settlement-rolls.js";
import { isSettlementList, settlementRow } from "./settlement-rows.js";
import { escHtml } from "../../utils/strings.js";
import { deletionEntry } from "../../utils/foundry-compat.js";

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
	setStanding:   "_onSetStanding",
	unlinkLeader:  "_onUnlinkLeader",
};

/** A settlement's three stats. Fortunes and Surplus are Stonetop's alone (Book I p.508). */
const STATS = ["population", "prosperity", "defenses"];

/**
 * @param {typeof ActorSheet} Base  core's V1 actor sheet
 */
export function createStonetopSettlementSheetClass(Base) {
	// withSheetSizeMemory: reopen at the size this user last left a settlement sheet at.
	return class StonetopSettlementSheet extends withSheetSizeMemory(Base) {
		/** The `updateActor` hook that redraws Stonetop's hearts here, while this sheet is open. */
		_stonetopStandingHook = null;

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

			const stonetop = getStonetopSteadingActor();
			const key = standingKey(actor);
			const standing = stonetop && key ? this.#standingContext(stonetop, key) : null;
			const sheetsBySlug = settlementsBySlug();

			Object.assign(context, {
				actor,
				system,
				editable,
				canWrite,
				isGM: !!game.user?.isGM,
				hidden: this.#isHidden(),
				sizes: STEADING_SIZES.map(id => ({ id, label: localize(`${KEY}.size.${id}`), selected: id === system.size })),
				sizeLabel: localize(`${KEY}.size.${system.size}`),
				sizeRule: localize(`${KEY}.sizeRule.${system.size}`),
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
				standing,
				stonetopName: stonetop?.name ?? "Stonetop",
				canGazetteer: !!system.journalId,
				sourcePage: system.sourcePage ?? "",
				blurb: rosterSettlement(system.sourceSlug)?.blurb ?? "",
				moves: SETTLEMENT_MOVES.map(slug => this.#moveContext(slug, system)),
				enrichedNotes: await foundry.applications.ux.TextEditor.implementation.enrichHTML(system.notes ?? "", {
					relativeTo: actor, secrets: actor.isOwner,
				}),
			});
			return context;
		}

		/**
		 * @inheritDoc: watch Stonetop. The standing shown here is stored there, so a heart moved on
		 * Stonetop's own Other Settlements table must redraw this sheet too; core only redraws a sheet
		 * for its OWN document's updates. Hooked on the first render, unhooked in close.
		 */
		async _render(force, options) {
			await super._render(force, options);
			injectHeaderToggle(this, "settlement");
			stripHeaderChrome(this);
			this.element[0]?.classList.toggle("stonetop-edit-mode", this._editMode);
			if (this._stonetopStandingHook === null && this.rendered) {
				this._stonetopStandingHook = Hooks.on("updateActor", (doc, changed) => {
					if (!isSteadingActor(doc)) return;
					// Only this place's own row (written, or deleted as `-=key`), not every heart Stonetop moves.
					const key = standingKey(this.actor);
					const rels = changed?.system?.relationships;
					if (key && rels && (key in rels || `-=${key}` in rels)) this.render(false);
				});
			}
		}

		/** @inheritDoc */
		async close(options) {
			if (this._stonetopStandingHook !== null) Hooks.off("updateActor", this._stonetopStandingHook);
			this._stonetopStandingHook = null;
			return super.close(options);
		}

		/** Stonetop's hearts for this place, on Stonetop's own row. */
		#standingContext(stonetop, key) {
			const { hearts, notes } = readRelationship(stonetop.system?.relationships?.[key]);
			return {
				notes,
				canRate: !!stonetop.isOwner,
				feeling: relationSummary(hearts, stonetop.name, this.actor.name),
				slots: heartSlots(hearts),
			};
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

			// A reader may still roll, read and follow links (see the head of this file).
			if (!this.isEditable) for (const el of root.querySelectorAll("[data-reader-ok]")) el.disabled = false;

			root.addEventListener("click", event => this.#dispatch(event, "[data-action]"));
			// A move's NAME rolls it, as on Stonetop's Moves tab. It is a <strong role="button">, not a
			// <button> (core would disable that for a reader), so Enter and Space are wired by hand.
			root.addEventListener("keydown", event => {
				if (event.key === "Enter" || event.key === " ") this.#dispatch(event, "[role='button'][data-action]");
			});

			// The notes: saved whole on the editor's own change (it carries no `name`).
			root.querySelector(".stonetop-settlement-notes prose-mirror")?.addEventListener("change", event => {
				if (!this.isEditable) return;
				this.actor.update({ "system.notes": event.currentTarget.value ?? "" });
			});
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
		 * Hidden from the players: no player can see it. Core lists an actor in a player's sidebar from
		 * LIMITED up, by their own entry or the default, so both are asked, through core's own test.
		 */
		#isHidden() {
			return !(game.users ?? []).some(user => !user.isGM && this.actor.testUserPermission(user, "LIMITED"));
		}

		/** @inheritDoc: list rows are written here, by id; everything else is core's submit. */
		async _onChangeInput(event) {
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

		/** The list writes in flight, one after another; see #editList. */
		#listWrites = Promise.resolve();

		/**
		 * Read a list, change it, write it whole. `edit` returning false skips the write. The writes
		 * queue: the document only takes a write in when the server answers, so a second edit read
		 * while the first was still out would start from the old rows and write the first one away.
		 * Each one reads the rows only once the one before it has landed.
		 */
		#editList(list, edit) {
			const write = async () => {
				const rows = (this.actor.system[list] ?? []).map(r => ({ ...r }));
				if (edit(rows) === false) return;
				await this.actor.update({ [`system.${list}`]: rows });
			};
			const next = this.#listWrites.then(write);
			this.#listWrites = next.catch(() => {});
			return next;
		}

		/** @inheritDoc: an NPC or character dropped on the People tab joins its leaders. */
		async _onDropActor(event, data) {
			if (!this.isEditable || !this._editMode) return false;
			const actor = await getDocumentClass("Actor").fromDropData(data);
			if (!actor || actor.id === this.actor.id) return false;
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

		// ── Actions, called through ACTIONS (`this` is the sheet) ──────────────────

		_onAddRow(_event, target) {
			const list = target.dataset.list;
			if (!isSettlementList(list) || !this.isEditable) return;
			return this.#editList(list, rows => { rows.push(settlementRow(list)); });
		}

		_onDeleteRow(_event, target) {
			const list = target.closest("[data-list]")?.dataset.list;
			const id = target.closest("[data-row-id]")?.dataset.rowId;
			if (!isSettlementList(list) || !id || !this.isEditable) return;
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

		/** Stonetop's hearts for this place, written on Stonetop. */
		async _onSetStanding(_event, target) {
			const stonetop = getStonetopSteadingActor();
			const position = Number(target.dataset.position);
			const key = standingKey(this.actor);
			if (!stonetop?.isOwner || !position || !key) return;
			await setRelationshipHearts(stonetop, key, position);
		}
	};
}
