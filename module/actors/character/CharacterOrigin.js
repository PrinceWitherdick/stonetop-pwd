export class CharacterOrigin {
	constructor(flags) {
		this._flags = flags;
	}

	get selected() {
		return this._flags.getFlag("selected") ?? "";
	}

	/** The place a player named for a write-in origin ("Somewhere else": the Marches). */
	get place() {
		return this._flags.getFlag("place") ?? "";
	}

	/** Their answer to the question a homebrew playbook asks someone from there. */
	get answer() {
		return this._flags.getFlag("answer") ?? "";
	}

	/**
	 * @param {string} region
	 * @param {{place?: string, answer?: string}} [more]  left out, what was stored stays
	 */
	async select(region, more = {}) {
		await this._flags.setFlag("selected", region);
		if (more.place !== undefined) await this._flags.setFlag("place", String(more.place ?? "").trim());
		if (more.answer !== undefined) await this._flags.setFlag("answer", String(more.answer ?? "").trim());
	}

	async setPlace(place) {
		await this._flags.setFlag("place", String(place ?? "").trim());
	}

	async setAnswer(answer) {
		await this._flags.setFlag("answer", String(answer ?? "").trim());
	}
}
