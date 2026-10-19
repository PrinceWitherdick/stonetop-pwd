import { POUCH_SLOTS_KEY } from "./sacred-pouch.js";

// The write-in labels an onboarding apply stores. Onboarding has the one "Something else" box,
// opened on the FIRST stored write-in, so its answer replaces only that one (blank drops it); any
// more the sheet's Inventory tab added after it are kept as they are, since the run never showed
// them. A new playbook clears the whole possessions flag before this runs (clearPlaybookData).
export function onboardingWriteIns(written, stored = []) {
	return [
		...(String(written ?? "").trim() ? [written] : []),
		...(stored ?? []).slice(1).map(c => c?.label).filter(Boolean),
	];
}

export class CharacterPossessions {
	constructor(flags) {
		this._flags = flags;
	}

	get selected()    { return new Set(this._flags.getFlag("selected") ?? []); }
	get uses()        { return this._flags.getFlag("uses") ?? {}; }
	get maxUses()     { return this._flags.getFlag("maxUses") ?? {}; }
	get subChoices()  { return this._flags.getFlag("subChoices") ?? {}; }
	get choiceUses()  { return this._flags.getFlag("choiceUses") ?? {}; }
	// How far a possession that `produces` something has been ticked, ever, keyed by slug: the
	// uses already paid out, so a use unticked and ticked again pays nothing twice.
	get produced()    { return this._flags.getFlag("produced") ?? {}; }
	// The level a move-granted possession arrived at (the Seeker's sacred pouch), keyed by
	// slug. Its Stock grows only from then on — see StonetopCharacter#computePossessionMaxUses.
	get grantedAtLevel() { return this._flags.getFlag("grantedAtLevel") ?? {}; }
	// Player-written "something else (discuss with GM)" possessions — items not on the
	// playbook's list, stored as { slug, label } since there's no option to match by slug.
	get custom()      { return this._flags.getFlag("custom") ?? []; }

	async select(slug) {
		const s = this.selected;
		s.add(slug);
		await this._flags.setFlag("selected", [...s]);
	}

	async setGrantedAtLevel(slug, level) {
		await this._flags.setFlag("grantedAtLevel", { ...this.grantedAtLevel, [slug]: level });
	}

	// Forget everything a move-granted possession carried (its level, spent uses and picks),
	// so taking the move again starts the possession fresh rather than half-spent.
	async forgetGranted(slug) {
		await this._flags.batch({ deletes: { grantedAtLevel: [slug], uses: [slug], subChoices: [slug] } });
	}

	// Un-picking a possession forgets its spent uses and its picks with it, in the same write, so
	// picking it again starts it fresh (Books & scrolls back at 5, not at what was left). A
	// grant-only possession's release clears the same keys (forgetGranted).
	async deselect(slug) {
		const s = this.selected;
		s.delete(slug);
		const deletes = {};
		if (slug in this.uses)       deletes.uses       = [slug];
		if (slug in this.subChoices) deletes.subChoices = [slug];
		if (slug in this.produced)   deletes.produced   = [slug];
		await this._flags.batch({ sets: { selected: [...s] }, deletes });
	}

	// `produced` (setPossessionUses) lands in the same write as the count it was read against.
	async setUses(slug, count, { produced } = {}) {
		if (produced == null) return this._flags.setFlag("uses", { ...this.uses, [slug]: count });
		await this._flags.batch({ sets: { uses: { ...this.uses, [slug]: count }, produced: { ...this.produced, [slug]: produced } } });
	}

	// What the sacred pouch holds besides Stock (a stored malady, a borrowed power), raw as stored:
	// see sacred-pouch.js for the shape. An ARRAY, so it is always written whole.
	get pouchSlots() { return this._flags.getFlag(POUCH_SLOTS_KEY) ?? []; }

	// The entries and the pouch's spent count in ONE write: an entry changes the room the count is
	// read against, so the two must never land apart (sacred-pouch.js).
	async setPouchSlots(pouchSlug, slots, spent) {
		await this._flags.batch({ sets: { [POUCH_SLOTS_KEY]: [...slots], uses: { ...this.uses, [pouchSlug]: spent } } });
	}

	async addSubChoice(possessionSlug, choiceSlug) {
		const current = this.subChoices;
		const existing = current[possessionSlug] ?? [];
		if (existing.includes(choiceSlug)) return;
		await this._flags.setFlag("subChoices", { ...current, [possessionSlug]: [...existing, choiceSlug] });
	}

	// Replace a possession's whole sub-choice list (used when re-applying onboarding, so
	// sub-choices the player deselected are dropped rather than left behind by add-only writes).
	async setSubChoices(possessionSlug, choiceSlugs) {
		await this.writeSubChoices(possessionSlug, choiceSlugs);
	}

	async removeSubChoice(possessionSlug, choiceSlug) {
		const existing = this.subChoices[possessionSlug] ?? [];
		await this.writeSubChoices(possessionSlug, existing.filter(s => s !== choiceSlug));
	}

	// Replace a possession's picks and clear the ◇ carry mark on `uncarry` in ONE document
	// write. Every actor.update on a character re-runs the ledger's snapshot diff, so a pick
	// change and the carry marks it invalidates must not go out as separate updates — which
	// is why the caller hands both over at once (see StonetopCharacter#deselectSubChoice for
	// the rule about which picks lose their mark). `also` is an update fragment landed in the same
	// write: the undefined marks those carry marks drew, handed back (StonetopCharacter#_choiceGiveBackData).
	async writeSubChoices(possessionSlug, choiceSlugs, { uncarry = [], also = {} } = {}) {
		const sets = { subChoices: { ...this.subChoices, [possessionSlug]: [...(choiceSlugs ?? [])] } };
		if (uncarry.length) {
			sets.choiceCarried = { ...this.choiceCarried };
			for (const slug of uncarry) sets.choiceCarried[`${possessionSlug}:${slug}`] = false;
		}
		if (!Object.keys(also).length) return this._flags.batch({ sets });
		const data = Object.assign({}, ...Object.entries(sets).map(([key, value]) => this._flags.updateData(key, value)));
		await this._flags.applyUpdateData({ ...data, ...also });
	}

	async selectExclusive(possessionSlug, choiceSlug, exclusiveSlugs) {
		const current = this.subChoices;
		const existing = current[possessionSlug] ?? [];
		const filtered = existing.filter(s => !exclusiveSlugs.includes(s));
		const updated = filtered.includes(choiceSlug) ? filtered : [...filtered, choiceSlug];
		await this._flags.setFlag("subChoices", { ...current, [possessionSlug]: updated });
	}

	// `options` (a `stonetopMove`, say) rides on the write when given, so a move spending these uses
	// is named for it in the ledger.
	async setChoiceUses(possessionSlug, choiceSlug, count, options) {
		const key = `${possessionSlug}:${choiceSlug}`;
		await this._flags.setFlag("choiceUses", { ...this.choiceUses, [key]: count }, options);
	}

	// Which of a gear-bearing bundle's *picked* options are actually being carried — the
	// ◇ load mark, which is separate from the pick. A Heavy chooses three Weapons of war
	// once (subChoices) and then marks whichever of them they're hauling right now.
	// Keyed possessionSlug:choiceSlug like choiceUses; unset = not carried.
	get choiceCarried() { return this._flags.getFlag("choiceCarried") ?? {}; }

	isChoiceCarried(possessionSlug, choiceSlug) {
		return this.choiceCarried[`${possessionSlug}:${choiceSlug}`] === true;
	}

	// Stores `false` rather than dropping the key: setFlag merges, so a deleted key
	// would just be re-filled from the stored object on the next read.
	async setChoiceCarried(possessionSlug, choiceSlug, isCarried) {
		const key = `${possessionSlug}:${choiceSlug}`;
		await this._flags.setFlag("choiceCarried", { ...this.choiceCarried, [key]: !!isCarried });
	}

	// Several carry marks at once, keyed `possessionSlug:choiceSlug` (the Outfit window's batch), as
	// an update fragment that StonetopCharacter#applyOutfit lands with the rest of the Outfit. Each
	// mark is its own sub-key, so one this call doesn't name keeps what is stored for it. Unmarked
	// ones are written as `false`, for the same reason as above.
	choicesCarriedData(carriedMap) {
		const data = {};
		for (const [key, value] of Object.entries(carriedMap ?? {})) {
			Object.assign(data, this._flags.subKeyData("choiceCarried", key, !!value));
		}
		return data;
	}

	// Set every chosen piece of gear down (Reset Inventory: "Clear all item marks"), as a fragment for
	// StonetopCharacter#resetInventorySelections' one update. An unset rather than a map of `false`s,
	// so nothing is left behind for a merge to keep.
	clearCarriedData() {
		return this._flags.deletionData("choiceCarried");
	}

	// Free text the player wrote into a sub-option's fill-in blank (the Would-Be Hero's
	// "A shield, bearing ___'s crest"), keyed possessionSlug:choiceSlug like choiceUses.
	get choiceTexts()  { return this._flags.getFlag("choiceTexts") ?? {}; }

	getChoiceText(possessionSlug, choiceSlug) {
		return this.choiceTexts[`${possessionSlug}:${choiceSlug}`] ?? "";
	}

	async setChoiceText(possessionSlug, choiceSlug, value) {
		const key = `${possessionSlug}:${choiceSlug}`;
		await this._flags.setFlag("choiceTexts", { ...this.choiceTexts, [key]: value });
	}

	// Replace the whole write-in list from a set of labels, assigning each a `custom-N`
	// slug. Blank labels are dropped. Replacing (rather than appending) keeps re-running
	// onboarding idempotent: the same write-in maps back to the same single entry.
	async setCustom(labels) {
		const entries = [];
		let n = 1;
		for (const label of labels ?? []) {
			const trimmed = String(label ?? "").trim();
			if (!trimmed) continue;
			entries.push({ slug: `custom-${n}`, label: trimmed });
			n++;
		}
		await this._flags.setFlag("custom", entries);
	}

	// One more write-in, added from the sheet's Inventory tab: "______ (discuss with GM)" is a
	// line on every playbook's list, so it is open after onboarding too. Same { slug, label }
	// shape onboarding stores, with the next `custom-N` no entry holds (so a removed one's slug
	// is never handed to a second write-in). A blank label adds nothing. Returns the new entry,
	// or null. Never refused for the pick count: going over is flagged on the sheet instead.
	async addCustom(label) {
		const trimmed = String(label ?? "").trim();
		if (!trimmed) return null;
		const current = this.custom;
		const taken = current.map(c => Number(/^custom-(\d+)$/.exec(c?.slug ?? "")?.[1]) || 0);
		const entry = { slug: `custom-${Math.max(0, ...taken) + 1}`, label: trimmed };
		await this._flags.setFlag("custom", [...current, entry]);
		return entry;
	}

	async removeCustom(slug) {
		await this._flags.setFlag("custom", this.custom.filter(c => c.slug !== slug));
	}
}
