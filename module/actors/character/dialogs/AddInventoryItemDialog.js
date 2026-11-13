import { StonetopDialog } from "../../../utils/stonetop-dialog.js";
import { gearNoteChips, wrapGearNoteTerms, buildUsesResource, circleLabelsFromLines } from "../../../utils/gear-note.js";
import {
	composeInventoryNote, inventoryItemCreateData, inventoryItemFormValues, inventoryItemUpdateData,
} from "../../../utils/inventory-item-data.js";
import { createWorldItem } from "../../../utils/world-item.js";
import { clampInt } from "../../../utils/custom-move-data.js";
import { enrichHTML, filePicker } from "../../../utils/foundry-compat.js";
import { isDefaultImg } from "../../../utils/strings.js";
import { ARTIFACT_STATE } from "../artifact-identify.js";
import { applyGuideRail, guideRailStep } from "../../../utils/guide-rail.js";
import { persistOpenWindowsSoon } from "../../../utils/window-restore.js";
import {
	ADD_ITEM_RESTORE_KIND, authoringRestoreKey, fieldsFromView, readFormFields, writeFormFields,
} from "../../../dialogs/authoring-restore.js";

// The rail's pages, in authoring order. `key` matches a `<section data-tab>` in the template;
// `titleKey` is a `stonetop.inventory.section.*` locale key. The last two pages (the write-up,
// and what identifying it takes) are a treasure's alone (see _sections).
const SECTIONS = [
	{ key: "item",     titleKey: "item",     icon: "fa-box-open" },
	{ key: "tags",     titleKey: "tags",     icon: "fa-tags" },
	{ key: "uses",     titleKey: "uses",     icon: "fa-circle-dot" },
	{ key: "writeup",  titleKey: "writeup",  icon: "fa-scroll", treasureOnly: true },
	{ key: "identify", titleKey: "identify", icon: "fa-magnifying-glass", treasureOnly: true },
];
const sectionTitle = (s) => game.i18n.localize(`stonetop.inventory.section.${s.titleKey}`);

// Foundry's own item icon. Writing it back is how an edit CLEARS chosen art: the img field
// is not nullable, and isDefaultImg reads this path as "no art", so the sidebar's type marker
// shows again.
const DEFAULT_ITEM_ICON = "icons/svg/item-bag.svg";

// What a blank form starts from. The same keys inventoryItemFormValues reads off an existing
// item, so create and edit fill the template identically.
const BLANK_VALUES = {
	name: "", img: "", column: "regular", weight: 1, tags: "", value: null, valueTo: "",
	uses: 0, isAmmo: false, usesLabel: "", usesLabels: "", resourceFirst: false, armor: 0, armorWorn: false, shield: false,
	isTreasure: false, artifact: { state: "", hint: "", lore: "", lead: "" },
};

/**
 * Authoring dialog for an inventory item: a piece of gear, or (in treasure mode) a treasure
 * written the way Book II prints one. Gathers name, column, ◇ weight, tags (with quick-insert
 * chips), Value, a ○ uses track, armor and shield; a treasure adds the write-up, the hint and
 * the lead the identify ladder works with (Book I pp.430-431). Hands the shaped input to a
 * caller-supplied `saver`, so the same UI drives every write target:
 *   - the on-sheet "Add item" button, which writes an `inventory-custom` move straight onto
 *     one character (characterInventoryItemSaver), and
 *   - the sidebar "Create Item → Inventory Item / Treasure" flows, which create a reusable
 *     world move the GM drags onto any character's Inventory tab (worldInventoryItemSaver).
 *     Opening one of those from the sidebar later reopens this dialog filled in (`item`).
 *
 * Value and "immobile" are fields here but live in the tag line, as the book prints them and
 * as a dragged treasure stores them (see composeInventoryNote / splitInventoryNote).
 *
 * The note field stays plain text while editing; recognised gear terms are
 * <em>-wrapped on save (see wrapGearNoteTerms) so they render italic and pick up the
 * shared gear-term tooltips. "Ammunition" turns the uses track into the shipped ranged
 * weapons' low-ammo/all-out labelling.
 */
export class AddInventoryItemDialog extends StonetopDialog {
	/**
	 * @param {object}   saver               { create(input), update?(item, input) } write target
	 * @param {object}   [opts]
	 * @param {string}   [opts.column]        "regular" | "small" (initial column)
	 * @param {boolean}  [opts.allowColumnChoice] show the regular/small/immobile selector (world flow)
	 * @param {boolean}  [opts.allowImage]    offer an image picker (world flow; the art is the
	 *        sidebar item's, and a drop carries it onto the sheet copy)
	 * @param {boolean}  [opts.treasure]      treasure mode: the write-up / hint / lead section.
	 *        Editing, it follows the item's own treasure flag unless given.
	 * @param {Item}     [opts.item]          an existing item to edit; null = create
	 * @param {string}   [opts.titleKey]      i18n key overriding the window title
	 * @param {Function} [opts.onSaved]       called after a successful save (to refresh the sheet)
	 * @param {string}   [opts.restoreId]     a reload's: the id a new item's window was saved under
	 */
	constructor(saver, {
		column = "regular", allowColumnChoice = false, allowImage = false, treasure = null,
		item = null, titleKey = null, onSaved = null, restoreId = null,
	} = {}, options = {}) {
		super(options);
		// Keeps a new item's window apart from any other new one for a reload (`restoreKey`).
		this._restoreId = restoreId || foundry.utils.randomID(8);
		// The form's fields as last typed, for a reload (`restoreView`); and a reload's, to put back.
		this._liveFields = null;
		this._restoredFields = null;
		this._saver = saver;
		this._item = item;
		this._values = item ? inventoryItemFormValues(item) : { ...BLANK_VALUES, column: column === "small" ? "small" : "regular" };
		this._column = this._values.column;
		this._allowColumnChoice = !!allowColumnChoice;
		this._allowImage = !!allowImage;
		this._treasure = treasure ?? this._values.isTreasure;
		this._titleKey = titleKey;
		this._onSaved = onSaved;
		// Which rail page is showing. Switching is client-side (see _selectTab), so this only
		// seeds the first render.
		this._activeTab = SECTIONS[0].key;
		// The write-up editor wants a little more room than a line of gear.
		if (this._treasure) this.position.height = 560;
	}

	static get defaultOptions() {
		return foundry.utils.mergeObject(super.defaultOptions, {
			template: "systems/stonetop-pwd/templates/dialogs/add-inventory-item.hbs",
			// Left-rail stepped sheet, sized like the custom-move author: a fixed height so moving
			// between pages never resizes the window (the page column scrolls if one runs long).
			width: 620,
			height: 500,
			resizable: true,
			classes: ["stonetop", "stonetop-add-item-dialog"],
			scrollY: [".stonetop-add-item-main"],
		});
	}

	// ---- Reload --------------------------------------------------------------------------
	// utils/window-restore.js reopens this window after a reload (dialogs/authoring-restore.js) with
	// every field as typed, and the way it was opened (which column, treasure or not, the art well).

	get restoreKey() {
		return authoringRestoreKey(ADD_ITEM_RESTORE_KIND, this._saver, { item: this._item, windowId: this._restoreId });
	}

	/** The page, the fields as last typed, and how it was opened. Read as the page unloads too, so never off the form. */
	get restoreView() {
		return {
			tab: this._activeTab,
			fields: this._liveFields,
			opened: {
				column: this._column, allowColumnChoice: this._allowColumnChoice, allowImage: this._allowImage,
				treasure: !!this._treasure, titleKey: this._titleKey,
			},
		};
	}

	async _render(force, options = {}) {
		if (options?.view && !this.rendered) this._takeRestoredView(options.view);
		return super._render(force, options);
	}

	_takeRestoredView(view) {
		if (this._restoredFields) return;
		const o = view?.opened;
		if (o && typeof o === "object") {
			if (!this._item && (o.column === "regular" || o.column === "small")) this._column = this._values.column = o.column;
			if (typeof o.allowColumnChoice === "boolean") this._allowColumnChoice = o.allowColumnChoice;
			if (typeof o.allowImage === "boolean") this._allowImage = o.allowImage;
			if (typeof o.treasure === "boolean" && o.treasure !== !!this._treasure) {
				this._treasure = o.treasure;
				if (this._treasure && this.position) this.position.height = 560;
			}
			if (typeof o.titleKey === "string" && o.titleKey.startsWith("stonetop.")) this._titleKey = o.titleKey;
		}
		this._restoredFields = fieldsFromView(view?.fields);
		// The write-up is a live editor, which takes its text from the template rather than a field.
		if (this._treasure && typeof this._restoredFields?.lore === "string") {
			this._values = { ...this._values, artifact: { ...this._values.artifact, lore: this._restoredFields.lore } };
		}
		if (this._sections().some(s => s.key === view?.tab)) this._activeTab = view.tab;
	}

	/** The rail's pages for this dialog: the artifact pages only in treasure mode. */
	_sections() {
		return SECTIONS.filter(s => this._treasure || !s.treasureOnly);
	}

	get title() {
		if (this._item) {
			return game.i18n.format(this._treasure
				? "stonetop.inventory.editTreasureTitle"
				: "stonetop.inventory.editItemTitle", { name: this._item.name });
		}
		if (this._titleKey) return game.i18n.localize(this._titleKey);
		return game.i18n.localize(this._column === "small"
			? "stonetop.inventory.addSmallItem"
			: "stonetop.inventory.addItem");
	}

	async getData() {
		const v = this._values;
		const isRegular = this._column === "regular";
		const img = isDefaultImg(v.img) ? "" : v.img;
		const sections = this._sections();
		const activeIndex = Math.max(0, sections.findIndex(s => s.key === this._activeTab));
		return {
			v,
			isEdit: !!this._item,
			treasure: this._treasure,
			// Left rail + banner. Only the first-render state comes from here; switching pages
			// afterwards is client-side, so nothing typed is lost.
			activeTab: sections[activeIndex].key,
			sections: sections.map((s, i) => ({ key: s.key, icon: s.icon, title: sectionTitle(s), selected: i === activeIndex })),
			active: {
				icon:  sections[activeIndex].icon,
				title: sectionTitle(sections[activeIndex]),
				count: `${activeIndex + 1} / ${sections.length}`,
			},
			atFirst: activeIndex === 0,
			atLast:  activeIndex === sections.length - 1,
			bannerSubKey: this._treasure ? "stonetop.inventory.bannerSubTreasure" : "stonetop.inventory.bannerSubItem",
			allowColumnChoice: this._allowColumnChoice,
			columns: ["regular", "small", "immobile"].map(key => ({
				key,
				labelKey: `stonetop.inventory.addItemColumn${key[0].toUpperCase()}${key.slice(1)}`,
				selected: key === this._column,
			})),
			// The weight/armor block is regular-only, but when the column can change at
			// runtime it must be present (and JS-toggled) rather than baked out.
			showWeightBlock: isRegular || this._allowColumnChoice,
			weightHidden: !isRegular,
			// Only someone who can browse the data files can pick one; a player authoring a
			// world item gets the type marker, as every art-less item does.
			showImage: this._allowImage && !!(game.user?.isGM || game.user?.can?.("FILES_BROWSE")),
			img,
			chips: gearNoteChips(),
			startsHidden: v.artifact.state === ARTIFACT_STATE.UNKNOWN,
			// The write-up opens in a live editor, handed BOTH forms: the raw HTML it edits, and
			// the enriched copy it paints until the custom element upgrades (as the GM's artifact
			// control does, templates/dialogs/artifact-gm.hbs).
			loreEnriched: this._treasure ? await enrichHTML(v.artifact.lore ?? "") : "",
			confirmKey: this._item
				? "stonetop.inventory.saveChanges"
				: (this._treasure ? "stonetop.inventory.createTreasureConfirm" : "stonetop.inventory.addItemConfirm"),
		};
	}

	activateListeners(html) {
		super.activateListeners(html);
		const root = html[0];

		// A reload's fields go back over the fresh form before anything below reads it.
		if (this._restoredFields) {
			writeFormFields(root, this._restoredFields);
			this._restoredFields = null;
		}
		// Typing never re-renders, so the fields are kept here as they change, and saved for a reload.
		// Clicks too: a tag chip and the art well's Clear change a field without an input event.
		const noteWork = () => { this._liveFields = readFormFields(root); persistOpenWindowsSoon(); };
		this._liveFields = readFormFields(root);
		for (const type of ["input", "change", "click"]) root.addEventListener(type, noteWork);

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
		const syncColumn = () => {
			if (!columnSelect) return;
			weightBlock?.classList.toggle("is-hidden", columnSelect.value !== "regular");
		};
		columnSelect?.addEventListener("change", syncColumn);

		// The ammo toggle and the track's label only matter once there's at least one circle.
		const usesInput = root.querySelector("[name=uses]");
		const usesOnly = root.querySelectorAll(".stonetop-add-item-uses-only");
		const syncUses = () => usesOnly.forEach(el => el.classList.toggle("is-hidden", !(Number(usesInput?.value) > 0)));
		usesInput?.addEventListener("input", syncUses);
		syncUses();

		// And the worn/bonus toggle only matters once there's an armor value to qualify.
		const armorInput = root.querySelector("[name=armor]");
		const wornLabel  = root.querySelector(".stonetop-add-item-armor-worn");
		const wornHint   = root.querySelector(".stonetop-add-item-armor-worn-hint");
		const syncWorn = () => {
			const on = Number(armorInput?.value) > 0;
			wornLabel?.classList.toggle("is-hidden", !on);
			wornHint?.classList.toggle("is-hidden", !on);
		};
		armorInput?.addEventListener("input", syncWorn);
		syncWorn();

		// "Who to" means nothing without a Value, so it stays inert until there is one.
		const valueInput = root.querySelector("[name=value]");
		const valueTo = root.querySelector("[name=valueTo]");
		const syncValue = () => { if (valueTo) valueTo.disabled = String(valueInput?.value ?? "").trim() === ""; };
		valueInput?.addEventListener("input", syncValue);
		syncValue();

		this._wireImage(root);

		root.querySelectorAll(".stonetop-add-item-tab").forEach(btn =>
			btn.addEventListener("click", () => this._selectTab(root, btn.dataset.tab)));
		root.querySelector(".stonetop-add-item-back")?.addEventListener("click", () => this._step(root, -1));
		root.querySelector(".stonetop-add-item-next")?.addEventListener("click", () => this._step(root, 1));

		root.querySelector(".stonetop-add-item-save")?.addEventListener("click", () => this._save(root));
		root.querySelector(".stonetop-add-item-cancel")?.addEventListener("click", () => this.close());
	}

	// Walk the rail one page at a time (Back/Next), stopping at the ends.
	_step(root, delta) {
		const next = guideRailStep(this._sections(), this._activeTab, delta);
		if (next) this._selectTab(root, next.key);
	}

	// Show one page and light its rail entry, updating the banner and Back/Next to match.
	// Purely DOM: the form is never re-rendered, so switching keeps everything filled in,
	// the live write-up editor included.
	_selectTab(root, key) {
		const sections = this._sections();
		const index = sections.findIndex(s => s.key === key);
		if (index < 0) return;
		this._activeTab = key;
		const active = sections[index];
		applyGuideRail(root, {
			key, dataKey: "tab",
			tabSelector: ".stonetop-add-item-tab",
			sectionSelector: ".stonetop-add-item-section",
			iconSelector: ".stonetop-add-item-banner-icon",
			icon: active.icon,
			iconExtraClass: "stonetop-add-item-banner-icon",
			mainSelector: ".stonetop-add-item-main",
			titleSelector: ".stonetop-add-item-banner-title", title: sectionTitle(active),
			countSelector: ".stonetop-add-item-banner-count",
			backSelector: ".stonetop-add-item-back", nextSelector: ".stonetop-add-item-next",
			index, total: sections.length,
		});
	}

	/** The image well: Choose opens the FilePicker, Clear goes back to the type marker. */
	_wireImage(root) {
		const input = root.querySelector("[name=img]");
		if (!input) return;
		const preview = root.querySelector(".stonetop-add-item-img-preview");
		const clearBtn = root.querySelector(".stonetop-add-item-img-clear");
		const paint = () => {
			const src = input.value;
			preview.classList.toggle("is-empty", !src);
			if (src) preview.src = src; else preview.removeAttribute("src");
			clearBtn?.classList.toggle("is-hidden", !src);
		};
		root.querySelector(".stonetop-add-item-img-choose")?.addEventListener("click", () => {
			const FilePickerClass = filePicker();
			if (!FilePickerClass) return;
			new FilePickerClass({
				type: "image",
				current: input.value,
				callback: path => {
					input.value = path;
					paint();
					// Picked art is part of the work a reload keeps (activateListeners' change listener).
					input.dispatchEvent(new Event("change", { bubbles: true }));
				},
			}).render(true);
		});
		clearBtn?.addEventListener("click", () => { input.value = ""; paint(); });
		paint();
	}

	async _save(root) {
		const val = (sel) => StonetopDialog.readValue(root, sel);
		const name = val("[name=name]").trim();
		if (!name) {
			ui.notifications.warn(game.i18n.localize("stonetop.inventory.addItemNameRequired"));
			// The name is on the first page, which may not be the one showing when Save is
			// pressed; swing back so the focus lands on a visible field.
			this._selectTab(root, SECTIONS[0].key);
			root.querySelector("[name=name]")?.focus();
			return;
		}

		const columnChoice = this._allowColumnChoice ? val("[name=column]") : this._column;
		// Immobile is not a third inventory column: it lists with the small items and says
		// so in its tags, exactly as a dragged Book II treasure does.
		const immobile = columnChoice === "immobile";
		const column = columnChoice === "regular" ? "regular" : "small";
		const isRegular = column === "regular";

		const uses = clampInt(val("[name=uses]"), 0, 20);
		const isAmmo = !!root.querySelector("[name=ammo]")?.checked;
		let resource = null;
		if (uses > 0) {
			resource = buildUsesResource(uses, isAmmo);
			resource.title = val("[name=usesLabel]").trim() || null;
			// Typed circle labels, one line per circle (Ammunition writes its own pair instead).
			const typed = circleLabelsFromLines(val("[name=usesLabels]"));
			if (!isAmmo && typed.length) resource.labels = resource.labels.map((_, i) => typed[i] ?? "");
		}
		const resourceFirst = !!resource && !!root.querySelector("[name=resourceFirst]")?.checked;

		// `base` is worn body armor — the best one counts and they don't stack; `modifier` is a
		// shield or a bonus, which adds on top. CharacterInventory.calculateArmor applies the two
		// differently, so authoring only ever `modifier` (as this did) meant a hand-written mail
		// shirt stacked with every other armor AND left its wearer reading as unarmored to the
		// moves that require being so (Uncanny Reflexes).
		const armorValue = parseInt(val("[name=armor]"), 10) || 0;
		const armorWorn  = !!root.querySelector("[name=armorWorn]")?.checked;
		const armor = isRegular && armorValue > 0
			? (armorWorn ? { base: armorValue } : { modifier: armorValue })
			: null;
		// A shield also buys "+1 Readiness on a 7+ to Defend" (p.216), which bearsShield reads
		// off this flag and never guesses from the armor.
		const shield = isRegular && !!root.querySelector("[name=shield]")?.checked;

		const input = {
			name,
			column,
			weight: isRegular ? (parseInt(val("[name=weight]"), 10) || 1) : 1,
			note: wrapGearNoteTerms(composeInventoryNote({
				tags: val("[name=note]"),
				immobile,
				value: val("[name=value]"),
				valueTo: val("[name=valueTo]"),
			})),
			resource,
			resourceFirst,
			armor,
			shield,
		};
		if (root.querySelector("[name=img]")) {
			input.img = val("[name=img]") || (this._item ? DEFAULT_ITEM_ICON : null);
		}
		if (this._treasure) {
			input.isTreasure = true;
			input.artifact = {
				state: this._artifactState(!!root.querySelector("[name=startsHidden]")?.checked),
				hint:  val("[name=hint]").trim(),
				// <prose-mirror> is form-associated and answers `.value` with the serialized live
				// document while its editor is active, unsaved keystrokes and all.
				lore:  val("[name=lore]").trim(),
				lead:  val("[name=lead]").trim(),
			};
		}

		if (this._item) await this._saver.update(this._item, input);
		else await this._saver.create(input);
		this._onSaved?.();
		this.close();
	}

	/**
	 * The identify state to write. The box asks one thing, "does this land unidentified?", so
	 * ticking it is UNKNOWN and clearing it is "" (follow the world setting). A partly or fully
	 * identified state the GM set elsewhere is kept while the box stays clear: this form has no
	 * way to say those, and must not quietly un-say them.
	 */
	_artifactState(startsHidden) {
		if (startsHidden) return ARTIFACT_STATE.UNKNOWN;
		const was = this._values.artifact.state ?? "";
		return was === ARTIFACT_STATE.UNKNOWN ? "" : was;
	}
}

/** Write target that adds the authored item straight onto one character's sheet. */
export function characterInventoryItemSaver(character) {
	return {
		// What a reload rebuilds this saver from (dialogs/authoring-restore.js).
		restoreAs: { saver: "characterInventoryItem", actor: character?._actor?.uuid ?? null },
		create: (input) => character.createCustomInventoryItem(input),
	};
}

/**
 * Write target that creates a reusable world move (moveType "inventory") the GM
 * drags onto any character's Inventory tab. The drop routes through
 * StonetopCharacterSheet._onDropItemCreate → addDroppedInventoryItem, which
 * re-plants it as an embedded `inventory-custom` item on that character.
 *
 * Ordinary gear is readable by everyone (matching homebrew moves/arcana) so players can
 * drag it too. A TREASURE is GM-only, like the seeded Book II treasures: its write-up and
 * Value are what the players go looking for, and they get it when the GM hands it over; the
 * embedded copy inherits the actor's ownership regardless.
 *
 * @param {object} [opts]
 * @param {boolean} [opts.treasure=false]
 */
export function worldInventoryItemSaver({ treasure = false } = {}) {
	return {
		restoreAs: { saver: treasure ? "worldTreasure" : "worldInventoryItem" },
		create: (input) => createWorldItem(
			inventoryItemCreateData(input),
			treasure ? "stonetop.inventory.treasureCreated" : "stonetop.inventory.worldCreated",
			treasure ? { ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE } } : {},
		),
		update: (item, input) => item.update(inventoryItemUpdateData(item, input)),
	};
}
