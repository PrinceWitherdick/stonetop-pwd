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

	// With `setupChoices`, the picks made under the new background go in the SAME write as the
	// background itself, so nothing settles between them: the picks (`{ key: value }`) are stored a
	// key at a time and any stored key not among them is dropped (an update merges objects, so a
	// whole-object write would leave a stale pick standing), and `{}` drops them all. Without it,
	// the stored picks are left as they are.
	async selectBackground(slug, { setupChoices } = {}) {
		if (setupChoices === undefined) {
			await this._flags.setFlag("selected", slug);
			return;
		}
		const picks = Object.entries(setupChoices ?? {}).filter(([, value]) => value != null && value !== "");
		const data = { ...this._flags.updateData("selected", slug) };
		if (!picks.length) {
			if (Object.keys(this.setupChoices).length) Object.assign(data, this._flags.deletionData("setupChoices"));
		} else {
			for (const [key, value] of picks) Object.assign(data, this._flags.subKeyData("setupChoices", key, value));
			for (const key of Object.keys(this.setupChoices)) {
				if (!picks.some(([k]) => k === key)) Object.assign(data, this._flags.subKeyDeletionData("setupChoices", key));
			}
		}
		await this._flags.applyUpdateData(data);
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

	// setSetupResource as an `actor.update()` fragment, for a caller putting it in one write with other changes
	// (StonetopCharacter#markDebility marking Auspicious Birth's circle beside the HP it buys).
	setupResourceData(key, value) {
		return this._flags.updateData("setupResources", { ...this.setupResources, [key]: value });
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
