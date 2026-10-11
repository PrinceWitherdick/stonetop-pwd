// Walk the text nodes under `container`, skipping any inside `skip`, and rewrite each node that
// contains a `regex` match: the text between matches is preserved verbatim and each match is
// replaced by whatever `render` returns for it. The one home for this TreeWalker-and-rebuild
// dance shared by the inline tooltip/glyph enhancers.
//
//   • skip   — a CSS selector; a text node whose parent `.closest(skip)` is left untouched
//              (covers editable controls, content links, and already-wrapped terms for idempotency).
//   • regex  — a GLOBAL RegExp; `matchAll` walks each node's text with it.
//   • render — (match, nodeText) => Node | Node[] | string | null. Return null/undefined to keep
//              the raw matched text; a string becomes a text node; an array appends each in order.
//
// Callers keep their own cheap `container.textContent` pre-check + setting gate before calling.
export function replaceTextMatches(container, { skip, regex, render }) {
	if (!container?.querySelectorAll) return;

	// No `acceptNode` filter: a JS filter is a native-to-JS call for every text node in the
	// container, whitespace included, and on a character sheet that crossing (plus a `.closest`
	// against the whole skip list each time) was most of the walk. Match the text first and ask
	// `.closest` only of the handful of nodes that actually hold a match.
	const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
	const toReplace = [];
	let node;
	while ((node = walker.nextNode())) {
		regex.lastIndex = 0;
		if (regex.test(node.data) && !node.parentElement?.closest(skip)) toReplace.push(node);
	}

	const append = (frag, out) => {
		if (out == null) return false;
		if (Array.isArray(out)) { out.forEach(n => append(frag, n)); return true; }
		frag.appendChild(typeof out === "string" ? document.createTextNode(out) : out);
		return true;
	};

	for (const textNode of toReplace) {
		const text = textNode.textContent;
		const frag = document.createDocumentFragment();
		let lastIdx = 0;
		// Reset before matchAll: it seeds its iterator from the regex's lastIndex, which the
		// `.test()` pre-scan above left advanced — without this, early matches would be skipped.
		regex.lastIndex = 0;
		for (const match of text.matchAll(regex)) {
			if (match.index > lastIdx) frag.appendChild(document.createTextNode(text.slice(lastIdx, match.index)));
			if (!append(frag, render(match, text))) frag.appendChild(document.createTextNode(match[0]));
			lastIdx = match.index + match[0].length;
		}
		if (lastIdx < text.length) frag.appendChild(document.createTextNode(text.slice(lastIdx)));
		textNode.parentNode?.replaceChild(frag, textNode);
	}
}
