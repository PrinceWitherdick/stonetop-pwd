import { MoveDefinition } from "../../../model/MoveDefinition.js";
import { FoundryPackStore } from "./FoundryPackStore.js";
import { ITEMS_PACK } from "../StonetopFlags.js";
import { homebrewPlaybookMoves, homebrewInsertMoves, homebrewInsertOf, homebrewMoveById, playbookCatalogGeneration, allPlaybookNames } from "../../../playbooks/playbook-catalog.js";
import { looseName } from "../../../utils/strings.js";

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
		this._homebrewCache    = new Map();
		this._basicCache       = null;
		this._expeditionCache  = null;
	}

	// A playbook's moves: the pack's (cached, they cannot change at runtime) plus a HOMEBREW
	// playbook's world moves (playbooks/playbook-catalog.js), rebuilt whenever a world playbook or
	// move changes, so a GM's edit shows at once. Only moves carrying the homebrew flag join, so an
	// official Fox move a GM dragged into the sidebar never doubles the Fox's list.
	async getPlaybookMoves(playbookName) {
		let packMoves = this._playbookCache.get(playbookName);
		if (!packMoves) {
			const entries = await this._store.filterEntries(e => e.system?.playbook === playbookName);
			packMoves = entries.map(e => new MoveDefinition(e));
			this._playbookCache.set(playbookName, packMoves);
		}
		const homebrew = homebrewPlaybookMoves(playbookName);
		if (!homebrew.length) return packMoves;
		return [...packMoves, ...this._homebrewDefinitions(playbookName, homebrew)];
	}

	// One INSERT's moves of a homebrew playbook (the Stranger's Monster Compendium), as definitions.
	// Never among getPlaybookMoves: the insert's own tab offers them, never Level Up.
	getHomebrewInsertMoves(playbookName, insertKey) {
		const items = homebrewInsertMoves(playbookName, insertKey);
		if (!items.length) return [];
		const defs = this._homebrewDefinitions(`${playbookName}::insert:${insertKey}`, items);
		// Which of the insert's moves lists each is picked from ("" for one outside any list).
		defs.forEach((d, i) => { d.insertList = homebrewInsertOf(items[i])?.list ?? ""; });
		return defs;
	}

	// A homebrew playbook's moves as definitions, kept while the catalog's generation and the list
	// itself stay the same: one sheet render asks for a playbook's moves several times.
	_homebrewDefinitions(name, items) {
		const generation = playbookCatalogGeneration();
		const hit = this._homebrewCache.get(name);
		if (hit && hit.generation === generation && hit.items.length === items.length && hit.items.every((item, i) => item === items[i])) return hit.defs;
		const defs = items.map(i => new MoveDefinition(i));
		this._homebrewCache.set(name, { generation, items, defs });
		return defs;
	}

	// A playbook's move DOCUMENTS, for a reader that needs whole Items (the onboarding walkthrough):
	// the pack's, then a homebrew playbook's world moves, which are documents already.
	async getPlaybookMoveDocuments(playbookName) {
		const entries = await this._store.filterEntries(e => e.system?.playbook === playbookName);
		const docs = await Promise.all(entries.map(e => this._store.getDocument(e._id)));
		return [...docs.filter(Boolean), ...homebrewPlaybookMoves(playbookName)];
	}

	// By the id getPlaybookMoves handed out: a homebrew world move's id, else a pack id. Every
	// grant (addMove, a background's move, an either/or pick, a cross-playbook pick) copies the
	// move onto the character through here. The world is asked first: it answers at once, where
	// the pack is a server round trip that would find nothing for a homebrew move.
	async getPlaybookMoveDocument(id) {
		return homebrewMoveById(id) ?? (await this._store.getDocument(id));
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

/**
 * The moves `names` names, matched loosely (utils/strings.js looseName: a PDF's "Lion’s" is the
 * book's "Lion's"), from every playbook but those in `except`: a background that gives ANOTHER
 * playbook's move. The book's playbooks are asked first, then the homebrew ones; the first to have
 * a name gives it. A free function over any move repository (`repo.getPlaybookMoves`).
 */
export async function findOtherPlaybookMoves(repo, names, { except = [] } = {}) {
	const wanted = new Set([...names].map(n => looseName(n)));
	if (!wanted.size) return [];
	const playbooks = allPlaybookNames().filter(p => !except.includes(p));
	const lists = await Promise.all(playbooks.map(p => repo.getPlaybookMoves(p)));
	const found = [];
	for (const e of lists.flat()) {
		const key = looseName(e.name);
		if (wanted.has(key)) { found.push(e); wanted.delete(key); }
	}
	return found;
}
