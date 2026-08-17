import { resolveResidentsGrid, readStoredColumnState, writeStoredColumnState } from "./steading-column-util.js";
import { SYSTEM_ID } from "../system-id.js";

const STORAGE_PREFIX = `${SYSTEM_ID}.columnSort.`;

// Last known pointer position, so a re-render can tell whether it is about to move rows
// out from under the user's cursor (see applySort). One passive listener for the whole
// module — a fresh render can't rely on mouseenter, which won't fire again until the
// pointer actually moves, so position is checked against live layout instead.
let ptrX = -1;
let ptrY = -1;
// Tables holding a deferred re-sort, each with the check that lands it once the pointer has
// moved off. A mouseleave on the list can't do this job: after a re-render the browser's
// hover chain still points at the list node that was just replaced, so the fresh one never
// receives an enter and therefore never fires a leave — the sort would stay deferred for
// good. Pointer movement is the signal that actually arrives.
const pendingSorts = new Set();
if (typeof document !== "undefined") {
	document.addEventListener("pointermove", ev => {
		ptrX = ev.clientX;
		ptrY = ev.clientY;
		for (const land of [...pendingSorts]) land();
	}, { passive: true });
}

// What is under the pointer right now. document.elementFromPoint forces a synchronous
// style+layout flush, and one re-render hit-tests once per sortable table (the steading
// sheet has four) from the same pointer position, interleaved with the row reordering that
// dirties layout again — so resolve it once and share it across that burst. `false` is the
// "resolved to nothing" sentinel, so a genuine miss isn't re-queried either. The microtask
// drops the cache before anything but that synchronous burst can observe it, which is why
// it can't go stale.
// The row order each table last PAINTED, keyed by its storage key so it outlives the
// closure — makeColumnsSortable re-runs against a brand-new table element on every render,
// so nothing inside it remembers anything. This is what "don't move rows under the pointer"
// has to be measured against: the freshly rendered DOM is always in raw template order,
// which is not an order the user has ever been shown.
const lastPainted = new Map();
const sameOrder = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

let ptrEl = null;
function elementUnderPointer() {
	if (ptrX < 0) return null;
	if (ptrEl === null) {
		ptrEl = document.elementFromPoint(ptrX, ptrY) ?? false;
		queueMicrotask(() => { ptrEl = null; });
	}
	return ptrEl || null;
}

/**
 * Lets users click the column headers of a `.steading-residents-table` (the
 * grid-based Players/Residents/Neighbors tables on the steading sheet) to sort
 * the rows ascending/descending on that column, and persists the chosen sort in
 * localStorage so it survives re-renders (editing a cell re-renders the sheet).
 *
 * The sort is purely visual: rows are reordered in the DOM but each row keeps
 * its original `data-index`, so edits and deletes still target the right entry
 * in the underlying flag array. Empty placeholder "add" rows (blank name) always
 * sink to the bottom in their original order, never mixed into the sort.
 *
 * Clicking a column cycles: unsorted -> ascending -> descending -> ascending...
 * Clicking a different column starts it ascending.
 *
 * @param {HTMLElement} table       - the `.steading-residents-table` wrapper
 * @param {string}      storageKey  - unique key (e.g. "players", "residents", "neighbors")
 */
export function makeColumnsSortable(table, storageKey) {
	const grid = resolveResidentsGrid(table);
	if (!grid) return;
	const { header, list } = grid;

	// Sortable columns are every header cell that carries a label; the trailing
	// actions column has none and is skipped.
	const headerCells = Array.from(header.children)
		.filter(cell => cell.querySelector(":scope > .steading-residents-header-label"));
	if (!headerCells.length) return;

	// Idempotent, for the same reason makeColumnsResizable is: a table reachable by both a
	// sheet's generic wiring loop and a shared component's own must not end up with two
	// sort handlers fighting over the row order.
	if (table.dataset.stColumnsSortable) return;
	table.dataset.stColumnsSortable = "1";

	const columnKey = cell => {
		// The col-name class (e.g. "steading-residents-col-occupation") is shared
		// between a header cell and its matching row cells, so it doubles as the
		// per-column sort key and the selector for reading each row's value.
		const cls = Array.from(cell.classList).find(c =>
			c.startsWith("steading-residents-col-") && c !== "steading-residents-col-resizable" && c !== "steading-residents-col-sortable");
		return cls ?? null;
	};

	const storageId = `${STORAGE_PREFIX}${storageKey}`;
	let state = null;
	const saved = readStoredColumnState(storageId);
	if (saved && typeof saved.col === "string" && (saved.dir === "asc" || saved.dir === "desc")) state = saved;

	const persist = () => writeStoredColumnState(storageId, state);

	const valueOf = (row, colClass) => {
		const cell = row.querySelector(`:scope > .${colClass}`);
		if (!cell) return "";
		// An editable cell sorts on what's typed in it — but only for value-carrying
		// fields. A valueless checkbox reports "on", so the relationship table's
		// show/hide box (which rides inside the NAME cell) would otherwise become every
		// row's sort key and flatten the name sort to a no-op.
		const input = cell.querySelector('input:not([type="checkbox"]):not([type="radio"])');
		const raw = input ? input.value : cell.textContent;
		return (raw ?? "").trim();
	};

	const nameClass = "steading-residents-col-name";

	// Stable per-row identity across renders: the relationship tables key rows by actor id,
	// the steading's by the row's index in the underlying flag array (sorting is purely
	// visual, so that index never moves). Name is the last resort.
	const rowId = row => row.dataset.relId
		?? row.querySelector("[data-index]")?.dataset?.index
		?? valueOf(row, nameClass);

	const applySort = (force = false) => {
		// Runs on every steading re-render, sorted or not: even with no active sort the blank
		// "add" / cleared-name rows must be pinned to the bottom. The DOM is only touched when
		// the order actually changes (see below), so an already-ordered render costs nothing.
		const rows = Array.from(list.querySelectorAll(":scope > .steading-residents-row"));
		// Decorate each row ONCE with its name and its active-column value, so the comparator
		// and the placeholder split read cached primitives instead of re-querying the DOM on
		// every comparison (which was O(n log n) querySelectors per sort).
		const decorated = rows.map(row => ({
			row,
			id:   rowId(row),
			name: valueOf(row, nameClass),
			key:  state ? valueOf(row, state.col) : "",
		}));
		// Blank-name rows are the edit-mode "add" placeholders; keep them pinned at the
		// bottom in DOM order and only sort the real entries above them.
		const placeholders = decorated.filter(d => d.name === "");
		const real = decorated.filter(d => d.name !== "");

		if (state) {
			const dir = state.dir === "desc" ? -1 : 1;
			real.sort((a, b) => {
				// Blank values in the sorted column sink to the bottom regardless of direction.
				if (a.key === "" && b.key !== "") return 1;
				if (b.key === "" && a.key !== "") return -1;
				return dir * a.key.localeCompare(b.key, undefined, { numeric: true, sensitivity: "base" });
			});
		}

		// Never reflow rows out from under a live pointer. Editing a row re-renders the
		// sheet, and if the edit changed the sorted column the row the user is aiming at
		// slides away — so a repeated click (stepping a relationship's hearts down,
		// retyping a resident's name) lands on whichever row took its place and writes to
		// the WRONG record.
		//
		// "Don't move" means hold the order the user is LOOKING at, which is the one we
		// last painted — NOT whatever this render's template just emitted. The template
		// always emits build order, so measuring against the live DOM would report "the
		// order changed" on every single render of a sorted table and leave it sitting in
		// raw build order, which is a bigger jump than the one this guard exists to stop.
		// The real re-sort is deferred until the pointer leaves. A header click always
		// reorders: the user asked for it, and the header sits outside the list.
		const ordered = [...real, ...placeholders];
		const realIds = real.map(d => d.id);
		const painted = lastPainted.get(storageId);

		let target = ordered;
		if (!force && painted && !sameOrder(realIds, painted) && pointerInList()) {
			const byId = new Map(real.map(d => [d.id, d]));
			const held = painted.map(id => byId.get(id)).filter(Boolean);
			const heldIds = new Set(held.map(d => d.id));
			// Rows that appeared since that paint have no remembered slot: give them their
			// sorted one. Placeholders stay pinned at the bottom either way.
			target = [...held, ...real.filter(d => !heldIds.has(d.id)), ...placeholders];
			deferred = true;
			pendingSorts.add(landDeferred);
		} else {
			deferred = false;
			pendingSorts.delete(landDeferred);
		}
		lastPainted.set(storageId, target.filter(d => d.name !== "").map(d => d.id));

		// Only touch the DOM when the order actually changes — the common unsorted re-render
		// (template already renders placeholders last) then costs nothing.
		if (!target.some((d, i) => d.row !== rows[i])) return;
		for (const d of target) list.appendChild(d.row);
	};

	// Is the pointer currently over this list? Read from live layout rather than tracked
	// enter/leave state, so it is correct on a freshly rendered DOM too.
	const pointerInList = () => {
		const el = elementUnderPointer();
		return !!el && list.contains(el);
	};

	let deferred = false;
	// Land the held re-sort once the pointer is off this list. Drops itself when the sort is
	// no longer deferred, or when this list has been replaced by a later render (each render
	// builds a fresh closure, so old ones must not linger in the registry).
	const landDeferred = () => {
		if (!deferred || !list.isConnected) return pendingSorts.delete(landDeferred);
		if (pointerInList()) return;
		pendingSorts.delete(landDeferred);
		applySort(true);
	};

	const updateIndicators = () => {
		for (const cell of headerCells) {
			const key = columnKey(cell);
			const active = state && key === state.col;
			cell.classList.toggle("is-sorted", !!active);
			cell.classList.toggle("is-sorted-asc", !!active && state.dir === "asc");
			cell.classList.toggle("is-sorted-desc", !!active && state.dir === "desc");
			const icon = cell.querySelector(":scope > .steading-residents-sort-icon");
			if (icon) {
				icon.className = "fas steading-residents-sort-icon "
					+ (active ? (state.dir === "asc" ? "fa-sort-up" : "fa-sort-down") : "fa-sort");
			}
		}
	};

	for (const cell of headerCells) {
		const key = columnKey(cell);
		if (!key) continue;
		cell.classList.add("steading-residents-col-sortable");
		// The icon sits beside the label (not inside it) so the label keeps its own
		// ellipsis truncation when the column is dragged narrow.
		if (!cell.querySelector(":scope > .steading-residents-sort-icon")) {
			const icon = document.createElement("i");
			icon.className = "fas fa-sort steading-residents-sort-icon";
			cell.appendChild(icon);
		}
		cell.addEventListener("click", ev => {
			// Ignore clicks that land on the drag-resize handle at the cell's edge.
			if (ev.target.closest(".steading-col-resize-handle")) return;
			if (state && state.col === key) {
				state.dir = state.dir === "asc" ? "desc" : "asc";
			} else {
				state = { col: key, dir: "asc" };
			}
			persist();
			// An explicit header click is the one case that always reorders now: the user
			// asked for it, and the pointer is on the header rather than over a row.
			applySort(true);
			updateIndicators();
		});
	}

	applySort();
	updateIndicators();
}
