import { StonetopDialog } from "../utils/stonetop-dialog.js";
import { normalizeRollType } from "../utils/roll-types.js";
import { customMoveDescriptionToPlainText } from "../utils/custom-move-text.js";
import {
	createLoveLetter, updateLoveLetter, sendLoveLetter, isDraftLoveLetter, loveLetterDrafts,
	loveLetterRecipientOptions, loveLetterRollOptions,
} from "../actors/character/love-letters.js";

/**
 * GM authoring dialog for a love letter (Book I, p.568) — a single-use move addressed to
 * one PC. Launched from the "Write a Love Letter" hotbar macro (create mode: pick the
 * recipient) or from the pencil on a letter's card (edit mode: recipient is fixed). On
 * save it writes an embedded `move` item onto the recipient character; the shaping of that
 * document lives in love-letters.js so this dialog only gathers raw input.
 *
 * A letter can also be saved as a draft: it goes onto the recipient's sheet unsent, where only
 * the GM sees it, and the window stays open on it. A blank window lists the saved drafts to pick
 * one back up; a draft's window offers Send beside Save as draft.
 */
export class LoveLetterDialog extends StonetopDialog {
	/**
	 * @param {object}   [opts]
	 * @param {Item}     [opts.item]    - existing love letter to edit; null = create
	 * @param {Actor}    [opts.actor]   - the recipient (edit mode); ignored in create mode
	 * @param {Function} [opts.onSaved] - called after a successful save
	 */
	constructor({ item = null, actor = null, onSaved = null } = {}, options = {}) {
		super(options);
		this._item = item;
		this._actor = actor ?? item?.parent ?? null;
		this._onSaved = onSaved;
	}

	// Convenience entry point for the hotbar macro / console: game.stonetop.openLoveLetter().
	static open() {
		if (!game.user?.isGM) {
			return void ui.notifications.warn(game.i18n.localize("stonetop.character.moves.loveLetter.gmOnly"));
		}
		if (!game.actors.some(a => a.type === "character")) {
			return void ui.notifications.warn(game.i18n.localize("stonetop.character.moves.loveLetter.noRecipients"));
		}
		return new LoveLetterDialog().render(true);
	}

	static get defaultOptions() {
		return foundry.utils.mergeObject(super.defaultOptions, {
			template: "systems/stonetop-pwd/templates/dialogs/love-letter.hbs",
			width: 520,
			height: "auto",
			resizable: true,
			classes: ["stonetop", "stonetop-love-letter-dialog"],
		});
	}

	get title() {
		const key = !this._item ? "createTitle" : (this._isDraft() ? "draftTitle" : "editTitle");
		return game.i18n.localize(`stonetop.character.moves.loveLetter.${key}`);
	}

	// Is the letter in this window an unsent draft? (A blank window is not.)
	_isDraft() {
		return !!this._item && isDraftLoveLetter(this._item);
	}

	getData() {
		const sys = this._item?.system ?? {};
		const rollType = normalizeRollType(sys.rollType) ?? "";
		const mr = sys.moveResults ?? {};
		const options = Array.isArray(sys.pickOptions) ? sys.pickOptions.filter(Boolean) : [];
		// A letter is authored in one of two result styles, and reopens in whichever it was
		// saved with. List style is prose's superset (a pool, pick counts, and optional words
		// per result), so the shared pick-list POOL (pickOptions) decides it first. Pick counts
		// alone do NOT: the pre-rename dialog showed a "Pick N" box beside every prose tier, so a
		// legacy prose letter can carry a stray non-zero pick alongside real prose, and it stays
		// prose. Only bare pick counts (no pool, no prose) read as list. The template picks the
		// checked radio / visible panel off resultStyle via the `eq` helper.
		const hasProse = !!(mr.success?.value || mr.partial?.value || mr.failure?.value);
		const hasPicks = !!(mr.success?.pick || mr.partial?.pick || mr.failure?.pick);
		const resultStyle = options.length > 0 ? "list" : (hasProse ? "prose" : (hasPicks ? "list" : "prose"));
		const isDraft = this._isDraft();
		// A blank window lists the drafts to pick back up, newest first.
		const drafts = this._item ? [] : loveLetterDrafts().map(({ actor, item }) => ({
			actorId: actor.id, itemId: item.id, name: item.name, recipient: actor.name,
		}));
		return {
			isEdit: !!this._item,
			isDraft,
			// Save as draft is offered until the letter is sent; after that an edit just saves.
			canDraft: !this._item || isDraft,
			drafts,
			recipients: this._item ? [] : loveLetterRecipientOptions(),
			recipientName: this._actor?.name ?? "",
			name: this._item?.name ?? "",
			description: customMoveDescriptionToPlainText(sys.description),
			rollOptions: loveLetterRollOptions(rollType),
			hasRoll: rollType !== "",
			resultStyle,
			results: {
				success: mr.success?.value ?? "",
				partial: mr.partial?.value ?? "",
				failure: mr.failure?.value ?? "",
				pickSuccess: mr.success?.pick || "",
				pickPartial: mr.partial?.pick || "",
				pickFailure: mr.failure?.pick || "",
			},
			// The shared "choose from this list" pool, one option per line for the textarea.
			options: options.join("\n"),
			// A miss marks XP by default (checkbox checked); an existing letter reflects
			// whatever the GM last saved.
			markXp: this._item ? !sys.noXpOnMiss : true,
			signed: sys.signed ?? "",
		};
	}

	activateListeners(html) {
		super.activateListeners(html);
		const root = html[0];

		// Reveal the 10+/7-9/6- result fields only when the letter actually rolls.
		const results = root.querySelector(".stonetop-love-letter-results");
		const rollSelect = root.querySelector("[name=rollType]");
		const syncResults = () => results?.classList.toggle("is-hidden", !rollSelect?.value);
		rollSelect?.addEventListener("change", syncResults);
		syncResults();

		// Swap between the freeform-prose panel and the pick-from-list panel; only the
		// active style is shown (via data-result-style) and, on save, only it is persisted.
		const syncStyle = () => {
			if (results) results.dataset.resultStyle = this._selectedStyle(root);
		};
		root.querySelectorAll("[name=resultStyle]").forEach(r => r.addEventListener("change", syncStyle));
		syncStyle();

		root.querySelector(".stonetop-love-letter-save")?.addEventListener("click", () => this._save(root));
		root.querySelector(".stonetop-love-letter-draft")?.addEventListener("click", () => this._save(root, { draft: true }));
		root.querySelector(".stonetop-love-letter-cancel")?.addEventListener("click", () => this.close());
		root.querySelectorAll(".stonetop-love-letter-draft-open").forEach(btn => btn.addEventListener("click", () => {
			const item = game.actors.get(btn.dataset.actorId)?.items.get(btn.dataset.itemId);
			if (item) this._showLetter(item);
		}));
	}

	// Turn this window onto a saved letter (a draft just saved, or one picked from the list).
	_showLetter(item) {
		this._item = item;
		this._actor = item.parent ?? this._actor;
		this.render(false);
		// A V1 re-render keeps the old header, so put the new title on it by hand.
		const titleEl = this.element?.[0]?.querySelector?.(".window-title");
		if (titleEl) titleEl.textContent = this.title;
	}

	// Which result style the GM has toggled on ("prose" | "list"); defaults to prose.
	_selectedStyle(root) {
		return root.querySelector("[name=resultStyle]:checked")?.value === "list" ? "list" : "prose";
	}

	/**
	 * Save the window. Sending (the default) puts the letter in front of the player; `draft`
	 * saves it unsent and keeps the window open on it.
	 */
	async _save(root, { draft = false } = {}) {
		const val = (sel) => StonetopDialog.readValue(root, sel);

		// Create mode needs a recipient; edit mode keeps the letter on its current actor.
		let actor = this._actor;
		if (!this._item) {
			const recipientId = val("[name=recipient]");
			actor = recipientId ? game.actors.get(recipientId) : null;
			if (!actor) {
				ui.notifications.warn(game.i18n.localize("stonetop.character.moves.loveLetter.recipientRequired"));
				root.querySelector("[name=recipient]")?.focus();
				return;
			}
		}

		// A draft can be untitled for now; it's named before it goes out.
		const name = val("[name=name]").trim();
		if (!name && !draft) {
			ui.notifications.warn(game.i18n.localize("stonetop.character.moves.loveLetter.nameRequired"));
			root.querySelector("[name=name]")?.focus();
			return;
		}

		// Persist ONLY the fields of the chosen result style: prose style drops the pool and
		// pick counts, list style keeps them plus its own per-result words (the list panel's
		// listSuccess/... fields, not the hidden prose panel's).
		const isList = this._selectedStyle(root) === "list";
		const input = {
			name,
			description: val("[name=description]"),
			rollType: val("[name=rollType]"),
			signed: val("[name=signed]"),
			// "Mark XP on a miss" checked ⇒ mark XP (noXpOnMiss false), and vice versa.
			noXpOnMiss: !root.querySelector("[name=markXp]")?.checked,
			// List style: shared pool (one option per line) + how many to pick per tier.
			options: isList ? val("[name=options]") : "",
			picks: isList ? {
				success: val("[name=pickSuccess]"),
				partial: val("[name=pickPartial]"),
				failure: val("[name=pickFailure]"),
			} : { success: 0, partial: 0, failure: 0 },
			// The 10+/7-9/6- words: the whole outcome in prose style, an optional addition to
			// the picks in list style.
			results: isList ? {
				success: val("[name=listSuccess]"),
				partial: val("[name=listPartial]"),
				failure: val("[name=listFailure]"),
			} : {
				success: val("[name=success]"),
				partial: val("[name=partial]"),
				failure: val("[name=failure]"),
			},
		};

		if (draft) {
			const item = this._item
				? (await updateLoveLetter(this._item, input), this._item)
				: await createLoveLetter(actor, input, { draft: true });
			if (!item) return;
			ui.notifications.info(game.i18n.format("stonetop.character.moves.loveLetter.draftSaved", { name: actor.name }));
			this._onSaved?.();
			this._showLetter(item);
			return;
		}

		if (this._item) {
			const wasDraft = this._isDraft();
			await updateLoveLetter(this._item, input);
			if (wasDraft) {
				await sendLoveLetter(this._item);
				ui.notifications.info(game.i18n.format("stonetop.character.moves.loveLetter.created", { name: actor.name }));
			}
		} else {
			const created = await createLoveLetter(actor, input);
			if (created) {
				ui.notifications.info(game.i18n.format("stonetop.character.moves.loveLetter.created", { name: actor.name }));
			}
		}
		this._onSaved?.();
		this.close();
	}
}
