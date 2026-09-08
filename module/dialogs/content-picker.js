// The shared "what do you want to make?" chooser: a radio list of icon + label + hint
// rows that resolves to the picked option's id, or null when dismissed. Every sidebar
// creation entry point runs through it — Create Item (create-stonetop-content-dialog.js)
// and Create Actor (create-actor-dialog.js), plus each of their second-step sub-choosers
// — so no step of any flow can drift away from the others in look or behaviour.
//
// AND THE ONE-LINE TEXT PROMPT (`promptForText`), which is here rather than in a module of its own
// because it is the same window asking a different question, and because both have to obey the same
// unforgiving rule about how a DialogV2 is handed its content. See `contentElement`.

import { escHtml } from "../utils/strings.js";
import { themedDialogClasses } from "../utils/window-theme.js";

/**
 * Present a one-of-N chooser and resolve to the picked option's id.
 *
 * Labels and hints are escaped, not trusted: the Create Actor flow builds rows from
 * player names, which are user-authored text.
 *
 * @param {object} params
 * @param {string} params.title       Window title.
 * @param {{id: string, label: string, icon: string, hint?: string}[]} params.options
 *                                    The rows, in display order; the first is pre-selected.
 * @param {string} [params.buttonLabel="Continue"]  Confirm-button label.
 * @param {string} [params.selected]  Which row opens picked, by id. Absent (or naming a row that is
 *                                    not there) keeps the first, which is what every other caller
 *                                    wants. It is here so that a chooser can offer a DEFAULT without
 *                                    reordering its own list to put that row first: sorting one row
 *                                    to the top is how a reader loses the order they had learned,
 *                                    and it gives no hint why the second row is the pre-selected
 *                                    one. Say that in the row's `hint` instead. The relationship
 *                                    map's Tidy up (`_askShape`) is the caller: Ring stays above
 *                                    Clusters whichever shape the board is already in.
 * @returns {Promise<string|null>}    The chosen option id, or null if the dialog was dismissed.
 */
export function pickContentOption({ title, options, buttonLabel = "Continue", selected = null }) {
	// Whether the caller's default is actually one of the rows, worked out ONCE: asking per row
	// would leave a list whose default is missing with nothing checked at all, and a radio group
	// with no selection is a confirm button that resolves to undefined.
	const pick = options.some(opt => opt.id === selected) ? selected : options[0]?.id;
	const rows = options.map(opt => `
		<label class="stonetop-content-picker-option">
			<input type="radio" name="contentType" value="${escHtml(opt.id)}"${opt.id === pick ? " checked" : ""}>
			<i class="fas ${escHtml(opt.icon)}" aria-hidden="true"></i>
			<span class="stonetop-content-picker-text">
				<span class="stonetop-content-picker-label">${escHtml(opt.label)}</span>
				<span class="stonetop-content-picker-hint">${escHtml(opt.hint ?? "")}</span>
			</span>
		</label>`).join("");

	return _promptRows({
		title, rows, buttonLabel, width: 440,
		read: form => form.contentType,
		// ⚠ THE PICKED ROW HAS TO BE ON SCREEN. Until `selected` existed the pre-selected row was
		// always the first one, which is always visible; now it can be anywhere in a list as long
		// as the map has people on it, and a default the reader has to scroll to find is a default
		// they will not know is there. `scrollIntoView` and not focus: the confirm button keeps the
		// focus a dialog opens with.
		onShow: root => root
			.querySelector("input:checked")?.closest("label")
			?.scrollIntoView?.({ block: "nearest" }),
	});
}

/**
 * The `<div>` a DialogV2 will accept as its content, wrapped around the markup you actually want.
 *
 * ⚠ THE RULE, AND IT THROWS. Core's `DialogV2#_initializeApplicationOptions` (v13
 * client/applications/api/dialog.mjs) refuses a content element that is not a `<div>`, refuses one
 * carrying ANY attribute at all, and then keeps only its `innerHTML` — the element itself is
 * discarded. So a `content.className = "stonetop"` on the way in is not merely ignored: it is
 * `Error: config.content element must have no attributes`, thrown out of the constructor, which
 * surfaces as an unhandled rejection and a button that silently does nothing. It cost the "New map"
 * button on the GM Toolkit's relationship maps tab, which shipped dead for exactly that reason, and
 * then cost the map's own "New page" button when its author copied the pattern.
 *
 * ONE FUNCTION so there is one place that knows, and so the next window to ask a question inherits
 * the rule rather than rediscovering it. The classed, styled container always lives one level in —
 * which is fine, because the wrapper is inside the `innerHTML` that survives.
 *
 * @param {string} inner  Authored markup for the container that carries the classes.
 * @returns {HTMLDivElement}
 */
function contentElement(inner) {
	const content = document.createElement("div");
	content.innerHTML = inner;
	return content;
}

/**
 * Ask for one line of text.
 *
 * Beside the choosers because it is the same window asking a different question, and it is shared
 * for the same reason they are: two hand-rolled copies is two chances to get the content rule above
 * wrong, and both of the copies this replaced had.
 *
 * RESOLVES TO A STRING OR NULL, and the difference matters to every caller: `""` means "saved
 * without typing anything", which is a name the caller may substitute a default for, while `null`
 * means "never mind", which must leave everything alone. Trimmed here, so no caller has to.
 *
 * THE FIELD TAKES FOCUS AND ITS TEXT IS SELECTED once the window is on screen. That is what makes
 * this usable for a RENAME as well as a new name: the box opens on the name it already has, and a
 * reader who meant to replace it can simply type. `render` and not a wire step, because focusing a
 * node that is not in a document yet is a silent no-op.
 *
 * @param {object} p
 * @param {string} p.title              Window title.
 * @param {string} p.buttonLabel        Confirm-button label.
 * @param {string} [p.value]            What the box opens on.
 * @param {string} [p.placeholder]      Ghost text for an empty box.
 * @param {number} [p.width=420]
 * @returns {Promise<string|null>}
 */
export function promptForText({ title, buttonLabel, value = "", placeholder = "", width = 420 }) {
	// Escaped because both are shown as ATTRIBUTES here, and both can be text somebody at this
	// table typed: `value` is very often the existing name of the thing being renamed.
	const content = contentElement(`
		<div class="stonetop stonetop-text-prompt">
			<input type="text" name="stonetopText" value="${escHtml(value)}"
			       placeholder="${escHtml(placeholder)}">
		</div>`);

	return foundry.applications.api.DialogV2.prompt({
		classes: themedDialogClasses(),
		window: { title },
		position: { width },
		content,
		render: (_event, dialog) => {
			const root = dialog?.element ?? dialog;
			const field = root?.querySelector?.("input[name='stonetopText']");
			field?.focus?.();
			field?.select?.();
		},
		ok: {
			label: buttonLabel,
			// Through `namedItem`, not `form.elements.stonetopText`: named access on a
			// HTMLFormControlsCollection is a lookup that can collide with the collection's own
			// members, and a field called `length` or `item` would read back as a function.
			callback: (event, button) =>
				String(button.form.elements.namedItem("stonetopText")?.value ?? "").trim(),
		},
		rejectClose: false,
	});
}

/**
 * The window both choosers here are: a radio list on the Stonetop skin, resolving to whatever the
 * caller reads out of the form.
 *
 * ONE SHELL, because the class list is load-bearing and was written out twice. A DialogV2 is an
 * ApplicationV2 (`.application` root), which the `.stonetop` parchment/slate skin excludes by
 * design (stonetop.css `:not(.application,…)`): the authoring flows we hand off to are AppV1 and
 * pick the skin up for free, but a V2 window needs `stonetop-themed` to get the same modal look.
 * Two copies of that list is one picker themed and one not, the next time it changes.
 *
 * @param {object} p
 * @param {string} p.title        Window title.
 * @param {string} p.rows         The radio rows, as authored markup.
 * @param {string} p.buttonLabel  Confirm-button label.
 * @param {number} p.width
 * @param {Function} p.read       `(formObject) => any` — what the dialog resolves to.
 * @param {Function} [p.wire]     `(content) => void` — listeners bound to the DETACHED node, which
 *                                keeps them when the dialog inserts it.
 * @param {Function} [p.onShow]   `(root) => void` — run once the dialog is ON SCREEN. Its own hook
 *                                and not part of `wire`, because the two run at different moments
 *                                and want different things: `wire` binds listeners to a node that
 *                                is not in a document yet, where anything measuring or scrolling is
 *                                a silent no-op.
 */
function _promptRows({ title, rows, buttonLabel, width, read, wire = null, onShow = null }) {
	const content = contentElement(`<div class="stonetop stonetop-content-picker">${rows}</div>`);
	wire?.(content);

	return foundry.applications.api.DialogV2.prompt({
		classes: themedDialogClasses("stonetop-content-picker-dialog"),
		window: { title },
		position: { width },
		content,
		render: (_event, dialog) => {
			const root = dialog?.element ?? dialog;
			if (root?.querySelector) onShow?.(root);
		},
		ok: {
			label: buttonLabel,
			callback: (event, button) =>
				read(new foundry.applications.ux.FormDataExtended(button.form).object),
		},
		rejectClose: false,
	});
}

/**
 * Pick one line off a menu, or write one that isn't on it.
 *
 * The other shape of chooser: `pickContentOption` above offers a handful of KINDS, each an
 * icon and a name and a sentence about it, and every one of them leads somewhere. This one
 * offers a list of PROMPTS — one-line sentences out of the book — and the list is a menu
 * rather than the whole of what can be said, so it carries a row at the foot for the GM's
 * own words. The expedition walkthrough's Chart a Course requirements and challenges are the
 * first caller; the book prints both as "tell them one of these, or something like them".
 *
 * `html` on a row is TRUSTED authored markup (the entities the prompts are written with),
 * unescaped exactly as the surfaces that print those prompts render them. Nothing
 * user-authored is ever handed in as a row: what a GM writes goes through the text field,
 * which is a form control and escapes nothing because it renders nothing.
 *
 * @param {object} params
 * @param {string} params.title      Window title.
 * @param {{id: string, html: string}[]} params.options  The menu, in display order.
 * @param {string} [params.writeLabel]        The last row's own label.
 * @param {string} [params.writePlaceholder]  Placeholder in its text field.
 * @param {string} [params.buttonLabel="Add"] Confirm-button label.
 * @returns {Promise<{key: string}|{text: string}|null>}
 *          The chosen row's id, the words that were written, or null when the dialog was
 *          dismissed — or confirmed on the write row with nothing written in it, which is
 *          the same thing: there is no entry to add.
 */
export function pickOrWriteOption({
	title, options, writeLabel = "Something else:", writePlaceholder = "", buttonLabel = "Add",
}) {
	const rows = options.map((opt, i) => `
		<label class="stonetop-content-picker-option stonetop-content-picker-option--line">
			<input type="radio" name="pick" value="${escHtml(opt.id)}"${i === 0 ? " checked" : ""}>
			<span class="stonetop-content-picker-line">${opt.html}</span>
		</label>`).join("");

	// The write-your-own row is one of the radios, not a second control beside them: the
	// question is "which line goes on the list", and it has exactly one answer.
	const own = `
		<label class="stonetop-content-picker-option stonetop-content-picker-option--line stonetop-content-picker-own">
			<input type="radio" name="pick" value="${escHtml(_WRITE_ID)}"${options.length ? "" : " checked"}>
			<span class="stonetop-content-picker-line">
				<span class="stonetop-content-picker-own-label">${escHtml(writeLabel)}</span>
				<input type="text" name="custom" maxlength="300" placeholder="${escHtml(writePlaceholder)}">
			</span>
		</label>`;

	return _promptRows({
		title, buttonLabel, width: 480,
		rows: `${rows}${own}`,
		// Typing is choosing. Without this a GM writes their line, presses Add, and gets whichever
		// authored row happened to be selected — their words dropped with nothing said.
		wire: content => {
			content.querySelector('input[name="custom"]')?.addEventListener("input", () => {
				content.querySelector(`input[name="pick"][value="${_WRITE_ID}"]`).checked = true;
			});
		},
		read: form => {
			if (form.pick !== _WRITE_ID) return form.pick ? { key: form.pick } : null;
			const text = String(form.custom ?? "").trim();
			return text ? { text } : null;
		},
	});
}

/** The write-your-own row's radio value. Not a key any menu can use. */
const _WRITE_ID = "__write__";

/**
 * Run the flow that belongs to the option that was picked.
 *
 * The other half of the chooser. Every table above used to be paired with an if/else ladder
 * beside it, re-spelling each id a second time: a kind added to one and missed in the other is a
 * picker row that quietly does nothing, or a flow nothing can reach, and neither fails loudly.
 * With the flow ON the row there is only one list to keep, and the one thing that can still go
 * wrong — a row with no flow at all — is reported instead of resolving a bare null, which the
 * caller cannot tell apart from the user closing the dialog.
 *
 * `create` is optional in the type sense only: a table whose rows lack it is a bug, not a mode.
 *
 * @param {{id: string, create?: Function}[]} options  The same rows handed to pickContentOption.
 * @param {string|null} choice     The id pickContentOption resolved, or null if it was dismissed.
 * @param {...any} args            Passed through to the row's `create`.
 * @returns {any}                  Whatever the flow returns, or null.
 */
export function runPickedOption(options, choice, ...args) {
	if (!choice) return null;
	const row = (options ?? []).find(o => o?.id === choice);
	if (!row?.create) {
		console.error(`Stonetop | picker option "${choice}" has no create flow`);
		ui.notifications?.error?.("That option has no creation flow behind it. See the console for details.");
		return null;
	}
	return row.create(...args);
}
