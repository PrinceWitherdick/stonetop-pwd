import { StonetopDialog } from "../../../utils/stonetop-dialog.js";
import { gearNoteChips, wrapGearNoteTerms, buildUsesResource } from "../../../utils/gear-note.js";
import { buildInventoryItemData } from "../../../utils/inventory-item-data.js";
import { createWorldItem } from "../../../utils/world-item.js";
import { clampInt } from "../../../utils/custom-move-data.js";

/**
 * Authoring dialog for a custom inventory item. Gathers name, weight (regular
 * column only), freeform tags/notes (with quick-insert gear-term chips), a
 * uses/ammo circle track, and a worn-armor value, then hands the shaped input to
 * a caller-supplied `saver`. The same UI drives two write targets:
 *   - the on-sheet "Add item" button, which writes an `inventory-custom` move
 *     straight onto one character (characterInventoryItemSaver), and
 *   - the sidebar "Create Item → Inventory Item" flow, which creates a reusable
 *     world move the GM drags onto any character's Inventory tab
 *     (worldInventoryItemSaver).
 *
 * The note field stays plain text while editing; recognised gear terms are
 * <em>-wrapped on save (see wrapGearNoteTerms) so they render italic and pick up
 * the shared gear-term tooltips. "Ammunition" turns the uses track into the
 * shipped ranged weapons' low-ammo/all-out labelling.
 */
export class AddInventoryItemDialog extends StonetopDialog {
	/**
	 * @param {object}   saver               { create(input) } write target
	 * @param {object}   [opts]
	 * @param {string}   [opts.column]        "regular" | "small" (initial column)
	 * @param {boolean}  [opts.allowColumnChoice] show a regular/small selector (world flow)
	 * @param {string}   [opts.titleKey]      i18n key overriding the window title
	 * @param {Function} [opts.onSaved]       called after a successful create (to refresh the sheet)
	 */
	constructor(saver, { column = "regular", allowColumnChoice = false, titleKey = null, onSaved = null } = {}, options = {}) {
		super(options);
		this._saver = saver;
		this._column = column === "small" ? "small" : "regular";
		this._allowColumnChoice = !!allowColumnChoice;
		this._titleKey = titleKey;
		this._onSaved = onSaved;
	}

	static get defaultOptions() {
		return foundry.utils.mergeObject(super.defaultOptions, {
			template: "systems/stonetop-pwd/templates/dialogs/add-inventory-item.hbs",
			width: 480,
			height: "auto",
			resizable: true,
			classes: ["stonetop", "stonetop-add-item-dialog"],
		});
	}

	get title() {
		if (this._titleKey) return game.i18n.localize(this._titleKey);
		return game.i18n.localize(this._column === "small"
			? "stonetop.inventory.addSmallItem"
			: "stonetop.inventory.addItem");
	}

	getData() {
		const isRegular = this._column === "regular";
		return {
			allowColumnChoice: this._allowColumnChoice,
			columnIsSmall: this._column === "small",
			// The weight/armor block is regular-only, but when the column can change at
			// runtime it must be present (and JS-toggled) rather than baked out.
			showWeightBlock: isRegular || this._allowColumnChoice,
			chips: gearNoteChips(),
		};
	}

	activateListeners(html) {
		super.activateListeners(html);
		const root = html[0];

		const noteInput = root.querySelector("[name=note]");
		const chips = Array.from(root.querySelectorAll(".stonetop-add-item-chip"));
		// The note is a freeform, comma-separated list. Each chip toggles its term in
		// or out of that list: clicking adds it (never duplicated), clicking again
		// removes it, and a chip stays highlighted while its term is present. Typing in
		// the field re-syncs the chips so manual edits stay reflected either way.
		const tokens = () => noteInput.value.split(",").map(t => t.trim()).filter(Boolean);
		const termOf = (chip) => (chip.dataset.insert ?? "").trim();
		const syncChips = () => {
			const present = new Set(tokens().map(t => t.toLowerCase()));
			chips.forEach(chip => {
				const on = present.has(termOf(chip).toLowerCase());
				chip.classList.toggle("is-selected", on);
				chip.setAttribute("aria-pressed", on ? "true" : "false");
			});
		};
		chips.forEach(chip => {
			chip.addEventListener("click", () => {
				const term = termOf(chip);
				if (!term) return;
				const list = tokens();
				const idx = list.findIndex(t => t.toLowerCase() === term.toLowerCase());
				if (idx >= 0) list.splice(idx, 1); // already present: toggle off
				else list.push(term);              // absent: toggle on
				noteInput.value = list.join(", ");
				syncChips();
				noteInput.focus();
			});
		});
		noteInput.addEventListener("input", syncChips);
		syncChips();

		// When the column is selectable (world flow), weight/armor only apply to the
		// regular Items column, so show the block only while "regular" is picked.
		const columnSelect = root.querySelector("[name=column]");
		const weightBlock = root.querySelector(".stonetop-add-item-weight-block");
		const syncColumn = () => weightBlock?.classList.toggle("is-hidden", columnSelect?.value === "small");
		columnSelect?.addEventListener("change", syncColumn);
		syncColumn();

		// The ammo toggle only matters once there's at least one use circle.
		const usesInput = root.querySelector("[name=uses]");
		const ammoLabel = root.querySelector(".stonetop-add-item-ammo");
		const syncAmmo = () => ammoLabel?.classList.toggle("is-hidden", !(Number(usesInput?.value) > 0));
		usesInput?.addEventListener("input", syncAmmo);
		syncAmmo();

		root.querySelector(".stonetop-add-item-save")?.addEventListener("click", () => this._save(root));
		root.querySelector(".stonetop-add-item-cancel")?.addEventListener("click", () => this.close());
	}

	async _save(root) {
		const val = (sel) => StonetopDialog.readValue(root, sel);
		const name = val("[name=name]").trim();
		if (!name) {
			ui.notifications.warn(game.i18n.localize("stonetop.inventory.addItemNameRequired"));
			root.querySelector("[name=name]")?.focus();
			return;
		}

		const column = this._allowColumnChoice
			? (root.querySelector("[name=column]")?.value === "small" ? "small" : "regular")
			: this._column;
		const isRegular = column === "regular";

		const uses = clampInt(val("[name=uses]"), 0, 20);
		const isAmmo = !!root.querySelector("[name=ammo]")?.checked;
		const resource = uses > 0 ? buildUsesResource(uses, isAmmo) : null;

		const armorMod = parseInt(val("[name=armor]"), 10) || 0;
		const armor = isRegular && armorMod > 0 ? { modifier: armorMod } : null;

		await this._saver.create({
			name,
			column,
			weight: isRegular ? (parseInt(val("[name=weight]"), 10) || 1) : 1,
			note: wrapGearNoteTerms(val("[name=note]").trim()),
			resource,
			armor,
		});
		this._onSaved?.();
		this.close();
	}
}

/** Write target that adds the authored item straight onto one character's sheet. */
export function characterInventoryItemSaver(character) {
	return { create: (input) => character.createCustomInventoryItem(input) };
}

/**
 * Write target that creates a reusable world move (moveType "inventory") the GM
 * drags onto any character's Inventory tab. The drop routes through
 * StonetopCharacterSheet._onDropItemCreate → addDroppedInventoryItem, which
 * re-plants it as an embedded `inventory-custom` item on that character. Everyone
 * can read the loose world item (matching homebrew moves/arcana) so players can
 * drag it too; the embedded copy inherits the actor's ownership regardless.
 */
export function worldInventoryItemSaver() {
	return {
		create: (input) => createWorldItem(
			buildInventoryItemData(input),
			"stonetop.inventory.worldCreated",
		),
	};
}
