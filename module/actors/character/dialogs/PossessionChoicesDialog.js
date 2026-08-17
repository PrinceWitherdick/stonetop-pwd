import { StonetopDialog } from "../../../utils/stonetop-dialog.js";
import { buildChoiceGroupsView } from "./possession-choice-cap.js";
import { stripHtmlToText } from "../../../utils/strings.js";

// Standalone editor for a possession's `choiceGroups` — the Blessed's sacred pouch:
// the "Your sacred pouch is…" flavor lines (radios, pick 1 each) and the
// "remarkable trait" line (checkboxes, capped at 1 + Big Magic). Separate from the
// onboarding wizard so a player can set/adjust these any time: auto-opened when a
// Blessed gains Big Magic (a fresh trait slot), or reached from the Big Magic move
// card / the sacred-pouch edit pencil on the gear tab. Writes straight to the
// actor's possession sub-choice flags, which re-renders the sheet under it.
//
// `addOnly` is the level-up surface: when auto-opened after a move frees a fresh
// trait slot, it shows ONLY the capped remarkable-trait line with prior picks locked,
// so the player adds the newly-earned trait without re-flavoring the pouch or swapping
// an existing trait. The gear-tab pencil leaves addOnly false (full editor).
export class PossessionChoicesDialog extends StonetopDialog {
	constructor(character, possessionSlug, { onDone, addOnly = false } = {}, options = {}) {
		super(options);
		this._character      = character;
		this._possessionSlug = possessionSlug;
		this._onDone         = onDone ?? null;
		this._addOnly        = addOnly;
		this._title          = "Special Possession";
	}

	static get defaultOptions() {
		return foundry.utils.mergeObject(super.defaultOptions, {
			id:        "stonetop-possession-choices-dialog",
			template:  "systems/stonetop-pwd/templates/dialogs/possession-choices.hbs",
			width:     480,
			height:    "auto",
			resizable: true,
			classes:   ["stonetop", "stonetop-possession-choices-dialog"],
		});
	}

	// Window title tracks the possession (resolved in getData); needs the override
	// because defaultOptions can't see the instance's possession label.
	get title() { return this._title; }

	get _autoHeight() { return true; }

	async getData() {
		const playbook = await this._character.playbook();
		const opt = (playbook?.specialPossessions?.options ?? []).find(o => o.slug === this._possessionSlug);
		if (!opt) return { groups: [], possessionSlug: this._possessionSlug };
		this._title = stripHtmlToText(opt.label) || "Special Possession";
		const picked     = this._character.possessions.subChoices[this._possessionSlug] ?? [];
		const moveCounts = this._character.ownedMoveCounts();
		const name = this._title.toLowerCase();
		// Add-only mode locks the traits the pouch already had — captured ON FIRST
		// RENDER so the fresh pick the player makes here stays toggleable until they
		// click Done (re-renders after each toggle reuse this baseline, not the live set).
		if (this._addOnly && this._lockedSlugs == null) this._lockedSlugs = [...picked];
		return {
			title:          this._title,
			// Not the possession's mechanical rules (those live on the gear tab) —
			// this editor only sets its descriptive traits, so say so. In add-only
			// (level-up) mode, frame it as the single new trait just earned.
			description:    this._addOnly
				? `<p>You've gained an additional remarkable trait for your ${name}. Choose it below: your existing traits stay as they are.</p>`
				: `<p>Update the traits of your ${name} below.</p>`,
			possessionSlug: this._possessionSlug,
			groups:         buildChoiceGroupsView(opt.choiceGroups, picked, moveCounts, {
				addOnly:     this._addOnly,
				lockedSlugs: this._lockedSlugs,
			}),
		};
	}

	activateListeners(html) {
		super.activateListeners(html);

		// Flavor lines (pick 1 each): select this option and drop its siblings.
		html.find(".stonetop-pc-sub-radio").on("change", async ev => {
			const { possessionSlug, choiceSlug, siblingSlugsCsv } = ev.currentTarget.dataset;
			const siblings = siblingSlugsCsv ? siblingSlugsCsv.split(",").filter(Boolean) : [];
			await this._character.selectSubChoiceExclusive(possessionSlug, choiceSlug, siblings);
			this._afterChange();
		});

		// Remarkable-trait line (capped multi-select). selectSubChoice enforces the cap in
		// the model and no-ops past it, so an over-cap click simply doesn't persist — the
		// re-render below then reflects the true (unchanged) selection.
		html.find(".stonetop-pc-sub-check").on("change", async ev => {
			const { possessionSlug, choiceSlug } = ev.currentTarget.dataset;
			if (ev.currentTarget.checked) await this._character.selectSubChoice(possessionSlug, choiceSlug);
			else await this._character.deselectSubChoice(possessionSlug, choiceSlug);
			this._afterChange();
		});

		html.find(".stonetop-pc-done").on("click", () => this.close());
	}

	// A pick changed: refresh the sheet under us, then re-render to recompute the
	// caps / disabled states / count readouts from the new selection.
	_afterChange() {
		if (this._onDone) this._onDone();
		this.render(false);
	}
}
