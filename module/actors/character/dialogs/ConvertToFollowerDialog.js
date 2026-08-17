import { StonetopDialog } from "../../../utils/stonetop-dialog.js";
import { normalizeTags } from "../../../data/follower-build.js";

// ── ConvertToFollowerDialog ──────────────────────────────────────────────────
// Shared machinery for the two "drop an actor → make it a follower" modals (Monster, NPC; Book I,
// NPCs & Followers, p.475). Both are compact, content-hugging forms with the same added-tags
// editor, cost / pronoun / group-size controls, and finish-capture; they differ only in their
// CSS-class infix, the actor's own "kept" tags, their getData, and the builder called on finish.
// Subclasses provide:
//   • get _sel()   — the class infix ("mf" | "nf") used by every control selector below.
//   • _keptTags()  — the actor's own tags (kept as-is), so an added tag can't duplicate one.
//   • getData()    — the actor-specific view.
//   • _finish()    — capture any actor-specific fields, call _captureCommonFields(), build + apply.
// A subclass that adds its own controls (the NPC's editable HP/armor/damage) overrides
// activateListeners, calling super() first so the shared wiring still runs.
export class ConvertToFollowerDialog extends StonetopDialog {
	get _autoHeight() { return true; }

	/** The CSS-class infix for this dialog's controls (`.stonetop-<sel>-*`). */
	get _sel() { return ""; }

	/** The actor's own tags, kept as-is; added tags de-dupe against these. */
	_keptTags() { return []; }

	activateListeners(html) {
		super.activateListeners(html);
		this._bindFollowerControls(html);
	}

	// Wire the controls common to both modals: cancel / create, the added-tags editor, the cost
	// example-chips + free input, the pronoun field, and the group toggle + size.
	_bindFollowerControls(html) {
		const sel = this._sel;
		html.find(`.stonetop-${sel}-cancel`).on("click", () => this.close());
		html.find(`.stonetop-${sel}-create`).on("click", () => this._finish());

		// Added tags: chips toggle off, free input adds.
		html.find(`.stonetop-${sel}-added-tag`).on("click", ev => this._removeTag(ev.currentTarget.dataset.tag));
		html.find(`.stonetop-${sel}-tag-add`).on("click", () => this._addTagFromInput(html));
		html.find(`.stonetop-${sel}-tag-input`).on("keydown", ev => {
			if (ev.key === "Enter") { ev.preventDefault(); this._addTagFromInput(html); }
		});

		// Cost: example chip sets it; free input overrides.
		html.find(`.stonetop-${sel}-cost-ex`).on("click", ev => { this._cost = ev.currentTarget.dataset.value; this.render(false); });
		html.find(`.stonetop-${sel}-cost-input`).on("change", ev => { this._cost = ev.currentTarget.value; });

		html.find(`.stonetop-${sel}-pronoun`).on("change", ev => { this._pronoun = ev.currentTarget.value; });

		// Group toggle + size (re-render so the size field shows/hides).
		html.find(`.stonetop-${sel}-group-toggle`).on("change", ev => { this._isGroup = ev.currentTarget.checked; this.render(false); });
		html.find(`.stonetop-${sel}-group-size`).on("change", ev => { this._groupSize = Math.max(2, parseInt(ev.currentTarget.value, 10) || 2); });
	}

	_removeTag(tag) {
		const t = String(tag ?? "").toLowerCase();
		this._addedTags = this._addedTags.filter(x => x.toLowerCase() !== t);
		this.render(false);
	}

	_addTagFromInput(html) {
		const input = html.find(`.stonetop-${this._sel}-tag-input`)[0];
		if (!input) return;
		// De-dupe against the actor's own kept tags too, so an added tag can't double.
		const kept = this._keptTags();
		const merged = normalizeTags([...this._addedTags, ...normalizeTags(input.value)])
			.filter(t => !kept.some(k => k.toLowerCase() === t.toLowerCase()));
		this._addedTags = merged;
		input.value = "";
		this.render(false);
	}

	// Capture the cost / pronoun / group-size fields that may be focused-but-unblurred when the
	// player clicks Create. Subclass _finish() calls this (after capturing its own extra fields).
	_captureCommonFields(root) {
		if (!root) return;
		const costEl = root.querySelector(`.stonetop-${this._sel}-cost-input`);
		if (costEl && costEl.value.trim()) this._cost = costEl.value.trim();
		const pronEl = root.querySelector(`.stonetop-${this._sel}-pronoun`);
		if (pronEl) this._pronoun = pronEl.value;
		const sizeEl = root.querySelector(`.stonetop-${this._sel}-group-size`);
		if (sizeEl) this._groupSize = Math.max(2, parseInt(sizeEl.value, 10) || 2);
	}

	/** The group size to bake into the built follower (0 when it's not a group). */
	_buildGroupSize() { return this._isGroup ? this._groupSize : 0; }
}
