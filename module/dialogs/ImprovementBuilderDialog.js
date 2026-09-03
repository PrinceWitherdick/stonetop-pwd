import { StonetopDialog } from "../utils/stonetop-dialog.js";
import { applyGuideRail, guideRailStep } from "../utils/guide-rail.js";
import { IMPROVEMENT_CATEGORIES, IMPROVEMENT_DEFINITIONS, IMPROVEMENT_GRANTS } from "../actors/steading/StonetopSteading.js";
import { createImprovementCard } from "../journal/steading-improvement-cards.js";
import {
	MAX_REQUIREMENT_REPEAT,
	STEADING_SIZES,
	buildImprovementDef,
	defaultSectionHeading,
	groupsFromSections,
	itemsFromRows,
	sectionsFromGroups,
	unformatImprovementText,
} from "../utils/improvement-def.js";
import { improvementPreviewHtml } from "../utils/improvement-preview.js";

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
 * Four things make it possible to actually reproduce one of the book's improvements
 * rather than merely to store the same fields:
 *
 *   - a requirement is a ROW, not a line of a textarea, so it can be moved, dropped, and
 *     repeated: "Pull Together" times five becomes five boxes numbered (1st) to (5th),
 *     which is how Additional Housing, Raincatching, Stone Wall and Township are built;
 *   - *asterisks* mark the italics the playbook puts on every move name;
 *   - "Start from" fills the whole form from an improvement that already exists, either
 *     one of the seventeen built-ins or one already added to this steading; and
 *   - a Preview panel draws the card the Improvements tab will draw.
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
	{ key: "preview",      title: "Preview",         icon: "fa-eye" },
];

/** The auto-applied stat deltas the Effect panel offers, in sheet order. */
const GRANT_STAT_FIELDS = [
	{ key: "fortunes",   label: "Fortunes" },
	{ key: "defenses",   label: "Defenses" },
	{ key: "prosperity", label: "Prosperity" },
	{ key: "population", label: "Population" },
];

/**
 * The Effect panel's other grants: the field each lives in, and how the two directions convert.
 *
 * ONE TABLE, read by `_readGrants` on the way out and `_fillFrom` on the way back in. Enumerated
 * separately, the two directions drift — and the direction that silently loses is `_fillFrom`: an
 * author who opens a finished improvement to fix a typo in its flavour text, and saves, writes back
 * a definition missing whatever grant the fill forgot, with nothing said about it.
 *
 * `field` is the form name; `key` is the name the definition uses. They differ where the definition
 * is camelCase and the markup is hyphenated.
 */
const GRANT_FIELDS = [
	{ key: "resources",            field: "resources",             fill: v => (v ?? []).join("\n") },
	{ key: "fortifications",       field: "fortifications",        fill: v => (v ?? []).join("\n") },
	{ key: "removeFortifications", field: "remove-fortifications", fill: v => (v ?? []).join("\n") },
	{ key: "setSize",              field: "size",                  fill: v => v ?? "" },
	{ key: "setPopulation",        field: "set-population",        fill: v => (Number.isFinite(v) ? String(v) : "") },
];

/**
 * The book's own seventeen, as "Start from" sources. Their one-time mechanical effects
 * live in IMPROVEMENT_GRANTS keyed by slug rather than on the definition, so they are
 * folded back on here: a copy of Palisade that came back without its +1 Fortunes would
 * be a copy of the prose only.
 */
function builtinSources() {
	return {
		label: "From the playbook",
		options: IMPROVEMENT_DEFINITIONS.map(def => ({
			value: `builtin:${def.slug}`,
			label: def.label,
			def: { ...def, name: def.label, grants: IMPROVEMENT_GRANTS[def.slug] ?? null },
		})),
	};
}

/**
 * A name the write target will actually accept, by marking a copy as one until a free name
 * turns up. Only used when the target says the original is taken: a homebrew card in the
 * journal may share a name with the book's improvement, and does, so nothing is suffixed
 * there. Bounded, and falls back to the plain name so the saver can refuse and say why
 * rather than this looping.
 */
export function freeImprovementName(name, taken) {
	if (!taken?.(name)) return name;
	for (let n = 1; n <= 99; n++) {
		const candidate = n === 1 ? `${name} (homebrew)` : `${name} (homebrew ${n})`;
		if (!taken(candidate)) return candidate;
	}
	return name;
}

/** Write target: a reusable homebrew card in the journal, dragged onto a steading later. */
export function improvementCardSaver() {
	return {
		submitLabel: "Create card",
		hint: "Author a reusable improvement card, then drag it onto any steading's Improvements tab.",
		sources: () => [builtinSources()],
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
		// This steading's own additions are offered too, which is the only way to correct
		// one: a definition already on the sheet cannot be edited in place, so copying it,
		// fixing it and removing the original is the path, and it needs the copy to work.
		// A steading holds one improvement per name (the book's own included), so a copy of
		// Palisade made HERE is offered as "Palisade (homebrew)" rather than filled in and
		// then refused on save. The journal-card target has no such rule and declares none.
		nameTaken: name => !!steading?.improvementNameTaken?.(name),
		sources: () => {
			const custom = steading?.customImprovements ?? [];
			return [
				builtinSources(),
				...(custom.length ? [{
					label: "Already on this steading",
					options: custom.map(def => ({ value: `custom:${def.slug}`, label: def.label, def: { ...def, name: def.label } })),
				}] : []),
			];
		},
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

/**
 * Write target: an improvement already on the steading, rewritten in place. The window opens
 * filled in (`editing`), keeps the improvement's slug and so its ticked steps, and says what
 * an edit could not do by itself.
 * @param {object}   steading  StonetopSteading wrapper
 * @param {string}   slug      the improvement being rewritten
 * @param {Function} [onSaved] called after a successful write (to re-render the sheet)
 */
export function improvementEditSaver(steading, slug, onSaved = null) {
	const def = steading?.improvementDef?.(slug) ?? null;
	return {
		submitLabel: "Save changes",
		hint: "Rewrite this improvement. Its ticked steps are kept wherever they still apply.",
		title: `Edit ${def?.label ?? "Improvement"}`,
		// Opens filled in rather than blank: this is a correction, not a new improvement.
		editing: def ? { ...def, name: def.label } : null,
		// Its own name is not a clash with itself; every other improvement's still is.
		nameTaken: name => !!steading?.improvementNameTaken?.(name, { except: slug }),
		sources: () => steadingImprovementSaver(steading).sources(),
		async create(next) {
			const result = await steading.updateCustomImprovement(slug, next);
			if (result.ok) {
				// Two things an edit does NOT do, said only when they actually apply, so the
				// notice stays worth reading. See updateCustomImprovement.
				const notes = [];
				if (result.structureChanged) notes.push("ticked steps were carried across by name");
				if (result.grantsChanged && result.completed) {
					notes.push("its automatic effects changed, but what completing it already applied is unchanged; un-tick and re-tick it to apply the new ones");
				}
				ui.notifications?.info?.(`Saved ${result.label}${notes.length ? `: ${notes.join("; ")}` : "."}`);
				onSaved?.();
			} else if (result.reason === "duplicate") {
				ui.notifications?.warn?.(`${result.label} is already a steading improvement.`);
			} else if (result.reason === "missing") {
				ui.notifications?.warn?.("That improvement is no longer on the steading.");
			}
			return result;
		},
	};
}

/**
 * Move `el` one place up (`delta < 0`) or down among its siblings.
 *
 * Answers whether anything moved, so the caller re-labels only when it did. Shared by the group
 * list and the requirement rows: the two lists renumber differently but reorder identically, and
 * two copies of "which neighbour, and which side of it" is two places to get the ends wrong.
 */
function swapSibling(el, delta) {
	const sibling = delta < 0 ? el.previousElementSibling : el.nextElementSibling;
	if (!sibling) return false;
	if (delta < 0) sibling.before(el);
	else sibling.after(el);
	return true;
}

/** Grey out the up/down buttons on the item at either end of its list, which has nowhere to go. */
function disableEnds(el, i, total, prefix) {
	el.querySelector(`${prefix}-up`)?.toggleAttribute("disabled", i === 0);
	el.querySelector(`${prefix}-down`)?.toggleAttribute("disabled", i === total - 1);
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
		// Definitions the "Start from" picker can copy, keyed by its option value. Built
		// once here rather than per pick, so the list the window offers and the list it
		// can actually fill from cannot come apart.
		this._sources = new Map();
		for (const group of saver.sources?.() ?? []) {
			for (const option of group.options ?? []) this._sources.set(option.value, option.def);
		}
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

	get title() { return this._saver.title ?? "Create Steading Improvement"; }

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
			maxRepeat: MAX_REQUIREMENT_REPEAT,
			sizes: STEADING_SIZES.map(size => ({ value: size, label: size })),
			sourceGroups: (this._saver.sources?.() ?? []).map(group => ({
				label: group.label,
				options: (group.options ?? []).map(({ value, label }) => ({ value, label })),
			})),
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
		// Editing an improvement opens on it. Otherwise one empty group to start, because a
		// requirement list is what most improvements are, and an empty panel with only an
		// "Add" button reads as though there is nothing to do.
		if (this._saver.editing) this._fillFrom(root, this._saver.editing);
		else this._addGroup(root);

		root.querySelector(".stonetop-improvement-builder-source")
			?.addEventListener("change", event => this._onPickSource(root, event.currentTarget));

		// The preview is redrawn on every keystroke, but only while its own panel is the
		// one showing: everywhere else it would be rebuilding a card nobody is looking at
		// on each character typed.
		root.addEventListener("input", () => { if (this._activeTab === "preview") this._renderPreview(root); });

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
		// Built on the way in rather than kept in step with every edit: the panel is only
		// ever read when it is the one showing.
		if (key === "preview") this._renderPreview(root);

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

	/**
	 * Clone the empty-group markup out of the template's <template> and wire its controls.
	 * @param {HTMLElement} root
	 * @param {{heading?:string, rows?:Array, partial?:boolean, min?:number, alternative?:boolean}} [values]
	 *   a group to fill it with, when the form is being filled from an existing improvement
	 * @returns {HTMLElement} the group element, so a caller can keep filling it
	 */
	_addGroup(root, values = null) {
		const tpl = root.querySelector(".stonetop-improvement-builder-group-tpl");
		const list = root.querySelector(".stonetop-improvement-builder-groups");
		if (!tpl || !list) return null;
		const group = tpl.content.firstElementChild.cloneNode(true);

		group.querySelector(".stonetop-improvement-builder-group-remove")
			?.addEventListener("click", () => { group.remove(); this._renumberGroups(root); });
		group.querySelector(".stonetop-improvement-builder-group-up")
			?.addEventListener("click", () => this._moveGroup(root, group, -1));
		group.querySelector(".stonetop-improvement-builder-group-down")
			?.addEventListener("click", () => this._moveGroup(root, group, 1));
		const mode = group.querySelector(".stonetop-improvement-builder-group-mode");
		mode?.addEventListener("change", () => { this._syncGroupMode(group); this._syncGroupHeading(group); });
		group.querySelector(".stonetop-improvement-builder-group-min")
			?.addEventListener("input", () => this._syncGroupHeading(group));
		group.querySelector(".stonetop-improvement-builder-group-alt input")
			?.addEventListener("change", () => this._syncGroupHeading(group));
		group.querySelector(".stonetop-improvement-builder-add-row")
			?.addEventListener("click", () => this._addRow(root, group));

		list.appendChild(group);

		if (values) {
			const set = (sel, v) => { const el = group.querySelector(sel); if (el) el.value = v; };
			set(".stonetop-improvement-builder-group-heading", values.heading ?? "");
			set(".stonetop-improvement-builder-group-mode", values.partial ? "min" : "all");
			set(".stonetop-improvement-builder-group-min", String(values.min ?? 1));
			const alt = group.querySelector(".stonetop-improvement-builder-group-alt input");
			if (alt) alt.checked = !!values.alternative;
			for (const row of values.rows ?? []) this._addRow(root, group, row);
		}
		// One empty requirement in a fresh group, for the same reason a fresh window gets
		// one group: a panel offering only an "Add" button reads as though it is broken.
		if (!group.querySelector(".stonetop-improvement-builder-req")) this._addRow(root, group);

		this._syncGroupMode(group);
		this._renumberGroups(root);
		return group;
	}

	/** Swap a group with its neighbour, then re-label and re-check the whole list. */
	_moveGroup(root, group, delta) {
		if (swapSibling(group, delta)) this._renumberGroups(root);
	}

	/** The "at least N" box only means anything in the matching mode. */
	_syncGroupMode(group) {
		const partial = group.querySelector(".stonetop-improvement-builder-group-mode")?.value === "min";
		group.querySelector(".stonetop-improvement-builder-group-min-wrap")?.classList.toggle("is-hidden", !partial);
		this._syncGroupHeading(group);
	}

	/**
	 * Show, as the heading field's placeholder, the heading that would actually be written
	 * for this group if it is left blank. "Leave it blank and it is written for you" is
	 * only a useful offer if you can see what it writes, and what it writes turns on the
	 * group's position, its item count and its either/or state, all of which move.
	 */
	_syncGroupHeading(group) {
		const field = group.querySelector(".stonetop-improvement-builder-group-heading");
		if (!field) return;
		const partial = group.querySelector(".stonetop-improvement-builder-group-mode")?.value === "min";
		const alt = group.querySelector(".stonetop-improvement-builder-group-alt");
		field.placeholder = defaultSectionHeading({
			index: [...(group.parentElement?.children ?? [])].indexOf(group),
			min: partial ? Number(group.querySelector(".stonetop-improvement-builder-group-min")?.value) : null,
			// Boxes, not rows: "2 of the following" is measured against the checkboxes the
			// group actually makes, and a repeated row makes several. Counting rows here had
			// the placeholder saying "And then:" for a group whose written heading would have
			// been "And 2 of the following:", which is the one thing it must not do.
			count: itemsFromRows(this._readRows(group)).length,
			alternative: !alt?.classList.contains("is-hidden") && !!alt?.querySelector("input")?.checked,
		});
	}

	/**
	 * Re-label the groups after one is added, removed or moved, and hide the "alternative
	 * to the group above" checkbox on the FIRST group, which has nothing above it to be an
	 * alternative to. Unticked as well as hidden, so a group promoted to first by a removal
	 * cannot carry a stale either/or into the saved definition.
	 */
	_renumberGroups(root) {
		const groups = [...root.querySelectorAll(".stonetop-improvement-builder-group")];
		groups.forEach((group, i) => {
			const num = group.querySelector(".stonetop-improvement-builder-group-num");
			if (num) num.textContent = `Group ${i + 1}`;
			const alt = group.querySelector(".stonetop-improvement-builder-group-alt");
			alt?.classList.toggle("is-hidden", i === 0);
			if (i === 0 && alt) alt.querySelector("input").checked = false;
			// A group at either end has nothing to swap with in that direction.
			disableEnds(group, i, groups.length, ".stonetop-improvement-builder-group");
			this._syncGroupHeading(group);
		});
	}

	// ── Requirement rows ────────────────────────────────────────

	/**
	 * One requirement: the text beside its checkbox and how many boxes it makes. A row per
	 * requirement rather than a line of a textarea is what lets a step be moved, dropped,
	 * or repeated without retyping the ones around it.
	 * @param {{text?: string, repeat?: number}} [values]
	 */
	_addRow(root, group, values = null) {
		const tpl = root.querySelector(".stonetop-improvement-builder-row-tpl");
		const list = group.querySelector(".stonetop-improvement-builder-rows");
		if (!tpl || !list) return null;
		const row = tpl.content.firstElementChild.cloneNode(true);

		row.querySelector(".stonetop-improvement-builder-req-remove")?.addEventListener("click", () => {
			row.remove();
			// A group with no rows left gets one back rather than becoming un-addable.
			if (!group.querySelector(".stonetop-improvement-builder-req")) this._addRow(root, group);
			this._renumberRows(group);
		});
		row.querySelector(".stonetop-improvement-builder-req-up")?.addEventListener("click", () => this._moveRow(group, row, -1));
		row.querySelector(".stonetop-improvement-builder-req-down")?.addEventListener("click", () => this._moveRow(group, row, 1));
		// The heading the group would be given counts its requirements, so it changes as
		// rows and repeats do ("Requires 2 of the following" vs "Requires all of them").
		row.querySelector(".stonetop-improvement-builder-req-count")
			?.addEventListener("input", () => this._syncGroupHeading(group));

		if (values) {
			const text = row.querySelector(".stonetop-improvement-builder-req-text");
			if (text) text.value = values.text ?? "";
			const count = row.querySelector(".stonetop-improvement-builder-req-count");
			if (count) count.value = String(Math.min(Math.max(Number(values.repeat) || 1, 1), MAX_REQUIREMENT_REPEAT));
		}

		list.appendChild(row);
		this._renumberRows(group);
		return row;
	}

	/** Swap a row with its neighbour inside its own group. */
	_moveRow(group, row, delta) {
		if (swapSibling(row, delta)) this._renumberRows(group);
	}

	/** Grey out the move buttons at each end, and refresh the group's written heading. */
	_renumberRows(group) {
		const rows = [...group.querySelectorAll(".stonetop-improvement-builder-req")];
		rows.forEach((row, i) => disableEnds(row, i, rows.length, ".stonetop-improvement-builder-req"));
		this._syncGroupHeading(group);
	}

	/** One group's requirement rows, as authored. */
	_readRows(group) {
		return [...group.querySelectorAll(".stonetop-improvement-builder-req")].map(row => ({
			text: row.querySelector(".stonetop-improvement-builder-req-text")?.value ?? "",
			repeat: row.querySelector(".stonetop-improvement-builder-req-count")?.value ?? "1",
		})).filter(r => r.text.trim());
	}

	/**
	 * The requirement groups as the author filled them in. Reading only: what a group
	 * MEANS (the heading it gets when blank, the boxes a repeat expands into, the shared
	 * id an either/or run needs) is decided by sectionsFromGroups and itemsFromRows, which
	 * have no DOM in them and are tested on their own.
	 */
	_readGroups(root) {
		return [...root.querySelectorAll(".stonetop-improvement-builder-group")].map(el => {
			const value = sel => el.querySelector(sel)?.value ?? "";
			return {
				heading: value(".stonetop-improvement-builder-group-heading"),
				rows: this._readRows(el),
				partial: value(".stonetop-improvement-builder-group-mode") === "min",
				min: value(".stonetop-improvement-builder-group-min"),
				alternative: !!el.querySelector(".stonetop-improvement-builder-group-alt input")?.checked,
			};
		});
	}

	// ── Starting from an improvement that already exists ─────────

	/**
	 * Copy the picked improvement into every panel. The select is put back to its blank
	 * entry afterwards, so it reads as an action taken rather than as a state the window
	 * is now in, and so picking the same one twice works.
	 */
	_onPickSource(root, select) {
		const def = this._sources.get(select?.value);
		select.value = "";
		if (!def) return;
		const name = freeImprovementName(def.name, this._saver.nameTaken);
		this._fillFrom(root, { ...def, name });
		ui.notifications?.info?.(name === def.name
			? `Copied ${def.name} into the form.`
			: `Copied ${def.name} into the form as "${name}", since the steading already has one by that name.`);
	}

	/**
	 * Fill the form from a definition. Stored text is HTML (see improvement-def.js), so it
	 * comes back through unformatImprovementText into the *asterisk* form that was typed;
	 * requirement items come back through groupsFromSections, which re-collapses a
	 * numbered run into the single repeated row that produced it.
	 */
	_fillFrom(root, def) {
		const set = (sel, v) => { const el = root.querySelector(sel); if (el) el.value = v; };
		set("[name=name]", def.name ?? "");
		set("[name=category]", def.category ?? "");
		set("[name=flavor]", def.flavor ?? "");
		set("[name=effect]", unformatImprovementText(def.effect ?? ""));

		const list = root.querySelector(".stonetop-improvement-builder-groups");
		if (list) list.replaceChildren();
		const groups = groupsFromSections(def.sections ?? []);
		for (const group of groups.length ? groups : [null]) this._addGroup(root, group);

		const grants = def.grants ?? {};
		for (const field of GRANT_STAT_FIELDS) set(`[name=grant-${field.key}]`, grants.stats?.[field.key] ?? "");
		for (const f of GRANT_FIELDS) set(`[name=grant-${f.field}]`, f.fill(grants[f.key]));

		if (this._activeTab === "preview") this._renderPreview(root);
	}

	// ── Preview ─────────────────────────────────────────────────

	/** Draw the card the Improvements tab will draw, from the definition the form makes. */
	_renderPreview(root) {
		const target = root.querySelector(".stonetop-improvement-builder-preview");
		if (target) target.innerHTML = improvementPreviewHtml(this._readDef(root));
	}

	// ── Saving ──────────────────────────────────────────────────

	_readGrants(root) {
		const value = sel => StonetopDialog.readValue(root, sel);
		const stats = {};
		for (const field of GRANT_STAT_FIELDS) stats[field.key] = value(`[name=grant-${field.key}]`);
		const grants = { stats };
		for (const f of GRANT_FIELDS) grants[f.key] = value(`[name=grant-${f.field}]`);
		return grants;
	}

	/**
	 * The definition the form currently describes. The ONE place the window turns itself
	 * into a definition, so the Preview panel cannot be showing a card that differs from
	 * the one Save would write.
	 */
	_readDef(root) {
		const value = sel => StonetopDialog.readValue(root, sel);
		return buildImprovementDef({
			name: value("[name=name]"),
			category: value("[name=category]"),
			flavor: value("[name=flavor]"),
			effect: value("[name=effect]"),
			sections: sectionsFromGroups(this._readGroups(root)),
			grants: this._readGrants(root),
		});
	}

	async _save(root) {
		const def = this._readDef(root);

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
