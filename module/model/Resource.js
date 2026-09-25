/**
 * Unified resource track used everywhere (moves, inventory items, possessions, pools).
 * @property {number} current - checks used
 * @property {number|null} max     - total capacity; null when determined by a stat (see maxStat)
 * @property {string|null} maxStat - stat name ("con", "str", etc.) when max equals that stat value
 * @property {string|null} title  - track label (e.g. "Stock", "Ammo"); null = unlabeled
 * @property {string[]} labels    - per-check labels; [] = plain unlabeled checkboxes
 *
 * @example
 * // Move "Rites of the Land"
 * { current: 1, max: 4, maxStat: null, title: null, labels: [] }
 * // Inventory "Bow & arrows"
 * { current: 0, max: 2, maxStat: null, title: null, labels: ["low ammo", "all out"] }
 * // Possession stock
 * { current: 2, max: 3, maxStat: null, title: "Stock", labels: [] }
 * // Arcanum Shell Game of Souls
 * { current: 0, max: null, maxStat: "con", title: "Souls", labels: [] }
 */
export class ResourceDef {
	constructor(data) {
		this.max     = data.max     ?? null;
		this.maxStat = data.maxStat ?? null;
		this.title   = data.title   ?? null;
		// The two LIST fields are coerced, not merely defaulted. Every construction site feeds
		// this hand-authored `system.resource` data — a pack move, an arcanum, a foreign
		// playbook move that landed in Other Moves and had its resource preserved verbatim —
		// so a string where an array belongs is a shape this constructor genuinely receives.
		// It matters more here than at the call sites because a throw inside it takes the whole
		// sheet down with it: this runs during buildSnapshot, so `spendOptions.join` on a string
		// is not a missing tooltip, it is an actor sheet that will not render at all.
		this.labels       = Array.isArray(data.labels)       ? data.labels       : [];
		// Optional "spend 1 to…" menu for hold tracks (e.g. Nerve, Command). Surfaced
		// as a tooltip on the track's title so the spendable options are visible
		// without re-reading the move's full description.
		this.spendOptions = Array.isArray(data.spendOptions) ? data.spendOptions : [];
		this.spendTooltip = this.spendOptions.length
			? "Spend 1 to:<br>• " + this.spendOptions.join("<br>• ")
			: null;
	}
}

export class Resource {
	constructor(b) {
		this.current = b._current;
		this.max     = b._max;
		this.maxStat = b._maxStat ?? null;
		this.title   = b._title;
		this.labels  = b._labels;
		// The "Spend 1 to:" hover the move templates hang on the track's title (ResourceDef builds
		// it). Absent on every track without a spend menu, so those keep the shape they always had.
		if (b._spendTooltip) this.spendTooltip = b._spendTooltip;
	}
}

export class ResourceBuilder {
	withCurrent(v) { this._current = v; return this; }
	withMax(v)     { this._max     = v; return this; }
	withMaxStat(v) { this._maxStat = v; return this; }
	withTitle(v)   { this._title   = v; return this; }
	withLabels(v)  { this._labels  = v; return this; }
	withSpendTooltip(v) { this._spendTooltip = v; return this; }
	build()        { return new Resource(this); }
}
