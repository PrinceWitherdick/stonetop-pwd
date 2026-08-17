import { StonetopDialog } from "../utils/stonetop-dialog.js";
import { wireTabSearch } from "../utils/tab-search.js";
import { buildFacetGroups, isRowHidden, toggleChip } from "../utils/catalog-filters.js";
import { SYSTEM_ID } from "../system-id.js";

/**
 * A window for looking THROUGH lists — currently the one that holds all of Stonetop's,
 * dialogs/StonetopBrowserDialog.js. One window, one skin (the `.stonetop-catalog-*` CSS), one
 * set of gestures — a search box and single-select chip groups that copy the steading
 * improvements bar, click-the-lit-chip-to-clear and all.
 *
 * It exists because those gestures are the whole of a browser and none of its subject. A
 * CatalogSource says WHAT is in one list and HOW each of its rows reads; everything below —
 * loading, chip state, filtering in place, the live count, the empty state, staying current
 * with the world, opening a row's sheet, dragging one out of the window — is the same work
 * whatever the lists hold.
 *
 * So there is exactly ONE seam, and it is the source: a subclass provides `_buildSources()`
 * and its own chrome, and everything that varies per list is asked of every source in turn
 * (see dialogs/catalog/CatalogSource.js for the six things a source answers). Nothing here
 * names a particular list, and nothing here is a hook a subclass has to forward.
 *
 * A ROW is the shape templates/dialogs/partials/catalog-shell.hbs renders:
 *   { key, uuid, title, img, placeholderImg, marked, inactive, flags[], badges[], note,
 *     summary, search, facets{} }
 * `key` identifies the row within its source (a slug, an id — anything stable). `search` is
 * the prebuilt lowercase index, so a term can reach text the row only shows as a tooltip.
 *
 * Rows are loaded once per source and cached: switching source is a re-render off the cache,
 * and chip clicks don't re-render at all.
 */
export class CatalogBrowserDialog extends StonetopDialog {
	constructor(options = {}) {
		super(options);
		// Lit chip per group, per source — `{ source: { groupKey: chipKey } }`. Kept per
		// source so switching to People and back doesn't quietly drop the monster filters.
		this._active = {};
		this._rowCache = new Map();
		this._source = this._sourceList()[0]?.key ?? "";
	}

	static get defaultOptions() {
		return foundry.utils.mergeObject(super.defaultOptions, {
			// The shell markup IS the whole body of a browser, so it is this class's default
			// rather than something each subclass re-points at: a wrapper template whose only
			// line was `{{> "stonetop.catalog-shell"}}` was one indirection for no decision.
			//
			// It stays registered as the `stonetop.catalog-shell` partial (stonetop.js), which
			// now earns its keep by PRELOADING it — Foundry compiles registered templates at
			// startup and renderTemplate reads that same cache, so the first open costs no
			// fetch. It also remains embeddable, should the shell ever want to sit in a page.
			template: `systems/${SYSTEM_ID}/templates/dialogs/partials/catalog-shell.hbs`,
		});
	}

	// ------------------------------------------------------------- subclass contract

	/**
	 * The lists this browser holds, in tab order — the ONE thing a subclass has to say.
	 *
	 * A method rather than a constructor argument or an assigned field because the constructor
	 * above needs it to pick the opening tab: a field assigned after `super()` is still
	 * undefined at that moment, and working around that took a `?? []` guard and a second
	 * assignment. An overridden method is already callable there, so long as it reads no
	 * instance state — which building a fresh set of sources doesn't.
	 */
	_buildSources() { return []; }

	// ------------------------------------------------------------- sources

	/** The sources, built once on the first ask. */
	_sourceList() { return this._sources ??= this._buildSources(); }

	/** A source by key, falling back to the first so an unknown key still reads sanely. */
	_sourceFor(key) {
		const list = this._sourceList();
		return list.find(s => s.key === key) ?? list[0] ?? null;
	}

	/** The source whose list is on screen. */
	get _currentSource() { return this._sourceFor(this._source); }

	/**
	 * Switch to a source by key, reporting whether that changed anything. An unknown key is
	 * ignored rather than stored: _sourceFor falls back to the first source, so a stored typo
	 * would draw the first list under no lit tab at all.
	 */
	_selectSource(key) {
		if (!key || key === this._source) return false;
		if (!this._sourceList().some(s => s.key === key)) return false;
		this._source = key;
		return true;
	}

	/**
	 * Point the window at what a caller asked for, re-rendering only when something actually
	 * changed — reopening the macro on the tab you were already on must not throw away your
	 * scroll position or your half-typed search term.
	 *
	 * Which source cares about which argument is the source's own business: the whole context
	 * goes to every one of them and the ones that say it stales their rows are invalidated.
	 * Same shape as the world hook below, and for the same reason.
	 */
	_retarget(context = {}) {
		let dirty = this._selectSource(context.source);

		for (const source of this._sourceList()) {
			if (!source.retarget(context)) continue;
			this.invalidateRows(source.key);
			dirty ||= this._source === source.key;
		}

		if (dirty && this.rendered) this.render(false);
	}

	// ------------------------------------------------------------- state

	/** The lit chips for the current source, created on first use. */
	get _activeFilters() {
		return this._active[this._source] ??= {};
	}

	async _rowsFor(source) {
		if (!this._rowCache.has(source)) {
			this._rowCache.set(source, (await this._sourceFor(source)?.loadRows()) ?? []);
		}
		return this._rowCache.get(source);
	}

	/**
	 * Drop cached rows so the next render re-reads the world. Pass a source to drop just that
	 * list: an edit to one of them is no reason to re-read (and re-sort, re-facet, re-render)
	 * the other, which on the bestiary is 212 rows.
	 */
	invalidateRows(source = null) {
		if (source === null) this._rowCache.clear();
		else this._rowCache.delete(source);
	}

	// ------------------------------------------------------------- render

	async getData() {
		const rows    = await this._rowsFor(this._source);
		const active  = this._activeFilters;
		const sources = this._sourceList();
		const current = this._currentSource;
		const search  = current?.search ?? { title: "Search", placeholder: "Filter…" };
		// Counts on the source tabs come from whatever is already cached; a source nobody
		// has opened yet shows none rather than being loaded just to be counted, which on
		// the bestiary would mean pulling 212 documents to draw a number.
		return {
			// Only what the tab strip renders. The rest of a source's copy is its own and has
			// no business in the template context.
			sources: sources.map(({ key, label, icon }) => {
				const count = this._rowCache.get(key)?.length ?? null;
				// `hasCount` rather than leaning on {{#if count}}: a source that has been
				// opened and holds nothing must show "0", not look unvisited, and Handlebars
				// counts 0 as falsy.
				return { key, label, icon, active: key === this._source, count, hasCount: count !== null };
			}),
			hasSources: sources.length > 1,
			groups:  buildFacetGroups(current?.facetGroups(rows) ?? [], rows, active),
			// `dragType` is the source's, but it is gated per row on there being a uuid to send:
			// a row with nothing to point at would drag an empty payload, which reads to every
			// drop target as a failed drop rather than as a row that isn't draggable.
			rows:    rows.map(row => ({
				...row,
				filtered: isRowHidden(row, active),
				dragType: row.uuid ? (current?.dragType ?? "") : "",
			})),
			// Seeds the count line for the first paint; _updateCount rewrites it from the DOM
			// from then on, which is the only place that knows about the search's hides too.
			total:   `${rows.length} ${this._countNoun(rows.length)}`,
			empty:   current?.empty ?? "Nothing matches those filters.",
			searchTitle:       search.title,
			searchPlaceholder: search.placeholder,
		};
	}

	activateListeners(html) {
		super.activateListeners(html);
		this._registerWorldHook();
		// `.stonetop-catalog` IS the template's root element, so `html[0]` is already it and
		// `html[0].querySelector(".stonetop-catalog")` finds nothing — querySelector looks at
		// descendants, never at the element itself. That silently handed wireTabSearch a null
		// scope, which it takes as "no search control here" and returns from: the magnifying
		// glass rendered and did nothing at all. Resolved from the window element instead, where
		// it genuinely is a descendant, with the root as the fallback.
		//
		// Listeners bind to this element rather than to `this.element[0]`: the window element
		// survives a re-render and would collect a fresh set of handlers every time, while the
		// inner content is replaced wholesale and takes its listeners with it.
		const root = this.element?.[0]?.querySelector(".stonetop-catalog") ?? (html[0] ?? html);

		wireTabSearch(root, {
			itemSel: ".stonetop-catalog-row",
			// The prebuilt index rather than textContent: it reaches text the row shows only
			// as a tooltip, and skips the chrome around it.
			textFor: el => el.dataset.search ?? el.textContent,
			onFilter: () => this._updateCount(root),
		});

		root.addEventListener("click", ev => {
			// A source tab swaps the list AND the whole filter bar, so it re-renders.
			const tab = ev.target.closest(".stonetop-catalog-source");
			if (tab) {
				ev.preventDefault();
				// Through _selectSource, never by assigning `_source` here: it is the one writer
				// that refuses a key no source answers to, and it already reports "nothing
				// changed" for the tab we are on, which is the only guard this needed.
				if (this._selectSource(tab.dataset.source)) this.render(false);
				return;
			}

			// Chips filter in place — no re-render, so the list keeps its scroll position and
			// the search box keeps its term mid-typing.
			const chip = ev.target.closest(".stonetop-catalog-filter");
			if (chip) {
				ev.preventDefault();
				this._active[this._source] = toggleChip(this._activeFilters, chip.dataset.group, chip.dataset.key);
				this._applyFilters(root);
				return;
			}

			const row = ev.target.closest(".stonetop-catalog-row");
			if (row) this._openRow(row.dataset.uuid);
		});

		// A dropdown facet sets its group directly — its empty option IS the unfiltered state,
		// so there's no toggle-to-clear to do. Filters in place like the chips.
		root.addEventListener("change", ev => {
			const select = ev.target.closest(".stonetop-catalog-select");
			if (!select) return;
			this._active[this._source] = { ...this._activeFilters, [select.dataset.group]: select.value };
			this._applyFilters(root);
		});

		// Drag a row out of the window as the document it summarises. This is what turns the
		// browser from a reading tool into a working one: a GM who has just filtered the bestiary
		// down to "swamp things, in a group" wants that stat block ON the scene, and a GM reading
		// the arcana wants the card they picked ON the character who found it. Without this the
		// only route was to note the name, close the window, and go find it again in a compendium.
		//
		// The payload is core's own `{type, uuid}` — the same thing Document#toDragData emits from
		// the sidebar — so every core drop target already knows what to do with it and nothing here
		// has to: the canvas places a token (importing a pack actor into the world first), the
		// sidebar directories import a copy, and this system's own sheets route it exactly as they
		// route a sidebar drag (an arcanum lands face-down, an NPC offers the follower conversion).
		//
		// It reads BOTH halves of the contract off the row rather than asking which tab is up:
		// `_currentSource` and the rendered rows do agree (a tab switch re-renders), but a handler
		// that depends on that agreement breaks silently the day something paints rows without one.
		// It cannot be async either — a dragstart that awaits has already lost its dataTransfer —
		// which is the other reason the row carries what it needs rather than the uuid being
		// resolved here.
		root.addEventListener("dragstart", ev => {
			const row  = ev.target.closest?.(".stonetop-catalog-row[draggable='true']");
			const uuid = row?.dataset.uuid;
			const type = row?.dataset.dragType;
			if (!uuid || !type) return;
			ev.dataTransfer.setData("text/plain", JSON.stringify({ type, uuid }));
			ev.dataTransfer.effectAllowed = "copy";
		});

		// The rows are role="button", so they owe a keyboard user the same opening. Space is
		// swallowed rather than left to scroll the list out from under the focused row.
		root.addEventListener("keydown", ev => {
			if (ev.key !== "Enter" && ev.key !== " ") return;
			const row = ev.target.closest(".stonetop-catalog-row");
			if (!row) return;
			ev.preventDefault();
			this._openRow(row.dataset.uuid);
		});

		this._updateCount(root);
	}

	/** Open an entry's own sheet — the browser summarises, the sheet is the thing. */
	async _openRow(uuid) {
		const doc = await fromUuid(uuid);
		doc?.sheet?.render(true);
	}

	/** Re-light the chips and re-hide the rows for the current filter state. */
	async _applyFilters(root) {
		const rows   = await this._rowsFor(this._source);
		const active = this._activeFilters;
		const byKey  = new Map(rows.map(row => [row.key, row]));

		for (const chip of root.querySelectorAll(".stonetop-catalog-filter")) {
			const lit = (active[chip.dataset.group] ?? "") === chip.dataset.key;
			chip.classList.toggle("is-active", lit);
			chip.setAttribute("aria-pressed", lit ? "true" : "false");
		}
		// Dropdown facets are re-synced too, not just the one the viewer touched: clearing a
		// group from anywhere else must show up here rather than leaving a stale selection.
		for (const select of root.querySelectorAll(".stonetop-catalog-select")) {
			const value = active[select.dataset.group] ?? "";
			select.value = value;
			select.classList.toggle("is-active", !!value);
		}
		for (const el of root.querySelectorAll(".stonetop-catalog-row")) {
			const row = byKey.get(el.dataset.key);
			el.classList.toggle("stonetop-catalog-filtered", !!row && isRowHidden(row, active));
		}
		this._updateCount(root);
	}

	/**
	 * "12 of 82" under the filter bar. Counted off the DOM rather than off the row data
	 * because the search hides rows too, and only the DOM knows about both hides.
	 */
	_updateCount(root) {
		const rows  = [...root.querySelectorAll(".stonetop-catalog-row")];
		const shown = rows.filter(el =>
			!el.classList.contains("stonetop-catalog-filtered") &&
			!el.classList.contains("stonetop-search-hidden")
		).length;
		const label = root.querySelector(".stonetop-catalog-count");
		if (label) {
			// Agrees with the TOTAL in both forms, because that is the noun's number in each:
			// "1 monster", and "1 of 82 monsters" — where the word belongs to the 82.
			const noun = this._countNoun(rows.length);
			label.textContent = shown === rows.length ? `${rows.length} ${noun}` : `${shown} of ${rows.length} ${noun}`;
		}
		const empty = root.querySelector(".stonetop-catalog-empty");
		if (empty) empty.classList.toggle("is-visible", shown === 0);
	}

	/**
	 * What the current source's entries are called in the count line: "82 arcana", "1 monster".
	 *
	 * `count` picks the form. It was declared at the call site and not here, so the line read
	 * "1 monsters" whenever the filters narrowed to one — the argument named the intent and
	 * nothing acted on it. A source that does not inflect (arcana, people) sets no `nounOne` and
	 * gets the same word back for both.
	 */
	_countNoun(count) { return (count === 1 ? this._currentSource?.nounOne : this._currentSource?.noun) ?? "entries"; }

	// ------------------------------------------------------------- staying current

	/**
	 * Keep the lists current with the world under them. A browser is a session-long singleton —
	 * a GM marks an NPC dead, renames a monster, drags a stat block out of a pack to edit — so
	 * without this it would quietly go stale under exactly the person who was changing things.
	 *
	 * Each source decides for itself whether a change is its business (CatalogSource#staleFor),
	 * and only the sources that say yes are invalidated: renaming an NPC must not throw away the
	 * 212 monster rows. It re-renders only when the stale list is the one on screen — the others
	 * refresh when next opened.
	 *
	 * Registered only where some list is actually built out of world actors, which is what
	 * `worldActorType` declares. A browser over packs and journals alone hooks nothing, rather
	 * than waking on every actor edit in the world to be told three times that it doesn't care.
	 *
	 * Throttled (StonetopDialog.renderThrottled) because a single edit can land as a burst of
	 * updates.
	 *
	 * Its own method, called from activateListeners, rather than a second `activateListeners`
	 * further down the class: two definitions of one method is not two handlers, it is the later
	 * one REPLACING the earlier — which silently threw away every listener wired above.
	 */
	_registerWorldHook() {
		if (this._worldHook) return;
		if (!this._sourceList().some(s => s.worldActorType)) return;
		this._worldHook = (doc) => {
			for (const source of this._sourceList()) {
				if (!source.staleFor(doc)) continue;
				this.invalidateRows(source.key);
				if (this.rendered && this._source === source.key) this.renderThrottled();
			}
		};
		for (const hook of _ACTOR_HOOKS) Hooks.on(hook, this._worldHook);
	}

	async close(options = {}) {
		if (this._worldHook) {
			for (const hook of _ACTOR_HOOKS) Hooks.off(hook, this._worldHook);
			this._worldHook = null;
		}
		return super.close(options);
	}
}

/** The world changes a list built from `game.actors` has to watch. */
const _ACTOR_HOOKS = ["createActor", "updateActor", "deleteActor"];
