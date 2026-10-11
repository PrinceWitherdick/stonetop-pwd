/**
 * Index a compendium pack for the fields a caller needs, remembering every field ANY caller has
 * ever asked that pack for and always requesting the union.
 *
 * Why the union, rather than each caller asking for its own fields:
 *
 * A pack tracks one set of "fields I am indexed on" (`CompendiumCollection##indexedFields`), and
 * `getIndex({fields})` OVERWRITES it with core-fields ∪ fields. The freshly fetched rows are
 * merged into the existing index entries, so the data of a previous, wider index survives the
 * call — but the pack no longer believes those fields are indexed. That matters because v14
 * rebuilds an index entry FROM SCRATCH out of the tracked set whenever a document is loaded
 * (`set()` → `indexDocument()`): the entry is replaced, not merged, so every field outside the
 * last-requested set is dropped from it.
 *
 * The visible failure: this system reads one shared items pack through half a dozen stores with
 * different field lists. Ask it for `system.moveType` last, then open a post-death insert
 * document, and that insert's index entry comes back without `system.slug` — so the "Choose Your
 * Fate" list, which matches inserts by slug, silently loses the ones the player had looked at.
 * Anything else keyed off an index field (playbook lookup, treasure, arcana slugs) fails the same
 * way, and only for the documents that happen to have been loaded.
 *
 * `getIndex` is asked on every call rather than guarded by a local "already indexed" flag: it
 * returns immediately when the requested fields are already covered, and re-fetches exactly when
 * they are not — which is precisely when another caller has narrowed the set and the index needs
 * repairing. Calls per pack are chained so a burst can't fire several server round trips before
 * the first one records what it indexed.
 *
 * @param {string} packName  Full pack id, e.g. "stonetop-pwd.stonetop-items".
 * @param {string[]} [fields]  Index fields this caller needs.
 * @returns {Promise<CompendiumCollection|null>}  The pack, or null when it isn't registered.
 */

const _fields  = new Map();
const _indexed = new Map();
const _pending = new Map();

export async function ensurePackIndex(packName, fields = []) {
	const pack = globalThis.game?.packs?.get?.(packName);
	if (!pack) return null;

	let wanted = _fields.get(packName);
	if (!wanted) _fields.set(packName, wanted = new Set());
	for (const field of fields) wanted.add(field);

	const index = async asked => {
		await pack.getIndex({ fields: withoutCoveredFields(asked, pack.indexFields) });
		_indexed.set(packName, new Set(asked));
	};

	// Spread inside the thunk, not here: by the time this link of the chain runs, a later caller
	// may have widened the union, and asking for the wider set costs the same one request.
	const run = (_pending.get(packName) ?? Promise.resolve()).then(async () => {
		// Re-added here because a failed link before this one may have taken a shared one out.
		for (const field of fields) wanted.add(field);
		const indexed = _indexed.get(packName) ?? new Set();
		const asked = [...wanted];
		try {
			await index(asked);
		} catch (err) {
			// The union holds fields of callers still queued behind this one, and any of them may be
			// the one the server rejects. Retried with only what last indexed plus this caller's own,
			// so a bad field fails the caller that asked for it and nobody queued ahead of it.
			const own = new Set([...indexed, ...fields]);
			if (own.size < asked.length) {
				try { return await index([...own]); }
				catch (retryErr) { err = retryErr; }
			}
			// This caller's fields must not stay in the union, or every later caller sends them and
			// fails too until reload. Only its own: a transient failure must not drop the fields of
			// callers that are no longer queued, and the ones still queued re-add theirs above.
			for (const field of fields) if (!indexed.has(field)) wanted.delete(field);
			throw err;
		}
	});
	// A failed index must not poison the chain for the next caller.
	_pending.set(packName, run.catch(() => {}));
	await run;
	return pack;
}

/**
 * The union with every field dropped that an ancestor already covers, whether the ancestor is in
 * the union or among the fields core sends with every request anyway (`pack.indexFields`: the
 * document's own plus `CONFIG[type].compendiumIndexFields`, which this system extends). The server
 * builds its projection with `setProperty(projection, field, 1)` per field, so a request holding
 * both `flags.stonetop` and `flags.stonetop.slug` sets the first to 1 and then throws on the
 * second ("Cannot create property 'slug' on number '1'"), failing that pack's index for every
 * caller. The ancestor alone returns the whole subtree, so nothing a child asked for is lost.
 * Core's fields go first in the request, so a caller's field that is an ANCESTOR of one of them
 * only overwrites it, which is safe, and is kept. PURE.
 *
 * @param {Iterable<string>} fields
 * @param {Iterable<string>} [alsoSent]  Fields core adds to the request itself.
 * @returns {string[]}
 */
export function withoutCoveredFields(fields, alsoSent = []) {
	const all = new Set(fields);
	const sent = new Set(alsoSent ?? []);
	const covered = path => all.has(path) || sent.has(path);
	return [...all].filter(field => {
		if (sent.has(field)) return false;
		const parts = field.split(".");
		for (let i = 1; i < parts.length; i++) if (covered(parts.slice(0, i).join("."))) return false;
		return true;
	});
}

/** Forget every remembered field set. Tests only — a live session wants the union to accumulate. */
export function resetPackIndexFields() {
	_fields.clear();
	_indexed.clear();
	_pending.clear();
}
