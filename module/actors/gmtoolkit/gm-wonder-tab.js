// The GM Toolkit's "I wonder..." tab — the running list of open questions from Book I p.33, and
// the one thing on this sheet a GM AUTHORS rather than reads.
//
// STORAGE IS THE TOOLKIT'S OWN, unlike the Threats and Sites tabs next door. Those moved here
// from the steading and left their JournalEntryPages behind, so every call in gm-prep-tabs.js has
// to resolve the steading first (its header says so at length). This list has no such history:
// it is a flat array on `actor.system.wonders` (module/data-models/fields.js), and `this.actor`
// is the right document. Storing it on the toolkit rather than on the User is deliberate for the
// same reason the toolkit is a singleton — a world has one set of open questions whoever is
// running it, and a second GM opening their own toolkit should see the same list.
//
// TWO KINDS OF WRITE, and the difference matters:
//
//   STRUCTURAL (add, remove, settle, reopen) re-renders. The list the GM is looking at changed
//   shape, so the sheet has to be redrawn to show it.
//
//   TEXT (editing a question, writing an answer) does NOT, and passes `{ render: false }`. These
//   save on `change`, which fires on BLUR — and blur is usually the GM tabbing or clicking into
//   the next field. An actor update re-renders every sheet showing that actor, which would tear
//   out the node that just took focus and put the caret back at the top of the tab. The box the
//   GM is looking at already holds the text that was saved, so there is nothing for a render to
//   show them. The cost is that a SECOND GM with the toolkit open does not see the typing until
//   something else redraws their copy, which is the right trade on a sheet only GMs can open.
//
// WRITES ARE SERIALIZED, which is not belt-and-braces. Clicking "answered" on one row blurs the
// answer box of another, so the browser fires `change` (an async write) and then `click` (a second
// async write) in that order with nothing between them. Both would read `actor.system.wonders`
// before either landed, and the second to finish would win: the answer just typed would vanish
// with no error. `_mutateWonders` therefore takes a TRANSFORM rather than a finished array, and
// runs it at the front of a promise chain so it always reads the list the previous write left.
import { GM_WONDER_GUIDE } from "../../gm-toolkit/gm-wonder-guide.js";
import { escHtml } from "../../utils/strings.js";
import { localize, format } from "../../utils/i18n.js";

/**
 * The tab's two edit sections, one per list, each with its own pencil in its own corner.
 *
 * Named here rather than spelt out at their call sites because they are a JOIN: the template
 * reads them off `stonetop.edit`, and the sheet's `isSectionEditable` is keyed by the same
 * strings. A typo in either half gives a section that can never be unlocked, with nothing logged.
 */
const WONDER_SECTION = { open: "wonderOpen", settled: "wonderSettled" };

/**
 * One entry, in the shape the sheet and the schema agree on.
 *
 * `keepId: false` mints a new id, which is what the add path wants; every other path keeps the
 * one already there. Same shape and same reasoning as `_normalizeWound` on the character.
 */
function normalizeWonder(w = {}, { keepId = true } = {}) {
	return {
		id:       (keepId && w.id) ? w.id : foundry.utils.randomID(),
		question: typeof w.question === "string" ? w.question : "",
		answer:   typeof w.answer === "string" ? w.answer : "",
		settled:  !!w.settled,
	};
}

export function withGmWonderTab(Base) {
	return class GmWonderTab extends Base {
		/**
		 * The tail of the write chain, so the next mutation reads the list the last one left.
		 * See the header. Never rejects: `_mutateWonders` absorbs the failure at the tail, which
		 * is what keeps one failed write from wedging every write after it.
		 *
		 * The name is checked against AppV1's own members, as every field on this sheet has to be:
		 * a collision there is silent. `_wonderWrites` collides with nothing in Application,
		 * FormApplication or ActorSheet.
		 */
		_wonderWrites = null;

		/**
		 * The add bar's unfiled line, and whether the caret belongs back in it.
		 *
		 * Everything else on this tab is saved to the document before a repaint, because
		 * everything else on this tab IS a saved question. The add bar is not: what is in it is a
		 * line the GM has not yet said to file, and filing it on a repaint they did not ask for
		 * would put a fragment in the list under an id of its own, which they would then have to
		 * find and delete. So it is carried over the render in memory instead, and put back into
		 * the fresh box by `_restoreGmWonderAdd`.
		 *
		 * `focus` is the same journey for the caret, and is why the add path does not simply focus
		 * the node it already has — see `_onWonderAdd`.
		 *
		 * Checked against AppV1's own members, as every field on this sheet has to be: a collision
		 * there is silent. `_wonderAdd` collides with nothing in Application, FormApplication or
		 * ActorSheet.
		 */
		_wonderAdd = { text: "", focus: false };

		/** Every entry, normalized. Read fresh on each call — this is the live document. */
		_wonderList() {
			const list = this.actor?.system?.wonders;
			return Array.isArray(list) ? list.map(w => normalizeWonder(w)) : [];
		}

		/** One entry by id, or null. */
		_wonder(id) {
			return this._wonderList().find(w => w.id === id) ?? null;
		}

		/**
		 * Apply `transform` to the list and save the result.
		 *
		 * @param {(list: object[]) => object[]|null} transform  Runs against the list as it stands
		 *   when this write's turn comes, NOT when it was queued (see the header). Return null to
		 *   write nothing, which is how a no-op edit stays off the wire.
		 * @param {object}  [options]
		 * @param {boolean} [options.render=true]  False for text edits — see the header.
		 */
		_mutateWonders(transform, { render = true } = {}) {
			const run = async () => {
				const next = transform(this._wonderList());
				if (!next) return;
				// The whole array, not a path into it. Foundry diffs an ArrayField by REPLACEMENT
				// (there is no `system.wonders.2.answer` write that means what it looks like it
				// means), which is also why the transform gets the list rather than an index.
				await this.actor.update({ "system.wonders": next }, render ? {} : { render: false });
			};
			this._wonderWrites = (this._wonderWrites ?? Promise.resolve()).then(run).catch(err => {
				console.error("Stonetop | failed to write the I wonder list", err);
				ui.notifications?.error?.(localize("stonetop.gmToolkit.wonder.writeFailed"));
			});
			return this._wonderWrites;
		}

		/**
		 * Add a question.
		 *
		 * Trimmed here rather than by the schema, which keeps `trim: false` (see fields.js): the
		 * padding around a freshly typed line is a slip, while the padding inside a saved one is
		 * whatever the GM left there.
		 *
		 * @returns {Promise<boolean>}  false if there was nothing to add, so the caller knows not
		 *   to clear the field it was typed into.
		 */
		async _addWonder(text) {
			const question = String(text ?? "").trim();
			if (!question) return false;
			await this._mutateWonders(list => [...list, normalizeWonder({ question }, { keepId: false })]);
			return true;
		}

		/** Edit one field of one entry. No write at all when the value is unchanged. */
		_setWonderField(id, key, value) {
			return this._mutateWonders(list => {
				const i = list.findIndex(w => w.id === id);
				if (i < 0 || list[i][key] === value) return null;
				list[i] = { ...list[i], [key]: value };
				return list;
			}, { render: false });
		}

		/** Move an entry into the Answered fold, or back out of it. */
		_setWonderSettled(id, settled) {
			return this._mutateWonders(list => {
				const i = list.findIndex(w => w.id === id);
				if (i < 0 || list[i].settled === settled) return null;
				list[i] = { ...list[i], settled };
				return list;
			});
		}

		/** Drop an entry for good. */
		_removeWonder(id) {
			return this._mutateWonders(list => {
				const next = list.filter(w => w.id !== id);
				return next.length === list.length ? null : next;
			});
		}

		/**
		 * Is the pencil on for the section this entry is RENDERED IN? The one gate on the three
		 * structural buttons.
		 *
		 * Which section that is comes off the entry's own `settled` flag rather than off the DOM,
		 * because that flag is what the context split the two lists by: a row is in the Answered
		 * box exactly when it is settled, so the two can never disagree. Walking up from the
		 * clicked button to find the box would be the same answer read from the less reliable
		 * copy — and the buttons themselves already say which list they are in (only the open
		 * list has a tick, only the answered one an arrow), which is why the trash is the button
		 * that needs asking at all.
		 *
		 * A method rather than a read of `stonetop.edit`, because the click handlers run against
		 * the sheet and not against a render's context.
		 */
		_wonderEditing(id) {
			const section = this._wonder(id)?.settled ? WONDER_SECTION.settled : WONDER_SECTION.open;
			return this.isSectionEditable(section);
		}

		/** Publish the tab's context. Call from the host's getData. */
		_addGmWonderContext(context) {
			const all = this._wonderList();
			context.stonetop.wonders = {
				open:    all.filter(w => !w.settled),
				settled: all.filter(w => w.settled),
			};
			// MERGED, never assigned over: the prep mixin publishes `threats` and `sites` into this
			// same object, and whichever of the two ran second would drop the other's flags — which
			// renders those sections permanently read-only with nothing logged. `_addGmPrepContext`
			// states the rule at length and merges for the same reason.
			context.stonetop.edit = {
				...(context.stonetop.edit ?? {}),
				[WONDER_SECTION.open]:    this.isSectionEditable(WONDER_SECTION.open),
				[WONDER_SECTION.settled]: this.isSectionEditable(WONDER_SECTION.settled),
			};
			// Static reference, straight off the frozen table. Not localized, for the same reason
			// the agenda and the principles are not: it is transcribed book text, and translating
			// it is a pass over the books rather than over the language file.
			context.stonetop.wonderGuide = GM_WONDER_GUIDE;
		}

		/**
		 * The tab's interactions, delegated on the sheet root: the add bar, the two text fields,
		 * and the three per-row buttons.
		 *
		 * Delegated rather than bound per element because every one of these nodes is re-emitted
		 * whenever the tab re-renders, which a structural write does on purpose.
		 */
		_activateGmWonderListeners(root) {
			if (!root) return;

			// Before any of them: this render's add bar is a new, empty node, and whatever was
			// half-typed into the last one is still only in memory.
			this._restoreGmWonderAdd(root);

			root.addEventListener("click", async ev => {
				if (ev.target.closest(".stonetop-gm-wonder-add-btn")) {
					ev.preventDefault();
					return this._onWonderAdd(root);
				}

				// The three structural buttons, each behind its own list's pencil. The template does
				// not draw them at all while that pencil is off, so this is the second lock and not
				// the first — but a delegated handler outlives the markup it was written against (a
				// re-render lands new nodes under the same listener), and "the button isn't there"
				// is a claim about CSS that this file cannot check.
				const settle = ev.target.closest(".stonetop-gm-wonder-settle, .stonetop-gm-wonder-reopen");
				if (settle) {
					ev.preventDefault();
					const id = this._wonderIdFrom(settle);
					if (id && this._wonderEditing(id)) {
						await this._setWonderSettled(id, settle.matches(".stonetop-gm-wonder-settle"));
					}
					return;
				}

				const remove = ev.target.closest(".stonetop-gm-wonder-remove");
				if (remove) {
					ev.preventDefault();
					const id = this._wonderIdFrom(remove);
					if (id && this._wonderEditing(id)) return this._onWonderRemove(id);
					return;
				}
			});

			// Enter, in either text field. Both live inside the sheet's <form>, where an unhandled
			// Enter is IMPLICIT SUBMISSION: core would submit and re-render the whole sheet, which
			// on the add bar looks exactly like the question being swallowed. So both are claimed.
			root.addEventListener("keydown", ev => {
				if (ev.key !== "Enter") return;
				if (ev.target.closest(".stonetop-gm-wonder-new")) {
					ev.preventDefault();
					return this._onWonderAdd(root);
				}
				// A saved question commits and gets out of the way. The blur is what fires the
				// `change` below, so this needs no write of its own.
				if (ev.target.closest(".stonetop-gm-wonder-question")) {
					ev.preventDefault();
					ev.target.blur();
				}
			});

			// `change`, not `input`: it fires on blur (and on Enter) with the final value, so a
			// sentence is one document write rather than one per keystroke.
			root.addEventListener("change", async ev => {
				const question = ev.target.closest(".stonetop-gm-wonder-question");
				if (question) {
					const id = this._wonderIdFrom(question);
					if (!id) return;
					// An emptied box is refused and put back, rather than saved. A row with no
					// question in it reads as a rendering fault and cannot be told apart from a
					// stray Enter on the add bar; removing a question is what the trash is for.
					if (!question.value.trim()) {
						question.value = this._wonder(id)?.question ?? "";
						return;
					}
					await this._setWonderField(id, "question", question.value);
					return;
				}

				const answer = ev.target.closest(".stonetop-gm-wonder-answer");
				if (answer) {
					const id = this._wonderIdFrom(answer);
					if (id) await this._setWonderField(id, "answer", answer.value);
				}
			});
		}

		/** The row an element sits in. */
		_wonderIdFrom(el) {
			return el?.closest("[data-wonder-id]")?.dataset.wonderId ?? null;
		}

		/**
		 * Put the unfiled line, and the caret, back into a freshly rendered add bar.
		 *
		 * Called from `_activateGmWonderListeners`, so it runs on every render — including the
		 * ones no add caused, which is the point: the stash is what `_flushGmWonderEdits` took off
		 * the last paint, and this is the only thing that ever puts it back.
		 *
		 * The stash is NOT cleared here. Every render flushes before it paints, so the next flush
		 * re-reads this box and overwrites what it holds; clearing would only matter on a render
		 * that skipped the flush, and there is none. Leaving it also means a GM who shut the sheet
		 * mid-question (the close flushes too) finds it still there when they open it again.
		 */
		_restoreGmWonderAdd(root) {
			const field = root?.querySelector(".stonetop-gm-wonder-new");
			if (!field) return;
			if (this._wonderAdd.text) field.value = this._wonderAdd.text;
			if (this._wonderAdd.focus) {
				this._wonderAdd.focus = false;
				field.focus();
			}
		}

		/**
		 * Save what is being TYPED before the sheet is redrawn under it.
		 *
		 * The two text fields save on blur, and this sheet has a redraw that does not wait for one:
		 * `_wirePrepPageSync` re-renders it on every threat, hazard and site write anywhere in the
		 * world. A GM part-way through an answer when another client ticks a grim portent would
		 * otherwise watch the sentence vanish, with nothing logged and nothing to undo.
		 *
		 * Reading the DOM here is correct, and is the one case where it is: unwritten keystrokes
		 * live ONLY in the box. The trap this pattern has (a pre-render flush reads the previous
		 * paint, so it can write stale state back over a fresh write) applies to fields a CLICK
		 * already committed to the document; neither of these has one, and `_setWonderField`
		 * no-ops on an unchanged value, so a flush with nothing to say costs nothing.
		 *
		 * AWAITED by the caller, unlike the listener writes. If the render went ahead first it
		 * would repaint from a document the write had not reached yet, and the GM would see their
		 * own sentence replaced by the previous one until something else redrew the tab.
		 *
		 * THREE boxes, not two. The add bar loses its contents to the same repaint and for the
		 * same reason, and the only difference is where they go: it is STASHED rather than saved,
		 * because a line nobody has filed yet is not a question (see `_wonderAdd`). Taken
		 * unconditionally and whether or not a field has focus — the GM may well have typed half a
		 * question, gone to read a threat, and left it sitting there.
		 */
		async _flushGmWonderEdits() {
			const root = this.element?.[0];
			if (!root) return;

			const add = root.querySelector(".stonetop-gm-wonder-new");
			if (add) this._wonderAdd.text = add.value;

			const field = root
				.querySelector(".stonetop-gm-wonder-question:focus, .stonetop-gm-wonder-answer:focus");
			if (!field) return;
			const id = this._wonderIdFrom(field);
			if (!id) return;
			const question = field.matches(".stonetop-gm-wonder-question");
			// Same refusal the `change` handler makes: an emptied question is not saved as one.
			// Nothing is put back here, because the repaint about to happen restores the box.
			if (question && !field.value.trim()) return;
			await this._setWonderField(id, question ? "question" : "answer", field.value);
		}

		/**
		 * Take what is in the add bar and file it.
		 *
		 * The box is cleared through the live node rather than left to the re-render, so it is
		 * already empty in the frame the GM sees instead of briefly showing the line they just
		 * filed. Same reasoning as `_clearAddField` in RosterDialog.
		 *
		 * BEFORE the write, though, and not after — which is the half that is not obvious. An add
		 * re-renders, and an AppV1 re-render is kicked off from inside `Document.update`, so it
		 * has already landed by the time the await here returns. A field cleared afterwards is a
		 * field on a node that has been replaced, and a stash still holding the typed line is one
		 * `_restoreGmWonderAdd` puts straight back into the new box. Both leave the question the
		 * GM just filed sitting in the add bar as though it had not been.
		 *
		 * The caret makes that same trip and so travels the same way: `focus` is set on the stash
		 * for the new box to claim, rather than given to the node about to be thrown away.
		 */
		async _onWonderAdd(root) {
			const field = root.querySelector(".stonetop-gm-wonder-new");
			if (!field) return;
			const typed = field.value;
			field.value = "";
			this._wonderAdd = { text: "", focus: true };
			if (await this._addWonder(typed)) return;
			// Nothing was filed, so nothing re-rendered: the line was blank, and it goes back in
			// the box it was typed into with the caret still in it.
			this._wonderAdd.text = typed;
			this._restoreGmWonderAdd(this.element?.[0] ?? root);
		}

		/**
		 * Delete a question, after asking.
		 *
		 * Asked because this is the only irreversible button on the tab, and it is NOT the one the
		 * book's own instruction ("if a question has been answered, remove it") points at: that is
		 * the tick, which files the question and its answer in the Answered fold and can be undone
		 * by the reopen arrow beside it. So the frequent act stays one click and the final one asks.
		 */
		async _onWonderRemove(id) {
			if (!id) return;
			const wonder = this._wonder(id);
			if (!wonder) return;
			const ok = await Dialog.confirm({
				title:   localize("stonetop.gmToolkit.wonder.removeTitle"),
				content: `<p>${format("stonetop.gmToolkit.wonder.removeBody", {
					question: escHtml(wonder.question || localize("stonetop.gmToolkit.wonder.removeUnnamed")),
				})}</p>`,
				options: { classes: ["dialog", "stonetop", "stonetop-remove-wonder-dialog"] },
			});
			if (!ok) return;
			await this._removeWonder(id);
		}
	};
}
