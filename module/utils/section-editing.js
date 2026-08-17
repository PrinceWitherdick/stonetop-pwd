import {getSheetSectionsCollapsed, setSheetSectionsCollapsed} from "../settings.js";

/**
 * Mixin for actor sheets that expose per-section edit pencils alongside the
 * global header-wrench edit mode. A section is editable when the global wrench
 * (`_editMode`) is on OR that section's own pencil has been toggled.
 *
 * It also owns the hover caret that sits beside those pencils and folds a
 * section shut — see `_wireSectionCollapse`.
 *
 * Extracted from StonetopCharacterSheet and StonetopSteadingSheet so the two
 * can't drift apart. Subclasses keep owning `_editMode`; this mixin only reads
 * it. Wire the delegated toggle handler from `activateListeners` via
 * `_wireSectionEditToggle(html, selector)`, and override the
 * `_onSectionEdit{Opened,Closed}` hooks for any per-sheet flourishes (e.g. the
 * steading's fade-out "done" check).
 *
 * @template {new (...args: any[]) => { _editMode: boolean, render: Function }} T
 * @param {T} Base
 */
export function withSectionEditing(Base) {
	return class extends Base {
		// Sections with their own pencil, tracked independently of `_editMode`.
		_editingSections = new Set();

		/** Whether a given section should render as editable right now. */
		isSectionEditable(section) {
			return this._editMode || this._editingSections.has(section);
		}

		/** True when the global wrench is on or any section pencil is open. */
		get hasActiveEdits() {
			return this._editMode || this._editingSections.size > 0;
		}

		/**
		 * Install the delegated click handler for per-section edit toggles.
		 * @param {JQuery}  html     the sheet's rendered jQuery element
		 * @param {string}  selector the toggle anchor selector (per sheet)
		 */
		_wireSectionEditToggle(html, selector) {
			html[0].addEventListener("click", ev => {
				const toggle = ev.target.closest(selector);
				if (!toggle) return;
				ev.stopPropagation();
				const section = toggle.dataset.section;
				if (this._editingSections.has(section)) {
					this._editingSections.delete(section);
					this._onSectionEditClosed(section);
				} else {
					this._editingSections.add(section);
					this._onSectionEditOpened(section);
				}
				this.render(false);
			}, true);
		}

		// Deliberately empty override points. The `_` prefix is only there to say "unused here" —
		// a subclass overriding these names its own parameter.
		/** Hook: a section's pencil was just opened. @param {string} _section */
		_onSectionEditOpened(_section) {}

		/** Hook: a section's pencil was just closed. @param {string} _section */
		_onSectionEditClosed(_section) {}

		// ── Section collapse ──────────────────────────────────────────────────
		// The caret beside each pencil folds its section down to just the heading.
		// Unlike the edit state this is a reading preference, not sheet data: it
		// lives in a client setting (per user), keyed by actor id (per sheet).
		//
		// What is STORED is the set of sections sitting AGAINST their default, not
		// the set that is collapsed. Almost every section defaults to expanded, and
		// for those two readings are identical, which is why the setting is still
		// called `sheetSectionsCollapsed` and why every list written by an older
		// build still means exactly what it meant. The difference only shows on a
		// section that opts into `defaultCollapsed` (the GM Toolkit's prep
		// reference): there, a stored id means the user pushed it OPEN.
		//
		// Storing the override rather than the state is what lets a default change
		// later without rewriting anyone's saved preferences, and it keeps "never
		// touched this" distinguishable from "deliberately put it back", which a
		// list of collapsed ids alone cannot express.

		/**
		 * Ids whose fold sits against its default on this sheet, hydrated from the
		 * stored preference once.
		 */
		get foldOverrides() {
			return (this._foldOverrides ??= new Set(getSheetSectionsCollapsed(this.actor?.id)));
		}

		/** Does this caret's section start folded when the user has never touched it? */
		_defaultsCollapsed(caret) {
			return caret.dataset.defaultCollapsed === "true";
		}

		/** Is this caret's section folded right now? */
		_isSectionCollapsed(caret) {
			const flipped = this.foldOverrides.has(caret.dataset.section);
			return this._defaultsCollapsed(caret) ? !flipped : flipped;
		}

		/**
		 * Everything one fold hides: the section's own heading (kept, but marked so
		 * the caret can rotate and any search box inside it can go), and the run of
		 * content below it.
		 *
		 * The heading is found from the caret rather than declared per call site,
		 * because the caret sits in one of two places: INSIDE the heading (sections
		 * with no pencil), or beside the pencil in the section's top-right corner,
		 * ahead of the heading (the steading's cards). `closest` covers the first,
		 * a forward look inside the caret's own parent the second.
		 *
		 * The content is the heading's following siblings, stopping at the next
		 * heading — these sheets lay a column out as one flat run (Inventory's
		 * Arcana and Treasures blocks, the Moves tab's groups), so "everything
		 * after the heading" would swallow the sections below it.
		 *
		 * @param {Element} caret     the fold caret
		 * @param {string}  headingSel what counts as a heading on this sheet
		 * @returns {{heading: Element|null, content: Element[]}}
		 */
		_sectionFoldTargets(caret, headingSel) {
			const heading = caret.closest(headingSel) ?? caret.parentElement?.querySelector(headingSel);
			if (!heading) return { heading: null, content: [] };
			const content = [];
			for (let el = heading.nextElementSibling; el; el = el.nextElementSibling) {
				if (el.matches(headingSel)) break;
				content.push(el);
			}
			return { heading, content };
		}

		/**
		 * Install the delegated collapse handler and re-apply the stored folds to
		 * the freshly rendered DOM.
		 *
		 * The fold classes are stamped here rather than by the template so a new
		 * collapsible section only has to render the caret — there is no second
		 * place to remember. They land before the sheet is painted (the DOM swap and
		 * `activateListeners` run in one task), so nothing flashes open.
		 *
		 * Wire this OUTSIDE any `isEditable` guard: folding a section is a reading
		 * preference, and a player looking at someone else's sheet wants it too.
		 *
		 * @param {JQuery} html       the sheet's rendered jQuery element
		 * @param {string} headingSel what counts as a section heading on this sheet
		 */
		_wireSectionCollapse(html, headingSel) {
			const root = html[0];
			const apply = (caret, collapsed) => {
				const { heading, content } = this._sectionFoldTargets(caret, headingSel);
				for (const el of content) el.classList.toggle("stonetop-section-folded", collapsed);
				// Controls that act on the folded content live inside the heading, so the run
				// above misses them — a search box or a Table/Board switch over nothing is a
				// dead end. They come back with the section.
				//
				// Found by ONE class the templates opt into, not by a list of the specific
				// controls that happen to exist today: this is shared infrastructure, and every
				// heading-resident control added since has had to remember to name itself here
				// or be silently left behind.
				for (const el of heading?.querySelectorAll(".stonetop-section-heading-control") ?? []) {
					el.classList.toggle("stonetop-section-folded", collapsed);
				}
				caret.classList.toggle("stonetop-section-collapsed", collapsed);
				caret.setAttribute("aria-expanded", String(!collapsed));
				caret.setAttribute("title", collapsed ? "Expand section" : "Collapse section");
			};
			for (const caret of root.querySelectorAll(".stonetop-section-collapse")) {
				apply(caret, this._isSectionCollapsed(caret));
			}

			const toggle = caret => {
				const id = caret.dataset.section;
				if (!id) return;
				const collapsed = !this._isSectionCollapsed(caret);
				// The STORED fact is "this section sits against its default", so which way
				// the flip is recorded depends on which way the section starts. Recording
				// the state instead would make a default-collapsed section that the user
				// has never touched indistinguishable from one they deliberately shut.
				if (collapsed === this._defaultsCollapsed(caret)) this.foldOverrides.delete(id);
				else                                              this.foldOverrides.add(id);
				apply(caret, collapsed);
				setSheetSectionsCollapsed(this.actor?.id, [...this.foldOverrides]);
			};
			// Class-toggled in place rather than re-rendered: a fold changes nothing
			// the template computes, and a re-render would cost a scroll jump.
			root.addEventListener("click", ev => {
				const caret = ev.target.closest(".stonetop-section-collapse");
				if (!caret) return;
				ev.preventDefault();
				ev.stopPropagation();
				toggle(caret);
			}, true);
			root.addEventListener("keydown", ev => {
				if (ev.key !== "Enter" && ev.key !== " ") return;
				const caret = ev.target.closest(".stonetop-section-collapse");
				if (!caret) return;
				ev.preventDefault();
				ev.stopPropagation();
				toggle(caret);
			}, true);
		}
	};
}
