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
import { ledgerNoun } from "./ledger-core.js";
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

function buildRows(items) {
	if (!items.length) return `<li class="stonetop-ledger-empty">No ledger entries yet.</li>`;
	return items.map((entry, index, list) => {
		const date = ledgerDate(entry.timestamp);
		const previous = index > 0 ? ledgerDate(list[index - 1].timestamp).key : null;
		const header = date.key !== previous
			? `<li class="stonetop-ledger-date-header" data-date-key="${escHtml(date.key)}">${escHtml(date.label)}</li>`
			: "";
		// Subject and category are stamped here, from the entry itself, so the filter can read
		// them back off the row instead of re-deriving them from the rendered text — and so the
		// noun it matches on is character-for-character the one the dropdown offers.
		return `${header}<li class="stonetop-ledger-entry" data-id="${escHtml(entry.id)}" data-timestamp="${entry.timestamp ?? 0}" data-noun="${escHtml(ledgerNoun(entry.action))}" data-category="${escHtml(categoryForEntry(entry))}" data-date-key="${escHtml(date.key)}" data-date-label="${escHtml(date.label)}">
			<input type="checkbox" class="stonetop-ledger-row-check">
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

/**
 * Open the changes-ledger dialog for an actor.
 * @param {Actor}  actor   the steading / NPC actor whose ledger is shown
 * @param {object} ledger  a ledger class exposing getEntries(actor) and
 *                         deleteEntries(actor, idSet)
 */
export function openLedgerDialog(actor, ledger) {
	const entries = ledger.getEntries(actor);
	const nounOptions = ledgerNounOptionsHtml(entries);

	const content = `<div class="stonetop-ledger-container">
		<div class="stonetop-ledger-toolbar">
			<label class="stonetop-edit-toggle stonetop-ledger-edit-toggle" title="Edit entries">
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
			</button>
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
			<ol class="stonetop-ledger-list">${buildRows(entries)}</ol>
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
				const visibleRows = html.find(".stonetop-ledger-entry:not([hidden]) .stonetop-ledger-row-check");
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
				html.find(".stonetop-ledger-entry:not([hidden]) .stonetop-ledger-row-check")
					.prop("checked", ev.currentTarget.checked);
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
				const checked = [...html.find(".stonetop-ledger-row-check:checked")];
				if (!checked.length) return;

				const doDelete = async () => {
					const ids = new Set(
						checked.map(el => el.closest(".stonetop-ledger-entry").dataset.id)
					);
					checked.forEach(el => el.closest(".stonetop-ledger-entry")?.remove());
					refreshDateHeaders();
					syncDateHeaders();
					syncSelectAll();
					await ledger.deleteEntries(actor, ids);
				};

				if (checked.length === 1) {
					await doDelete();
					return;
				}

				const ok = await confirmOutcome({
					title:   "Delete Ledger Entries",
					content: `<p>You're about to delete ${checked.length} entries. They can't be brought back.</p>`,
					yes:     { label: `Delete ${checked.length} entries`, icon: "fa-trash" },
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
