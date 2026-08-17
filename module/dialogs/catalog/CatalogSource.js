import { stripHtmlToText } from "../../utils/strings.js";
import { truncateValue } from "../../utils/ledger-core.js";

/**
 * One list inside a catalogue browser: the tab that reaches it, the words printed around it,
 * and how its rows and filter chips are built.
 *
 * A browser is a window plus N of these — CatalogBrowserDialog is the window, and
 * dialogs/StonetopBrowserDialog.js is the one that holds all of Stonetop's lists. Splitting
 * them this way is what lets "the arcana", "the bestiary" and "the world's NPCs" share a
 * window without any of them knowing the others exist: a source says what is in ITS list and
 * nothing else, and a fourth list is a new file plus one line in the browser's source list.
 *
 * Everything a source DECLARES is fixed copy, passed to the constructor. Everything it
 * COMPUTES is a method:
 *
 *   loadRows()        → the rows (CatalogBrowserDialog documents the row shape). Called once
 *                       per window and cached from then on, so it is allowed to be expensive.
 *   facetGroups(rows) → this list's filter bar, given the rows just loaded (see
 *                       utils/catalog-filters.js for the group shape).
 *   staleFor(doc)     → does this world-document change mean loadRows() must run again?
 *   retarget(context) → take whatever of the browser's open() context is this source's, and
 *                       say whether that stales the rows.
 *
 * DRAGGING a row out of the browser is a `dragType` and nothing else. A row already carries the
 * uuid of the document it summarises, and core's whole drop vocabulary is `{type, uuid}` — the
 * same payload `Document#toDragData` emits from the sidebar — so a source that names the document
 * name its rows ARE gets every core drop target for free: a compendium arcanum onto a character
 * sheet or into the Items directory, a stat block onto a scene as a token or into the Actors
 * directory. Which is why nothing here (and nothing in the browser) knows what any of those
 * targets DO with it: the browser only has to hand out the same pointer the sidebar would.
 *
 * A source that leaves it empty has rows that open and nothing more, which is the default.
 */
export class CatalogSource {
	/**
	 * @param {object} def
	 * @param {string} def.key   Stable tab key. Also the key the browser files this source's
	 *                           lit chips under, so switching tabs never drops the other's.
	 * @param {string} def.label Tab label.
	 * @param {string} def.icon  Tab icon — a Font Awesome class.
	 * @param {string} def.noun  What these are called in the count line: "82 arcana".
	 * @param {string} [def.nounOne] The same word for a count of one ("1 monster"). Defaults to
	 *                           `noun`, which is right for the collectives that do not inflect —
	 *                           "1 arcana", "1 people" would be wrong, but so is any other single
	 *                           word, and those lists say "arcana"/"people" of one entry too.
	 * @param {{title: string, placeholder: string}} def.search Tooltip and placeholder for the search box.
	 * @param {string} def.empty The line shown when the chips and the search between them leave nothing.
	 * @param {string} [def.worldActorType] Actor `type` this list is built from, if it is built
	 *                           from world actors at all. Declaring it is what makes the list
	 *                           live — see staleFor.
	 * @param {string} [def.dragType] The core document name this list's rows drag AS — "Item",
	 *                           "Actor". Declaring it is what makes the rows draggable at all;
	 *                           see the note below.
	 */
	constructor({ key, label, icon, noun, nounOne = noun, search, empty, worldActorType = "", dragType = "" }) {
		Object.assign(this, { key, label, icon, noun, nounOne, search, empty, worldActorType, dragType });
	}

	/** The rows in this list. Called once per window; the browser caches the result. */
	async loadRows() { return []; }

	/** Filter-bar group defs for this list, given its already-loaded rows. */
	facetGroups(_rows) { return []; }

	/**
	 * Whether a created / updated / deleted world document makes this list stale. The browser
	 * asks every source on every world change, so this must be cheap and must say no to
	 * anything it doesn't list — a source that over-claims costs the viewer their scroll
	 * position and their half-typed search term.
	 *
	 * Answered here for every list built out of `game.actors`, which is all of them that are
	 * live at all, so the exclusions are written once:
	 *
	 *  • a SYNTHETIC token actor is an ActorDelta copy and is in no list here, but it shares its
	 *    base actor's type — without the test, a follower's token taking a hit in combat would
	 *    stale the list and cost the viewer their place in it;
	 *  • a compendium actor is out because the pack half of a list is cached deliberately (see
	 *    MonsterSource#_packRows).
	 *
	 * A source that declares no `worldActorType` is not live, which is the base's answer and
	 * ArcanaSource's deliberate choice.
	 */
	staleFor(doc) {
		if (!this.worldActorType) return false;
		return doc?.documentName === "Actor" && !doc.isToken && !doc.pack && doc.type === this.worldActorType;
	}

	/**
	 * Take this source's share of the browser's open() context — the arguments a caller passes
	 * to say what they want to see — and report whether it stales the rows.
	 *
	 * Here rather than in the browser so the shell never has to know WHICH list cares about
	 * which argument: it hands the whole context to every source and invalidates the ones that
	 * say yes. A source that reads nothing from it returns false, which is the base's answer.
	 */
	retarget(_context) { return false; }

	/**
	 * Memoise one expensive per-window pull — a compendium read — under `key`, so a list whose
	 * rows are dropped and rebuilt doesn't pay for it a second time. A compendium cannot change
	 * under us, while the ROWS can: retarget() invalidates them whenever the browser is pointed
	 * somewhere new, and a monster edit re-reads the world half on its own.
	 *
	 * Its own helper on the base rather than written out in each source that needs it, because
	 * the trap is the same wherever it's written: `this._p ??= (async () => …)()` memoises a
	 * REJECTED promise exactly as happily as a resolved one. One pack locked mid-rebuild, one
	 * transient socket error, and that tab throws for the rest of the window's life with nothing
	 * but closing it to clear the error. Here the failure is dropped from the cache and the next
	 * ask simply tries again — the in-flight callers still see the error they were waiting on.
	 */
	_once(key, fn) {
		this._onceCache ??= new Map();
		if (!this._onceCache.has(key)) {
			const promise = Promise.resolve().then(fn).catch(err => {
				// Identity-checked so a retry already in flight is never evicted by the failure
				// that caused it.
				if (this._onceCache.get(key) === promise) this._onceCache.delete(key);
				throw err;
			});
			this._onceCache.set(key, promise);
		}
		return this._onceCache.get(key);
	}
}

/**
 * A one-line gist of some authored prose, clipped at a word boundary by the system's one
 * truncator so the ellipsis never lands mid-word.
 */
export function summarize(html, max = 190) {
	return truncateValue(stripHtmlToText(html), max);
}

/** The lowercase search index for a row, from whatever text the source thinks matters. */
export function searchIndex(...parts) {
	return parts.flat().filter(Boolean).join(" ").toLowerCase();
}
