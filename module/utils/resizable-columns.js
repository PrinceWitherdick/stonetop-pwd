import { resolveResidentsGrid, readStoredColumnState, writeStoredColumnState } from "./steading-column-util.js";
import { SYSTEM_ID } from "../system-id.js";

const MIN_COL_WIDTH = 50;
const STORAGE_PREFIX = `${SYSTEM_ID}.columnWidths.`;

/**
 * Lets users drag-resize the columns of a `.steading-residents-table` (the
 * grid-based Players/Residents/Neighbors tables on the steading sheet), and
 * persists the chosen widths in localStorage so they survive re-renders.
 *
 * All resizable columns get a fixed pixel width except the last one, which
 * stays `minmax(0, 1fr)` and absorbs whatever space remains — mirroring how
 * spreadsheet/table UIs let you shrink one column to reveal more of another.
 * The trailing actions column is always fixed at 32px and never resizable.
 *
 * @param {HTMLElement} table       - the `.steading-residents-table` wrapper
 * @param {string}      storageKey  - unique key (e.g. "players", "neighbors")
 */
export function makeColumnsResizable(table, storageKey) {
	const grid = resolveResidentsGrid(table);
	if (!grid) return;
	const { header, list } = grid;

	const headerCells = Array.from(header.children)
		.filter(cell => !cell.classList.contains("steading-residents-col-actions"));
	if (headerCells.length < 2) return;

	// Idempotent, so no caller has to know whether someone else got there first: a sheet
	// that wires every `[data-resize-key]` table generically and a shared component that
	// wires its own would otherwise stack two sets of drag listeners on the same table.
	// A re-render builds fresh elements, so the flag never leaks across renders.
	if (table.dataset.stColumnsResizable) return;
	table.dataset.stColumnsResizable = "1";

	// Most columns hold shrinkable text, so the generic floor is fine. A column whose
	// content is a row of fixed-size controls has to declare its own: the relationship
	// hearts are five 18px masks that neither shrink nor wrap, and the cell centres its
	// overflow, so squeezing the track below their width clips the FIRST and LAST heart
	// out of reach — and since a rating is set by clicking heart N, that silently makes
	// 5-heart (and 1-heart) ratings unreachable. The header cell states its floor via
	// data-col-min; everything else keeps MIN_COL_WIDTH.
	const minWidths = headerCells.map(cell => {
		const declared = Number(cell.dataset?.colMin);
		return Number.isFinite(declared) && declared > 0 ? declared : MIN_COL_WIDTH;
	});

	const storageId = `${STORAGE_PREFIX}${storageKey}`;
	let widths = null;
	const saved = readStoredColumnState(storageId);
	// Clamp on restore too — a width persisted before a floor existed (or under an older
	// layout) would otherwise keep the column broken across reloads with no way back.
	if (Array.isArray(saved) && saved.length === headerCells.length && saved.every(Number.isFinite)) {
		widths = saved.map((w, i) => Math.max(minWidths[i], w));
	}

	// Tables with a trailing fixed actions column (the steading's Players/Residents/
	// Neighbors) reserve a final 32px track for it; tables without one (the NPC sheet's
	// Relationships table) don't, so the last resizable column absorbs all the slack.
	const hasActions = !!header.querySelector(":scope > .steading-residents-col-actions");

	const applyTemplate = () => {
		if (!widths) return;
		const columns = widths.map((w, i) => i === widths.length - 1 ? "minmax(0, 1fr)" : `${Math.round(w)}px`);
		if (hasActions) columns.push("32px");
		const template = columns.join(" ");
		header.style.gridTemplateColumns = template;
		list.querySelectorAll(":scope > .steading-residents-row").forEach(row => {
			row.style.gridTemplateColumns = template;
		});
	};

	const persist = () => writeStoredColumnState(storageId, widths);

	// The table may be on a hidden tab when this runs, so rendered widths read
	// as 0 — only measure them lazily, at drag start, once it's actually visible.
	const ensureWidths = () => {
		if (widths) return;
		widths = headerCells.map(cell => cell.getBoundingClientRect().width);
	};

	applyTemplate();

	headerCells.slice(0, -1).forEach((cell, index) => {
		const handle = document.createElement("div");
		handle.className = "steading-col-resize-handle";
		cell.classList.add("steading-residents-col-resizable");
		cell.appendChild(handle);

		let startX = 0;
		let startWidth = 0;

		const onMove = ev => {
			widths[index] = Math.max(minWidths[index], startWidth + (ev.clientX - startX));
			applyTemplate();
		};
		const onUp = ev => {
			handle.releasePointerCapture(ev.pointerId);
			handle.removeEventListener("pointermove", onMove);
			handle.removeEventListener("pointerup", onUp);
			handle.classList.remove("is-dragging");
			persist();
		};

		handle.addEventListener("pointerdown", ev => {
			ev.preventDefault();
			ev.stopPropagation();
			ensureWidths();
			applyTemplate();
			startX = ev.clientX;
			startWidth = widths[index];
			handle.setPointerCapture(ev.pointerId);
			handle.classList.add("is-dragging");
			handle.addEventListener("pointermove", onMove);
			handle.addEventListener("pointerup", onUp);
		});
	});
}
