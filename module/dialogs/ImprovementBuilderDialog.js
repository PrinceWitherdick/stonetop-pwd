import { StonetopDialog } from "../utils/stonetop-dialog.js";
import { applyGuideRail, guideRailStep } from "../utils/guide-rail.js";
import { IMPROVEMENT_CATEGORIES } from "../actors/steading/StonetopSteading.js";
import { createImprovementCard } from "../journal/steading-improvement-cards.js";
import { STEADING_SIZES, buildImprovementDef, sectionsFromGroups } from "../utils/improvement-def.js";

/**
 * The authoring sheet for a steading improvement, in the shape the book's own
 * improvements have: a name and flavor, any number of requirement GROUPS (each with its
 * own heading, its own "all of these" or "N of these" rule, and the option to be an
 * ALTERNATIVE to the group above it), the effect prose, and the mechanical effects that
 * are applied automatically on completion.
 *
 * It replaces the two hand-rolled forms that came before, which between them could
 * author one flat all-of-these requirement list and no automatic effects at all: not
 * enough to reproduce Weapons of War (either/or), Aurochs Hunting (2 of 3), or any
 * improvement whose completion is supposed to move a stat. Both entry points now open
 * THIS window and differ only in where the finished definition is written:
 *
 *   improvementCardSaver()          a reusable, draggable card in the homebrew journal
 *                                   (sidebar "Create Stonetop Content" flow);
 *   steadingImprovementSaver(...)   straight onto the open steading's Improvements tab.
 *
 * Laid out as a left-rail stepped sheet, the same shared .stonetop-guide-* chrome as the
 * custom-move dialog and Make a Monster.
 */

// The rail's panels, in authoring order. `key` matches a `<section data-tab>` in the
// template and its rail button.
const SECTIONS = [
	{ key: "improvement",  title: "The improvement", icon: "fa-screwdriver-wrench" },
	{ key: "requirements", title: "Requirements",    icon: "fa-list-check" },
	{ key: "effect",       title: "Effect",          icon: "fa-wand-sparkles" },
];

/** The auto-applied stat deltas the Effect panel offers, in sheet order. */
const GRANT_STAT_FIELDS = [
	{ key: "fortunes",   label: "Fortunes" },
	{ key: "defenses",   label: "Defenses" },
	{ key: "prosperity", label: "Prosperity" },
	{ key: "population", label: "Population" },
];

/** Write target: a reusable homebrew card in the journal, dragged onto a steading later. */
export function improvementCardSaver() {
	return {
		submitLabel: "Create card",
		hint: "Author a reusable improvement card, then drag it onto any steading's Improvements tab.",
		async create(def) {
			const page = await createImprovementCard(def);
			return { ok: !!page };
		},
	};
}

/**
 * Write target: the open steading, which tracks the improvement immediately.
 * @param {object}   steading  StonetopSteading wrapper
 * @param {Function} [onSaved] called after a successful add (to re-render the sheet)
 */
export function steadingImprovementSaver(steading, onSaved = null) {
	return {
		submitLabel: "Add improvement",
		hint: "Add a custom improvement to track alongside the book's built-ins.",
		async create(def) {
			const result = await steading.addCustomImprovement(def);
			if (result.ok) {
				ui.notifications?.info?.(`Added steading improvement: ${result.label}.`);
				onSaved?.();
			} else if (result.reason === "duplicate") {
				ui.notifications?.warn?.(`${result.label} is already a steading improvement.`);
			}
			return result;
		},
	};
}

export class ImprovementBuilderDialog extends StonetopDialog {
	/**
	 * @param {{submitLabel: string, hint: string, create: Function}} saver
	 */
	constructor(saver, options = {}) {
		super(options);
		this._saver = saver;
		// Which rail panel is showing. Switching is client-side (see _selectTab), so this
		// only seeds the first render and nothing typed is ever re-rendered away.
		this._activeTab = SECTIONS[0].key;
	}

	static get defaultOptions() {
		return foundry.utils.mergeObject(super.defaultOptions, {
			// No fixed id: two of these may be open at once (one per steading, or one of
			// each kind), and a shared DOM id would have the second paint into the first.
			template: "systems/stonetop-pwd/templates/dialogs/improvement-builder.hbs",
			width: 660,
			height: 560,
			resizable: true,
			classes: ["stonetop", "stonetop-improvement-builder"],
			scrollY: [".stonetop-improvement-builder-main"],
		});
	}

	get title() { return "Create Steading Improvement"; }

	getData() {
		const activeIndex = Math.max(0, SECTIONS.findIndex(s => s.key === this._activeTab));
		return {
			hint: this._saver.hint,
			submitLabel: this._saver.submitLabel,
			activeTab: this._activeTab,
			sections: SECTIONS.map((s, i) => ({ ...s, selected: i === activeIndex })),
			active: {
				icon: SECTIONS[activeIndex].icon,
				title: SECTIONS[activeIndex].title,
				count: `${activeIndex + 1} / ${SECTIONS.length}`,
			},
			atFirst: activeIndex === 0,
			atLast: activeIndex === SECTIONS.length - 1,
			categories: IMPROVEMENT_CATEGORIES.map(c => ({ key: c.key, label: c.label })),
			statFields: GRANT_STAT_FIELDS,
			sizes: STEADING_SIZES.map(size => ({ value: size, label: size })),
		};
	}

	activateListeners(html) {
		super.activateListeners(html);
		const root = html[0];

		root.querySelectorAll(".stonetop-improvement-builder-tab").forEach(btn =>
			btn.addEventListener("click", () => this._selectTab(root, btn.dataset.tab)));
		root.querySelector(".stonetop-improvement-builder-back")?.addEventListener("click", () => this._step(root, -1));
		root.querySelector(".stonetop-improvement-builder-next")?.addEventListener("click", () => this._step(root, 1));

		root.querySelector(".stonetop-improvement-builder-add-group")?.addEventListener("click", () => this._addGroup(root));
		// One empty group to start: a requirement list is what most improvements are, and
		// an empty panel with only an "Add" button reads as though there is nothing to do.
		this._addGroup(root);

		root.querySelector(".stonetop-improvement-builder-save")?.addEventListener("click", () => this._save(root));
		root.querySelector(".stonetop-improvement-builder-cancel")?.addEventListener("click", () => this.close());
	}

	// ── The rail ────────────────────────────────────────────────

	_step(root, delta) {
		const next = guideRailStep(SECTIONS, this._activeTab, delta);
		if (next) this._selectTab(root, next.key);
	}

	// Show one panel and light its rail entry. Purely DOM: the form is never re-rendered,
	// so moving around keeps every field, and the requirement groups added so far.
	_selectTab(root, key) {
		const index = SECTIONS.findIndex(s => s.key === key);
		if (index < 0) return;
		this._activeTab = key;
		const active = SECTIONS[index];

		applyGuideRail(root, {
			key, dataKey: "tab",
			tabSelector: ".stonetop-improvement-builder-tab",
			sectionSelector: ".stonetop-improvement-builder-section",
			iconSelector: ".stonetop-improvement-builder-banner-icon",
			icon: active.icon,
			iconExtraClass: "stonetop-improvement-builder-banner-icon",
			mainSelector: ".stonetop-improvement-builder-main",
			titleSelector: ".stonetop-improvement-builder-banner-title", title: active.title,
			countSelector: ".stonetop-improvement-builder-banner-count",
			backSelector: ".stonetop-improvement-builder-back", nextSelector: ".stonetop-improvement-builder-next",
			index, total: SECTIONS.length,
		});
	}

	// ── Requirement groups ──────────────────────────────────────

	/** Clone the empty-group markup out of the template's <template> and wire its controls. */
	_addGroup(root) {
		const tpl = root.querySelector(".stonetop-improvement-builder-group-tpl");
		const list = root.querySelector(".stonetop-improvement-builder-groups");
		if (!tpl || !list) return;
		const group = tpl.content.firstElementChild.cloneNode(true);

		group.querySelector(".stonetop-improvement-builder-group-remove")
			?.addEventListener("click", () => { group.remove(); this._renumberGroups(root); });
		const mode = group.querySelector(".stonetop-improvement-builder-group-mode");
		mode?.addEventListener("change", () => this._syncGroupMode(group));

		list.appendChild(group);
		this._syncGroupMode(group);
		this._renumberGroups(root);
	}

	/** The "at least N" box only means anything in the matching mode. */
	_syncGroupMode(group) {
		const partial = group.querySelector(".stonetop-improvement-builder-group-mode")?.value === "min";
		group.querySelector(".stonetop-improvement-builder-group-min-wrap")?.classList.toggle("is-hidden", !partial);
	}

	/**
	 * Re-label the groups after one is added or removed, and hide the "alternative to the
	 * group above" checkbox on the FIRST group, which has nothing above it to be an
	 * alternative to. Unticked as well as hidden, so a group promoted to first by a
	 * removal cannot carry a stale either/or into the saved definition.
	 */
	_renumberGroups(root) {
		root.querySelectorAll(".stonetop-improvement-builder-group").forEach((group, i) => {
			const num = group.querySelector(".stonetop-improvement-builder-group-num");
			if (num) num.textContent = `Group ${i + 1}`;
			const alt = group.querySelector(".stonetop-improvement-builder-group-alt");
			alt?.classList.toggle("is-hidden", i === 0);
			if (i === 0 && alt) alt.querySelector("input").checked = false;
		});
	}

	/**
	 * The requirement groups as the author filled them in. Reading only: what a group
	 * MEANS (the heading it gets when blank, the shared id an either/or run needs) is
	 * decided by sectionsFromGroups, which has no DOM in it and is tested on its own.
	 */
	_readGroups(root) {
		return [...root.querySelectorAll(".stonetop-improvement-builder-group")].map(el => {
			const value = sel => el.querySelector(sel)?.value ?? "";
			return {
				heading: value(".stonetop-improvement-builder-group-heading"),
				items: value(".stonetop-improvement-builder-group-items"),
				partial: value(".stonetop-improvement-builder-group-mode") === "min",
				min: value(".stonetop-improvement-builder-group-min"),
				alternative: !!el.querySelector(".stonetop-improvement-builder-group-alt input")?.checked,
			};
		});
	}

	// ── Saving ──────────────────────────────────────────────────

	_readGrants(root) {
		const value = sel => StonetopDialog.readValue(root, sel);
		const stats = {};
		for (const field of GRANT_STAT_FIELDS) stats[field.key] = value(`[name=grant-${field.key}]`);
		return {
			stats,
			resources: value("[name=grant-resources]"),
			fortifications: value("[name=grant-fortifications]"),
			removeFortifications: value("[name=grant-remove-fortifications]"),
			setSize: value("[name=grant-size]"),
			setPopulation: value("[name=grant-set-population]"),
		};
	}

	async _save(root) {
		const value = sel => StonetopDialog.readValue(root, sel);
		const def = buildImprovementDef({
			name: value("[name=name]"),
			category: value("[name=category]"),
			flavor: value("[name=flavor]"),
			effect: value("[name=effect]"),
			sections: sectionsFromGroups(this._readGroups(root)),
			grants: this._readGrants(root),
		});

		if (!def.name) {
			ui.notifications?.warn?.("Enter a name for the improvement.");
			// The name lives on the first panel, which may not be the one showing when Save
			// is pressed: swing back to it so the focus lands somewhere the author can see.
			this._selectTab(root, SECTIONS[0].key);
			root.querySelector("[name=name]")?.focus();
			return;
		}

		const result = await this._saver.create(def);
		// A rejected write (duplicate name, no permission) has already said so through the
		// saver; leaving the window open keeps everything typed rather than making the
		// author start over from a notification.
		if (result?.ok !== false) this.close();
	}
}
