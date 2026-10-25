export class CharacterInstincts {
	constructor(flags) {
		this._flags = flags;
	}

	get selectedValue() {
		return this._flags.getFlag("selected") ?? "";
	}

	async select(value) {
		await this._flags.setFlag("selected", value);
	}

	/**
	 * An Instinct that holds only until the next Level Up (Book II p.370, the grwgnach: "until you
	 * Level Up, your instinct becomes 'Birdlike'"; p.523, the wolf pelt). It sits over the chosen
	 * Instinct, which is kept, and Level Up clears it. `{ value, source }`, or null.
	 */
	get temporary() {
		const stored = this._flags.getFlag("temporary");
		const value = typeof stored?.value === "string" ? stored.value.trim() : "";
		return value ? { value, source: typeof stored.source === "string" ? stored.source.trim() : "" } : null;
	}

	/** Set the temporary Instinct; a blank value removes it. */
	async setTemporary(value, source = "") {
		const text = String(value ?? "").trim();
		if (!text) return this.clearTemporary();
		await this._flags.setFlag("temporary", { value: text, source: String(source ?? "").trim() });
	}

	/** Remove the temporary Instinct. Answers the one removed, or null when there was none. */
	async clearTemporary() {
		const ended = this.temporary;
		if (this._flags.getFlag("temporary") !== undefined) await this._flags.unsetFlag("temporary");
		return ended;
	}
}
