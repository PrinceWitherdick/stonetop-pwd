/**
 * Collapsible magnifying-glass tab filter (see templates/actor/partials/tab-search-control.hbs
 * and the `.stonetop-tab-search` CSS). A round icon button sits beside a section's header text
 * and expands into a filter box on click; typing hides non-matching items live, client-side.
 *
 * `scope` is the element that holds BOTH the `.stonetop-tab-search` control and the items it
 * filters. It also carries `.is-searching` while a term is active, which some tabs key CSS off
 * to keep matches from being hidden by another rule (Moves' "hide un-learned", Arcana's collapsed
 * sections). Matching items stay; the rest get `.stonetop-search-hidden` (a class, not the `hidden`
 * prop, so the CSS `!important` beats an item's own `display:flex`). Group / section headers are
 * intentionally left in place, since the search box lives inside one and hiding an "empty" header
 * could hide the box itself.
 *
 * Scope the control to whatever container you want it to filter: a whole tab (`.tab.moves`) or a
 * single column / section within one (`.stonetop-inventory-regular`), so sibling sections each get
 * their own independent filter.
 *
 * A live term is DOM state, so a re-render would drop it: the sheet re-renders on plenty of
 * things a reader does mid-search (rolling a move from its title, editing an item), and each one
 * used to hand back the unfiltered list, scrolled to the top, with the box shut. Pass `memory`
 * (a plain object the APPLICATION owns, so it outlives the DOM and dies with the sheet) plus a
 * `key` to hold this control's term in, and the filter comes back on the next render instead.
 *
 * @param {HTMLElement|null} scope           Container holding the control and the items.
 * @param {object} opts
 * @param {string} opts.itemSel              Selector, resolved within `scope`, for filterable items.
 * @param {(el: HTMLElement) => string} opts.textFor  Returns the searchable text for one item.
 * @param {() => void} [opts.onFilter]       Called after each pass, for a tab that has to react to
 *                                           the new visible set (the Moves tab re-packs its masonry
 *                                           columns). Hung off `apply` rather than the input's
 *                                           `input` event so it also fires on the paths that clear
 *                                           the term without one: Escape, and closing the box.
 * @param {object} [opts.memory]             Store, owned by the caller, that the live term is kept
 *                                           in under `key` so it survives a re-render. Omit both to
 *                                           get the old behaviour: the term lasts one render.
 * @param {string} [opts.key]                Slot in `memory`. Must be unique per control on one
 *                                           application (two sibling sections each have their own).
 */
export function wireTabSearch(scope, {itemSel, textFor, onFilter, memory = null, key = null}) {
	const box    = scope?.querySelector(".stonetop-tab-search");
	const input  = box?.querySelector(".stonetop-tab-search-input");
	const toggle = box?.querySelector(".stonetop-tab-search-toggle");
	if (!scope || !box || !input || !toggle) return;

	const items = [...scope.querySelectorAll(itemSel)];
	// The search index (per-item text, which may need a nested DOM walk) is built lazily on first
	// use, not on every render (the box is almost never open). Editing an item re-renders the sheet,
	// which rebuilds these elements and drops the cache, so it never goes stale against live inputs.
	//
	// `notify` is the one caller-visible flag: the restore below wants the classes without the
	// callback (see there for why).
	const apply = ({notify = true} = {}) => {
		const term = input.value.trim().toLowerCase();
		if (memory && key) memory[key] = input.value;
		scope.classList.toggle("is-searching", !!term);
		for (const item of items) {
			if (term && item._stSearchText === undefined)
				item._stSearchText = (textFor(item) ?? "").toLowerCase();
			item.classList.toggle("stonetop-search-hidden", !!term && !item._stSearchText.includes(term));
		}
		if (notify) onFilter?.();
	};
	// Wrapped, not passed straight in: the handler is called with the Event, which would land in
	// the options object.
	input.addEventListener("input", () => apply());

	// The Arcana control sits inside a click-to-collapse <summary>; keep its own clicks / keys from
	// bubbling up and toggling that collapse.
	box.addEventListener("click", ev => ev.stopPropagation());
	box.addEventListener("keydown", ev => ev.stopPropagation());
	// preventDefault on mousedown so clicking the button never pulls focus off the input; otherwise
	// the blur-to-collapse below would fight the toggle.
	toggle.addEventListener("mousedown", ev => ev.preventDefault());
	toggle.addEventListener("click", () => {
		if (box.classList.contains("is-open")) {
			box.classList.remove("is-open");
			if (input.value) { input.value = ""; apply(); }
			input.blur();
		} else {
			box.classList.add("is-open");
			input.focus();
		}
	});
	input.addEventListener("keydown", ev => {
		if (ev.key !== "Escape") return;
		input.value = ""; apply();
		box.classList.remove("is-open");
		input.blur();
	});
	// Clicking away collapses an empty box; one holding a live term stays open.
	input.addEventListener("blur", () => { if (!input.value.trim()) box.classList.remove("is-open"); });

	// The term this control was left holding when the DOM it lived in was replaced. The box is
	// re-opened with it, so an active filter is never hiding items behind a shut box. Focus is NOT
	// taken: the re-render usually follows a click somewhere else on the sheet, and a dialog it
	// opened may already own the caret.
	//
	// `notify: false` because `onFilter` at this point is the PREVIOUS render's callback, closed
	// over containers this DOM has just replaced. Nothing is lost: the filter classes are what a
	// packer reads, and they land here, before this render wires and runs its own first pack.
	if (memory && key && memory[key]) {
		input.value = memory[key];
		box.classList.add("is-open");
		apply({notify: false});
	}
}
