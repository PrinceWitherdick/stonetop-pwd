/**
 * Height-balanced card packing for the sheet's card grids (arcana, special moves, moves).
 *
 * CSS multi-column fills strictly in document order and balances by picking ONE column height
 * for the whole list, so a card taller than that height starts a new column and everything
 * after it stacks below, leaving the column to its left half empty. Placing each card in the
 * currently-shortest column instead keeps authored order and fills the short column first,
 * which is where a reader expects the next card anyway. Cards also stay whole: a tall card
 * never splits across a column break.
 *
 * Every grid packs the same way and only the PLACEMENT differs, so the scaffolding lives here
 * once: the one-time card capture, the per-width guard that makes a re-pack idempotent (and
 * breaks the feedback loop, since packing changes the container's own height, which would
 * otherwise re-trigger the observer), the ResizeObserver wiring, and the teardown.
 *
 * Foundry-free and DOM-only, so it is shared by any sheet that grows a card grid.
 */

/**
 * How many equal-width column tracks fit in `width`, given a minimum track width and the gap
 * between tracks. Always at least 1, capped at `max` when given.
 */
export function fitColumns(width, { minPx, gapPx, max = Infinity }) {
	return Math.max(1, Math.min(max, Math.floor((width + gapPx) / (minPx + gapPx))));
}

/**
 * `count` fresh column elements of one class, ready to be filled. `tag` is the element to
 * build: a grid of <div> tracks by default, but a packed <ul> needs <li> tracks to stay
 * valid markup.
 */
export function makeColumns(count, className, tag = "div") {
	return Array.from({ length: count }, () => {
		const col = document.createElement(tag);
		col.className = className;
		return col;
	});
}

/**
 * Place each card in the currently-shortest column, in the order given.
 *
 * `heightOf` measures a card, `appendTo` puts it in its column (a track may nest an inner list,
 * so the caller decides where the card actually lands). Ties keep the LEFTMOST column, so the
 * first cards of an empty grid fill left to right, as reading order expects.
 */
export function packShortest(cards, columns, heightOf, appendTo = (col, card) => col.appendChild(card)) {
	const heights = new Array(columns.length).fill(0);
	for (const card of cards) {
		let i = 0;
		for (let c = 1; c < columns.length; c++) if (heights[c] < heights[i]) i = c;
		heights[i] += heightOf(card);
		appendTo(columns[i], card);
	}
	return heights;
}

/**
 * Build a packer for one kind of grid.
 *
 *   cards      selector for the cards inside the container, captured once per container so the
 *              authored order survives every re-pack (packing moves them into column elements).
 *   reset      optional: put the container back to its unpacked state before measuring, so every
 *              card measures at the width it will actually render at.
 *   layoutKey  optional: the only thing about `width` this grid's layout depends on (usually the
 *              column count). Called with (width, container). When it hasn't changed, the re-pack
 *              is skipped outright, so dragging a sheet edge doesn't re-parent every card on every
 *              frame. Omit for a grid whose layout varies continuously with width.
 *   place      the placement itself: returns the nodes to hand the container, or null when the
 *              cards aren't measurable yet (a hidden tab), which leaves the guard unset so the
 *              next observer notification tries again.
 *
 * @returns {(container: Element) => void}
 */
export function createPacker({ cards: cardSelector, reset, layoutKey, place }) {
	return function pack(container) {
		const cards = (container._stonetopCards ??= Array.from(container.querySelectorAll(cardSelector)));
		const width = container.clientWidth;
		if (!cards.length || !width || container._packedWidth === width) return;

		const key = layoutKey?.(width, container);
		if (key !== undefined && container._packedKey === key) { container._packedWidth = width; return; }

		reset?.(container, cards);
		const nodes = place(cards, width, container);
		if (!nodes) return; // not measurable yet: leave the guard unset and retry on the next notification

		container.replaceChildren(...nodes);
		container._packedWidth = width;
		container._packedKey = key;
	};
}

/**
 * Pack every container now and keep them packed.
 *
 * The immediate pass matters: the visible grid has width already (the tab is active), so packing
 * it here puts its final, shorter height in place before Foundry restores scrollTop. Leaving it
 * to the observer would repack after the restore and clamp the scroll position.
 *
 * The observer then fires when a grid first becomes measurable (its tab is shown, 0 to a real
 * width) and on every sheet resize. Notifications are coalesced into one animation frame, so a
 * drag that crosses several widths repacks once per frame rather than once per notification.
 *
 * @returns {{repack: () => void, disconnect: () => void}}
 */
export function wireMasonry(pack, containers) {
	const targets = Array.from(containers);
	const pending = new Set();
	let frame = 0;

	const flush = () => {
		frame = 0;
		for (const el of pending) pack(el);
		pending.clear();
	};
	const observer = new ResizeObserver(entries => {
		for (const entry of entries) pending.add(entry.target);
		frame ||= requestAnimationFrame(flush);
	});

	for (const el of targets) {
		pack(el);
		observer.observe(el);
	}

	return {
		// Something other than width changed the cards' heights (a card collapsed, a search hid
		// half of them), which the width guard would otherwise hold the stale packing through.
		//
		// `only` narrows it to the grid that actually changed. A tab can show several of these at
		// once, and folding one card open is no reason to re-parent and re-measure every card in
		// the sibling grids, which is what packing them all again amounts to.
		repack(only = null) {
			for (const el of only ? [only] : targets) {
				if (only && !targets.includes(el)) continue;
				el._packedWidth = null;
				el._packedKey = null;
				pack(el);
			}
		},
		disconnect() {
			if (frame) cancelAnimationFrame(frame);
			frame = 0;
			pending.clear();
			observer.disconnect();
		},
	};
}
