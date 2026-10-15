// The shared "what do you want to make?" chooser: a radio list of icon + label + hint
// rows that resolves to the picked option's id, or null when dismissed. Every sidebar
// creation entry point runs through it — Create Item (create-stonetop-content-dialog.js)
// and Create Actor (create-actor-dialog.js), plus each of their second-step sub-choosers
// — so no step of any flow can drift away from the others in look or behaviour.
//
// AND THE ONE-LINE TEXT PROMPT (`promptForText`), which is here rather than in a module of its own
// because it is the same window asking a different question.
//
// ALL OF THEM ARE ONE AppV1 WINDOW, `ContentPickerDialog` (a StonetopDialog), so they wear the
// parchment skin and behave like the system's other dialogs (the user's call, 2026-10-14: V1
// everywhere until the planned V1 -> V2 migration). They were DialogV2 prompts before that.

import { escHtml } from "../utils/strings.js";
import { StonetopDialog } from "../utils/stonetop-dialog.js";
import { applyGuideRail } from "../utils/guide-rail.js";

/**
 * Present a one-of-N chooser and resolve to the picked option's id.
 *
 * Labels and hints are escaped, not trusted: the Create Actor flow builds rows from
 * player names, which are user-authored text.
 *
 * @param {object} params
 * @param {string} params.title       Window title.
 * @param {({id: string, label: string, icon: string, hint?: string}|{heading: string})[]} params.options
 *                                    The rows, in display order; the first is pre-selected. A
 *                                    `{heading}` entry is a small caption over the rows after it,
 *                                    not a choice: it has no radio and can never be the answer.
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
 * @param {boolean} [params.tabbed=false]  Show each `{heading}` group as a page of its own behind a
 *                                    left rail (the Welcome guide's), instead of one long stack. For
 *                                    a list too tall for the screen: the settlement chooser. A
 *                                    heading may carry an `icon` for its rail entry. Ignored unless
 *                                    the list opens on a heading, since a row above the first one
 *                                    would have no page to sit on.
 * @returns {Promise<string|null>}    The chosen option id, or null if the dialog was dismissed.
 */
export function pickContentOption({ title, options, buttonLabel = "Continue", selected = null, tabbed = false }) {
	// Whether the caller's default is actually one of the rows, worked out ONCE: asking per row
	// would leave a list whose default is missing with nothing checked at all, and a radio group
	// with no selection is a confirm button that resolves to undefined.
	const pick = options.some(opt => !opt.heading && opt.id === selected)
		? selected
		: options.find(opt => !opt.heading)?.id;
	const row = opt => `
		<label class="stonetop-content-picker-option">
			<input type="radio" name="contentType" value="${escHtml(opt.id)}"${opt.id === pick ? " checked" : ""}>
			<i class="fas ${escHtml(opt.icon)}" aria-hidden="true"></i>
			<span class="stonetop-content-picker-text">
				<span class="stonetop-content-picker-label">${escHtml(opt.label)}</span>
				<span class="stonetop-content-picker-hint">${escHtml(opt.hint ?? "")}</span>
			</span>
		</label>`;

	if (tabbed && options[0]?.heading) return _pickTabbed({ title, options, buttonLabel, pick, row });

	const rows = options.map(opt => opt.heading
		? `<div class="stonetop-content-picker-heading">${escHtml(opt.heading)}</div>`
		: row(opt)).join("");

	return ContentPickerDialog.ask({
		title, body: rows, buttonLabel, width: 440,
		read: _checkedPick,
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
 * The tabbed chooser: one page per heading, switched from a left rail, all of them ONE radio group
 * so the window still has exactly one answer.
 *
 * ⚠ WHAT IS PICKED IS ALWAYS ON THE PAGE SHOWING. Opening another page picks its first row (unless
 * the pick is already there), and arrowing through the radio group onto a row on a page that is not
 * showing turns the rail to that page. Either way round, Continue never makes something the reader
 * cannot see.
 *
 * The pages share one grid cell, and the ones not showing are `visibility: hidden` rather than gone,
 * so the window is as tall as its tallest page and does not jump as the rail is clicked.
 */
function _pickTabbed({ title, options, buttonLabel, pick, row }) {
	const groups = [];
	for (const opt of options) {
		if (opt.heading) groups.push({ heading: opt.heading, icon: opt.icon || "fa-list", rows: [] });
		else groups.at(-1).rows.push(opt);
	}
	const open = Math.max(0, groups.findIndex(g => g.rows.some(r => r.id === pick)));

	const tabs = groups.map((g, i) => `
		<li class="stonetop-guide-toc-item${i === open ? " is-active" : ""}">
			<button type="button" class="stonetop-guide-toc-btn stonetop-content-picker-tab" data-tab="${i}"${i === open ? ' aria-current="true"' : ""}>
				<i class="fas ${escHtml(g.icon)} stonetop-guide-toc-icon" aria-hidden="true"></i>
				<span class="stonetop-guide-toc-text">${escHtml(g.heading)}</span>
				<span class="stonetop-guide-toc-count">${g.rows.length}</span>
			</button>
		</li>`).join("");
	const pages = groups.map((g, i) => `
		<div class="stonetop-content-picker-page${i === open ? " is-active" : ""}" data-tab="${i}">${g.rows.map(row).join("")}</div>`).join("");

	return ContentPickerDialog.ask({
		title, buttonLabel, width: 600,
		bodyClass: "stonetop-content-picker--tabbed",
		// The pages pin the window's height already (they share one grid cell), so it opens at that
		// height and stays there.
		body: `
			<div class="stonetop-guide-split">
				<nav class="stonetop-guide-toc" aria-label="${escHtml(title)}">
					<ol class="stonetop-guide-toc-list">${tabs}</ol>
				</nav>
				<div class="stonetop-content-picker-pages">${pages}</div>
			</div>`,
		read: _checkedPick,
		wire: root => {
			const show = key => {
				// The rail as every guide rail syncs it; the pages are this window's own (visibility, not `hidden`).
				applyGuideRail(root, { key, dataKey: "tab", tabSelector: ".stonetop-content-picker-tab" });
				let page = null;
				root.querySelectorAll(".stonetop-content-picker-page").forEach(p => {
					const on = p.dataset.tab === key;
					p.classList.toggle("is-active", on);
					if (on) page = p;
				});
				return page;
			};
			root.querySelectorAll(".stonetop-content-picker-tab").forEach(btn => btn.addEventListener("click", () => {
				const page = show(btn.dataset.tab);
				if (page && !page.querySelector("input:checked")) {
					const first = page.querySelector("input[type=radio]");
					if (first) first.checked = true;
				}
			}));
			root.querySelectorAll(".stonetop-content-picker-page input[type=radio]").forEach(radio =>
				radio.addEventListener("change", () => {
					const page = radio.closest(".stonetop-content-picker-page");
					if (radio.checked && page && !page.classList.contains("is-active")) show(page.dataset.tab);
				}));
		},
	});
}

/** The chooser's answer: the checked row's id, or null if (somehow) none is checked. */
function _checkedPick(form) {
	return form.querySelector('input[name="contentType"]:checked')?.value ?? null;
}

/**
 * Ask for one line of text.
 *
 * Beside the choosers because it is the same window asking a different question, and it is shared
 * for the same reason they are: two hand-rolled copies of one window drift apart.
 *
 * RESOLVES TO A STRING OR NULL, and the difference matters to every caller: `""` means "saved
 * without typing anything", which is a name the caller may substitute a default for, while `null`
 * means "never mind", which must leave everything alone. Trimmed here, so no caller has to.
 *
 * THE FIELD TAKES FOCUS AND ITS TEXT IS SELECTED once the window is on screen. That is what makes
 * this usable for a RENAME as well as a new name: the box opens on the name it already has, and a
 * reader who meant to replace it can simply type. `onShow` and not a wire step, because it is the
 * hook that runs once the window is on screen and placed.
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
	return ContentPickerDialog.ask({
		title, buttonLabel, width,
		bodyClass: "stonetop-text-prompt",
		body: `<input type="text" name="stonetopText" value="${escHtml(value)}" placeholder="${escHtml(placeholder)}">`,
		read: form => String(form.querySelector('input[name="stonetopText"]')?.value ?? "").trim(),
		onShow: root => {
			const field = root.querySelector('input[name="stonetopText"]');
			field?.focus?.();
			field?.select?.();
		},
	});
}

/**
 * The one window behind every prompt in this file: a body of authored markup over one confirm
 * button, on the Stonetop skin, resolving to whatever the caller reads out of the form, or null
 * when it is closed.
 *
 * Confirm is the form's submit, so Enter in the text prompt saves it, and Enter anywhere else in a
 * chooser confirms the row that is picked. The confirm button takes the focus as the window opens
 * (as a DialogV2's did), unless `onShow` puts it somewhere else. Cancel is closing the window:
 * StonetopDialog#close settles the promise to null.
 */
export class ContentPickerDialog extends StonetopDialog {
	/**
	 * Open the window and wait for its answer: `new this(spec).promise()`.
	 *
	 * @param {object} spec  As the constructor takes it.
	 * @returns {Promise<any|null>}  What `read` returned, or null when the window was closed.
	 */
	static ask(spec) {
		return new this(spec).promise();
	}

	/**
	 * Anything beyond these goes through to the Application as its own options.
	 *
	 * @param {object} p
	 * @param {string} p.title          Window title.
	 * @param {string} p.body           The body, as authored markup (escaped by the caller).
	 * @param {string} p.buttonLabel    Confirm-button label.
	 * @param {number} [p.width=440]
	 * @param {Function} p.read         `(form) => any`: what the window resolves to, read off its <form>.
	 * @param {Function} [p.wire]       `(form) => void`: listeners on the body, bound once it is drawn.
	 * @param {Function} [p.onShow]     `(form) => void`: run once the window is on screen and placed,
	 *                                  for anything that measures, scrolls or focuses.
	 * @param {string} [p.bodyClass]    An extra class on the body, for a layout variant.
	 */
	constructor({ body, buttonLabel, read, wire = null, onShow = null, bodyClass = "", ...options }) {
		super(options);
		this._body = body;
		this._buttonLabel = buttonLabel;
		this._read = read;
		this._wire = wire;
		this._onShow = onShow;
		this._bodyClass = bodyClass;
		this._shown = false;
	}

	static get defaultOptions() {
		return foundry.utils.mergeObject(super.defaultOptions, {
			template: "systems/stonetop-pwd/templates/dialogs/content-picker.hbs",
			classes: ["stonetop", "stonetop-content-picker-dialog"],
			width: 440,
			height: "auto",
			resizable: true,
		});
	}

	getData() {
		return { body: this._body, buttonLabel: this._buttonLabel, bodyClass: this._bodyClass };
	}

	activateListeners(html) {
		super.activateListeners(html);
		const form = html[0];
		if (!form) return;
		this._wire?.(form);
		form.addEventListener("submit", event => {
			event.preventDefault();
			this._resolveWith(this._read(form));
		});
	}

	async _render(force, options) {
		await super._render(force, options);
		const form = this.element?.[0]?.querySelector?.(".stonetop-content-picker-form");
		if (this._shown || !form) return;
		this._shown = true;
		form.querySelector(".stonetop-content-picker-confirm")?.focus?.({ preventScroll: true });
		this._onShow?.(form);
	}
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

	return ContentPickerDialog.ask({
		title, buttonLabel, width: 480,
		body: `${rows}${own}`,
		// Typing is choosing. Without this a GM writes their line, presses Add, and gets whichever
		// authored row happened to be selected — their words dropped with nothing said.
		wire: content => {
			content.querySelector('input[name="custom"]')?.addEventListener("input", () => {
				content.querySelector(`input[name="pick"][value="${_WRITE_ID}"]`).checked = true;
			});
		},
		read: form => {
			const pick = form.querySelector('input[name="pick"]:checked')?.value ?? null;
			if (pick !== _WRITE_ID) return pick ? { key: pick } : null;
			const text = String(form.querySelector('input[name="custom"]')?.value ?? "").trim();
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
