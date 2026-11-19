import { StonetopDialog } from "../../../utils/stonetop-dialog.js";
import { normalizePlaybookGlyphs } from "../../../utils/strings.js";
import { STONETOP_SCOPE } from "../StonetopFlags.js";
import { companionKindOptions, companionPaidTraits, companionTraitAllowance } from "../animal-companion.js";
import { togglePick, suggestionView, paintPickLimit, bindSuggestionOrCustom } from "./pick-with-writein.js";

// ── CompanionSetupDialog ─────────────────────────────────────────────────────
// Set up an animal companion the character is owed but has never been given: the Animal Companion
// insert's type, kind, options, instinct, cost and name, written to the same `animalCompanion.*` flags
// onboarding's companion step writes. CrewSetupDialog's shape, for the Ranger.
//
// Owed one whenever Animal Companion is LEARNED and no companion is stored. Onboarding only asks while
// the character's own playbook is the Ranger's and the move is had at creation, so every other way of
// gaining it lands here: Animal Companion taken at a level-up or ticked on the Moves tab, a mid-play
// switch to Beast-Bonded, or the move learned through another playbook's (Wild Soul, Dabbler, Versatile,
// ...), whose companion is drawn from the one insert (StonetopCharacter#companionSource).
//
// The picks are onboarding's, and so is the markup (the `stonetop-onboarding-*` classes its companion
// step draws with): the type's "Pick N more" plus 2 per learned Magnificent Specimen
// (animal-companion.js#companionTraitAllowance), the type's pre-ticked option shown locked on and never
// counted or stored, a write-in row for an option, instinct and cost of the player's own. The rules live
// in the pure helpers below, which the tests drive.

/** The companion's type in the insert, by slug, or null. */
export function companionSetupType(companionDef, slug) {
	return (companionDef?.types ?? []).find(t => t.slug === slug) ?? null;
}

/** How many options the player picks: the type's "Pick N more", plus Magnificent Specimen's learned extras. */
export function companionSetupLimit(typeData, traitBonus = 0) {
	return typeData ? companionTraitAllowance(typeData) + Math.max(0, Number(traitBonus) || 0) : 0;
}

/**
 * The picks a fresh dialog starts from: whatever is already stored (a half-made companion is finished,
 * not restarted), less the type's pre-ticked option, which is never a pick.
 */
export function companionSetupInitial(stored = {}, companionDef = null) {
	const type = String(stored?.type ?? "");
	const typeData = companionSetupType(companionDef, type);
	return {
		type:     typeData ? type : "",
		kind:     String(stored?.kind ?? ""),
		traits:   typeData ? companionPaidTraits(typeData, Array.isArray(stored?.traits) ? stored.traits : []) : [],
		name:     String(stored?.name ?? ""),
		instinct: String(stored?.instinct ?? ""),
		cost:     String(stored?.cost ?? ""),
	};
}

/** Choose a type: its picks and kind start over, as onboarding's do. */
export function companionSetupSelectType(sel, slug) {
	return { ...sel, type: String(slug ?? ""), traits: [], kind: "" };
}

/**
 * Tick or untick a listed option. Refused (the picks come back unchanged, `ok` false) when ticking one
 * past the limit, or the pre-ticked option; the caller puts the box back.
 */
export function companionSetupToggleTrait(sel, trait, checked, limit, typeData = null) {
	if (trait === typeData?.mandatoryTrait) return { ok: false, sel };
	return togglePick(sel, "traits", trait, checked, limit);
}

/** The option write-in: the listed picks, plus this one while there is room for it. */
export function companionSetupCustomTrait(sel, value, typeData, limit) {
	const known = new Set(typeData?.traits ?? []);
	const traits = (sel.traits ?? []).filter(t => known.has(t));
	const typed = String(value ?? "").trim();
	if (typed && traits.length < limit) traits.push(typed);
	return { ...sel, traits };
}

/** Whether the companion can be made: a type and a kind, every option picked, an instinct and a cost. */
export function companionSetupReady(sel, limit) {
	return !!sel.type && !!String(sel.kind ?? "").trim() && (sel.traits ?? []).length === limit
		&& !!String(sel.instinct ?? "").trim() && !!String(sel.cost ?? "").trim();
}

/**
 * The actor update the finished picks make: the `animalCompanion.*` flags onboarding writes
 * (StonetopCharacterSheet#_applyCommonSelections), the name only when one was given.
 */
export function companionSetupUpdate(sel) {
	const base = `flags.${STONETOP_SCOPE}.animalCompanion`;
	const name = String(sel.name ?? "").trim();
	return {
		[`${base}.type`]:     String(sel.type ?? ""),
		[`${base}.kind`]:     String(sel.kind ?? "").trim(),
		[`${base}.traits`]:   [...(sel.traits ?? [])],
		[`${base}.instinct`]: String(sel.instinct ?? "").trim(),
		[`${base}.cost`]:     String(sel.cost ?? "").trim(),
		...(name ? { [`${base}.name`]: name } : {}),
	};
}

/** What the template draws, in the shape onboarding's companion step hands its own (`acData`). */
export function companionSetupView(companionDef, sel, { traitBonus = 0 } = {}) {
	const typeData = companionSetupType(companionDef, sel.type);
	const limit = companionSetupLimit(typeData, traitBonus);
	const chosen = new Set(sel.traits ?? []);
	const atLimit = chosen.size >= limit;
	const mandatory = typeData?.mandatoryTrait ?? null;
	const known = new Set(typeData?.traits ?? []);
	const customTrait = [...chosen].find(t => !known.has(t)) ?? "";
	const kinds = companionKindOptions(typeData);
	const instinct = suggestionView(companionDef?.instincts, sel.instinct);
	const cost     = suggestionView(companionDef?.costs, sel.cost);
	return {
		name: sel.name ?? "",
		types: (companionDef?.types ?? []).map(t => ({
			slug: t.slug, label: normalizePlaybookGlyphs(t.label), examples: normalizePlaybookGlyphs(t.examples ?? ""),
			hp: t.hp, armor: t.armor, damage: t.damage, selected: t.slug === sel.type,
		})),
		selectedType: typeData ? {
			slug:          typeData.slug,
			kind:          sel.kind ?? "",
			customKind:    kinds.includes(sel.kind) ? "" : (sel.kind ?? ""),
			isCustomKind:  !!sel.kind && !kinds.includes(sel.kind),
			kindOptions:   kinds.map(value => ({ value, selected: sel.kind === value })),
			pickCount:     limit,
			selectedCount: chosen.size,
			customTrait,
			customTraitDisabled: !customTrait && atLimit,
			traits: (typeData.traits ?? []).map(trait => {
				const isMandatory = trait === mandatory;
				return {
					slug: trait, label: normalizePlaybookGlyphs(trait), isMandatory,
					isSelected: isMandatory || chosen.has(trait),
					disabled:   isMandatory || (!chosen.has(trait) && atLimit),
				};
			}),
		} : null,
		instincts:      instinct.options,
		costs:          cost.options,
		customInstinct: instinct.custom,
		customCost:     cost.custom,
		ready:          companionSetupReady(sel, limit),
	};
}

export class CompanionSetupDialog extends StonetopDialog {
	/**
	 * @param {{companionDef: object, traitBonus?: number, stored?: object}} ctx
	 *   `companionDef` the Animal Companion insert (companionSource), `traitBonus` the learned
	 *   Magnificent Specimens' extra options, `stored` the companion flags already written
	 */
	constructor({ companionDef, traitBonus = 0, stored = {} } = {}, options = {}) {
		super(options);
		this._def        = companionDef ?? {};
		this._traitBonus = Math.max(0, Number(traitBonus) || 0);
		this._sel        = companionSetupInitial(stored, this._def);
	}

	static get defaultOptions() {
		return foundry.utils.mergeObject(super.defaultOptions, {
			id:        "stonetop-companion-setup",
			title:     "Create your companion",
			template:  "systems/stonetop-pwd/templates/dialogs/companion-setup.hbs",
			width:     600,
			height:    "auto",
			resizable: true,
			classes:   ["stonetop", "stonetop-spring-dialog", "stonetop-companion-setup-dialog"],
		});
	}

	get _autoHeight() { return true; }

	_type()  { return companionSetupType(this._def, this._sel.type); }
	_limit() { return companionSetupLimit(this._type(), this._traitBonus); }

	getData() {
		return { acData: companionSetupView(this._def, this._sel, { traitBonus: this._traitBonus }) };
	}

	activateListeners(html) {
		super.activateListeners(html);
		// Looked up once: the markup only changes on a re-render, which binds afresh.
		const pickEls = {
			count:  html.find(".stonetop-onboarding-ac-trait-count"),
			boxes:  html.find("[name='companion-setup-trait']:not([data-mandatory])"),
			custom: html.find(".companion-setup-trait-custom"),
			create: html.find(".stonetop-companion-setup-create"),
		};
		const refresh = () => {
			const limit = this._limit();
			paintPickLimit(pickEls, this._sel.traits.length, limit, companionSetupReady(this._sel, limit));
		};

		html.find(".companion-setup-name").on("input", ev => { this._sel = { ...this._sel, name: ev.currentTarget.value }; });

		html.find("[name='companion-setup-type']").on("change", ev => {
			this._sel = companionSetupSelectType(this._sel, ev.currentTarget.value);
			this.render(false);
		});
		html.find("[name='companion-setup-kind']").on("change", ev => {
			const value = ev.currentTarget.value;
			this._sel = { ...this._sel, kind: value === "custom" ? String(html.find(".companion-setup-kind-custom").val() ?? "").trim() : value };
			html.find("[name='companion-setup-kind']").each((_, el) => el.closest(".stonetop-onboarding-appearance-option")?.classList.toggle("is-selected", el.checked));
			refresh();
		});
		html.find(".companion-setup-kind-custom").on("input", ev => {
			this._sel = { ...this._sel, kind: ev.currentTarget.value.trim() };
			html.find("[name='companion-setup-kind'][value='custom']").prop("checked", true);
			html.find("[name='companion-setup-kind']").each((_, el) => el.closest(".stonetop-onboarding-appearance-option")?.classList.toggle("is-selected", el.checked));
			refresh();
		});

		html.find("[name='companion-setup-trait']").on("change", ev => {
			const { ok, sel } = companionSetupToggleTrait(this._sel, ev.currentTarget.value, ev.currentTarget.checked, this._limit(), this._type());
			if (!ok) { ev.currentTarget.checked = !ev.currentTarget.checked; return; }
			this._sel = sel;
			ev.currentTarget.closest(".stonetop-onboarding-tag-option")?.classList.toggle("is-selected", ev.currentTarget.checked);
			refresh();
		});
		html.find(".companion-setup-trait-custom").on("input", ev => {
			this._sel = companionSetupCustomTrait(this._sel, ev.currentTarget.value, this._type(), this._limit());
			refresh();
		});

		// A suggestion radio saves its value and clears the write-in; typing a write-in saves it and
		// clears the radios, as onboarding's companion step does.
		const setSel = key => value => { this._sel = { ...this._sel, [key]: value }; };
		bindSuggestionOrCustom(html, "companion-setup-instinct", ".companion-setup-instinct-custom", setSel("instinct"), refresh);
		bindSuggestionOrCustom(html, "companion-setup-cost", ".companion-setup-cost-custom", setSel("cost"), refresh);

		html.find(".stonetop-companion-setup-create").on("click", () => {
			if (!companionSetupReady(this._sel, this._limit())) return;
			this._resolveWith(this._sel);
		});
		html.find(".stonetop-companion-setup-cancel").on("click", () => this.close());
	}
}
