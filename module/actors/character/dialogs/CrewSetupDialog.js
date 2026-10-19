import { StonetopDialog } from "../../../utils/stonetop-dialog.js";
import { normalizePlaybookGlyphs } from "../../../utils/strings.js";
import { STONETOP_SCOPE } from "../StonetopFlags.js";
import { crewWriteInTags, crewWriteInTagBoxes, crewTagsWithWriteIns } from "../crew-write-ins.js";

// ── CrewSetupDialog ──────────────────────────────────────────────────────────
// Set up a crew the character is owed but has never been given: the Crew insert's tags, instinct,
// cost and name, written to the same `crew.*` flags onboarding's crew step writes.
//
// Two ways to be owed one. Crew learned through another playbook's move (Dabbler, Worldly, Seasoned
// Warrior, Versatile), which onboarding never asks about since the crew step follows the character's
// OWN playbook (the user's ruling: a borrowed Crew brings a crew, drawn from the one insert,
// StonetopCharacter#crewSource). And a Marshal whose onboarding stopped short of its crew step.
//
// The picks are onboarding's, and so is the markup (the `stonetop-onboarding-*` classes the crew step
// draws with): "plus 2 more of your choice" (Crew insert, p.144), raised by Veteran Crew's "Select 2
// new tags" marks, with write-in rows for three tags, an instinct and a cost of the player's own. The
// background's tag is shown locked on and never stored, as the card and onboarding keep it; a crew
// borrowed by a non-Marshal has none (utils/crew.js#crewBackgroundTag).
//
// A standalone dialog rather than onboarding's step run on its own: onboarding is built around the
// character's own playbook document and a dozen steps' state, and the crew here may be another
// playbook's. The rules live in the pure helpers below, which the tests drive.

/** How many tags the player picks: the insert's count (2), plus Veteran Crew's marked extras. */
export function crewSetupLimit(crewDef, tagBonus = 0) {
	const base = Number.isFinite(crewDef?.additionalTagCount) ? crewDef.additionalTagCount : 2;
	return base + Math.max(0, Number(tagBonus) || 0);
}

/**
 * The picks a fresh dialog starts from: whatever is already stored (a half-made crew is finished, not
 * restarted), less the background's tag and "group", which are never picks.
 */
export function crewSetupInitial(stored = {}, bgTag = null) {
	return {
		name:     String(stored?.name ?? ""),
		tags:     (Array.isArray(stored?.tags) ? stored.tags : []).filter(t => t && t !== bgTag && t !== "group"),
		instinct: String(stored?.instinct ?? ""),
		cost:     String(stored?.cost ?? ""),
	};
}

/**
 * Tick or untick a listed tag. Refused (the picks come back unchanged, `ok` false) when ticking one
 * past the limit; the caller puts the box back.
 */
export function crewSetupToggleTag(sel, tag, checked, limit) {
	const tags = sel.tags ?? [];
	if (!checked) return { ok: true, sel: { ...sel, tags: tags.filter(t => t !== tag) } };
	if (tags.includes(tag)) return { ok: true, sel };
	if (tags.length >= limit) return { ok: false, sel };
	return { ok: true, sel: { ...sel, tags: [...tags, tag] } };
}

/**
 * A tag write-in box typed in (the insert's three blank tag lines, crew-write-ins.js): the listed
 * picks, plus each box's text while there is room for it. `index` is the box (0 to 2).
 */
export function crewSetupCustomTag(sel, value, crewDef, limit, index = 0) {
	const known = new Set(crewDef?.availableTags ?? []);
	const boxes = crewWriteInTags(sel.tags, crewDef);
	boxes[Math.max(0, Math.min(boxes.length - 1, Number(index) || 0))] = String(value ?? "");
	return { ...sel, tags: crewTagsWithWriteIns((sel.tags ?? []).filter(t => known.has(t)), boxes, limit) };
}

/** Whether the crew can be made: every tag picked, an instinct and a cost. The name is optional. */
export function crewSetupReady(sel, limit) {
	return (sel.tags ?? []).length >= limit && !!String(sel.instinct ?? "").trim() && !!String(sel.cost ?? "").trim();
}

/**
 * The actor update the finished picks make: the same four `crew.*` flags onboarding writes
 * (StonetopCharacterSheet#_applyCommonSelections). Only the chosen tags are stored; the
 * background's is derived at render.
 */
export function crewSetupUpdate(sel) {
	const base = `flags.${STONETOP_SCOPE}.crew`;
	return {
		[`${base}.name`]:     String(sel.name ?? "").trim(),
		[`${base}.tags`]:     [...(sel.tags ?? [])],
		[`${base}.instinct`]: String(sel.instinct ?? "").trim(),
		[`${base}.cost`]:     String(sel.cost ?? "").trim(),
	};
}

/** What the template draws, in the shape onboarding's crew step hands its own (`crewData`). */
export function crewSetupView(crewDef, sel, { bgTag = null, limit = 2 } = {}) {
	const chosen = new Set(sel.tags ?? []);
	const atLimit = chosen.size >= limit;
	const knownTags = new Set(crewDef?.availableTags ?? []);
	const customTag = [...chosen].find(t => !knownTags.has(t)) ?? "";
	const instinctValues = (crewDef?.instincts ?? []).map(v => normalizePlaybookGlyphs(v));
	const costValues     = (crewDef?.costs ?? []).map(v => normalizePlaybookGlyphs(v));
	const isCustomInstinct = !!sel.instinct && !instinctValues.includes(sel.instinct);
	const isCustomCost     = !!sel.cost && !costValues.includes(sel.cost);
	return {
		name:               sel.name ?? "",
		bgTag:              bgTag ? normalizePlaybookGlyphs(bgTag) : "",
		additionalTagCount: limit,
		selectedTagCount:   chosen.size,
		customTag,
		customTagDisabled:  !customTag && atLimit,
		// The insert's three write-in lines, one box each (crew-write-ins.js).
		customTags:         crewWriteInTagBoxes(sel.tags, crewDef, bgTag, limit),
		tags: (crewDef?.availableTags ?? []).map(tag => {
			const isAuto     = tag === bgTag;
			const isSelected = isAuto || chosen.has(tag);
			return { slug: tag, label: normalizePlaybookGlyphs(tag), isAuto, isSelected, disabled: isAuto || (!isSelected && atLimit) };
		}),
		instincts: instinctValues.map(value => ({ value, selected: sel.instinct === value })),
		costs:     costValues.map(value => ({ value, selected: sel.cost === value })),
		customInstinct: isCustomInstinct ? sel.instinct : "",
		customCost:     isCustomCost ? sel.cost : "",
		ready:          crewSetupReady(sel, limit),
	};
}

export class CrewSetupDialog extends StonetopDialog {
	/**
	 * @param {{crewDef: object, bgTag?: string|null, tagBonus?: number, stored?: object}} ctx
	 *   `crewDef` the Crew insert (crewSource), `bgTag` the background's locked tag (the Marshal's
	 *   only), `tagBonus` Veteran Crew's extra picks, `stored` the crew flags already written
	 */
	constructor({ crewDef, bgTag = null, tagBonus = 0, stored = {} } = {}, options = {}) {
		super(options);
		this._crewDef = crewDef ?? {};
		this._bgTag   = bgTag ?? null;
		this._limit   = crewSetupLimit(this._crewDef, tagBonus);
		this._sel     = crewSetupInitial(stored, this._bgTag);
	}

	static get defaultOptions() {
		return foundry.utils.mergeObject(super.defaultOptions, {
			id:        "stonetop-crew-setup",
			title:     "Create your crew",
			template:  "systems/stonetop-pwd/templates/dialogs/crew-setup.hbs",
			width:     560,
			height:    "auto",
			resizable: true,
			classes:   ["stonetop", "stonetop-spring-dialog", "stonetop-crew-setup-dialog"],
		});
	}

	get _autoHeight() { return true; }

	getData() {
		return { crewData: crewSetupView(this._crewDef, this._sel, { bgTag: this._bgTag, limit: this._limit }) };
	}

	activateListeners(html) {
		super.activateListeners(html);
		const refresh = () => {
			const picked = this._sel.tags.length;
			const atLimit = picked >= this._limit;
			html.find(".stonetop-onboarding-crew-tag-count").text(picked);
			html.find("[name='crew-setup-tag']:not([data-auto])").each((_, el) => { if (!el.checked) el.disabled = atLimit; });
			html.find(".crew-setup-tag-custom").each((_, el) => { el.disabled = atLimit && !String(el.value ?? "").trim(); });
			html.find(".stonetop-crew-setup-create").prop("disabled", !crewSetupReady(this._sel, this._limit));
		};

		html.find(".crew-setup-name").on("input", ev => { this._sel = { ...this._sel, name: ev.currentTarget.value }; });

		html.find("[name='crew-setup-tag']").on("change", ev => {
			const { ok, sel } = crewSetupToggleTag(this._sel, ev.currentTarget.value, ev.currentTarget.checked, this._limit);
			if (!ok) { ev.currentTarget.checked = false; return; }
			this._sel = sel;
			ev.currentTarget.closest(".stonetop-onboarding-tag-option")?.classList.toggle("is-selected", ev.currentTarget.checked);
			refresh();
		});
		html.find(".crew-setup-tag-custom").on("input", ev => {
			this._sel = crewSetupCustomTag(this._sel, ev.currentTarget.value, this._crewDef, this._limit, Number(ev.currentTarget.dataset.index) || 0);
			refresh();
		});

		// A suggestion radio saves its value and clears the write-in; typing a write-in saves it and
		// clears the radios, as onboarding's crew step does.
		const bindSuggestionOrCustom = (radioName, customClass, key) => {
			html.find(`[name='${radioName}']`).on("change", ev => {
				this._sel = { ...this._sel, [key]: ev.currentTarget.value };
				html.find(customClass).val("");
				html.find(`[name='${radioName}']`).each((_, el) => el.closest(".stonetop-onboarding-card")?.classList.toggle("is-selected", el.checked));
				refresh();
			});
			html.find(customClass).on("input", ev => {
				this._sel = { ...this._sel, [key]: ev.currentTarget.value.trim() };
				html.find(`[name='${radioName}']`).prop("checked", false)
					.closest(".stonetop-onboarding-card").removeClass("is-selected");
				refresh();
			});
		};
		bindSuggestionOrCustom("crew-setup-instinct", ".crew-setup-instinct-custom", "instinct");
		bindSuggestionOrCustom("crew-setup-cost", ".crew-setup-cost-custom", "cost");

		html.find(".stonetop-crew-setup-create").on("click", () => {
			if (!crewSetupReady(this._sel, this._limit)) return;
			this._resolveWith(this._sel);
		});
		html.find(".stonetop-crew-setup-cancel").on("click", () => this.close());
	}
}
