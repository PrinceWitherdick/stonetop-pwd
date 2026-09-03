// The GM playbook's two flowcharts, as the GM Toolkit's Core Loop tab needs them.
//
// These are the one part of the toolkit that is a PICTURE rather than transcribed text. The
// move lists in gm-moves.js are facts about the rules and are typed out in this repo; the
// flowcharts are the publisher's own artwork, so they ship nowhere and exist in a world only
// after the GM runs "Import Book Art" against their own copy of the (free) GM playbook PDF.
//
// Which of them are on disk is answered by the world-scoped `gmDiagramArt` index — the same
// shape and the same reasoning as `treasureArt` (see settings.js): nothing in any compendium
// points at these files, so an index published by the GM-side passes is the only way to know.
// Resolving through `book2ArtSrc` rather than assembling a path is what makes the tab work on
// a hosted Foundry, where the durable art folder is served from somewhere else entirely.
import { book2ArtSrc } from "../book2-art/art-root.js";
import { getObjectSetting } from "../settings.js";
import { localize } from "../utils/i18n.js";
import { GM_CORE_LOOP, GM_FLOW_OF_PLAY } from "./gm-loop-text.js";
import { bookPageCites } from "./book-ref.js";

/**
 * The diagrams the tab shows, in the order the playbook prints them (core loop on the left-hand
 * page, flow of play facing it).
 *
 * `slug` is the key the manifest and the `gmDiagramArt` index agree on; nothing derives a path
 * from it. `captionKey`/`noteKey` are i18n keys rather than strings so this stays a plain data
 * table the tests can read without a Handlebars or Foundry environment.
 */
export const GM_DIAGRAMS = [
	{
		slug: "core-loop",
		captionKey: "stonetop.gmToolkit.loop.coreLoop",
		noteKey: "stonetop.gmToolkit.loop.coreLoopNote",
		// What the picture SAYS, so the tab reads with or without the artwork. The core loop is
		// five NUMBERED steps that cycle; the flow of play is stages a campaign moves between,
		// and numbering those would promise an order the chart does not have.
		steps: GM_CORE_LOOP,
		numbered: true,
	},
	{
		slug: "flow-of-play",
		captionKey: "stonetop.gmToolkit.loop.flowOfPlay",
		noteKey: "stonetop.gmToolkit.loop.flowOfPlayNote",
		steps: GM_FLOW_OF_PLAY,
		numbered: false,
	},
];

/**
 * The tab's context: one entry per diagram, each with a `src` when this world has the file and
 * null when it does not.
 *
 * Every entry is returned either way, rather than only the imported ones. The tab draws a
 * labelled placeholder in the gap, so a GM who imported one of the two sees which one is
 * missing instead of a page that silently looks complete.
 */
export function gmDiagrams() {
	// Through the shared tolerant reader, like the sibling art indexes (treasureArt, peopleArt,
	// peoplePortraitArt): `{}` rather than a throw in a world that never registered the setting,
	// and `{}` rather than a surprise if the stored value is a scalar or an array.
	const index = getObjectSetting("gmDiagramArt");
	return GM_DIAGRAMS.map(d => {
		const out = index[d.slug];
		return {
			slug: d.slug,
			caption: localize(d.captionKey),
			note: localize(d.noteKey),
			src: out ? book2ArtSrc(out) : null,
			numbered: d.numbered,
			// The chart as text, with each stage's chapter citation resolved. Always present:
			// the picture is the optional half of this tab, not this.
			steps: d.steps.map(step => ({ ...step, pageCites: bookPageCites(step) })),
		};
	});
}
