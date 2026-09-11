import { ResourceDef } from "./Resource.js";

export class MinorArcanumItem {
	constructor(data) {
		this.name            = data.name;
		this.weight          = data.weight          ?? null;
		this.note            = data.note            ?? null;
		this.inventoryColumn = data.inventoryColumn ?? null;
		this.resource        = data.resource ? new ResourceDef(data.resource) : null;
		// Worn/borne arcana (the Demonhide Cloak's "1 armor", the Rune-laden Scales' "2 armor",
		// the Shield of the Wisent Witch's "+1 armor") carry the same `{base}`/`{modifier}` shape
		// as an outfit item, and CharacterInventory.calculateArmor applies it by the same rule.
		// This DTO whitelists fields, so until it was declared here an authored `armor` was
		// dropped on construction and the card's armor could never be fixed in JSON alone.
		this.armor           = data.armor           ?? null;
		// Declared for the same reason as `armor`: this DTO whitelists fields, so the Shield of
		// the Wisent Witch's "+1 Readiness on a 7+ to Defend" could not be expressed in JSON at
		// all until the flag had a home here.
		this.shield          = data.shield          ?? false;
	}
}

export class MinorArcanumMove {
	constructor(data) {
		this.name        = data.name;
		this.rollType    = data.rollType    ?? null;
		this.description = data.description;
	}
}

export class MinorArcanumFront {
	constructor(data) {
		this.title       = data.title;
		this.item        = data.item ? new MinorArcanumItem(data.item) : null;
		this.description = data.description;
		this.unlock      = data.unlock;
	}
}

export class MinorArcanumBack {
	constructor(data) {
		this.title       = data.title;
		this.item        = data.item ? new MinorArcanumItem(data.item) : null;
		this.description = data.description;
		this.resource    = data.resource ? new ResourceDef(data.resource) : null;
		this.move        = data.move ? new MinorArcanumMove(data.move) : null;
		this.options     = data.options ?? [];
	}
}

export class MinorArcanum {
	constructor(data) {
		this.slug  = data.slug;
		this.front = new MinorArcanumFront(data.front);
		this.back  = new MinorArcanumBack(data.back);
		// Homebrew arcana declare their tier explicitly via `flags.stonetop.major`;
		// shipped arcana omit it and fall back to the MAJOR_ARCANA_ICONS allowlist
		// (see isMajorArcanumItem). `img` is the Item's own art, used as the card
		// thumbnail for homebrew majors that aren't in the icon registry.
		this.major = data.major ?? false;
		this.img   = data.img ?? null;
		// Homebrew summoners author their manifested follower(s) here; shipped summoners
		// use the hard-coded ARCANA_SUMMONS map instead (see arcanaSummonFollowers).
		this.summon = data.summon ?? null;
		// Mysteries on the BACK that change what the curio is worth as armor once ticked — the
		// Rune-laden Scales' PROOF AGAINST HARM ("The Rune-laden Scales now provide you 3 armor").
		// Each entry is `{ label, armor }`, where `label` is the mystery's printed name and its
		// □ is found by that name rather than by a hard-coded index, so the card's text can be
		// edited without silently re-pointing the unlock (see CharacterArcana#backBoxChecked).
		// The best armor among the ticked ones wins over the curio's own printed value.
		this.armorUnlocks = data.armorUnlocks ?? [];
	}
}
