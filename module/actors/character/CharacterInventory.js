export class CharacterInventory {
	constructor(flags) {
		this._flags = flags;
	}

	get checked()      { return this._flags.getFlag("checked") ?? {}; }
	get resources()    { return this._flags.getFlag("resources") ?? {}; }
	// Capacity for a track whose size is ACQUIRED rather than printed, keyed by slug alongside
	// `resources`. Provisions are the case that needs it (see provisions.js): the Inventory
	// insert prints no Provisions row and no number of uses, because how much of a larder you
	// carry is whatever the last Forage or butchering brought in. Absent — which is every other
	// item — means "use the item's printed max".
	get resourceMax()  { return this._flags.getFlag("resourceMax") ?? {}; }
	get addedSpecial() { return this._flags.getFlag("addedSpecial") ?? []; }
	get regularPool()  { return this._flags.getFlag("regularPool") ?? 0; }
	get smallPool()    { return this._flags.getFlag("smallPool") ?? 0; }
	// Per-item record of how many undefined ◇/□ a Have-What-You-Need mark drew from
	// the reserve, keyed by slug. Lets un-marking return exactly what was spent
	// instead of the item's full cost (which would invent marks). Items defined at
	// Outfit have no entry, so un-marking them just drops their weight from the load.
	get drawn()        { return this._flags.getFlag("drawn") ?? {}; }

	async setItemChecked(slug, isChecked) {
		await this._flags.setFlag("checked", { ...this.checked, [slug]: isChecked });
	}

	async setResource(slug, count, options) {
		// Targeted sub-key write (not a spread of the whole resources object) so two near-
		// simultaneous writes to different tracks can't clobber each other's value.
		await this._flags.setSubKey("resources", slug, count, options);
	}

	// The same write as `setResource`, as a fragment rather than its own document update, so a
	// caller spending from several tracks at once (Make Camp spills a meal across up to five
	// purses) lands them in ONE actor.update instead of one per purse.
	resourceData(slug, count) {
		return this._flags.subKeyData("resources", slug, count);
	}

	// Drop a removed arcanum's resource tracks (the back-power track keyed by slug and the
	// back-item ammo track keyed "<slug>:item"), so a later re-acquire doesn't inherit stale
	// charges. No-op when the card had no tracks.
	async clearArcanumResources(slug) {
		const resources = this.resources;
		const itemKey = `${slug}:item`;
		const kept = Object.entries(resources).filter(([k]) => k !== slug && k !== itemKey);
		if (kept.length !== Object.keys(resources).length) {
			// setFlag MERGES, so writing the smaller object leaves the removed slug/"<slug>:item"
			// keys in place (see CharacterArcana.removeArcanum). Unset the whole map, then re-set
			// the survivors, so a later re-acquire can't inherit stale charges.
			await this._flags.unsetFlag("resources");
			if (kept.length) await this._flags.setFlag("resources", Object.fromEntries(kept));
		}
	}

	async setRegularPool(count) {
		await this._flags.setFlag("regularPool", count);
	}

	async setSmallPool(count) {
		await this._flags.setFlag("smallPool", count);
	}

	async setDrawn(drawnMap) {
		await this._flags.setFlag("drawn", drawnMap);
	}

	async setAllChecked(checkedMap) {
		await this._flags.setFlag("checked", { ...this.checked, ...checkedMap });
	}

	async addSpecial(slug) {
		if (this.addedSpecial.includes(slug)) return;
		await this._flags.setFlag("addedSpecial", [...this.addedSpecial, slug]);
	}

	// Add a special item and top up its uses / acquired-capacity tracks in ONE document write,
	// the counterpart of removeSpecial below. Provisions is what needs it: a Forage payout would
	// otherwise be four sequential writes (addedSpecial, checked, resourceMax, resources), and
	// every one of them re-renders every open sheet for that actor — four full snapshot rebuilds
	// for one haul of food, with four chances to leave the larder half-recorded.
	//
	// The track values go through `sets` as one-key objects rather than `setSubKey` dot-paths
	// because a plain-object flag value deep-MERGES (see StonetopFlags.batch), which lands the
	// same targeted write without disturbing the other slugs' entries.
	async addSpecialWithResource(slug, { held, max, carry = false } = {}) {
		const sets = {
			addedSpecial: this.addedSpecial.includes(slug) ? this.addedSpecial : [...this.addedSpecial, slug],
			resources:    { [slug]: held },
			resourceMax:  { [slug]: max },
		};
		if (carry) sets.checked = { [slug]: true };
		await this._flags.batch({ sets });
	}

	// Drops the item AND everything keyed to it: its carried mark (so it stops counting toward
	// load and armor) and its uses / acquired-capacity tracks. The tracks go for the same reason
	// clearArcanumResources drops an arcanum's — a re-acquired item must not inherit stale
	// charges. Provisions is where that bites: a larder tossed to the crows with 2 uses left,
	// then re-foraged, would otherwise come back holding those 2.
	//
	// Every key goes through `deletes` rather than a smaller object through `sets`: writing an
	// object flag MERGES, so re-setting `checked` without the slug left the old `true` sitting
	// there and a re-added item came back already marked as carried.
	async removeSpecial(slug) {
		await this._flags.batch({
			sets:    { addedSpecial: this.addedSpecial.filter(s => s !== slug) },
			deletes: { checked: [slug], resources: [slug], resourceMax: [slug] },
		});
	}

	// Clears item marks, both undefined ◇/□ reserves (which is what drives the
	// derived load), and the per-item draw records. Item uses (resources) and
	// added-special items are left alone.
	async resetSelections() {
		await Promise.all([
			this._flags.unsetFlag("checked"),
			this._flags.unsetFlag("regularPool"),
			this._flags.unsetFlag("smallPool"),
			this._flags.unsetFlag("drawn"),
		]);
	}

	// `base` defaults to the worn-armor base of `allItems`; callers that already need the
	// base separately (the sheet snapshot gates unarmored moves on it) can pass it in so it
	// isn't recomputed.
	calculateArmor(allItems, base = this.wornArmorBase(allItems)) {
		const equipped  = allItems.filter(item => this.checked[item.slug] && item.armor);
		const modifiers = equipped.filter(i => i.armor.modifier != null).map(i => i.armor.modifier);
		return base + modifiers.reduce((s, m) => s + m, 0);
	}

	// The highest worn-armor BASE among equipped items (leather/mail/etc.); shields — a
	// `modifier` — and move bonuses are excluded, so 0 means "unarmored." This is the base
	// half of calculateArmor, exposed on its own to gate moves that require being unarmored
	// (e.g. Uncanny Reflexes) so the "what counts as worn armor" rule lives in one place.
	wornArmorBase(allItems) {
		const bases = allItems
			.filter(i => this.checked[i.slug] && i.armor?.base != null)
			.map(i => i.armor.base);
		return bases.length > 0 ? Math.max(...bases) : 0;
	}
}
