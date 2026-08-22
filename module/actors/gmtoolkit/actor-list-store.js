// The GM Toolkit's authored lists, written safely, once.
//
// Two tabs on this sheet keep a list the GM writes into: the "I wonder..." questions and the
// Encounters bundles. They stored different things and shared, line for line, the whole protocol
// for getting a change out of a text box and into the document — the queue, the whole-array write,
// the no-op contract, the swallow at the tail. Two copies of that is two places to fix a queue
// leak in, and they had already drifted on one point (which of them defaulted to a silent write).
//
// THE QUEUE IS THE POINT. Every mutation is expressed as a transform over the list AS IT STANDS
// WHEN ITS TURN COMES, never over a list captured when it was queued. A GM typing in one box and
// clicking a button in another produces two writes in the same tick, and if the second one had
// closed over the array the first one read, it would write that array back and undo the first
// edit. Chaining them means the second transform sees the first's result.
//
// THE WHOLE ARRAY, not a path into it. Foundry diffs an ArrayField by REPLACEMENT: there is no
// `system.wonders.2.answer` or `system.encounters.2.entries.0.note` write that means what it looks
// like it means. That is also why a transform is handed the list rather than an index.
//
// THE CHAIN NEVER REJECTS. The failure is absorbed at the tail, so one write that could not land
// (a lost permission, a closed world) does not wedge every write queued behind it for the rest of
// the session. It is reported once, to the console and to the GM.
import { error } from "../../utils/logger.js";
import { localize } from "../../utils/i18n.js";

export class ActorListStore {
	/**
	 * @param {object} sheet  The sheet instance. Held rather than copied, because the actor it
	 *   points at is the live document and every read has to see the latest one.
	 * @param {object} options
	 * @param {string} options.path  Where the list lives, e.g. `"system.encounters"`.
	 * @param {(row: object) => object} options.normalize  One row, in the shape the schema and the
	 *   sheet agree on. Applied on every read, so nothing downstream has to defend itself.
	 * @param {string} options.writeFailedKey  The i18n key for the toast when a write does not land.
	 */
	constructor(sheet, { path, normalize, writeFailedKey }) {
		this.sheet = sheet;
		this.path = path;
		this.normalize = normalize;
		this.writeFailedKey = writeFailedKey;
		// The tail of the write chain, so the next mutation reads the list the last one left.
		this.writes = null;
	}

	/** Every row, normalized. Read fresh on each call: this is the live document. */
	list() {
		const rows = foundry.utils.getProperty(this.sheet.actor ?? {}, this.path);
		return Array.isArray(rows) ? rows.map(row => this.normalize(row)) : [];
	}

	/** One row by id, or null. */
	get(id) {
		return this.list().find(row => row.id === id) ?? null;
	}

	/**
	 * Apply `transform` to the list and save the result.
	 *
	 * @param {(list: object[]) => object[]|null} transform  Return null to write nothing, which is
	 *   how a no-op edit stays off the wire.
	 * @param {object}  [options]
	 * @param {boolean} [options.render=true]  False for text edits, which must not pull the DOM
	 *   out from under the caret that is still in it.
	 * @returns {Promise<boolean>} Whether the write landed — true for a no-op too, since there
	 *   was nothing that failed to be written. The chain itself still never rejects; a caller that
	 *   has to know (the notes pop-up, which must not record a refused edit as saved) reads this
	 *   instead of a rejection it would otherwise have to be given back at the cost of the
	 *   swallow.
	 */
	mutate(transform, { render = true } = {}) {
		const run = async () => {
			const next = transform(this.list());
			if (!next) return true;
			await this.sheet.actor.update({ [this.path]: next }, render ? {} : { render: false });
			return true;
		};
		this.writes = (this.writes ?? Promise.resolve()).then(run).catch(err => {
			error(`failed to write ${this.path}`, err);
			ui.notifications?.error?.(localize(this.writeFailedKey));
			return false;
		});
		return this.writes;
	}

	/** Set one field of one row. No write at all when the value is unchanged. */
	setField(id, key, value, { render = false } = {}) {
		return this.mutate(list => {
			const i = list.findIndex(row => row.id === id);
			if (i < 0 || list[i][key] === value) return null;
			list[i] = { ...list[i], [key]: value };
			return list;
		}, { render });
	}

	/** Drop one row for good. */
	remove(id) {
		return this.mutate(list => {
			const next = list.filter(row => row.id !== id);
			return next.length === list.length ? null : next;
		});
	}

	/**
	 * Save what is being TYPED before the sheet is redrawn under it.
	 *
	 * Both tabs that keep a list here have text fields that save on BLUR, and this sheet has a
	 * redraw that does not wait for one: `_wirePrepPageSync` re-renders it on every threat, hazard
	 * and site write anywhere in the world. A GM part-way through a sentence when another client
	 * ticks a grim portent would otherwise watch it revert, with nothing logged and nothing to
	 * undo. Both tabs had their own copy of this, comment and all, which is two places to fix the
	 * ordering in and a third to write for the next delegated list tab.
	 *
	 * ONE FIELD AT MOST, because at most one thing has focus. The `:focus` query is what decides,
	 * so the order of `fields` does not matter and a sheet with nothing focused costs one
	 * querySelector.
	 *
	 * Reading the DOM here is correct, and is the one case where it is: unwritten keystrokes live
	 * ONLY in the box. The trap this pattern has (a pre-render flush reads the previous paint, so
	 * it can write stale state back over a fresh write) applies to fields a CLICK already
	 * committed to the document; these have none, and `setField` no-ops on an unchanged value, so
	 * a flush with nothing to say costs nothing.
	 *
	 * @param {HTMLElement|null} root  The sheet's root; a missing one is a no-op.
	 * @param {Array<{selector: string, required?: boolean, save: (field: HTMLElement) => any}>} fields
	 *   `required` refuses an emptied box rather than saving the blank — the same refusal the tab's
	 *   own `change` handler makes. Nothing is put back, because the repaint about to happen
	 *   restores the box from the document.
	 */
	async flushFocused(root, fields = []) {
		if (!root || !fields.length) return;
		const field = root.querySelector(fields.map(f => `${f.selector}:focus`).join(", "));
		if (!field) return;
		const spec = fields.find(f => field.matches(f.selector));
		if (!spec) return;
		if (spec.required && !String(field.value ?? "").trim()) return;
		await spec.save(field);
	}
}
