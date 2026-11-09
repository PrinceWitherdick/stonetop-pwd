/**
 * Shared scrollable autocomplete popup — a drop-in replacement for native
 * `<datalist>` suggestion dropdowns.
 *
 * Chromium's native datalist popup renders no scrollbar once the option list is
 * taller than the popup (longstanding engine bug crbug.com/375637 / electron#45586),
 * so the bottom of a long suggestion list is unreachable. This helper keeps the field
 * a free-type input but swaps the broken native popup for our own: a single `<ul>` on
 * `<body>` (`position: fixed`, so no sheet/dialog scroll container can clip it),
 * height-capped so it never stretches the full screen, with a real scrollbar.
 *
 * The popup is a process-wide singleton reused by every registered input — only one
 * input is ever focused at a time. Inputs stay free-type: these are suggestions, not
 * a closed list. Picking one fires `input` + `change` (bubbling), exactly as choosing
 * a native datalist option would, so existing field handlers keep working unchanged.
 */

const MAX_HEIGHT = 250; // Foundry-style cap so the list never fills the screen.

/**
 * Normalise one supplied option. An option may be a bare string (every caller before hints
 * existed) or `{ value, hint }`, where the hint is a dimmed second column — where an NPC lives,
 * say — shown to tell two people of the same name apart. Only `value` is ever inserted into the
 * field; the hint is display and search fodder and never becomes text the caller has to parse
 * back off, which is the trap a "Name (Home)" value string would have set.
 */
const asOption = o => (typeof o === "string"
	? { value: o, hint: "" }
	: { value: String(o?.value ?? ""), hint: String(o?.hint ?? "") });

class StonetopAutocompleteController {
	constructor() {
		this._popup = null;
		this._input = null;
		this._index = -1;
		// Set while we replay a pick's synthetic `input` event, so our own input
		// listener doesn't immediately re-open the popup we're about to close.
		this._suppress = false;
	}

	/**
	 * Upgrade every `<input list="…">` under `root`, replacing its native datalist
	 * popup with ours. The linked `<datalist>` is kept as the live option source (so
	 * datalists refreshed at runtime stay current) but the `list` attribute is removed
	 * to suppress the native popup. `root` may be a jQuery object or an Element.
	 *
	 * An option's `label` attribute becomes its dimmed hint column. That is the attribute a
	 * native datalist already means this by, so a template declares the pair in markup
	 * (`<option value="Brennan" label="Marshedge">`) and nothing has to be wired in JS. Options
	 * without one — which is every datalist that existed before hints did — carry no hint.
	 */
	upgradeAll(root) {
		const el = root?.jquery ? root[0] : root;
		if (!el) return;
		el.querySelectorAll("input[list]").forEach(input => {
			const listId = input.getAttribute("list");
			const datalist = el.querySelector(`datalist#${CSS.escape(listId)}`)
				?? document.getElementById(listId);
			if (!datalist) return;
			input.removeAttribute("list");
			// Read live each time so a datalist rebuilt at runtime is reflected.
			this.attach(input, () => [...datalist.querySelectorAll("option")]
				.map(o => ({ value: o.value, hint: o.getAttribute("label") ?? "" }))
				.filter(o => o.value));
		});
	}

	/**
	 * Attach the popup to a single input. `options` is an array or a getter returning one (read
	 * fresh on every open, for dynamic suggestion sets). Each entry is a bare string, or
	 * `{ value, hint }` to put a dimmed second column beside it — see asOption.
	 */
	attach(input, options) {
		if (input._stAutocomplete) return;
		input._stAutocomplete = true;
		const getOptions = typeof options === "function" ? options : () => options;
		input.addEventListener("focus",   () => this._open(input, getOptions));
		input.addEventListener("input",   () => this._open(input, getOptions));
		input.addEventListener("blur",    () => this.close());
		input.addEventListener("keydown", ev => this._onKeydown(ev, input, getOptions));
	}

	close() {
		this._input = null;
		this._index = -1;
		if (this._popup) this._popup.style.display = "none";
	}

	_ensurePopup() {
		if (this._popup) return this._popup;
		const popup = document.createElement("ul");
		popup.className = "stonetop-autocomplete";
		popup.style.display = "none";
		// pointerdown (not click) so it fires before the input's blur handler closes
		// the popup; preventDefault keeps focus on the input, so dragging the scrollbar
		// or picking an option never blurs (and so never dismisses) the list.
		popup.addEventListener("pointerdown", ev => {
			ev.preventDefault();
			const option = ev.target.closest(".stonetop-autocomplete-option");
			if (option && this._input) this._choose(this._input, option.dataset.value);
		});
		// Keep the fixed popup pinned to its input as a sheet body or the window scrolls.
		this._reflow = () => {
			if (this._input?.isConnected && popup.style.display !== "none") this._position(this._input);
			else this.close();
		};
		window.addEventListener("scroll", this._reflow, true);
		window.addEventListener("resize", this._reflow);
		document.body.appendChild(popup);
		this._popup = popup;
		return popup;
	}

	_open(input, getOptions) {
		if (this._suppress) return;
		const query = input.value.trim().toLowerCase();
		// Matched against the hint as well as the value, so typing a place ("marshedge") narrows
		// to the people from it. Picking one still inserts only their name.
		const matches = getOptions()
			.map(asOption)
			.filter(o => o.value)
			.filter(o => `${o.value} ${o.hint}`.toLowerCase().includes(query));
		// Nothing to suggest (or the field already holds the sole exact match) → no popup.
		if (!matches.length || (matches.length === 1 && matches[0].value.toLowerCase() === query)) {
			this.close();
			return;
		}
		const esc = foundry.utils.escapeHTML;
		const popup = this._ensurePopup();
		popup.innerHTML = matches
			.map(o => `<li class="stonetop-autocomplete-option" data-value="${esc(o.value)}">`
				+ `<span class="stonetop-autocomplete-value">${esc(o.value)}</span>`
				+ (o.hint ? `<span class="stonetop-autocomplete-hint">${esc(o.hint)}</span>` : "")
				+ `</li>`)
			.join("");
		this._input = input;
		this._index = -1;
		popup.style.display = "block";
		this._position(input);
	}

	_position(input) {
		placeFixedPopup(this._popup, input.getBoundingClientRect(), { maxHeight: MAX_HEIGHT, openUpBelow: 160, minHeight: 80 });
	}

	_onKeydown(ev, input, getOptions) {
		const open = this._popup && this._popup.style.display !== "none" && this._input === input;
		if (!open) {
			if (ev.key === "ArrowDown") this._open(input, getOptions);
			return;
		}
		const items = [...this._popup.querySelectorAll(".stonetop-autocomplete-option")];
		if (!items.length) return;
		switch (ev.key) {
			case "ArrowDown":
				ev.preventDefault();
				this._index = Math.min(this._index + 1, items.length - 1);
				this._highlight(items);
				break;
			case "ArrowUp":
				ev.preventDefault();
				this._index = Math.max(this._index - 1, 0);
				this._highlight(items);
				break;
			case "Enter":
				if (this._index >= 0) {
					ev.preventDefault();
					this._choose(input, items[this._index].dataset.value);
				}
				break;
			case "Escape":
				this.close();
				break;
		}
	}

	_highlight(items) {
		items.forEach((li, i) => li.classList.toggle("is-active", i === this._index));
		items[this._index]?.scrollIntoView({ block: "nearest" });
	}

	_choose(input, value) {
		input.value = value;
		// Replay what a native datalist pick fires (input → change), without letting the
		// synthetic input event re-open the popup we're about to close.
		this._suppress = true;
		input.dispatchEvent(new Event("input", { bubbles: true }));
		input.dispatchEvent(new Event("change", { bubbles: true }));
		this._suppress = false;
		this.close();
	}
}

/**
 * Pin a `position: fixed` popup 2px under `rect` (the field or button it belongs to), or over it
 * when the room below is under `openUpBelow` (capped at `maxHeight`) and there is more above. Its
 * height is capped at `maxHeight` and the room it opens into, but never below `minHeight`. With a
 * `minWidth` it is at least that wide and kept 8px inside the window; without, it matches `rect`.
 * Shared by this popup and the suggestion menu (utils/suggestion-menu.js), which differ only in numbers.
 */
export function placeFixedPopup(popup, rect, { maxHeight, openUpBelow, minHeight, minWidth = null }) {
	const gap = 2;
	const below = window.innerHeight - rect.bottom - gap;
	const above = rect.top - gap;
	// Open downward unless that would be cramped and there's more room above.
	const up = below < Math.min(maxHeight, openUpBelow) && above > below;
	if (minWidth == null) {
		popup.style.left = `${rect.left}px`;
		popup.style.width = `${rect.width}px`;
	} else {
		const width = Math.min(Math.max(rect.width, minWidth), window.innerWidth - 16);
		popup.style.width = `${width}px`;
		popup.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - width - 8))}px`;
	}
	popup.style.maxHeight = `${Math.max(minHeight, Math.min(maxHeight, up ? above : below))}px`;
	popup.style.top = up ? "auto" : `${rect.bottom + gap}px`;
	popup.style.bottom = up ? `${window.innerHeight - rect.top + gap}px` : "auto";
}

/** Process-wide singleton — one popup serves every registered input. */
export const StonetopAutocomplete = new StonetopAutocompleteController();
