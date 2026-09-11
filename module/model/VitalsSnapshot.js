/** Used for hp and xp tracks in VitalsSnapshot. */
export class ValueMax {
	constructor(value, max) {
		this.value = value;
		this.max   = max;
	}
}

/**
 * @property {ValueMax} hp  - max = playbook.hp, plus move bonuses and the permanent
 *   adjustment; both 0 if no playbook
 * @property {number} hpBase - max HP with the permanent adjustment ignored, so the sheet
 *   can turn a hand-typed max into a delta (and show what clearing it goes back to).
 *   0 when there is no playbook, which is also the signal that there is no derived
 *   number to sit on top of. See StonetopCharacter#setMaxHp.
 * @property {string|null} damage - the die actually in play, e.g. "d10": the hand-set
 *   override if there is one, else the playbook's die (raised by move bonuses). Null
 *   when there is neither a playbook nor an override.
 * @property {string|null} damageBase - the derived die with the override ignored, so the
 *   sheet can show what clearing the override would go back to. Null if no playbook.
 * @property {number} armor
 * @property {number} armorBase - armor with the hand-set adjustment ignored: what the gear and
 *   the moves alone come to. The sheet's note and StonetopCharacter#setArmor both need it, and
 *   neither can get it back out of `armor`, which is clamped at 0. Mirrors `hpBase`.
 * @property {number} wornArmor - the highest worn-armor BASE among equipped items
 *   (shields and move bonuses excluded); 0 means unarmored. Distinct from `armor`,
 *   which is the full total. Used to gate moves that require being unarmored.
 * @property {number} level
 * @property {ValueMax} xp  - max = 6 + level * 2
 */
export class VitalsSnapshot {
	constructor(b) {
		this.hp         = b._hp;
		this.hpBase     = b._hpBase ?? 0;
		this.damage     = b._damage;
		this.damageBase = b._damageBase ?? null;
		this.armor      = b._armor;
		this.armorBase  = b._armorBase ?? b._armor;
		// The portion of `armor` that piercing cannot reduce and "ignores armor" cannot
		// bypass (the Rune-laden Scales' PROOF AGAINST HARM). 0 for almost every character.
		this.unpierceableArmor = b._unpierceableArmor ?? 0;
		this.wornArmor  = b._wornArmor ?? 0;
		this.level      = b._level;
		this.xp         = b._xp;
	}
}

export class VitalsSnapshotBuilder {
	withHp(v)         { this._hp         = v; return this; }
	withHpBase(v)     { this._hpBase     = v; return this; }
	withDamage(v)     { this._damage     = v; return this; }
	withDamageBase(v) { this._damageBase = v; return this; }
	withArmor(v)      { this._armor      = v; return this; }
	withArmorBase(v)  { this._armorBase  = v; return this; }
	withUnpierceableArmor(v) { this._unpierceableArmor = v; return this; }
	withWornArmor(v)  { this._wornArmor  = v; return this; }
	withLevel(v)      { this._level      = v; return this; }
	withXp(v)         { this._xp         = v; return this; }
	build()           { return new VitalsSnapshot(this); }
}
