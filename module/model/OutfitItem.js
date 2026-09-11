export class OutfitItem {
	constructor(b) {
		this.slug               = b._slug;
		this.name               = b._name;
		this.weight             = b._weight;
		this.note               = b._note;
		this.inventoryColumn    = b._inventoryColumn;
		this.resource           = b._resource;
		this.resourceFirst      = b._resourceFirst ?? false;
		this.prosperityResource = b._prosperityResource ?? false;
		this.twoCol             = b._twoCol;
		this.smallGrid          = b._smallGrid;
		this.breakBefore        = b._breakBefore;
		this.armor              = b._armor ?? null;
		// A shield in the book's sense: it grants its armor AND "+1 Readiness on a 7+ to
		// Defend" (p.216). Marked explicitly rather than guessed from the armor shape — a
		// `modifier` is "a bonus", which a shield is but a magic ring might also be — or from
		// the name, which would miss the Shield of the Wisent Witch's cousins and catch a
		// "shield-fern poultice". See StonetopCharacter#bearsShield.
		this.shield             = b._shield ?? false;
		this.special            = b._special ?? false;
		this.specialCategory    = b._specialCategory ?? null;
	}
}

export class OutfitItemBuilder {
	withSlug(v)               { this._slug               = v; return this; }
	withName(v)               { this._name               = v; return this; }
	withWeight(v)             { this._weight             = v; return this; }
	withNote(v)               { this._note               = v; return this; }
	withInventoryColumn(v)    { this._inventoryColumn    = v; return this; }
	withResource(v)           { this._resource           = v; return this; }
	withResourceFirst(v)      { this._resourceFirst      = v; return this; }
	withProsperityResource(v) { this._prosperityResource = v; return this; }
	withTwoCol(v)             { this._twoCol             = v; return this; }
	withSmallGrid(v)          { this._smallGrid          = v; return this; }
	withBreakBefore(v)        { this._breakBefore        = v; return this; }
	withArmor(v)              { this._armor              = v; return this; }
	withShield(v)             { this._shield             = v; return this; }
	withSpecial(v)            { this._special            = v; return this; }
	withSpecialCategory(v)    { this._specialCategory    = v; return this; }
	build()                   { return new OutfitItem(this); }
}
