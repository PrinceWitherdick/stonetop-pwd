import {ITEM_FLAG_SCOPE} from "../actors/character/StonetopFlags.js";

export class StonetopPlaybook {
	_stonetopItem;

	constructor(stonetopItem) {
		this._stonetopItem = stonetopItem;
		this._stonetopFields = this._stonetopItem.flags[ITEM_FLAG_SCOPE];
	}

	get crew() {
		return this._stonetopFields.crew ?? null;
	}

	get animalCompanion() {
		return this._stonetopFields.animalCompanion ?? null;
	}

	get name() {
		return this._stonetopItem.name;
	}

	get slug() {
		return this._stonetopItem.system?.slug ?? null;
	}

	get img() {
		return this._stonetopItem.img ?? null;
	}

	get description() {
		return this._stonetopItem.system?.description ?? null;
	}

	get statsNote() {
		return this._stonetopFields.statsNote ?? null;
	}

	get hp() {
		return this._stonetopFields.hp;
	}

	get damage() {
		return this._stonetopFields.damage;
	}

	get appearance() {
		return this._stonetopFields.appearance ?? [];
	}

	get backgrounds() {
		return this._stonetopFields.backgrounds ?? [];
	}

	get instincts() {
		return this._stonetopFields.instincts ?? [];
	}

	get origin() {
		return this._stonetopFields.origin ?? [];
	}

	get startingMovesNote() {
		return this._stonetopFields.moves?.startingMovesNote ?? null;
	}

	// "Either X OR Y" starting-move choices: groups of move names the player picks
	// one from (e.g. the Heavy's Armored OR Uncanny Reflexes). These are excluded
	// from the auto-granted starting moves; the chosen one is added separately.
	get startingMoveChoices() {
		return this._stonetopFields.moves?.choices ?? [];
	}

	get invocations() {
		return this._stonetopFields.invocations ?? null;
	}

	get specialPossessions() {
		return this._stonetopFields.specialPossessions ?? null;
	}

	get lore() {
		return this._stonetopFields.lore ?? [];
	}

	// A homebrew playbook's INSERTS (homebrew-bundle.js insertToFlags): a page a move unlocks, with
	// lists to tick, moves of its own and maybe a form to take. The book's playbooks have none here.
	get inserts() {
		return Array.isArray(this._stonetopFields.inserts) ? this._stonetopFields.inserts : [];
	}

	// A homebrew playbook's own Level Up (homebrew-bundle.js advancementToFlags): `{replacesUsual,
	// note, options: [{slug, label, kind, max?, to?, by?, die?}]}`, or `{switchPlaybook: true, note}` for
	// one whose Level Up is a change of playbook (the Standout), or null for the book's Level Up.
	get advancement() {
		const a = this._stonetopFields.advancement;
		if (a?.switchPlaybook) return { switchPlaybook: true, replacesUsual: false, note: String(a.note ?? ""), options: [] };
		return a && Array.isArray(a.options) && a.options.length ? a : null;
	}

	// A homebrew playbook's notes for the table, as formatter-made HTML (playbooks/playbook-text.js).
	get notes() {
		return this._stonetopFields.notes ?? "";
	}
}
