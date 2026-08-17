// A proper, movable AppV1 window for editing a threat (its `threat` JournalEntryPage).
// Used instead of rendering the page sheet standalone — standalone JournalEntryPage
// sheets are malformed in v13/14 (they're built to render inside a journal, so the
// window frame and content positions diverge). This dialog behaves like every other
// Stonetop modal: draggable, resizable, auto-height.
//
// Editing writes straight to the page via data-doc-field / data-list handlers (no
// FormApplication submit), and the dialog re-renders when the page changes.
import { StonetopDialog } from "../utils/stonetop-dialog.js";
import { THREAT_TYPES, THREAT_PROXIMITIES, threatType, DEFAULT_PROXIMITY } from "./threat-types.js";
import { setThreatName } from "./threat-store.js";

const EMPTY_ROW = {
	grimPortents: () => ({ text: "", done: false }),
	nested: () => ({ name: "", type: "", instinct: "" }),
	customPlayerMoves: () => ({ label: "", text: "" }),
};

export class ThreatEditorDialog extends StonetopDialog {
	constructor(page, options = {}) {
		super(foundry.utils.mergeObject({ id: `stonetop-threat-editor-${page?.id}` }, options));
		this.page = page;
		// The advanced ("Stakes, GM moves & more") section's open state, persisted on the
		// instance so it survives the re-render every page.update triggers below — otherwise
		// adding/editing a row inside it would snap it shut and hide the row just added.
		this._moreOpen = false;
		// Keep the form in sync if the page changes elsewhere (tab toggle, another GM).
		this._onUpdate = (doc) => { if (doc?.id === this.page?.id && this.rendered) this.render(false); };
	}

	static get defaultOptions() {
		return foundry.utils.mergeObject(super.defaultOptions, {
			classes: ["stonetop", "stonetop-threat-editor-dialog"],
			template: "systems/stonetop-pwd/templates/dialogs/threat-editor.hbs",
			width: 460,
			height: "auto",
			resizable: true,
		});
	}

	get title() { return `Threat: ${this.page?.name ?? ""}`; }

	/**
	 * Register the page-sync hook on FIRST RENDER, not in the constructor.
	 *
	 * `close()` is the only thing that unregisters it, and close() only ever runs on a dialog
	 * that was rendered — so a ThreatEditorDialog constructed and then dropped (an early return,
	 * a throw between `new` and `render`) used to leak a live hook holding a strong reference to
	 * the dead dialog AND its page, and every later page update called into it. Binding here
	 * means the registration and its removal are on the same lifecycle.
	 *
	 * Idempotent: AppV1 re-renders call this repeatedly, and Hooks.on would happily add the same
	 * function again each time.
	 */
	async _render(force, options) {
		// `== null`, not falsy: a hook id of 0 is a VALID registration, and testing it for truth
		// would re-register on every re-render and unregister only one of them — the leak this
		// method exists to close.
		if (this._syncHookId == null) this._syncHookId = Hooks.on("updateJournalEntryPage", this._onUpdate);
		return super._render(force, options);
	}

	async close(options = {}) {
		if (this._syncHookId != null) {
			Hooks.off("updateJournalEntryPage", this._syncHookId);
			this._syncHookId = null;
		}
		// super.close (StonetopDialog) stops the FrontOnOpen lifecycle.
		return super.close(options);
	}

	getData() {
		const page = this.page;
		const sys = page.system ?? {};
		const proximity = sys.proximity || DEFAULT_PROXIMITY;
		const used = new Set((sys.gmMoves ?? []).map(m => String(m).trim()));
		// Index a string-list field into editable {index, value} rows.
		const rows = (arr) => (arr ?? []).map((v, index) => ({ index, value: String(v ?? "") }));
		return {
			id: page.id,
			uuid: page.uuid,
			name: page.name,
			moreOpen: this._moreOpen,
			system: sys,
			typeLabel: threatType(sys.type).label,
			typeOptions: THREAT_TYPES.map(t => ({ id: t.id, label: t.label, selected: t.id === sys.type })),
			proximityOptions: THREAT_PROXIMITIES.map(p => ({ id: p.id, label: p.label, selected: p.id === proximity })),
			suggestedMoves: threatType(sys.type).suggestedMoves.map(text => ({ text, used: used.has(text) })),
			grimPortents: (sys.grimPortents ?? []).map((p, index) => ({ index, text: p?.text ?? "", done: !!p?.done })),
			// "Things Below" fields (Book II): themes/aspects flavor a Thing; cleansing lists a
			// corrupted site's Make-a-Plan requirements.
			themes: rows(sys.themes),
			aspects: rows(sys.aspects),
			cleansing: rows(sys.cleansing),
			stakes: rows(sys.stakes),
			gmMoves: rows(sys.gmMoves),
			nested: (sys.nested ?? []).map((n, index) => ({ index, name: n?.name ?? "", type: n?.type ?? "", instinct: n?.instinct ?? "" })),
			customPlayerMoves: (sys.customPlayerMoves ?? []).map((m, index) => ({ index, label: m?.label ?? "", text: m?.text ?? "" })),
		};
	}

	activateListeners(html) {
		super.activateListeners(html);
		const root = html?.[0] ?? html;
		if (!root) return;

		root.addEventListener("change", async ev => {
			const scalar = ev.target.closest?.("[data-doc-field]");
			if (scalar) {
				const el = ev.target;
				const field = scalar.dataset.docField;
				// The name is the threat's identity across the page, the parent entry, and its
				// scene pins — route it through setThreatName so a rename isn't half-applied.
				if (field === "name") { await setThreatName(this.page, el.value); return; }
				await this.page.update({ [field]: el.type === "checkbox" ? el.checked : el.value });
				return;
			}
			const listEl = ev.target.closest?.(".threat-list[data-list]");
			if (listEl && ev.target.closest(".threat-list-row")) {
				await this.page.update({ [`system.${listEl.dataset.list}`]: this._collectList(root, listEl.dataset.list) });
			}
		});

		root.addEventListener("click", async ev => {
			if (ev.target.closest(".threat-editor-done")) return this.close();
			const add = ev.target.closest(".threat-list-add");
			if (add) { ev.preventDefault(); return this._addListRow(add.dataset.list); }
			const rem = ev.target.closest(".threat-list-remove");
			if (rem) { ev.preventDefault(); return this._removeListRow(rem.dataset.list, Number(rem.dataset.index)); }
			const chip = ev.target.closest(".threat-suggested__chip");
			if (chip) { ev.preventDefault(); return this._addGmMove(chip.dataset.suggestedMove); }
			const more = ev.target.closest(".threat-editor-more-toggle");
			if (more) {
				ev.preventDefault();
				// Persist the open state so it survives the next re-render (a page.update), and
				// flip the class now without waiting for one.
				this._moreOpen = !this._moreOpen;
				root.querySelector(".threat-editor-more")?.classList.toggle("is-open", this._moreOpen);
				more.classList.toggle("is-open", this._moreOpen);
			}
		});
	}

	_collectList(root, listName) {
		const listEl = root.querySelector(`.threat-list[data-list="${listName}"]`);
		if (!listEl) return [];
		const stringKind = listEl.dataset.kind === "string";
		const val = (row, field) => row.querySelector(`[data-field="${field}"]`)?.value ?? "";
		return [...listEl.querySelectorAll(".threat-list-row")].map(row => {
			if (stringKind) return val(row, "value");
			if (listName === "grimPortents") return { text: val(row, "text"), done: !!row.querySelector('[data-field="done"]')?.checked };
			if (listName === "nested") return { name: val(row, "name"), type: val(row, "type"), instinct: val(row, "instinct") };
			if (listName === "customPlayerMoves") return { label: val(row, "label"), text: val(row, "text") };
			return {};
		});
	}

	// Build the current list from the DOM (not the persisted doc) before mutating it, so a
	// row the user just typed into but hasn't blurred — or an edit whose `change` write is
	// still in flight — is carried into the add/remove write instead of being clobbered.
	_currentList(listName) {
		const root = this.element?.[0] ?? this.element;
		return root ? this._collectList(root, listName) : foundry.utils.deepClone(this.page.system?.[listName] ?? []);
	}

	async _addListRow(listName) {
		const cur = this._currentList(listName);
		cur.push(EMPTY_ROW[listName] ? EMPTY_ROW[listName]() : "");
		await this.page.update({ [`system.${listName}`]: cur });
	}

	async _removeListRow(listName, index) {
		const cur = this._currentList(listName);
		if (!Number.isInteger(index) || index < 0 || index >= cur.length) return;
		cur.splice(index, 1);
		await this.page.update({ [`system.${listName}`]: cur });
	}

	async _addGmMove(text) {
		const t = String(text ?? "").trim();
		if (!t) return;
		const cur = (this.page.system?.gmMoves ?? []).map(String);
		if (cur.some(m => m.trim() === t)) return;
		await this.page.update({ "system.gmMoves": [...cur, t] });
	}
}
