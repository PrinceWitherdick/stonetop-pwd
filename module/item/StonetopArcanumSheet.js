import { arcanumCardImg } from "../arcana-icons.js";
import { ITEM_FLAG_SCOPE } from "../actors/character/StonetopFlags.js";
import { centerArcanumTracks, wrapGlyphTextContainers, wrapStonetopGlyphsInEl } from "../utils/glyphs.js";
import { markValueTooltips } from "../utils/value-tooltips.js";
import { markDebilityTooltips } from "../utils/debility-tooltips.js";
import { enrichHTML } from "../utils/foundry-compat.js";
import { isInCompendium } from "../utils/compendium-edit-guard.js";
import { bringDialogToFront } from "../utils/front-on-open.js";
import { applyGuideRail } from "../utils/guide-rail.js";
import { isDefaultImg } from "../utils/strings.js";
import { STAT_KEYS } from "../utils/roll-types.js";
import { hasText } from "../actors/bestiary/codex.js";
import { buildItemReadout } from "./item-readout.js";
import { isArcanumData } from "./createArcanum.js";
import { SYSTEM_ID } from "../system-id.js";
import {
	defaultArcanumItemLine, defaultResourceDef, defaultBackMove, defaultFollower,
	newUnlockRequirement, nextOptionSlug, ensureOptionSlug, validateArcanumFlags,
	markTrackHtml, mysteryHtml, consequenceHtml,
} from "./arcanum-edit.js";

const VIEW_TEMPLATE = "systems/stonetop-pwd/templates/item/arcanum-sheet.hbs";
const EDIT_TEMPLATE = "systems/stonetop-pwd/templates/item/arcanum-sheet-edit.hbs";

// The "Max = stat" picker options, derived from the shared stat list so the order and
// labels match the rest of the app (and can't drift). { key, abbr } is the template shape.
const STAT_OPTIONS = STAT_KEYS.map(key => ({ key, abbr: key.toUpperCase() }));

// Glyph runs the toolbar inserts into the focused rich editor. Tracks need a run of 2+ to
// become interactive on the character sheet (see CharacterArcana._injectMarkers); a lone
// glyph stays decorative — so the diamond/circle buttons insert a 3-run by default.
const GLYPH_INSERTS = [
	{ ins: "◇◇◇", label: "◇◇◇", hint: "Charge / diamond track (needs 2+ to be markable)" },
	{ ins: "○○○", label: "○○○", hint: "Circle / Loyalty track (needs 2+ to be markable)" },
	{ ins: "□", label: "□", hint: "One-shot box (move / consequence / task)" },
	{ ins: "▶ ", label: "▶", hint: "Move / list arrow (decorative)" },
];

// The editor's own chrome that spells glyphs out in text: the insert-track buttons and the
// line under them, the major-mode consequence buttons (□ / □□ / □□□) and the mark-track
// hint beside them, and the warning about re-cutting a track. Redrawn as styled glyphs on
// render so a control shows the same mark it will put on the card. Display-only, and never
// a field the author types into (whose value IS its text) — what the buttons insert is read
// from `data-glyph`.
const GLYPH_CHROME = [
	".stonetop-arc-glyph",
	".stonetop-arc-glyphbar-hint",
	".stonetop-arc-add-consequence",
	".stonetop-arc-majorbar .stonetop-arc-hint",
	".stonetop-arc-issue",
].join(", ");

// The editor's sections, driving the left rail (like Make a Monster / Run an Expedition).
// Each `key` matches a `<section data-arc-tab>` in the edit template and its rail button;
// `sub` is the banner subtitle, `icon` a Font Awesome 6 glyph. Switching sections is
// client-side (no re-render), so the prose-mirror editors and unsaved field values survive.
const ARC_SECTIONS = [
	{ key: "identity",  title: "Identity",  sub: "name & tier",         icon: "fa-fingerprint" },
	{ key: "front",     title: "Front",     sub: "the curio, face-up",  icon: "fa-scroll" },
	{ key: "back",      title: "Back",      sub: "the revealed power",  icon: "fa-wand-sparkles" },
	{ key: "followers", title: "Followers", sub: "manifested summons",  icon: "fa-users" },
];

// Window widths per mode: the edit view seats the section rail; the read-only card is narrow.
const ARC_VIEW_WIDTH = 460;
const ARC_EDIT_WIDTH = 680;

// True when any character already holds this arcanum slug — in their owned/identified
// list, or via saved marks/unlock counts keyed by it. Marks are saved by POSITION within a
// track, so the editor uses this to warn that re-cutting a ◇/○/□ run shifts what those
// players have already marked.
function _arcanumSlugInUse(slug) {
	if (!slug) return false;
	const prefix = `${slug}:`;
	const keyedBySlug = map => !!map && Object.keys(map).some(k => k === slug || k.startsWith(prefix));
	for (const actor of globalThis.game?.actors ?? []) {
		// Check the live scope AND the legacy "stonetop" scope a migrated world may still
		// store arcana marks under, so renaming a slug never orphans either set of marks.
		for (const arcana of [actor.flags?.[SYSTEM_ID]?.arcana, actor.flags?.stonetop?.arcana]) {
			if (!arcana) continue;
			if ([arcana.owned, arcana.identified, arcana.flipped, arcana.minorDraw]
				.some(list => Array.isArray(list) && list.includes(slug))) return true;
			if ([arcana.boxes, arcana.unlock, arcana.backOptions, arcana.minorRoles].some(keyedBySlug)) return true;
		}
	}
	return false;
}

export function createStonetopArcanumSheetClass(BaseItemSheet) {
	return class StonetopArcanumSheet extends BaseItemSheet {
		_editMode = false;
		// Which edit-mode section the rail is showing. Preserved across the structural
		// re-renders (toggles, requirement/follower add-remove) so the author stays put.
		_activeArcSection = "identity";
		// One-shot guard: widen to seat the rail on the first edit render of a session, then
		// leave the width alone so structural re-renders don't undo a manual resize.
		_editSizeApplied = false;
		// Draft state: a card created from a character's Create button is a pending draft that
		// isn't attached to that character until Save & Done. `_arcanumOnSave(item)` performs
		// the attach (set by createArcanumItem); `_discarded` guards the delete-triggered close
		// so it doesn't re-prompt or flush a just-deleted item.
		_arcanumDraft  = false;
		_arcanumOnSave = null;
		_discarded     = false;

		static get defaultOptions() {
			return foundry.utils.mergeObject(super.defaultOptions, {
				classes: ["stonetop", "sheet", "item", "stonetop-arcanum-sheet"],
				width: 460,
				height: "auto",
				template: VIEW_TEMPLATE,
				resizable: true,
				submitOnChange: false,
				closeOnSubmit: false,
			});
		}

		// Switch templates by mode; editing is gated to world-owned arcana.
		get template() {
			return (this._editMode && this._canEditArcanum()) ? EDIT_TEMPLATE : VIEW_TEMPLATE;
		}

		// A player-authored custom move (moveType "other", flagged custom) has no read-only
		// card worth showing — hand off to the same rich authoring dialog the "Create Item →
		// Move" / Moves-tab flows use, so opening it from the sidebar reopens the editor
		// pre-filled. Arcana and legacy non-custom stubs fall through to the normal readout.
		// Editing writes back to this world Item via item.update.
		_isCustomMoveHandoff() {
			return this.item?.type === "move"
				&& this.item?.system?.moveType !== "arcanum"
				&& !!this.item?.flags?.[SYSTEM_ID]?.custom
				&& !isInCompendium(this.item);
		}

		async _render(force, options) {
			if (this._isCustomMoveHandoff()) {
				if (this._customMoveDialog?.rendered) {
					this._customMoveDialog.bringToTop();
					return;
				}
				const { CustomMoveDialog, worldMoveSaver } =
					await import("../actors/character/dialogs/CustomMoveDialog.js");
				this._customMoveDialog = new CustomMoveDialog(worldMoveSaver(), { item: this.item });
				await this._customMoveDialog.render(true);
				return;
			}
			return super._render(force, options);
		}

		// Only homebrew (world, owned, editable) arcana can be edited in place; shipped
		// compendium cards are immutable reference content.
		_canEditArcanum() {
			return isArcanumData(this.item)
				&& this.isEditable
				&& !isInCompendium(this.item);
		}

		_getHeaderButtons() {
			const buttons = super._getHeaderButtons();
			if (this._canEditArcanum()) {
				buttons.unshift({
					// A pending draft's "Done" both saves the card and attaches it to the
					// character, so label it "Save" to make that commit obvious.
					label: this._editMode ? (this._arcanumDraft ? "Save" : "Done") : "Edit",
					class: "stonetop-arcanum-edit-toggle",
					icon:  this._editMode ? "fas fa-eye" : "fas fa-pen-to-square",
					onclick: () => this._toggleEditMode(),
				});
			}
			return buttons;
		}

		async _toggleEditMode() {
			if (this._editMode) {
				await this._flushRichEditors();
				// Leaving edit mode commits a pending draft: attach it to the originating
				// character (once) so Save & Done / header Done both finish it in one click.
				if (this._arcanumDraft) await this._commitArcanumDraft();
			}
			this._editMode = !this._editMode;
			// Leaving edit re-arms the one-shot edit-width sizing so re-entering re-seats the
			// rail width; entering edit is sized by activateListeners (it runs post-render, so
			// setPosition has an element even on a freshly-created draft opened straight to edit).
			if (!this._editMode) this._editSizeApplied = false;
			await this.render(false);
			if (!this._editMode) this.setPosition({ width: ARC_VIEW_WIDTH, height: "auto" });
		}

		// Attach the finished draft to the originating character exactly once, then clear the
		// draft state so closing the (now-saved) card no longer offers to discard it.
		async _commitArcanumDraft() {
			this._arcanumDraft  = false;
			const onSave = this._arcanumOnSave;
			this._arcanumOnSave = null;
			if (!onSave) return;
			try { await onSave(this.item); }
			catch (err) { console.error("Stonetop | Failed to add arcanum to character", err); }
		}

		// Discard an unsaved draft: confirm, then delete the world Item (which tears down this
		// sheet). Returns true if discarded, false if the author chose to keep editing. A no-op
		// for a non-draft (an existing card's edits are already persisted live).
		async _discardDraft() {
			if (!this._arcanumDraft || this._discarded) return false;
			const ok = await Dialog.confirm({
				title:   "Discard arcanum?",
				content: "<p>This arcanum hasn't been saved yet. Discard it? This can't be undone.</p>",
				defaultYes: false,
				render:  bringDialogToFront,
				options: { classes: ["dialog", "stonetop"] },
			});
			if (!ok) return false;
			// Re-check after the await: the confirm is non-modal, so while it was open the author
			// could have clicked "Save & Done" (which commits the draft and clears _arcanumDraft) —
			// don't then delete the now-owned card and orphan its slug. Also bail if the world Item
			// was deleted out from under us in the meantime.
			if (!this._arcanumDraft || this._discarded || !this.item || !game.items?.get(this.item.id)) return false;
			// Suppress the discard prompt + editor flush on the delete-triggered re-entrant close.
			this._discarded     = true;
			this._arcanumOnSave = null;
			await this.item.delete();
			return true;
		}

		async close(options) {
			// If the draft's world Item was already deleted (an external delete triggers close),
			// there's nothing left to discard or flush — just tear the sheet down without prompting.
			const itemGone = !this.item || !game.items?.get(this.item.id);
			// An unsaved draft (created from a character's Create button) offers to discard on
			// close; keeping it aborts the close so the author can finish. Skipped once the card
			// has been saved (no longer a draft) or discarded (torn down by item.delete()).
			if (this._arcanumDraft && !this._discarded && !itemGone) {
				const discarded = await this._discardDraft();
				if (!discarded) return this;   // "Keep editing" → don't close
				return this;                   // discarded: item.delete() already closed the sheet
			}
			// Flush any pending rich-editor content before teardown. Skip it when the item was
			// just deleted (nothing to flush, and the update would throw).
			if (this._editMode && !this._discarded && !itemGone) await this._flushRichEditors();
			return super.close(options);
		}

		async getData() {
			const data = await super.getData();
			const flags = this.item.flags?.[ITEM_FLAG_SCOPE] ?? {};
			data.isArcanum = isArcanumData(this.item);

			// This is the only system item sheet registered for the "move" subtype, so
			// the sheet registry resolves it as the default for *every* move item that
			// has no explicit `flags.core.sheetClass` — including plain inventory items
			// (the Setting Overview's Livestock & Beasts links: Dog, Goat, Sheep) and
			// basic/special moves. Those carry no front/back glyph tracks, so render a
			// plain read-only readout instead of an empty Arcanum card.
			//
			// That readout prints the SAME entry a character sheet's gear row does — ◇ load,
			// tags, ○ uses, and the artifact hint / write-up / lead — so a treasure reads whole
			// in the Items sidebar and in the compendium it was dragged out of, not only once
			// somebody is carrying it. Gathering the fields is item-readout.js; concealment for
			// a hidden artifact happens there too, against the viewer, so nothing the ladder is
			// still withholding reaches this template.
			if (!data.isArcanum) {
				const simple = buildItemReadout(this.item, { viewerIsGM: !!game.user?.isGM });
				// The item's own art heads the card, as an arcanum's icon does. A stock
				// placeholder counts as none (isDefaultImg), so an un-illustrated item gets the
				// plain card it had rather than a bordered panel of Foundry's bag glyph.
				simple.img = isDefaultImg(this.item.img) ? null : this.item.img;
				// Both rich fields go through enrichHTML so a @UUID link, an inline roll or a
				// content link somebody typed into a write-up actually resolves. The gear row
				// does NOT enrich its copy (it prints `system.artifactLore` verbatim) — it has
				// a line of a column to work in, where a card has the room to render a link as
				// a link. The shipped Book II write-ups carry no links either way.
				[simple.description, simple.artifact.lore] = await Promise.all([
					enrichHTML(simple.description),
					enrichHTML(simple.artifact.lore),
				]);
				data.simple = simple;
				return data;
			}

			// Edit mode: hand the template raw values (+ enriched copies for the rich
			// editors) and the live validation status.
			if (this._editMode && this._canEditArcanum()) {
				data.editMode   = true;
				// Left-rail sections. The active one is preserved on `this._activeArcSection`
				// so a structural re-render re-opens the same section (the template hides the
				// others via `active.key`).
				const activeIdx = Math.max(0, ARC_SECTIONS.findIndex(s => s.key === this._activeArcSection));
				data.sections     = ARC_SECTIONS.map((s, i) => ({ ...s, index: i + 1, selected: i === activeIdx }));
				data.sectionCount = ARC_SECTIONS.length;
				data.active       = { ...ARC_SECTIONS[activeIdx], index: activeIdx + 1 };
				data.edit       = await this._buildEditContext(flags);
				// Lock the slug once a character holds the card — changing it would orphan
				// their saved marks and break the owned-slug link (the card would vanish).
				data.edit.slugLocked = _arcanumSlugInUse(flags.slug);
				// A pending draft gets a Cancel (discard) button and a "Save & Done" primary;
				// an existing card's re-edit only gets a plain "Done" (its edits persist live).
				data.edit.isDraft    = !!this._arcanumDraft;
				data.statOptions = STAT_OPTIONS;
				data.glyphs     = GLYPH_INSERTS;
				data.validation = validateArcanumFlags(flags);
				return data;
			}

			// View mode: deep-clone before transforming so we never mutate live flags.
			const front = foundry.utils.deepClone(flags.front ?? {});
			const back  = foundry.utils.deepClone(flags.back ?? {});
			if (front.description)         front.description         = centerArcanumTracks(front.description);
			if (front.unlock?.description) front.unlock.description  = centerArcanumTracks(front.unlock.description);
			if (back.description)          back.description          = centerArcanumTracks(back.description);
			data.front = front;
			data.back = back;
			data.slug = flags.slug ?? "";
			// Card art resolved by the shared helper: shipped majors use their registered icon,
			// homebrew majors fall back to author-chosen art (a stock placeholder counts as none),
			// minor arcana have none. Keeps this in lockstep with the character-sheet snapshot.
			data.arcanaImg = arcanumCardImg({ slug: flags.slug, major: flags.major, img: this.item.img });
			return data;
		}

		async _buildEditContext(flags) {
			const front  = flags.front ?? {};
			const back   = flags.back ?? {};
			const unlock = front.unlock ?? {};

			const itemForForm = it => {
				const base = it ?? defaultArcanumItemLine();
				return { ...base, inventoryColumnValue: base.inventoryColumn ?? "" };
			};
			const resourceForForm = r => {
				const base = r ?? defaultResourceDef();
				return {
					title:        base.title ?? "",
					max:          base.max ?? null,
					maxStat:      base.maxStat ?? null,
					maxStatValue: base.maxStat ?? "",
					labelsText:   (base.labels ?? []).join("\n"),
				};
			};

			// Enrich the four rich-text fields in parallel — they're independent and each
			// enrichHTML resolves @UUID links asynchronously, and this runs on every
			// structural-edit re-render (toggling major, adding a mystery, etc.).
			const [frontEnriched, unlockEnriched, backEnriched, moveEnriched] = await Promise.all([
				enrichHTML(front.description ?? ""),
				enrichHTML(unlock.description ?? ""),
				enrichHTML(back.description ?? ""),
				enrichHTML(back.move?.description ?? ""),
			]);
			return {
				name:   this.item.name ?? "",
				major:  !!flags.major,
				img:    isDefaultImg(this.item.img) ? null : this.item.img,
				front: {
					title:               front.title ?? "",
					description:         front.description ?? "",
					descriptionEnriched: frontEnriched,
					hasItem:             !!front.item,
					item:                itemForForm(front.item),
					unlock: {
						description:         unlock.description ?? "",
						descriptionEnriched: unlockEnriched,
						requirements: (unlock.requirements ?? []).map(r => ({
							type:        r.type,
							isOption:    r.type === "option",
							isText:      r.type === "text",
							slug:        r.slug ?? "",
							description: r.description ?? "",
							content:     r.content ?? "",
							max:         r.max ?? 1,
						})),
					},
				},
				back: {
					title:               back.title ?? "",
					description:         back.description ?? "",
					descriptionEnriched: backEnriched,
					hasItem:             !!back.item,
					item:                itemForForm(back.item),
					hasItemResource:     !!back.item?.resource,
					itemResource:        resourceForForm(back.item?.resource),
					hasResource:         !!back.resource,
					resource:            resourceForForm(back.resource),
					hasMove:             !!back.move,
					move: {
						name:                back.move?.name ?? "",
						description:         back.move?.description ?? "",
						descriptionEnriched: moveEnriched,
					},
				},
				summonFollowers: (flags.summon?.followers ?? []).map(f => ({
					name:       f.name ?? "",
					pronoun:    f.pronoun ?? "",
					typeLabel:  f.typeLabel ?? "",
					tags:       Array.isArray(f.tags) ? f.tags.join(", ") : (f.tags ?? ""),
					hp:         f.hp ?? 0,
					armor:      f.armor ?? "",
					damage:     f.damage ?? "",
					instinct:   f.instinct ?? "",
					moves:      f.moves ?? "",
					cost:       f.cost ?? "",
					loyalty:    f.loyalty ?? 0,
					notes:      f.notes ?? "",
					repeatable: !!f.repeatable,
				})),
			};
		}

		activateListeners(html) {
			super.activateListeners(html);
			const root = html?.[0] ?? html;
			if (!root) return;

			if (this._editMode && this._canEditArcanum()) {
				root.addEventListener("change", ev => this._onEditChange(ev));
				root.addEventListener("click",  ev => this._onEditClick(ev));
				// Insert glyph runs on mousedown so the focused editor keeps focus.
				root.querySelectorAll(".stonetop-arc-glyph").forEach(btn =>
					btn.addEventListener("mousedown", ev => { ev.preventDefault(); this._insertGlyph(btn.dataset.glyph); }));
				// Redraw the toolbar's own ◇ ○ □ ▶ as the same styled glyphs the cards paint, so a
				// button shows what it will actually put on the card rather than the fallback-font
				// character. Done here rather than via wrapGlyphTextContainers: that list is for
				// containers of *authored* text, and this is the editor's own chrome. Display-only —
				// what gets inserted is read from `data-glyph`, never from the button's text.
				root.querySelectorAll(GLYPH_CHROME).forEach(el => wrapStonetopGlyphsInEl(el));
				// Hide "Next" if the rail opens on the last section.
				this._syncArcNext(root);
				// Seat the rail width once per edit session (covers a freshly-created draft that
				// opens straight into edit mode, where _toggleEditMode never ran). setPosition is
				// safe here — activateListeners runs after the element exists.
				if (!this._editSizeApplied) {
					this._editSizeApplied = true;
					this.setPosition({ width: ARC_EDIT_WIDTH, height: "auto" });
				}
				return;
			}

			// View mode. Give "Value N" mentions the shared hover tooltip the journals and
			// actor sheets show, and render inline glyphs (◇ □ ○ ▶) as SVG like the
			// character sheet's arcana cards. Self-gated by setting.
			markValueTooltips(root);
			markDebilityTooltips(root);
			wrapGlyphTextContainers(root);
		}

		// ── Edit dispatch ─────────────────────────────────────────────────────────

		async _onEditChange(ev) {
			const t = ev.target;

			// Requirement type select restructures the row (option ↔ text fields differ).
			if (t.classList?.contains("stonetop-arc-req-type")) {
				await this._flushRichEditors();
				return this._rebuildRequirements({ render: true });
			}
			// Any other requirement input → rebuild the array silently (DOM already correct).
			if (t.closest(".stonetop-arc-req-row")) return this._rebuildRequirements({ render: false });

			// Follower field → rebuild the followers array silently.
			if (t.closest(".stonetop-arc-foll-row")) return this._rebuildSummon({ render: false });

			// Presence toggles add/remove a sub-object → restructure.
			const toggle = t.closest("[data-arc-toggle]");
			if (toggle) return this._onToggle(toggle.dataset.arcToggle, toggle.checked);

			// Generic scalar / select field. Rich (prose-mirror) content is intentionally NOT
			// saved here — it's flushed on Done/close/toggle/append (every path before a
			// re-render or exit). Saving on the per-change event lets a prose-mirror's stale
			// teardown `change` (fired when a re-render replaces it) clobber freshly-saved content.
			const fieldEl = t.closest("[data-arc-field]");
			if (!fieldEl || fieldEl.tagName === "PROSE-MIRROR") return;
			const path = fieldEl.dataset.arcField;
			let value;
			if (fieldEl.matches?.('input[type="checkbox"]')) {
				value = fieldEl.checked;
			} else if (fieldEl.dataset.arcType === "number") {
				value = fieldEl.value === "" ? null : Number(fieldEl.value);
				if (Number.isNaN(value)) value = null;
			} else if (fieldEl.dataset.arcType === "lines") {
				value = fieldEl.value.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
			} else {
				value = fieldEl.value;
			}
			if (value === "" && (path.endsWith(".maxStat") || path.endsWith(".inventoryColumn"))) value = null;

			// Toggling major shows/hides the major-tools UI, so it needs a re-render.
			if (path.endsWith(".major")) {
				await this._flushRichEditors();
				return this.item.update({ [path]: value });
			}
			await this.item.update({ [path]: value }, { render: false });
		}

		_onEditClick(ev) {
			// Left-rail section switch + "Next" walk — purely client-side (no re-render), so
			// the prose-mirror editors and any unsaved field values are preserved.
			const tab = ev.target.closest(".stonetop-arc-tab");
			if (tab) { ev.preventDefault(); return this._selectArcSection(tab.dataset.arcTab); }
			const next = ev.target.closest(".stonetop-arc-next");
			if (next) { ev.preventDefault(); return this._selectNextArcSection(); }

			// Footer actions: Save & Done finishes the card (flush + attach draft + preview);
			// Cancel discards an unsaved draft.
			const save = ev.target.closest(".stonetop-arc-save");
			if (save) { ev.preventDefault(); return this._toggleEditMode(); }
			const cancel = ev.target.closest(".stonetop-arc-cancel");
			if (cancel) { ev.preventDefault(); return this._discardDraft(); }
			const add = ev.target.closest(".stonetop-arc-req-add");
			if (add) { ev.preventDefault(); return this._addRequirement(add.dataset.reqType || "option"); }
			const rem = ev.target.closest(".stonetop-arc-req-remove");
			if (rem) {
				ev.preventDefault();
				return this._removeRequirement(Number(rem.closest(".stonetop-arc-req-row")?.dataset?.reqIndex));
			}
			// Major-mode authoring helpers.
			const art = ev.target.closest(".stonetop-arc-pick-art");
			if (art) { ev.preventDefault(); return this._onPickArt(); }
			const track = ev.target.closest(".stonetop-arc-marktrack");
			if (track) { ev.preventDefault(); return this._appendToField(`flags.${ITEM_FLAG_SCOPE}.front.unlock.description`, markTrackHtml(track.dataset.marks)); }
			const myst = ev.target.closest(".stonetop-arc-add-mystery");
			if (myst) { ev.preventDefault(); return this._appendToField(`flags.${ITEM_FLAG_SCOPE}.back.description`, mysteryHtml()); }
			const cons = ev.target.closest(".stonetop-arc-add-consequence");
			if (cons) { ev.preventDefault(); return this._appendToField(`flags.${ITEM_FLAG_SCOPE}.back.description`, consequenceHtml(cons.dataset.weight)); }
			// Manifested-follower list.
			const fadd = ev.target.closest(".stonetop-arc-foll-add");
			if (fadd) { ev.preventDefault(); return this._addFollower(); }
			const frem = ev.target.closest(".stonetop-arc-foll-remove");
			if (frem) {
				ev.preventDefault();
				return this._removeFollower(Number(frem.closest(".stonetop-arc-foll-row")?.dataset?.follIndex));
			}
		}

		// ── Section rail ────────────────────────────────────────────────────────────

		// Show one editor section and light its rail entry, updating the banner — all DOM,
		// no re-render, so prose-mirror editors and unsaved field edits survive the switch.
		_selectArcSection(key) {
			const index = ARC_SECTIONS.findIndex(s => s.key === key);
			if (index < 0) return;
			this._activeArcSection = key;
			const root = this.element?.[0];
			if (!root) return;
			const active = ARC_SECTIONS[index];

			applyGuideRail(root, {
				key, dataKey: "arcTab",
				tabSelector: ".stonetop-arc-tab",
				sectionSelector: ".stonetop-arc-section",
				iconSelector: ".stonetop-arc-banner-icon",
				icon: active.icon,
				iconExtraClass: "stonetop-arc-banner-icon",
				mainSelector: ".stonetop-arc-main",
			});

			const title = root.querySelector(".stonetop-arc-banner-title");
			if (title) title.textContent = active.title;
			const sub = root.querySelector(".stonetop-arc-banner-sub");
			if (sub) sub.textContent = active.sub;
			const count = root.querySelector(".stonetop-arc-banner-count");
			if (count) count.textContent = `${index + 1} / ${ARC_SECTIONS.length}`;

			this._syncArcNext(root);
		}

		// "Next" walks the rail one section at a time (same client-side switch).
		_selectNextArcSection() {
			const next = ARC_SECTIONS[ARC_SECTIONS.findIndex(s => s.key === this._activeArcSection) + 1];
			if (next) this._selectArcSection(next.key);
		}

		// Hide "Next" once the last section is active (nothing left to advance to).
		_syncArcNext(root) {
			const btn = root?.querySelector(".stonetop-arc-next");
			if (btn) btn.hidden = ARC_SECTIONS.findIndex(s => s.key === this._activeArcSection) >= ARC_SECTIONS.length - 1;
		}

		// Append a guided HTML snippet to a rich field, then re-render to show it. Does it in a
		// SINGLE update that also flushes the other live editors (so unsaved edits survive the
		// re-render) — a flush-then-append pair of rapid updates drops the second write.
		async _appendToField(path, snippet) {
			if (this._appending) return;
			this._appending = true;
			try {
				const updates = this._collectEditorUpdates();
				const base = (path in updates) ? updates[path] : (foundry.utils.getProperty(this.item, path) ?? "");
				updates[path] = `${base}${snippet}`;
				await this.item.update(updates);
			} finally {
				this._appending = false;
			}
		}

		// Map of flag-path → live editor value for every rich editor whose content changed,
		// skipping empty reads from un-activated editors (which would clobber stored content).
		_collectEditorUpdates() {
			const root = this.element?.[0];
			const updates = {};
			root?.querySelectorAll("prose-mirror[data-arc-field]").forEach(pm => {
				const path = pm.dataset.arcField;
				if (!path) return;
				const val    = pm.value ?? "";
				const stored = foundry.utils.getProperty(this.item, path) ?? "";
				if (!hasText(val) && hasText(stored)) return;
				if (val !== stored) updates[path] = val;
			});
			return updates;
		}

		_onPickArt() {
			const FP = foundry.applications?.apps?.FilePicker?.implementation ?? globalThis.FilePicker;
			new FP({
				type: "image",
				current: this.item.img,
				callback: path => this.item.update({ img: path }),
			}).render(true);
		}

		async _insertGlyph(text) {
			if (!text) return;
			// Resolve the focused rich field, scoped to THIS sheet's editors so a glyph never
			// lands in some other app's editor that happens to hold focus.
			const root = this.element?.[0];
			const pm   = document.activeElement?.closest?.("prose-mirror[data-arc-field]");
			if (!pm || (root && !root.contains(pm))) {
				ui.notifications?.info("Click into a description, then insert the track.");
				return;
			}
			// Insert at the caret. execCommand still works inside ProseMirror's contenteditable
			// in current Chromium (its DOM observer syncs the mutation the same way it syncs
			// typing), but it's deprecated — if the platform no longer supports it, fall back to
			// appending the run to the field's stored value so the glyph never silently vanishes.
			const inserted = document.execCommand("insertText", false, text);
			if (!inserted) await this._appendToField(pm.dataset.arcField, text);
		}

		_flags() { return this.item.flags?.[ITEM_FLAG_SCOPE] ?? {}; }

		// Persist any unsaved rich-editor content (e.g. before a re-render or on close) without
		// re-rendering. An un-activated ProseMirror can report an empty value; _collectEditorUpdates
		// never lets that clobber stored content (legitimate clears go through the editor's own
		// change event).
		async _flushRichEditors() {
			const updates = this._collectEditorUpdates();
			if (Object.keys(updates).length) await this.item.update(updates, { render: false });
		}

		_defaultForToggle(which) {
			if (which.endsWith(".resource")) return defaultResourceDef();
			if (which.endsWith(".move"))     return defaultBackMove();
			return defaultArcanumItemLine();
		}

		async _onToggle(which, on) {
			await this._flushRichEditors();
			await this.item.update({ [`flags.${ITEM_FLAG_SCOPE}.${which}`]: on ? this._defaultForToggle(which) : null });
		}

		async _addRequirement(type) {
			await this._flushRichEditors();
			const reqs  = [...(this._flags().front?.unlock?.requirements ?? [])];
			const taken = new Set(reqs.filter(r => r.type === "option").map(r => r.slug));
			const slug  = type === "option" ? nextOptionSlug(taken) : "";
			reqs.push(newUnlockRequirement(type, slug));
			await this.item.update({ [`flags.${ITEM_FLAG_SCOPE}.front.unlock.requirements`]: reqs });
		}

		async _removeRequirement(index) {
			if (Number.isNaN(index)) return;
			await this._flushRichEditors();
			const reqs = [...(this._flags().front?.unlock?.requirements ?? [])];
			reqs.splice(index, 1);
			await this.item.update({ [`flags.${ITEM_FLAG_SCOPE}.front.unlock.requirements`]: reqs });
		}

		_rebuildRequirements({ render = false } = {}) {
			const root = this.element?.[0];
			if (!root) return;
			const taken = new Set();
			const reqs = [...root.querySelectorAll(".stonetop-arc-req-row")].map(row => {
				const type = row.querySelector('[data-req-prop="type"]')?.value ?? "option";
				if (type === "text") {
					return { type: "text", content: row.querySelector('[data-req-prop="content"]')?.value ?? "" };
				}
				const description = row.querySelector('[data-req-prop="description"]')?.value ?? "";
				const slug = ensureOptionSlug(row.querySelector('[data-req-prop="slug"]')?.value ?? "", description, taken);
				taken.add(slug);
				const maxRaw = row.querySelector('[data-req-prop="max"]')?.value;
				const max = maxRaw ? Math.max(1, Number(maxRaw) || 1) : 1;
				return { type: "option", slug, description, max };
			});
			return this.item.update({ [`flags.${ITEM_FLAG_SCOPE}.front.unlock.requirements`]: reqs }, { render });
		}

		// ── Manifested followers (data-driven summons) ──────────────────────────────

		async _addFollower() {
			await this._flushRichEditors();
			const followers = [...(this._flags().summon?.followers ?? []), defaultFollower()];
			await this.item.update({ [`flags.${ITEM_FLAG_SCOPE}.summon.followers`]: followers });
		}

		async _removeFollower(index) {
			if (Number.isNaN(index)) return;
			await this._flushRichEditors();
			const followers = [...(this._flags().summon?.followers ?? [])];
			followers.splice(index, 1);
			await this.item.update({ [`flags.${ITEM_FLAG_SCOPE}.summon.followers`]: followers });
		}

		_rebuildSummon({ render = false } = {}) {
			const root = this.element?.[0];
			if (!root) return;
			const num = el => { const x = el?.value; return x === "" || x == null ? 0 : (Number(x) || 0); };
			const followers = [...root.querySelectorAll(".stonetop-arc-foll-row")].map(row => {
				const v = p => row.querySelector(`[data-foll-prop="${p}"]`)?.value ?? "";
				return {
					name:       v("name"),
					pronoun:    v("pronoun"),
					typeLabel:  v("typeLabel"),
					tags:       v("tags"),
					hp:         num(row.querySelector('[data-foll-prop="hp"]')),
					armor:      v("armor"),
					damage:     v("damage"),
					instinct:   v("instinct"),
					moves:      v("moves"),
					cost:       v("cost"),
					loyalty:    num(row.querySelector('[data-foll-prop="loyalty"]')),
					notes:      v("notes"),
					repeatable: row.querySelector('[data-foll-prop="repeatable"]')?.checked || false,
				};
			});
			return this.item.update({ [`flags.${ITEM_FLAG_SCOPE}.summon.followers`]: followers }, { render });
		}
	};
}
