// Shared "changes ledger" dialog, opened from the Ledger header button on the
// steading and NPC sheets. Both wear the same toolbar (edit toggle, select-all,
// delete, search, subject filter, sort) over a date-grouped entry list, so the
// markup and wiring live here once and are parameterised by the actor and its
// ledger class (any of CharacterLedger / SteadingLedger / NpcLedger — each exposes
// the same `getEntries` / `deleteEntries` surface).
import { escHtml } from "./strings.js";
import { confirmOutcome } from "./ask-with-buttons.js";
import { ledgerNounOptionsHtml, wireLedgerFilters } from "./ledger-filter.js";
import { categoryForEntry } from "./ledger-categories.js";
import { ledgerSubject, canDeleteLedgerEntry } from "./ledger-core.js";
import { attachFrontOnOpen } from "./front-on-open.js";

function ledgerDate(timestamp) {
	const date = timestamp ? new Date(timestamp) : null;
	if (!date || Number.isNaN(date.getTime())) return { key: "unknown", label: "Unknown date" };
	const key = [
		date.getFullYear(),
		String(date.getMonth() + 1).padStart(2, "0"),
		String(date.getDate()).padStart(2, "0"),
	].join("-");
	return {
		key,
		label: date.toLocaleDateString(undefined, {
			weekday: "long",
			year:    "numeric",
			month:   "long",
			day:     "numeric",
		}),
	};
}

/**
 * The ledger's rows. `canDelete(entry)` decides each row's checkbox: a row the viewer may not
 * delete (a GM's entry, for a player) gets a disabled one, so select-all and Delete pass it by.
 */
export function ledgerRowsHtml(items, canDelete = () => true) {
	if (!items.length) return `<li class="stonetop-ledger-empty">No ledger entries yet.</li>`;
	return items.map((entry, index, list) => {
		const date = ledgerDate(entry.timestamp);
		const previous = index > 0 ? ledgerDate(list[index - 1].timestamp).key : null;
		const header = date.key !== previous
			? `<li class="stonetop-ledger-date-header" data-date-key="${escHtml(date.key)}">${escHtml(date.label)}</li>`
			: "";
		const locked = !canDelete(entry);
		// Subject and category are stamped here, from the entry itself, so the filter can read
		// them back off the row instead of re-deriving them from the rendered text — and so the
		// noun it matches on is character-for-character the one the dropdown offers.
		return `${header}<li class="stonetop-ledger-entry" data-id="${escHtml(entry.id)}" data-timestamp="${entry.timestamp ?? 0}" data-noun="${escHtml(ledgerSubject(entry))}" data-category="${escHtml(categoryForEntry(entry))}" data-date-key="${escHtml(date.key)}" data-date-label="${escHtml(date.label)}">
			<input type="checkbox" class="stonetop-ledger-row-check"${locked ? ` disabled title="Only the GM can delete an entry the GM made"` : ""}>
			<div class="stonetop-ledger-entry-content">
				<div class="stonetop-ledger-entry-main">${escHtml(entry.action)}${entry.move ? ` <span class="stonetop-ledger-entry-move">via ${escHtml(entry.move)}</span>` : ""}</div>
				<div class="stonetop-ledger-entry-user">Changed by ${escHtml(entry.userName)}</div>
				<div class="stonetop-ledger-entry-meta">
					<span>${escHtml(entry.timestamp ? new Date(entry.timestamp).toLocaleString() : "")}</span>
				</div>
			</div>
		</li>`;
	}).join("");
}

/** The rows a Delete can take: on show and deletable. */
const SELECTABLE = ".stonetop-ledger-entry:not([hidden]) .stonetop-ledger-row-check:not(:disabled)";
/** The rows whose checkbox is ticked AND that are on show and deletable. */
const SELECTED_ROW_CHECKS = `${SELECTABLE}:checked`;

/**
 * The ids of the rows a Delete would take: ticked, on show, deletable. Only what is ON SHOW: a row
 * ticked and then filtered out of view used to be deleted along with the visible ones, unseen,
 * and counted in the confirmation as though the player could see it.
 */
export function selectedLedgerIds(root) {
	return [...root.querySelectorAll(SELECTED_ROW_CHECKS)]
		.map(el => el.closest(".stonetop-ledger-entry")?.dataset.id)
		.filter(Boolean);
}

/**
 * Open the changes-ledger dialog for an actor.
 * @param {Actor}  actor   the steading / NPC actor whose ledger is shown
 * @param {object} ledger  a ledger class exposing getEntries(actor) and
 *                         deleteEntries(actor, idSet)
 */
export function openLedgerDialog(actor, ledger) {
	const entries = ledger.getEntries(actor);
	const nounOptions = ledgerNounOptionsHtml(entries);
	// The same rule deleteEntries applies (canDeleteLedgerEntry): an observer gets no editing at
	// all, and a player cannot tick a GM's entry. The write is refused anyway; this keeps the
	// dialog from offering what it cannot do.
	const canDelete = (entry) => canDeleteLedgerEntry(actor, entry);
	const mayEdit = entries.some(canDelete);

	const content = `<div class="stonetop-ledger-container">
		<div class="stonetop-ledger-toolbar stonetop-field-btns">
			${mayEdit ? `<label class="stonetop-edit-toggle stonetop-ledger-edit-toggle" title="Edit entries">
				<input type="checkbox" class="stonetop-ledger-edit-check">
				<span class="stonetop-toggle-track">
					<span class="stonetop-toggle-thumb"><i class="fas fa-pen"></i></span>
				</span>
			</label>
			<label class="stonetop-ledger-select-all-label" title="Select all">
				<input type="checkbox" class="stonetop-ledger-select-all">
			</label>
			<button type="button" class="stonetop-ledger-delete-selected">
				<i class="fas fa-trash"></i> Delete
			</button>` : ""}
			<input type="search" class="stonetop-ledger-search" placeholder="Filter entries…">
			<select class="stonetop-ledger-noun" title="Filter by subject">
				<option value="">All changes</option>
				${nounOptions}
			</select>
			<select class="stonetop-ledger-sort">
				<option value="desc">Newest first</option>
				<option value="asc">Oldest first</option>
			</select>
		</div>
		<section class="stonetop-ledger-dialog">
			<ol class="stonetop-ledger-list">${ledgerRowsHtml(entries, canDelete)}</ol>
		</section>
	</div>`;

	const ledgerDialog = new Dialog({
		title: `${actor.name}: Ledger`,
		content,
		buttons: {},
		render: (html) => {
			const container   = html.find(".stonetop-ledger-container")[0];
			const list = html.find(".stonetop-ledger-list")[0];
			const selectAllEl = html.find(".stonetop-ledger-select-all")[0];

			const createDateHeader = (dateKey, dateLabel) => {
				const header = document.createElement("li");
				header.className = "stonetop-ledger-date-header";
				header.dataset.dateKey = dateKey;
				header.textContent = dateLabel;
				return header;
			};

			const refreshDateHeaders = () => {
				list.querySelectorAll(".stonetop-ledger-date-header").forEach(el => el.remove());
				let previous = null;
				for (const entry of [...list.querySelectorAll(".stonetop-ledger-entry")]) {
					const dateKey = entry.dataset.dateKey ?? "unknown";
					if (dateKey === previous) continue;
					list.insertBefore(createDateHeader(dateKey, entry.dataset.dateLabel ?? "Unknown date"), entry);
					previous = dateKey;
				}
			};

			const syncDateHeaders = () => {
				for (const header of list.querySelectorAll(".stonetop-ledger-date-header")) {
					let sibling = header.nextElementSibling;
					let hasVisibleEntry = false;
					while (sibling && !sibling.classList.contains("stonetop-ledger-date-header")) {
						if (sibling.classList.contains("stonetop-ledger-entry") && !sibling.hidden) {
							hasVisibleEntry = true;
							break;
						}
						sibling = sibling.nextElementSibling;
					}
					header.hidden = !hasVisibleEntry;
				}
			};

			const syncSelectAll = () => {
				if (!selectAllEl) return;
				const visibleRows = html.find(SELECTABLE);
				const total   = visibleRows.length;
				const checked = visibleRows.filter(":checked").length;
				selectAllEl.checked       = checked === total && total > 0;
				selectAllEl.indeterminate = checked > 0 && checked < total;
			};

			html.find(".stonetop-ledger-edit-check").on("change", ev => {
				container.classList.toggle("stonetop-ledger-edit-mode", ev.currentTarget.checked);
				if (!ev.currentTarget.checked) {
					html.find(".stonetop-ledger-row-check").prop("checked", false);
					syncSelectAll();
				}
			});

			html.find(".stonetop-ledger-select-all").on("change", ev => {
				html.find(SELECTABLE).prop("checked", ev.currentTarget.checked);
			});

			html[0].addEventListener("change", ev => {
				if (ev.target.closest(".stonetop-ledger-row-check")) syncSelectAll();
			});

			wireLedgerFilters(html, () => { syncDateHeaders(); syncSelectAll(); });

			html.find(".stonetop-ledger-sort").on("change", ev => {
				const asc  = ev.currentTarget.value === "asc";
				const tagged = [...list.querySelectorAll(".stonetop-ledger-entry")]
					.map(el => [el, Number(el.dataset.timestamp)]);
				tagged.sort(([, ta], [, tb]) => asc ? ta - tb : tb - ta);
				tagged.forEach(([el]) => list.appendChild(el));
				refreshDateHeaders();
				syncDateHeaders();
			});

			html.find(".stonetop-ledger-delete-selected").on("click", async () => {
				const selected = selectedLedgerIds(list);
				if (!selected.length) return;

				// Rows come off once the write has landed, and only the rows it actually deleted:
				// taken off first, a refused write (a player without the right) left the dialog
				// showing them gone while the ledger kept them.
				const doDelete = async () => {
					let deleted;
					try {
						deleted = await ledger.deleteEntries(actor, new Set(selected));
					} catch (err) {
						console.error("Stonetop | could not delete ledger entries", err);
						ui.notifications?.error?.("Those ledger entries could not be deleted.");
						return;
					}
					for (const id of deleted ?? []) {
						list.querySelector(`.stonetop-ledger-entry[data-id="${CSS.escape(id)}"]`)?.remove();
					}
					refreshDateHeaders();
					syncDateHeaders();
					syncSelectAll();
				};

				if (selected.length === 1) {
					await doDelete();
					return;
				}

				const ok = await confirmOutcome({
					title:   "Delete Ledger Entries",
					content: `<p>You're about to delete ${selected.length} entries. They can't be brought back.</p>`,
					yes:     { label: `Delete ${selected.length} entries`, icon: "fa-trash" },
					no:      { label: "Keep them" },
					classes: ["stonetop-ledger-child"],
				});
				if (ok) await doDelete();
			});
		},
	}, {
		width: 560,
		height: 640,
		// "stonetop" is what carries our window chrome — the header bar, the content background,
		// the focus glow, and the font-scale setting the whole ledger inherits. It is scoped to
		// that class precisely so none of it can bleed onto core or another module's windows, so
		// omitting it here left the Chronicle wearing Foundry's default dark header and parchment
		// while every other window in the system wore ours.
		classes: ["dialog", "stonetop", "stonetop-ledger-window"],
	});
	attachFrontOnOpen(ledgerDialog);
	ledgerDialog.render(true);
}
