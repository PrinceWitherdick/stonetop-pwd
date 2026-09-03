// What a line on a relationship map says, and who to draw one to.
//
// Two small windows, together because they are the two halves of one act: pick a person, then say
// what the line between you means.

import { StonetopDialog } from "../utils/stonetop-dialog.js";
import { StonetopAutocomplete } from "../utils/autocomplete.js";
import { pickContentOption } from "./content-picker.js";
import { format, localize } from "../utils/i18n.js";
import { localizedOnce } from "../utils/localized-once.js";
import {
	RELMAP_DIRS, RELMAP_DIR_DEFAULT, RELMAP_INKS, RELMAP_INK_DEFAULT, RELMAP_LABEL_MAX,
} from "../relmap/relmap-store.js";

const TEMPLATE = "systems/stonetop-pwd/templates/dialogs/relationship-link.hbs";

/**
 * The eight inks' and four directions' display names.
 *
 * Through `localizedOnce` and not a top-level constant: `game.i18n` does not exist at module
 * evaluation time, so a constant built at import would be a table of untranslated keys forever.
 */
const inkNames = localizedOnce(() => Object.fromEntries(
	RELMAP_INKS.map(key => [key, localize(`stonetop.relmap.inks.${key}`)]),
));
const dirNames = localizedOnce(() => Object.fromEntries(
	RELMAP_DIRS.map(key => [key, localize(`stonetop.relmap.dirs.${key}`)]),
));

export class RelationshipLinkDialog extends StonetopDialog {
	constructor({ edge = null, from = "", to = "", suggestions = [] } = {}, options = {}) {
		super(options);
		this._edge = edge;
		this._from = from;
		this._to = to;
		this._suggestions = suggestions;
	}

	static get defaultOptions() {
		return foundry.utils.mergeObject(super.defaultOptions, {
			id: "stonetop-relmap-link",
			classes: ["stonetop", "stonetop-relmap-link-app"],
			template: TEMPLATE,
			width: 460,
			title: localize("stonetop.relmap.linkTitle"),
		});
	}

	/** Content-hugging: the ink row wraps differently at different font scales. */
	get _autoHeight() { return true; }

	getData() {
		const edge = this._edge ?? {};
		const ink = RELMAP_INKS.includes(edge.ink) ? edge.ink : RELMAP_INK_DEFAULT;
		const dir = RELMAP_DIRS.includes(edge.dir) ? edge.dir : RELMAP_DIR_DEFAULT;
		return {
			edge: { label: edge.label ?? "", note: edge.note ?? "" },
			between: this._from && this._to
				? format("stonetop.relmap.between", { a: this._from, b: this._to })
				: localize("stonetop.relmap.betweenUnknown"),
			suggestions: this._suggestions,
			maxLength: RELMAP_LABEL_MAX,
			placeholder: localize("stonetop.relmap.labelPlaceholder"),
			labelLabel: localize("stonetop.relmap.labelField"),
			inkLabel: localize("stonetop.relmap.inkField"),
			dirLabel: localize("stonetop.relmap.dirField"),
			noteLabel: localize("stonetop.relmap.noteField"),
			notePlaceholder: localize("stonetop.relmap.notePlaceholder"),
			inks: RELMAP_INKS.map(key => ({ key, name: inkNames()[key], checked: key === ink })),
			dirs: RELMAP_DIRS.map(key => ({ key, name: dirNames()[key], checked: key === dir })),
			canDelete: !!this._edge,
			saveLabel: localize(this._edge ? "stonetop.relmap.saveLink" : "stonetop.relmap.drawLink"),
			deleteLabel: localize("stonetop.relmap.deleteLink"),
			cancelLabel: localize("stonetop.relmap.cancel"),
		};
	}

	activateListeners(html) {
		super.activateListeners(html);
		const root = html[0];
		// Swap the label field’s native <datalist> popup for ours, as every other combo field in
		// the system does: Chromium’s native popup has no scrollbar, and the suggestions here are
		// every label already used on this map — exactly the long list that needs one.
		StonetopAutocomplete.upgradeAll(html);
		root.querySelectorAll("[data-relmap-link]").forEach(button => {
			button.addEventListener("click", ev => this._onButton(ev, root));
		});
		root.querySelector("#relmap-link-label")?.focus();
	}

	_onButton(ev, root) {
		const action = ev.currentTarget.dataset.relmapLink;
		if (action === "cancel") return this._resolveWith(null);
		if (action === "delete") return this._resolveWith({ deleted: true });
		this._resolveWith({
			label: StonetopDialog.readValue(root, "#relmap-link-label").trim(),
			note: StonetopDialog.readValue(root, "#relmap-link-note").trim(),
			ink: root.querySelector("input[name='ink']:checked")?.value ?? RELMAP_INK_DEFAULT,
			dir: root.querySelector("input[name='dir']:checked")?.value ?? RELMAP_DIR_DEFAULT,
		});
	}
}

/**
 * Ask what a link says.
 *
 * Resolves to the link's fields, to `{deleted: true}`, or to null when the reader backed out —
 * which every exit does, including Escape and the X, so a caller is never left awaiting.
 */
export function openLinkEditor({ edge = null, from = "", to = "", suggestions = [] } = {}) {
	return new RelationshipLinkDialog({ edge, from, to, suggestions }).promise();
}

/**
 * Ask which person on the map to draw to, or to add.
 *
 * The system's own chooser rather than a bespoke list, so this looks and behaves like every other
 * one-of-N question the system asks. It escapes its own labels, which matters here: the rows are
 * built from actor names, which are user-authored text.
 */
export function pickPersonToLink({ from = "", options = [], title = "" } = {}) {
	return pickContentOption({
		title: title || (from
			? format("stonetop.relmap.linkFromTitle", { name: from })
			: localize("stonetop.relmap.linkPickTitle")),
		buttonLabel: localize("stonetop.relmap.choose"),
		options: options.map(option => ({
			id: option.id,
			label: option.name,
			icon: "fa-user",
			hint: option.hint ?? "",
		})),
	});
}
