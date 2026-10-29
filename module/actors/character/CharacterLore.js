export class CharacterLore {
	constructor(flags) {
		this._flags = flags;
	}

	get counts() {
		return this._flags.getFlag("counts") ?? {};
	}

	getCount(loreSlug, optionSlug) {
		return this.counts[`${loreSlug}:${optionSlug}`] ?? 0;
	}

	async setCount(loreSlug, optionSlug, count) {
		await this.setCounts(loreSlug, { [optionSlug]: count });
	}

	/**
	 * Set several of one section's counts at once — for a "choose 1" group, where taking an option
	 * also clears its siblings.
	 *
	 * ONE write for the lot. Done one at a time they had to be awaited in sequence, because each
	 * rewrites the whole counts object from a spread of what it last read and two in flight would
	 * clobber each other; and each one cost its own server round trip and its own re-render of
	 * every open sheet. Building the whole object first removes both problems at once.
	 */
	async setCounts(loreSlug, counts) {
		const changes = {};
		for (const [optionSlug, count] of Object.entries(counts)) changes[`${loreSlug}:${optionSlug}`] = count;
		await this._flags.setFlag("counts", { ...this.counts, ...changes });
	}

	/**
	 * One count as an `actor.update()` fragment, for a caller landing it in ONE write with changes outside
	 * this store (UndeathDialog's costs, with the hit points and the state). Written as the count's own sub-key
	 * rather than the whole counts object, so two of these in one update (a Consequence and a reset Favor, a
	 * Mark and the Favor) each keep their own key instead of the second object replacing the first.
	 */
	countUpdateData(loreSlug, optionSlug, count) {
		return this._flags.subKeyData("counts", `${loreSlug}:${optionSlug}`, count);
	}

	get texts() {
		return this._flags.getFlag("texts") ?? {};
	}

	getText(loreSlug, optionSlug) {
		return this.texts[`${loreSlug}:${optionSlug}`] ?? "";
	}

	async setText(loreSlug, optionSlug, value) {
		const key = `${loreSlug}:${optionSlug}`;
		await this._flags.setFlag("texts", { ...this.texts, [key]: value });
	}

	/**
	 * Drop every count and text whose key isn't in `validKeys`, as an `actor.update()` fragment: for when
	 * the thing this lore belongs to has been swapped for a different one and its answers no longer mean
	 * anything. A fragment, so the caller lands it in ONE write with something outside this store (an insert
	 * swap, with the slug it is measured against: as two writes, a reload between them left the old insert
	 * worn with the answers already gone). `{}` when nothing would be dropped.
	 *
	 * Built of sub-key deletions, not a filtered object written back: an object flag value MERGES on write,
	 * so a filtered copy would leave every dropped key exactly where it was.
	 */
	pruneToUpdateData(validKeys) {
		const data = {};
		for (const [key, store] of [["counts", this.counts], ["texts", this.texts]]) {
			for (const sub of Object.keys(store)) {
				if (!validKeys.has(sub)) Object.assign(data, this._flags.subKeyDeletionData(key, sub));
			}
		}
		return data;
	}
}
