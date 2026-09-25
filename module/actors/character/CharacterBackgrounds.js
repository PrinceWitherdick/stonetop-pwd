export class CharacterBackgrounds {
	constructor(flags) {
		this._flags = flags;
	}

	get selectedSlug() {
		return this._flags.getFlag("selected") ?? "";
	}

	get choices() {
		return this._flags.getFlag("choices") ?? {};
	}

	get setupResources() {
		return this._flags.getFlag("setupResources") ?? {};
	}

	// The option the player took in each of the background's `setup.choices` entries,
	// keyed by choice key (A Life of Crime → { extraMove: "Burgle" }).
	get setupChoices() {
		return this._flags.getFlag("setupChoices") ?? {};
	}

	get setupTexts() {
		return this._flags.getFlag("setupTexts") ?? {};
	}

	// Slugs of the background's level-gated markable actions the player has marked
	// (the Ranger's Beast-Bonded "focus on your companion" actions).
	get markedActions() {
		return this._flags.getFlag("markedActions") ?? [];
	}

	async selectBackground(slug) {
		await this._flags.setFlag("selected", slug);
	}

	async addChoice(choice) {
		const current = this.choices;
		await this._flags.setFlag("choices", { ...current, [choice.slug]: choice.isChecked });
	}

	// Several choices at once, in one write: `{ slug: checked }`. Slugs left out keep what they had.
	async setChoices(patch) {
		await this._flags.setFlag("choices", { ...this.choices, ...patch });
	}

	async setSetupResource(key, value) {
		await this._flags.setFlag("setupResources", { ...this.setupResources, [key]: value });
	}

	async markAction(slug) {
		const current = this.markedActions;
		if (current.includes(slug)) return;
		await this._flags.setFlag("markedActions", [...current, slug]);
	}

	async unmarkAction(slug) {
		await this._flags.setFlag("markedActions", this.markedActions.filter(s => s !== slug));
	}

	async setMarkedActions(slugs) {
		await this._flags.setFlag("markedActions", [...slugs]);
	}
}
