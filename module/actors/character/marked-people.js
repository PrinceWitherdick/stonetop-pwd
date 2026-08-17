/**
 * The shared algebra behind every "list of people this character has marked, standing until they
 * lift it" feature on the character sheet.
 *
 * Three of them exist, and they are the same thing three times over:
 *
 *  • condemn.js       — the Judge's brand ("cannot be removed or hidden UNTIL YOU DISMISS IT")
 *  • oaths.js         — the Judge's Binding Arbitration ("HENCEFORTH you may ask their player…")
 *  • blessed-marks.js — the Blessed's five marking moves ("so long as the mark remains")
 *
 * Each stores an array of rows on one actor flag, each row naming a person by uuid where there is
 * a document and by name alone where there is not, each row dismissible on its own. The only
 * differences are the id prefix and what extra fields a row carries — so those are the only two
 * things `createRoster` takes.
 *
 * ⚠ EVERY caller writes the WHOLE array back. Foundry's update merge treats an array as an atomic
 * value, so a dotted `oaths.2.note` does not patch element 2: it expands to `{ oaths: { 2: … } }`
 * and replaces the array with an object, destroying the roster. Same rule, same reason, as
 * roster-portraits.js.
 *
 * Deliberately Foundry-free: nothing here touches a global, so all three features' predicates can
 * be tested without a world in sight. The one function that needs the world (holdersOf) takes its
 * population as an argument.
 */

/**
 * Whether a standing list's header glyph renders at all.
 *
 * ONE rule for all three, because it is one rule: show it to anyone who owns the move, AND to
 * anyone still holding rows even though they no longer do — otherwise dropping a new playbook over
 * a Judge or a Blessed strands live brands, oaths and marks with nothing left on the sheet that
 * could lift them. (holy-light.js and battle-joy.js keep their own two-boolean form: their state is
 * a single slot rather than a list, so there is no count to ask about.)
 */
export function showStandingList({ owns, count }) {
	return !!owns || (Number(count) || 0) > 0;
}

/** Casefolded, whitespace-collapsed name, so "  The  CLAWS " and "the claws" are one thing. */
export function normalizeName(name) {
	return String(name ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

/** The document id at the end of an Actor uuid, whatever it was reached through. */
export function trailingActorId(uuid) {
	const parts = String(uuid ?? "").split(".");
	return parts[parts.length - 1] ?? "";
}

/**
 * Every string that should resolve to this actor: its uuid, and the bare id inside it.
 *
 * A world Actor's uuid is `Actor.<id>`, but the same person reached through a token gives
 * `Scene.<id>.Token.<id>.Actor.<id>` — so a row recorded from a token drop and a row recorded from
 * the sidebar would otherwise be two different people. Comparing the trailing id folds both onto
 * the document, which is what the sheet is showing either way.
 *
 * Exported because the REPAINT side has to fold identically or it repaints the wrong sheets — see
 * hooks/CondemnedTag.js. Two functions deciding "is this the marked person" by different rules is
 * how a tag came to be derived correctly and then never drawn.
 */
export function actorMatchKeys(actor) {
	const keys = new Set();
	const uuid = String(actor?.uuid ?? "").trim();
	const id   = String(actor?.id ?? "").trim();
	if (uuid) keys.add(trailingActorId(uuid));
	if (id) keys.add(id);
	keys.delete("");
	return keys;
}

/**
 * Which world actor a typed name means. The point of it: a row that carries a uuid tags that
 * person's sheet, and a row that carries only a name tags nobody — so typing "brennan" for an NPC
 * actually called "Brennan the Claw" should still land on HIM, not create a second, inert Brennan
 * that looks marked on the roster and nowhere else.
 *
 * Three tiers, each only consulted when the one above found nothing:
 *
 *  1. EXACT (casefolded). Several actors can genuinely share a name — a world with four "Guard"
 *     NPCs is ordinary — and the typed text carries nothing that could tell them apart, so this
 *     tier takes the first and flags `ambiguous` rather than refusing. Refusing would leave the
 *     player with a name they cannot use by typing at all. Dropping the actor is the way to say
 *     WHICH guard, and each dialog's notice points at it.
 *  2. PREFIX, then 3. SUBSTRING. These are guesses rather than statements, so they only resolve
 *     when EXACTLY ONE actor matches. More than one and the caller gets `candidates` to name back
 *     at the player instead of a coin-flip: quietly marking the wrong Aeronwen is worse than
 *     asking which.
 *
 * `actors` is passed in already filtered (eligible types, self excluded) so this stays pure and
 * general; returns `{ match, candidates, ambiguous }` with match null when nothing was found,
 * which is the ordinary case for a bandit nobody has made an Actor for.
 */
export function findNamedActor(name, actors) {
	const wanted = normalizeName(name);
	const none = { match: null, candidates: [], ambiguous: false };
	if (!wanted) return none;

	const scored = [...(actors ?? [])]
		.filter(Boolean)
		.map(actor => ({ actor, key: normalizeName(actor.name) }))
		.filter(e => e.key);

	const exact = scored.filter(e => e.key === wanted);
	if (exact.length) return { match: exact[0].actor, candidates: [], ambiguous: exact.length > 1 };

	for (const test of [e => e.key.startsWith(wanted), e => e.key.includes(wanted)]) {
		const hits = scored.filter(test);
		if (hits.length === 1) return { match: hits[0].actor, candidates: [], ambiguous: false };
		if (hits.length > 1) return { match: null, candidates: hits.map(e => e.actor), ambiguous: true };
	}
	return none;
}

/**
 * Build one roster's read/write functions.
 *
 * @param {object} opts
 * @param {string} opts.prefix  positional id stem for a row stored with no id of its own
 *                              ("condemned" → `condemned-0`). Distinct per roster, so two rosters
 *                              on one actor can never hand the same handle to two different rows.
 * @param {Object<string, function(*, object): *>} [opts.fields]
 *                              extra per-row fields beyond id/name/uuid/note, each a coercer
 *                              called with `(rawValue, rawRow)`. It gets the whole raw row so a
 *                              field can depend on a sibling — the Blessed's Loyalty is only
 *                              meaningful on a Shared Souls row, and reads `kind` to know.
 * @param {function(object): string} [opts.scope]
 *                              what makes two rows about the same person DIFFERENT rows. Empty by
 *                              default: one brand per person, one oath per person. The Blessed
 *                              scopes by kind, because the same woman can wear Barkskin and a
 *                              charm at once and only Amulets & Talismans says otherwise ("one can
 *                              benefit from only 1 charm at a time"). Affects `keyOf` — and so the
 *                              duplicate refusal in `add` — and nothing else: `buildIndex` stays
 *                              scope-blind, because "is this person marked at all" is the question
 *                              a tag on their sheet asks.
 */
export function createRoster({ prefix, fields = {}, scope = () => "" }) {
	const extraKeys = Object.keys(fields);

	/**
	 * One stored row, normalised.
	 *
	 * `uuid` is the link to an Actor and is what the target sheets match on; it is empty for a row
	 * naming somebody with no actor in the world, which is the common case at the table and the
	 * only possible case for a faction or a warded doorway. A name-only row is a perfectly good
	 * roster entry — it simply cannot carry a tag, because there is no sheet to put one on.
	 *
	 * `id` is this row's own handle, used by the dialogs to dismiss it. Never the target's id: two
	 * rows can name the same faction, and a name-only row has no document id to borrow.
	 *
	 * Everything is defensive because this comes back out of a flag, which validates nothing — a
	 * hand-edited world must not be able to put `undefined` into a template or throw on `.trim()`.
	 */
	function readEntry(raw, index = 0) {
		const entry = {
			id:   String(raw?.id ?? "").trim() || `${prefix}-${index}`,
			name: String(raw?.name ?? "").trim(),
			uuid: String(raw?.uuid ?? "").trim(),
			note: String(raw?.note ?? "").trim(),
		};
		for (const key of extraKeys) entry[key] = fields[key](raw?.[key], raw ?? {});
		return entry;
	}

	/**
	 * Every row, normalised and in stored order.
	 *
	 * Rows with no name at all are dropped rather than rendered as a blank line: a nameless row
	 * names nobody, so there is nothing to recognise and nothing to dismiss.
	 */
	function readList(raw) {
		if (!Array.isArray(raw)) return [];
		return raw.map(readEntry).filter(e => e.name);
	}

	/**
	 * The identity two rows are compared on, so the same person cannot be listed twice.
	 *
	 * An actor-backed row is its uuid; a name-only row is its case-folded name. The two never
	 * collide, because the name key is prefixed — otherwise a faction literally called after an
	 * Actor uuid would be a very silly bug to chase.
	 *
	 * `scope` rides in front of both, so a roster that keeps several kinds of row about one person
	 * compares them within their kind. The separator is a pipe, which no kind key contains.
	 */
	function keyOf(entry) {
		const base = entry?.uuid ? `uuid:${entry.uuid}` : `name:${normalizeName(entry?.name)}`;
		const within = String(scope(entry ?? {}) ?? "");
		return within ? `${within}|${base}` : base;
	}

	/**
	 * Add a row, or report why not. Returns `{ entries, added }` — `added` is null when the list is
	 * unchanged, so a caller can tell "marked" from "already marked" without re-comparing, and can
	 * skip the document write entirely.
	 *
	 * `makeId` is injected rather than reaching for foundry.utils.randomID, so this module keeps
	 * its property of being testable without a Foundry global in sight.
	 *
	 * The row is normalised at the first FREE positional slot so that readEntry's fallback cannot
	 * collide when `makeId` yields nothing — normalising at the default index 0 would hand every
	 * such row the same `<prefix>-0`, and two rows sharing an id means one Dismiss lifts both.
	 *
	 * The length alone isn't a free slot, because readList numbers by the RAW stored index and then
	 * DROPS nameless rows: a stored `[{name:""}, {name:"Gethin"}]` leaves one entry, `<prefix>-1`,
	 * at length 1. So the taken ids are asked directly rather than assumed from the count.
	 */
	function add(list, entry, makeId = () => "") {
		const entries = readList(list);
		const taken = new Set(entries.map(e => e.id));
		let slot = entries.length;
		while (taken.has(`${prefix}-${slot}`)) slot++;
		const next = readEntry({ ...entry, id: entry?.id || makeId() }, slot);
		if (!next.name) return { entries, added: null };
		const key = keyOf(next);
		if (entries.some(e => keyOf(e) === key)) return { entries, added: null };
		return { entries: [...entries, next], added: next };
	}

	/**
	 * Drop ONE row. Returns `{ entries, removed }`, `removed` null when the id matched nothing —
	 * so the caller can skip a write that would change nothing but still re-render every sheet
	 * showing this actor.
	 *
	 * Cut by POSITION rather than by filtering on the id: `add` guarantees fresh ids are unique,
	 * but a hand-edited flag can still hold two rows spelling the same one, and a filter would take
	 * both people off the roster for a single click. Same reason `patch` writes by index below.
	 */
	function remove(list, id) {
		const entries = readList(list);
		const at = entries.findIndex(e => e.id === id);
		if (at < 0) return { entries, removed: null };
		return { entries: entries.filter((_, i) => i !== at), removed: entries[at] };
	}

	/**
	 * Patch one row's fields in place, same no-op contract as the two above: `changed` is null when
	 * the row does not actually move, so re-saving an unedited note writes nothing.
	 *
	 * The patch goes back through readEntry, so a caller cannot store a value the read path would
	 * have refused — a Loyalty of 9 or an unknown kind is coerced here exactly as it would be on
	 * the way back out of the flag.
	 */
	function patch(list, id, changes) {
		const entries = readList(list);
		const at = entries.findIndex(e => e.id === id);
		if (at < 0) return { entries, changed: null };
		const changed = readEntry({ ...entries[at], ...changes }, at);
		if (Object.keys(changed).every(k => changed[k] === entries[at][k])) {
			return { entries, changed: null };
		}
		return { entries: entries.map((e, i) => (i === at ? changed : e)), changed };
	}

	/**
	 * The comparison form of a list: the actor ids on it, and the case-folded names.
	 *
	 * Built once and asked many times. `isOn` re-reads and re-normalises the WHOLE list on every
	 * call, which is fine for a single question but is O(actors × rows) when a caller is filtering
	 * a world's worth of actors against it — every add field's suggestions do exactly that, on
	 * every render. Callers in a loop build this above the loop and use `isOnIndex`.
	 */
	function buildIndex(list) {
		const ids = new Set();
		const names = new Set();
		for (const row of readList(list)) {
			if (row.uuid) ids.add(trailingActorId(row.uuid));
			const name = normalizeName(row.name);
			if (name) names.add(name);
		}
		return { ids, names };
	}

	/** Is this actor on a prepared `buildIndex`? See `isOn` for why the name counts too. */
	function isOnIndex(index, actor) {
		const name = normalizeName(actor?.name);
		if (name && index.names.has(name)) return true;
		for (const key of actorMatchKeys(actor)) if (index.ids.has(key)) return true;
		return false;
	}

	/**
	 * Is this actor already listed? Used to keep people already on a roster out of an add field's
	 * suggestions — offering somebody is offering a click whose only outcome is a refusal.
	 *
	 * DELIBERATELY LOOSER THAN holdersOf, which is the other "is this person marked" question here,
	 * and the two must not be merged:
	 *
	 *  • holdersOf decides whether a SHEET WEARS A TAG, so it matches on uuid alone. A name-only
	 *    row names nobody in particular and must never put a mark on a document that merely shares
	 *    the spelling.
	 *  • this decides whether to OFFER A NAME, and the roster the player is reading lists that name
	 *    either way. Matching the name too keeps the promise the list makes — what is visibly on it
	 *    is not offered again — and stops a second, near-identical row for the same person.
	 *
	 * Only the suggestions are filtered, never the SEARCH: typing an already-listed name still
	 * resolves and still gets told why, which is a better answer than the name silently failing to
	 * match anybody.
	 */
	function isOn(list, actor) {
		return isOnIndex(buildIndex(list), actor);
	}

	/**
	 * Who is holding a row against this actor, given the characters to search. Returns the holders,
	 * so a tooltip can name them rather than asserting a bare state.
	 *
	 * `holders` is passed in rather than read off `game.actors` so this is testable and so the
	 * caller owns the (cheap, but repeated) collection scan. `readFlag` reads one character's
	 * stored list.
	 */
	function holdersOf(actor, holders, readFlag) {
		const target = actorMatchKeys(actor);
		if (!target.size) return [];
		const found = [];
		for (const holder of holders ?? []) {
			if (!holder || holder === actor) continue;
			const rows = readList(readFlag?.(holder));
			if (rows.some(r => r.uuid && target.has(trailingActorId(r.uuid)))) found.push(holder);
		}
		return found;
	}

	return { readEntry, readList, keyOf, add, remove, patch, buildIndex, isOnIndex, isOn, holdersOf };
}
