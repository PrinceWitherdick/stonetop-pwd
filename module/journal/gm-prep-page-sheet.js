// Factory for a "GM-prep page" sheet (threat / hazard / site). These sheets render ONLY
// the book-faithful card (view) with live doom-track checkboxes the owner can tick and an
// owner Edit button. They are only ever rendered EMBEDDED in the journal (a scene pin
// opens one), so "tick the doom track from the map" is: click the pin, tick a portent
// right here. The card markup is shared, so threat-view's wiring (doom toggles,
// drag-to-pin) applies to all three. The sheets differ only in the config values below.
import { wireGmPrepCard, wireThreatCardDrag } from "../threats/threat-view.js";
import { adoptInlineViewRoot } from "./inline-page-view.js";

/**
 * @param {Function} Base  The core JournalPageSheet base for this render mode.
 * @param {object} cfg
 * @param {string} cfg.template     Handlebars path for the card view.
 * @param {(page:object, opts:object)=>Promise<object>} cfg.buildCardVM  Card view-model builder.
 * @param {string} cfg.editSelector Selector for the owner's Edit affordance.
 * @param {(document:object)=>void} cfg.openEditor  Open the editor for this page's document.
 * @param {(root:HTMLElement, page:object)=>void} [cfg.wireExtras]  Wiring only one kind's
 *        card needs (a site's roll-on-my-table buttons), run once per render.
 */
export function createStonetopGmPrepPageSheetClass(Base, { template, buildCardVM, editSelector, openEditor, wireExtras }) {
	return class StonetopGmPrepPageSheet extends Base {
		// Nothing on the card is a form field for core to save (the doom boxes write
		// themselves, and edits go through the editor), and the template has no <form>. Left
		// on, save-on-close threw "no registered form element" and the popout's X did
		// nothing the first time it was pressed.
		static get defaultOptions() {
			return foundry.utils.mergeObject(super.defaultOptions, { submitOnClose: false });
		}

		get template() { return template; }

		// The embedded page view renders with editable:false, which would blanket-disable
		// every input (including the owner's live doom checkboxes). We gate editability
		// ourselves per element in the template, so suppress the lock-down.
		_disableFields(_form) {}

		async getData(options = {}) {
			const context = super.getData(options);
			const page = this.document;
			const st = context.stonetop = { canEdit: page.isOwner };
			st.card = await buildCardVM(page, { forOwner: page.isOwner });
			st.card.canDrag = page.isOwner;
			return context;
		}

		activateListeners(html) {
			super.activateListeners(html);
			// The embedded view sheet is rendered by the journal, which never sets _element.
			adoptInlineViewRoot(this, html);
			const root = html?.[0] ?? html;
			if (!root) return;

			// Drag the card onto a scene to drop a linked pin (native page payload). The whole
			// card is the drag handle; fall back to this page's uuid if the markup lacks it.
			wireThreatCardDrag(root, { fallbackUuid: this.document.uuid });
			// Live doom-track checkboxes (owners only; players are disabled), "Give to players" on a threat's
			// or hazard's custom player move (GM-only button), and anything only this kind of card carries
			// (a site's roll-on-my-table buttons).
			wireGmPrepCard(root, () => this.document, wireExtras && (el => wireExtras(el, this.document)));

			root.addEventListener("click", async ev => {
				if (!this.document.isOwner) return;
				if (ev.target.closest(editSelector)) {
					ev.preventDefault();
					openEditor(this.document);
				}
			});
		}
	};
}
