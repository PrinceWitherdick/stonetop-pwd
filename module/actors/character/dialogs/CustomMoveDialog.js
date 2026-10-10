import { StonetopDialog } from "../../../utils/stonetop-dialog.js";
import { normalizeRollType, STAT_KEYS } from "../../../utils/roll-types.js";
import { customMoveDescriptionToPlainText } from "../../../utils/custom-move-text.js";
import { buildCustomMoveData } from "../../../utils/custom-move-data.js";
import { createWorldItem } from "../../../utils/world-item.js";
import { applyGuideRail, guideRailStep } from "../../../utils/guide-rail.js";

/**
 * A "saver" for a custom move backed by an actor-embedded item (the on-sheet
 * Moves-tab flow). Delegates the document shaping + write to StonetopCharacter.
 * @param {object} character - StonetopCharacter wrapper
 */
export function characterMoveSaver(character) {
	return {
		create: (input) => character.addCustomMove(input),
		update: (item, input) => character.updateCustomMove(item.id ?? item._id, input),
	};
}

/**
 * A "saver" for a reusable custom move backed by a WORLD `move` Item (the
 * sidebar "Create Item → Move" flow). The created item can then be dragged onto
 * any number of character sheets (drop embeds it via onDropMove). Uses the same
 * shared shaping as the embedded path, so both flows author identical moves.
 */
export function worldMoveSaver() {
	return {
		// A dropped world move is a COPY (onDropMove embeds it whole), so the editor says an edit
		// here does not reach sheets that already hold it.
		world: true,
		create: (input) => createWorldItem(
			{ ...buildCustomMoveData(input), type: "move" },
			"stonetop.character.moves.custom.worldCreated",
		),
		update: (item, input) => item.update(buildCustomMoveData(input, { requirement: item.system?.requirement })),
	};
}

/**
 * Authoring dialog for a custom "Other" move. Creates or edits a `move` item
 * (moveType "other", flagged stonetop-pwd.custom) through a caller-supplied
 * `saver`, so the same UI drives both the actor-embedded on-sheet flow and the
 * reusable world-item "Create Item → Move" flow. The document shaping lives in
 * the shared builder; this dialog only gathers raw input.
 *
 * Scope (Tier 0): name + description + optional stat roll with 10+/7-9/6- result
 * text, a resource track, no-XP-on-miss, and self bonuses. A roll move then rolls
 * through the same engine as a shipped move (StonetopItem.roll → rollStat), with no
 * pack involvement.
 *
 * Laid out as a left-rail stepped sheet (the shared .stonetop-guide-* chrome used by
 * the Welcome guide and Make a Monster) rather than one long scroll: the four field
 * groups below are rail panels, so the resource track and bonuses that used to hide
 * behind an "Advanced options" details block are now visible entries.
 */

// The dialog's field groups, in authoring order, driving the left rail. `key` matches
// a `<section data-tab>` in the template and the rail button's `data-tab`; `titleKey`
// is a `stonetop.character.moves.custom.*` locale key; `icon` is a Font Awesome 6 glyph.
const SECTIONS = [
	{ key: "move",     titleKey: "sectionMoveTitle",     icon: "fa-feather-pointed" },
	{ key: "roll",     titleKey: "sectionRollTitle",     icon: "fa-dice-d6" },
	{ key: "resource", titleKey: "sectionResourceTitle", icon: "fa-circle-check" },
	{ key: "bonuses",  titleKey: "sectionBonusesTitle",  icon: "fa-shield-heart" },
];

const sectionTitle = (s) => game.i18n.localize(`stonetop.character.moves.custom.${s.titleKey}`);

export class CustomMoveDialog extends StonetopDialog {
	/**
	 * @param {object}   saver          - { create(input), update(item, input) } write target
	 * @param {object}   [opts]
	 * @param {Item}     [opts.item]    - existing custom move to edit; null = create
	 * @param {Function} [opts.onSaved] - called after a successful save (to refresh the sheet)
	 */
	constructor(saver, { item = null, onSaved = null } = {}, options = {}) {
		super(options);
		this._saver = saver;
		this._item = item;
		this._onSaved = onSaved;
		// Which rail panel is showing. Switching is client-side (see _selectTab), so this
		// only seeds the first render.
		this._activeTab = SECTIONS[0].key;
	}

	static get defaultOptions() {
		return foundry.utils.mergeObject(super.defaultOptions, {
			// No fixed id: edit and create dialogs (or two edits) may be open at once,
			// and a shared DOM id would collide. The class below is the styling hook.
			template: "systems/stonetop-pwd/templates/dialogs/custom-move.hbs",
			// Left-rail stepped sheet: a touch more width for the rail, and a fixed height
			// so moving between panels never resizes the window (the panel column scrolls
			// if a group runs long).
			width: 620,
			height: 480,
			resizable: true,
			classes: ["stonetop", "stonetop-custom-move-dialog"],
			// Keep the reader's place in the active panel across a re-render.
			scrollY: [".stonetop-custom-move-main"],
		});
	}

	get title() {
		return game.i18n.localize(this._item
			? "stonetop.character.moves.custom.editTitle"
			: "stonetop.character.moves.custom.createTitle");
	}

	getData() {
		const sys = this._item?.system ?? {};
		const rollType = normalizeRollType(sys.rollType) ?? "";
		const mr = sys.moveResults ?? {};
		const rollOptions = [
			{ value: "", label: game.i18n.localize("stonetop.character.moves.custom.rollNone"), selected: rollType === "" },
			...STAT_KEYS.map(k => ({ value: k, label: Handlebars.helpers.statLabel(k), selected: rollType === k })),
			{ value: "ask", label: game.i18n.localize("stonetop.character.moves.custom.rollAsk"), selected: rollType === "ask" },
		];
		const res = sys.resource ?? {};
		const activeIndex = Math.max(0, SECTIONS.findIndex(s => s.key === this._activeTab));
		return {
			isEdit: !!this._item,
			// Per-window suffix for the field ids, so two open dialogs (a create beside an edit) never
			// point a label at the other window's field.
			uid: this.appId,
			// A reusable world move says that copies already on sheets keep their old text.
			worldMove: !!this._saver?.world,
			// Left rail + banner. Only the first-render active state comes from here;
			// switching panels afterwards is client-side, so nothing typed is lost.
			activeTab: this._activeTab,
			sections: SECTIONS.map((s, i) => ({
				key: s.key, icon: s.icon, title: sectionTitle(s), selected: i === activeIndex,
			})),
			active: {
				icon:  SECTIONS[activeIndex].icon,
				title: sectionTitle(SECTIONS[activeIndex]),
				count: this._countLabel(activeIndex),
			},
			atFirst: activeIndex === 0,
			atLast:  activeIndex === SECTIONS.length - 1,
			name: this._item?.name ?? "",
			description: customMoveDescriptionToPlainText(sys.description),
			requires: sys.requirement?.note ?? "",
			rollOptions,
			hasRoll: rollType !== "",
			results: {
				success: mr.success?.value ?? "",
				partial: mr.partial?.value ?? "",
				failure: mr.failure?.value ?? "",
			},
			noXpOnMiss: !!sys.noXpOnMiss,
			resource: {
				title: res.title ?? "",
				max: res.max ?? "",
				labels: Array.isArray(res.labels) ? res.labels.join(", ") : "",
			},
			bonuses: {
				hp: sys.hpBonus || "",
				armor: sys.armorBonus || "",
				load: sys.loadBonus || "",
			},
		};
	}

	// Banner "N / M" for the active panel.
	_countLabel(index) {
		return `${index + 1} / ${SECTIONS.length}`;
	}

	activateListeners(html) {
		super.activateListeners(html);
		const root = html[0];

		// Show the 10+/7-9/6- result fields only when the move actually rolls.
		const results = root.querySelector(".stonetop-custom-move-results");
		const rollSelect = root.querySelector("[name=rollType]");
		const syncResults = () => results?.classList.toggle("is-hidden", !rollSelect?.value);
		rollSelect?.addEventListener("change", syncResults);
		syncResults();

		// Left-rail tabs + Back/Next: switch which field group is shown, client-side. No
		// re-render, so every field keeps its value and focus.
		root.querySelectorAll(".stonetop-custom-move-tab").forEach(btn =>
			btn.addEventListener("click", () => this._selectTab(root, btn.dataset.tab)));
		root.querySelector(".stonetop-custom-move-back")?.addEventListener("click", () => this._step(root, -1));
		root.querySelector(".stonetop-custom-move-next")?.addEventListener("click", () => this._step(root, 1));

		// Latched: Save awaits the write before it closes, and a second click in that gap would
		// create the move twice.
		root.querySelector(".stonetop-custom-move-save")?.addEventListener("click", ev => this._guardBusy(ev, () => this._save(root)));
		root.querySelector(".stonetop-custom-move-cancel")?.addEventListener("click", () => this.close());
	}

	// Walk the rail one panel at a time (Back/Next), stopping at the ends.
	_step(root, delta) {
		const next = guideRailStep(SECTIONS, this._activeTab, delta);
		if (next) this._selectTab(root, next.key);
	}

	// Show one field group and light its rail entry, updating the banner (icon, title,
	// count) and the Back/Next disabled state to match. Purely DOM — the form is never
	// re-rendered, so switching panels preserves everything already filled in.
	_selectTab(root, key) {
		const index = SECTIONS.findIndex(s => s.key === key);
		if (index < 0) return;
		this._activeTab = key;
		const active = SECTIONS[index];

		applyGuideRail(root, {
			key, dataKey: "tab",
			tabSelector: ".stonetop-custom-move-tab",
			sectionSelector: ".stonetop-custom-move-section",
			iconSelector: ".stonetop-custom-move-banner-icon",
			icon: active.icon,
			iconExtraClass: "stonetop-custom-move-banner-icon",
			mainSelector: ".stonetop-custom-move-main",
			titleSelector: ".stonetop-custom-move-banner-title", title: sectionTitle(active),
			countSelector: ".stonetop-custom-move-banner-count",
			backSelector: ".stonetop-custom-move-back", nextSelector: ".stonetop-custom-move-next",
			index, total: SECTIONS.length,
		});
	}

	async _save(root) {
		const val = (sel) => StonetopDialog.readValue(root, sel);
		const name = val("[name=name]").trim();
		if (!name) {
			ui.notifications.warn(game.i18n.localize("stonetop.character.moves.custom.nameRequired"));
			// The name field lives on the first rail panel, which may not be the one showing
			// when Save is pressed — swing back to it so the focus call lands on a visible
			// field instead of silently doing nothing inside a hidden panel.
			this._selectTab(root, SECTIONS[0].key);
			root.querySelector("[name=name]")?.focus();
			// Nothing was saved, so the latched Save button is offered again.
			const save = root.querySelector(".stonetop-custom-move-save");
			if (save) save.disabled = false;
			return;
		}
		const input = {
			name,
			description: val("[name=description]"),
			requires: val("[name=requires]"),
			rollType: val("[name=rollType]"),
			results: {
				success: val("[name=success]"),
				partial: val("[name=partial]"),
				failure: val("[name=failure]"),
			},
			noXpOnMiss: !!root.querySelector("[name=noXpOnMiss]")?.checked,
			resource: {
				title: val("[name=resourceTitle]"),
				max: val("[name=resourceMax]"),
				labels: val("[name=resourceLabels]"),
			},
			hpBonus: val("[name=hpBonus]"),
			armorBonus: val("[name=armorBonus]"),
			loadBonus: val("[name=loadBonus]"),
		};
		if (this._item) await this._saver.update(this._item, input);
		else await this._saver.create(input);
		this._onSaved?.();
		this.close();
	}
}
