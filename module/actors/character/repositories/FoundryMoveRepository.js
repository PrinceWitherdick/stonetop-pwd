import { MoveDefinition } from "../../../model/MoveDefinition.js";
import { FoundryPackStore } from "./FoundryPackStore.js";
import { ITEMS_PACK } from "../StonetopFlags.js";

// Every field MoveDefinition reads, plus the two the stores filter on (moveType, playbook). A live
// pack's index holds ONLY the fields asked for, so one left out arrives undefined and falls to its
// default, while a test fake that hands back whole entries never notices. The three stores once
// asked for three different subsets: a basic or expedition move lost all but its text and roll, a
// post-death move its bonuses and requirement. One list, for every store of one pack, cannot drift.
export const MOVE_DEFINITION_FIELDS = Object.freeze([
	"system.moveType", "system.playbook", "system.loreOption", "system.rollType", "system.description",
	"system.moveResults", "system.isStartingMove", "system.requirement", "system.replaces",
	"system.repeatMax", "system.cap", "system.resource", "system.hpBonus", "system.armorBonus",
	"system.loadBonus", "system.maxLoad", "system.requiresUnarmored", "system.markOptions",
	"system.markBudget", "system.crossPlaybook",
]);

export class FoundryMoveRepository {
	constructor() {
		this._store            = new FoundryPackStore(ITEMS_PACK, MOVE_DEFINITION_FIELDS);
		this._playbookCache    = new Map();
		this._postDeathCache   = new Map();
		this._basicCache       = null;
		this._expeditionCache  = null;
	}

	async getPlaybookMoves(playbookName) {
		if (this._playbookCache.has(playbookName)) return this._playbookCache.get(playbookName);
		const entries = await this._store.filterEntries(e => e.system?.playbook === playbookName);
		const moves   = entries.map(e => new MoveDefinition(e));
		this._playbookCache.set(playbookName, moves);
		return moves;
	}

	async getPlaybookMoveDocument(id) {
		return this._store.getDocument(id);
	}

	async getBasicMoves() {
		if (this._basicCache) return this._basicCache;
		const entries    = await this._store.filterEntries(e => e.system?.moveType === "basic");
		this._basicCache = entries.map(e => new MoveDefinition(e));
		return this._basicCache;
	}

	async getBasicMoveDocument(id) {
		return this._store.getDocument(id);
	}

	async getExpeditionMoves() {
		if (this._expeditionCache) return this._expeditionCache;
		const entries         = await this._store.filterEntries(e => e.system?.moveType === "expedition");
		this._expeditionCache = entries.map(e => new MoveDefinition(e));
		return this._expeditionCache;
	}


	async getPostDeathMoves(insertSlug) {
		if (this._postDeathCache.has(insertSlug)) return this._postDeathCache.get(insertSlug);
		const entries = await this._store.filterEntries(e => e.system?.playbook === insertSlug);
		const moves   = entries.map(e => new MoveDefinition(e));
		// Every insert has moves, so none is a pack not read yet: not cached, so the next ask reads again.
		if (moves.length) this._postDeathCache.set(insertSlug, moves);
		return moves;
	}

	async getPostDeathMoveDocument(id) {
		return this._store.getDocument(id);
	}
}
