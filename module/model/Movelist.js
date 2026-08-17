/**
 * @property {string} id
 * @property {string} name
 * @property {string|null} description
 * @property {string|null} moveType
 * @property {string} ownedId - same as id; provided for template convenience
 * @property {string|null} rollType - normalized stat/"ask" so the row renders a dice control
 * @property {string|null} rollLabel - stat-chip label for the roll
 * @property {boolean} custom - player-authored (shows the edit affordance)
 * @property {boolean} learned - custom move is currently learned (active: rollable, bonuses
 *   apply). Un-learned custom moves stay on the sheet but inactive. Always true for
 *   non-custom "other" moves. Absent flag defaults to true, so freshly authored moves and
 *   any pre-feature ones read as learned.
 * @property {string} resourceKey - stable key the resource track persists under (item id for
 *   custom moves, name otherwise); written to the box's data-move-name so renames/duplicate
 *   names never collide or orphan the saved count
 * @property {{title: string|null, max: number, labels: string[], current: number}|null} resource
 */
export class OtherItemSnapshot {
	constructor(b) {
		this.id          = b._id;
		this.name        = b._name;
		this.description = b._description;
		this.moveType    = b._moveType;
		this.ownedId     = b._ownedId;
		this.rollType    = b._rollType ?? null;
		this.rollLabel   = b._rollLabel ?? null;
		this.custom      = b._custom ?? false;
		this.learned     = b._learned ?? true;
		// Origin badge for the row's top-right corner, on the same terms as a playbook
		// move's "Starting move" / "Granted by …": the playbook a move came from when that
		// ISN'T this character's own. Null for anything homegrown, so the badge only ever
		// appears where it says something.
		this.sourceLabel = b._sourceLabel ?? null;
		this.resourceKey = b._resourceKey ?? b._name;
		this.resource    = b._resource ?? null;
	}
}

export class OtherItemSnapshotBuilder {
	withId(v)          { this._id          = v; return this; }
	withName(v)        { this._name        = v; return this; }
	withDescription(v) { this._description = v; return this; }
	withMoveType(v)    { this._moveType    = v; return this; }
	withOwnedId(v)     { this._ownedId     = v; return this; }
	withRollType(v)    { this._rollType    = v; return this; }
	withRollLabel(v)   { this._rollLabel   = v; return this; }
	withCustom(v)      { this._custom      = v; return this; }
	withLearned(v)     { this._learned     = v; return this; }
	withSourceLabel(v) { this._sourceLabel = v; return this; }
	withResourceKey(v) { this._resourceKey = v; return this; }
	withResource(v)    { this._resource    = v; return this; }
	build()            { return new OtherItemSnapshot(this); }
}

/**
 * @property {MoveSnapshot[]} playbookMoves
 * @property {MoveSnapshot[]} playbookMovesOwned
 * @property {MoveSnapshot[]} playbookMovesUnowned
 * @property {Array<{key: string, label: string, moves: MoveSnapshot[], ownedMoves: MoveSnapshot[], unownedMoves: MoveSnapshot[]}>} playbookMoveGroups
 * @property {MoveSnapshot[]} basicMoves
 * @property {MoveSnapshot[]} expeditionMoves
 * @property {MoveGroupSnapshot[]} otherGroups
 * @property {OtherItemSnapshot[]} otherMoves
 * @property {string|null} startingMovesNote
 * @property {{label: string, moves: MoveSnapshot[]}|null} postDeathGroup
 * @property {boolean} movesIncomplete - starting "moves of your choice" not all picked yet
 * @property {boolean} levelMovesIncomplete - fewer move picks made than the current level entitles
 * @property {number} levelMovesShortfall - how many move picks the character still owes for their level
 * @property {boolean} levelMovesOverLimit - more move picks made than the current level entitles
 * @property {number} levelMovesOverage - how many extra move picks the character has for their level
 * @property {string|null} levelMovesOverageKey - stable key for dismissing the current overage notice
 * @property {number} characterLevel
 */
export class Movelist {
	constructor(b) {
		this.playbookMoves     = b._playbookMoves;
		this.playbookMovesOwned = this.playbookMoves.filter(m => m.owned);
		this.playbookMovesUnowned = this.playbookMoves.filter(m => !m.owned);
		// The same moves again, bucketed into the playbook's three onboarding groups
		// (plus "Other" for the leftovers) so the Moves tab can head each cluster with
		// its own sub-section. Each keeps the owned / un-owned split the flat lists
		// above use, so "Hide un-learned moves" reaches inside a group unchanged.
		// Empty when the playbook defines no groups — the tab then renders one flat list.
		this.playbookMoveGroups = (b._playbookMoveGroups ?? []).map(g => ({
			key:          g.key,
			label:        g.label,
			moves:        g.moves,
			ownedMoves:   g.moves.filter(m => m.owned),
			unownedMoves: g.moves.filter(m => !m.owned),
		}));
		// Moves learned from OTHER playbooks via a cross-playbook pick (Versatile/…),
		// rendered with their full card (description/roll/marks/resource) like playbook moves.
		this.learnedMoves      = b._learnedMoves ?? [];
		this.basicMoves        = b._basicMoves;
		this.expeditionMoves   = b._expeditionMoves;
		this.otherGroups       = b._otherGroups;
		this.otherMoves        = b._otherMoves;
		// Single-use love letters (Book I p.568), rendered in their own top-of-tab section.
		this.loveLetters       = b._loveLetters ?? [];
		this.startingMovesNote = b._startingMovesNote;
		this.postDeathGroup    = b._postDeathGroup ?? null;
		this.movesIncomplete   = b._movesIncomplete ?? false;
		this.levelMovesIncomplete = b._levelMovesIncomplete ?? false;
		this.levelMovesShortfall  = b._levelMovesShortfall ?? 0;
		this.levelMovesOverLimit  = b._levelMovesOverLimit ?? false;
		this.levelMovesOverage    = b._levelMovesOverage ?? 0;
		this.levelMovesOverageKey = b._levelMovesOverageKey ?? null;
		this.characterLevel       = b._characterLevel ?? 1;
	}
}

export class MovelistBuilder {
	withPlaybookMoves(v)     { this._playbookMoves     = v; return this; }
	withPlaybookMoveGroups(v) { this._playbookMoveGroups = v; return this; }
	withLearnedMoves(v)      { this._learnedMoves      = v; return this; }
	withBasicMoves(v)        { this._basicMoves        = v; return this; }
	withExpeditionMoves(v)   { this._expeditionMoves   = v; return this; }
	withOtherGroups(v)       { this._otherGroups       = v; return this; }
	withOtherMoves(v)        { this._otherMoves        = v; return this; }
	withLoveLetters(v)       { this._loveLetters       = v; return this; }
	withStartingMovesNote(v) { this._startingMovesNote = v; return this; }
	withPostDeathGroup(v)    { this._postDeathGroup    = v; return this; }
	withMovesIncomplete(v)   { this._movesIncomplete   = v; return this; }
	withLevelMovesIncomplete(v) { this._levelMovesIncomplete = v; return this; }
	withLevelMovesShortfall(v)  { this._levelMovesShortfall  = v; return this; }
	withLevelMovesOverLimit(v)  { this._levelMovesOverLimit  = v; return this; }
	withLevelMovesOverage(v)    { this._levelMovesOverage    = v; return this; }
	withLevelMovesOverageKey(v) { this._levelMovesOverageKey = v; return this; }
	withCharacterLevel(v)       { this._characterLevel       = v; return this; }
	build()                  { return new Movelist(this); }
}
