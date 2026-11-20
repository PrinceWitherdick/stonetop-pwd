// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { ledgerRowsHtml, selectedLedgerIds } from "../../module/utils/ledger-dialog.js";

const entries = [
	{ id: "a", action: "HP changed from 6 to 4", timestamp: 3, byGM: true },
	{ id: "b", action: "Longsword selected", timestamp: 2, byGM: false },
	{ id: "c", action: "Name set to Pim", timestamp: 1, byGM: false },
];

function render(canDelete) {
	const list = document.createElement("ol");
	list.innerHTML = ledgerRowsHtml(entries, canDelete);
	const row = (id) => list.querySelector(`.stonetop-ledger-entry[data-id="${id}"]`);
	const tick = (id) => { row(id).querySelector(".stonetop-ledger-row-check").checked = true; };
	return { list, row, tick };
}

describe("the ledger dialog's selection (#10, #21c)", () => {
	it("deletes only the ticked rows still on show", () => {
		const { list, row, tick } = render();
		tick("b");
		tick("c");
		// Filtered out of view after being ticked: it must not go with the visible ones.
		row("c").hidden = true;

		expect(selectedLedgerIds(list)).toEqual(["b"]);
	});

	it("locks a row the viewer may not delete, and never selects it", () => {
		const { list, row, tick } = render(entry => !entry.byGM);
		expect(row("a").querySelector(".stonetop-ledger-row-check").disabled).toBe(true);
		expect(row("b").querySelector(".stonetop-ledger-row-check").disabled).toBe(false);

		tick("a");
		tick("b");
		expect(selectedLedgerIds(list)).toEqual(["b"]);
	});

	// The box is the only control on its row and holds no words: without a name a screen reader
	// reads every row as the same unlabelled checkbox.
	it("names each row's box for its entry, and a locked one for why it is locked", () => {
		const { row } = render(entry => !entry.byGM);
		expect(row("b").querySelector(".stonetop-ledger-row-check").getAttribute("aria-label"))
			.toBe("Select: Longsword selected");
		expect(row("a").querySelector(".stonetop-ledger-row-check").getAttribute("aria-label"))
			.toBe("Select: HP changed from 6 to 4. Only the GM can delete an entry the GM made");
	});

	it("escapes an entry's words in the name", () => {
		const list = document.createElement("ol");
		list.innerHTML = ledgerRowsHtml([{ id: "x", action: `Named "<b>Pim</b>"`, timestamp: 1 }]);
		const box = list.querySelector(".stonetop-ledger-row-check");
		expect(box.getAttribute("aria-label")).toBe(`Select: Named "<b>Pim</b>"`);
		expect(list.querySelector("b")).toBeNull();
	});
});
