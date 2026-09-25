export class CharacterPossessions {
	constructor(flags) {
		this._flags = flags;
	}

	get selected()    { return new Set(this._flags.getFlag("selected") ?? []); }
	get uses()        { return this._flags.getFlag("uses") ?? {}; }
	get maxUses()     { return this._flags.getFlag("maxUses") ?? {}; }
	get subChoices()  { return this._flags.getFlag("subChoices") ?? {}; }
	get choiceUses()  { return this._flags.getFlag("choiceUses") ?? {}; }
	// Player-written "something else (discuss with GM)" possessions — items not on the
	// playbook's list, stored as { slug, label } since there's no option to match by slug.
	get custom()      { return this._flags.getFlag("custom") ?? []; }

	async select(slug) {
		const s = this.selected;
		s.add(slug);
		await this._flags.setFlag("selected", [...s]);
	}

	// Forget everything a move-granted possession carried (its level, spent uses and picks),
	// so taking the move again starts the possession fresh rather than half-spent.
	async forgetGranted(slug) {
		await this._flags.batch({ deletes: { grantedAtLevel: [slug], uses: [slug], subChoices: [slug] } });
	}

	async deselect(slug) {
		const s = this.selected;
		s.delete(slug);
		await this._flags.setFlag("selected", [...s]);
	}

	async setUses(slug, count) {
		await this._flags.setFlag("uses", { ...this.uses, [slug]: count });
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
	// the rule about which picks lose their mark).
	async writeSubChoices(possessionSlug, choiceSlugs, { uncarry = [] } = {}) {
		const sets = { subChoices: { ...this.subChoices, [possessionSlug]: [...(choiceSlugs ?? [])] } };
		if (uncarry.length) {
			sets.choiceCarried = { ...this.choiceCarried };
			for (const slug of uncarry) sets.choiceCarried[`${possessionSlug}:${slug}`] = false;
		}
		await this._flags.batch({ sets });
	}

	async selectExclusive(possessionSlug, choiceSlug, exclusiveSlugs) {
		const current = this.subChoices;
		const existing = current[possessionSlug] ?? [];
		const filtered = existing.filter(s => !exclusiveSlugs.includes(s));
		const updated = filtered.includes(choiceSlug) ? filtered : [...filtered, choiceSlug];
		await this._flags.setFlag("subChoices", { ...current, [possessionSlug]: updated });
	}

	async setChoiceUses(possessionSlug, choiceSlug, count) {
		const key = `${possessionSlug}:${choiceSlug}`;
		await this._flags.setFlag("choiceUses", { ...this.choiceUses, [key]: count });
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

	async removeCustom(slug) {
		await this._flags.setFlag("custom", this.custom.filter(c => c.slug !== slug));
	}
}
