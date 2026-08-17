import { StonetopDialog } from "../../utils/stonetop-dialog.js";
import { book2ArtPrefix, book2ArtRoot, book2ArtServedWith, book2ArtSrcWith } from "../../book2-art/art-root.js";
import { splitAtArtRoot } from "../../book2-art/browse.js";
import { BOOK2_ART_APPLY_MANIFEST } from "../../book2-art/manifest.js";
import { displayPortraitSrc, portraitRectOf } from "../../book2-art/people-portraits.js";
import { normalizeFrame } from "../../utils/portrait-frame.js";
import { getObjectSetting } from "../../settings.js";
import { filePicker } from "../../utils/foundry-compat.js";
import { pickRandomExcluding } from "../../utils/arrays.js";

// How long the grid takes to travel to a rolled portrait, however far away it landed. The
// browser's own `scrollIntoView({behavior:"smooth"})` picks its own duration and scales it
// with distance, so in a ~155-tile grid a roll clear across the gallery took noticeably
// longer than one nearby — and rolling repeatedly meant waiting on the scroll every time.
const ROLL_SCROLL_MS = 200;

/**
 * Where the gallery body has to be scrolled to put a tile in the middle of it, clamped to
 * the ends of the scroll range so a roll near the top or bottom doesn't ask for an
 * impossible offset (and then appear not to move, having asked for one it was already at).
 *
 * Takes measurements rather than elements so the centring is testable without a DOM: `*Top`
 * values are viewport-relative rects, `scrollTop`/`scrollHeight` the body's own.
 */
export function rolledScrollTop({ scrollTop, viewTop, viewHeight, tileTop, tileHeight, scrollHeight }) {
	const centred = scrollTop + (tileTop - viewTop) - (viewHeight - tileHeight) / 2;
	return Math.max(0, Math.min(centred, scrollHeight - viewHeight));
}

/**
 * The identity of a portrait, whichever way it is being held.
 *
 * A face is stored as the SQUARE once one has been cut, but a portrait chosen before squares
 * existed is still the whole illustration, and the two paths are different strings for the same
 * person. Everything that asks "is this the same portrait?" — selected, used-by, and the roll's
 * "give me a different one" — has to ask it on one of the two, and the whole illustration is the
 * one that always exists. Anything that is not gallery art (a browsed file) is its own identity.
 */
export const asFullPortrait = displayPortraitSrc;

/**
 * The comparable identity of a held portrait: its whole-illustration form, reduced to the path
 * INSIDE the durable art folder.
 *
 * Two paths can name the same picture and not match as strings. A square and its illustration are
 * the pair `asFullPortrait` exists for; the other pair is a path written before this world knew
 * where its art was actually served from (a bare `stonetop-book-art/…`) against the same file
 * spelled with the host's prefix (`https://assets.forge-vtt.com/<userId>/stonetop-book-art/…`).
 * Cutting everything up to and including the root settles that second pair, because a root and a
 * host prefix are both things that sit in FRONT of the part that identifies the picture.
 *
 * Cutting all the way down to the BASENAME would settle it too, and that is what this did — but a
 * file outside the art folder then answers to a gallery tile merely by sharing its name. A GM's own
 * `worlds/mine/npcs/b1-p135-x526.webp` was marked "used by" whoever holds it and hidden from the
 * Unused filter, for a portrait nobody is wearing. Art outside the root keeps its whole path and so
 * is only ever equal to itself.
 *
 * Used for every "is this the same portrait?" question the gallery asks — selected, used-by, and
 * the roll's avoid-the-current-one — but never to BUILD a path.
 *
 * `root` is injectable for the same reason `book2ArtPrefix` is hoisted in getData: every caller
 * asks this once PER ITEM — once per used portrait, and once per pool tile inside the roll — so
 * reading the setting in here means one `game.settings.get` per element of a 155-tile pool for a
 * value that cannot change between iterations. Callers with a root already in hand pass it.
 */
export const portraitIdentity = (src, root = book2ArtRoot()) => {
	if (!src) return "";
	// `splitAtArtRoot` is the browse's own answer to "what is in front of the root, and what
	// identifies the file?" — the same question asked of a stored path instead of a listed one.
	// Sharing it is what keeps a gallery tile and a browse result agreeing about one picture; it
	// also matches on the DEEPEST occurrence of the root, so a URL that happens to repeat it
	// higher up still resolves to the file.
	return splitAtArtRoot(String(asFullPortrait(src)), root).key;
};

/**
 * Choose one portrait at random out of `srcs` — which the caller has already narrowed to the
 * tiles the filters leave on screen, so "feminine, not a child, surprise me" works.
 *
 * Prefers a portrait other than `current`, so rolling again on a member who already has one
 * always lands somewhere new; falls back to the whole pool when the current portrait is the
 * only thing showing. `rng` is injectable so the tests can pin the roll.
 *
 * Compares through `keyOf`, which defaults to comparing the raw strings. The gallery passes
 * `portraitIdentity`, because the pool and the held portrait are routinely spelled differently
 * for the same picture — see there.
 */
export function pickRandomPortrait(srcs, { current = "", rng = Math.random, keyOf = (s) => s } = {}) {
	return pickRandomExcluding(srcs, { exclude: current, rng, keyOf });
}

/**
 * The "People of Stonetop" portrait gallery: pick an imported book illustration as a
 * resident's or neighbor's portrait on the steading sheet.
 *
 * The images are the ones a GM tagged as people in the local art picker and imported from
 * their own book PDF (they are copyrighted, so nothing ships). Which of them are on disk, and
 * what to label each, is broadcast in the world-scoped `peopleArt` setting — a { manifest out
 * path -> display name } map published by the Import Book Art macro and book2-art/reapply.js.
 * Reading that setting (instead of browsing files) is what lets this work for players too, who
 * cannot FilePicker.browse. Each `out` resolves against the durable art folder (`book2ArtRoot`),
 * the exact path the index checked for, so a listed portrait always loads.
 *
 * Falls back to a normal FilePicker via "Browse files…" for a custom image (offered only to a
 * user who can browse), and "Use default" clears the portrait back to the placeholder.
 */
export class PeopleGalleryDialog extends StonetopDialog {
	constructor({ current = "", canBrowse = false, used = {}, onPick, onBrowse, onClear } = {}, options = {}) {
		super(options);
		this._current = current;
		this._canBrowse = canBrowse;
		// { src -> who already wears it }, built by the caller from the rest of the roster.
		this._used = used ?? {};
		this._onPick = onPick;
		this._onBrowse = onBrowse;
		this._onClear = onClear;
	}

	static get defaultOptions() {
		return foundry.utils.mergeObject(super.defaultOptions, {
			id: "stonetop-people-gallery",
			title: "People of Stonetop",
			template: "systems/stonetop-pwd/templates/dialogs/people-gallery.hbs",
			width: 640,
			height: "auto",
			resizable: true,
			classes: ["stonetop", "stonetop-people-gallery"],
		});
	}

	/** The broadcast { out -> name } index, tolerant of an unregistered/legacy setting. */
	_peopleIndex() {
		return getObjectSetting("peopleArt");
	}

	/**
	 * The broadcast { illustration out -> square out } index: which portraits have their
	 * hand-authored square face on disk. Empty in a world whose GM has not run the rebuild (or
	 * whose build predates squares), which is exactly right — every such portrait then offers
	 * and commits the whole illustration, as it always did.
	 */
	_squareIndex() {
		return getObjectSetting("peoplePortraitArt");
	}

	/**
	 * Sorting traits by manifest `out` path. The broadcast index says which portraits are on
	 * disk; the shipped manifest says what each one IS — how it presents, and whether it's a
	 * child — as tagged in the local art picker. They are joined here rather than folded into
	 * the setting so the setting stays a plain { out -> name } map (nothing to migrate in a
	 * world that already has one), and because traits are static authored data, not per-world.
	 */
	static _traitsByOut() {
		const map = {};
		for (const p of BOOK2_ART_APPLY_MANIFEST.people ?? []) {
			map[p.out] = { presenting: p.presenting || "", kid: !!p.kid };
		}
		return map;
	}

	getData() {
		const idx = this._peopleIndex();
		const squares = this._squareIndex();
		const root = book2ArtRoot();
		// Where this host actually serves the art folder from. Empty on a self-hosted Foundry, so
		// the tiles are built exactly as they always were; the Assets Library origin on The Forge,
		// where the bare path 404s. Read once per render rather than per tile — 155 of them.
		const prefix = book2ArtPrefix();
		const traits = PeopleGalleryDialog._traitsByOut();
		// Everything about "is this the same person" is decided on the portrait's identity — see
		// portraitIdentity — because one picture can be held under several paths: an actor picked
		// before squares existed carries the illustration and one picked after carries the square,
		// and either can be spelled with or without this host's prefix.
		//
		// Only the HELD paths need reducing. A tile is built FROM the manifest, so its identity is
		// already known — `${root}/${out}`, the same key the browse and every art index use — and
		// re-deriving it from the path built one line below would cost a setting read and a
		// manifest lookup on each of 155 tiles, twice over, to arrive back where it started.
		const currentKey = portraitIdentity(this._current, root);
		const usedByKey = {};
		for (const [src, who] of Object.entries(this._used ?? {})) usedByKey[portraitIdentity(src, root)] = who;
		const people = Object.entries(idx).map(([out, name]) => {
			const key = book2ArtSrcWith(root, out);
			const full = book2ArtServedWith(root, out, prefix);
			// The square is what the tile SHOWS, so the grid is a preview of the sheet rather
			// than of the book page. The whole illustration is one hover away, which is where a
			// standing figure actually reads.
			//
			// What gets COMMITTED is the whole illustration plus the square as a frame over it —
			// see `_choose`. The tile still previews the square because that is what the sheet
			// will draw; only the way it gets there has changed.
			const square = squares[out] ? book2ArtServedWith(root, squares[out], prefix) : "";
			const src = square || full;
			// A portrait with no manifest entry (an older import, or a file dropped in by hand)
			// is untagged, which is the same bucket as one deliberately left unspecified.
			const t = traits[out] ?? { presenting: "", kid: false };
			const selected = key === currentKey;
			// "Used" always means used by somebody ELSE. Every caller leaves the person being
			// edited out of the map it hands over, but the guarantee is made here too rather than
			// resting on all of them getting it right: the scans now reach the whole world, and
			// two people can legitimately share a face — so without this, the very portrait
			// somebody is wearing could come back marked as taken from them, and the "Unused"
			// filter would hide the tile that is currently selected.
			const usedBy = selected ? "" : (usedByKey[key] ?? "");
			return {
				out, name, src, full, isSquare: !!square,
				selected, presenting: t.presenting, kid: t.kid, usedBy,
			};
		});
		people.sort((a, b) => (a.name || "").localeCompare(b.name || "") || a.out.localeCompare(b.out));
		// Counts ride on the chips so it's clear what narrowing will cost before you click.
		const counts = {
			all: people.length,
			masculine: people.filter((p) => p.presenting === "masculine").length,
			feminine: people.filter((p) => p.presenting === "feminine").length,
			// Not the complement of masculine+feminine: the picker's tag vocabulary can grow, and
			// a portrait tagged something else is not untagged.
			unspecified: people.filter((p) => !p.presenting).length,
			kid: people.filter((p) => p.kid).length,
			used: people.filter((p) => p.usedBy).length,
		};
		// True complements, so they are subtracted rather than counted a second time: every
		// portrait is in exactly one bucket of each pair.
		counts.notKid = people.length - counts.kid;
		counts.unused = people.length - counts.used;
		// Only worth offering the filters when there is enough art for them to do something,
		// and only for the traits that were actually tagged.
		const showFilters = people.length > 1 && (counts.masculine || counts.feminine || counts.kid || counts.used);
		return {
			people, counts,
			showFilters: !!showFilters,
			hasKids: !!counts.kid,
			// Nobody has a portrait yet in a fresh world, and a lone "Unused 155" chip would
			// only be noise, so the use filter appears with the first assignment.
			hasUsed: !!counts.used,
			canBrowse: this._canBrowse,
		};
	}

	/**
	 * Narrow the grid in place rather than re-rendering: filtering is pure display, and a
	 * re-render would rebuild every <img> and throw away the scroll position mid-browse.
	 */
	_activateFilters(root, picks) {
		const chips = [...root.querySelectorAll(".stonetop-people-chip")];
		if (!chips.length) return;
		const noMatch = root.querySelector(".stonetop-people-nomatch");
		const state = { presenting: "any", kid: "any", used: "any" };
		const facets = Object.keys(state);

		const apply = () => {
			// a hover preview belonging to a tile we are about to hide would be left
			// stranded beside nothing
			this._removePortraitPreview();
			let shown = 0;
			for (const p of picks) {
				// Each tile's data-<facet> speaks the same vocabulary as that facet's chips
				// (see people-gallery.hbs), so a facet needs no decoder and a new one costs a
				// chip group and a dataset attribute — no change here.
				const ok = facets.every(facet => state[facet] === "any" || p.dataset[facet] === state[facet]);
				p.hidden = !ok;
				if (ok) shown++;
			}
			if (noMatch) noMatch.hidden = shown > 0;
			// Randomize rolls from what is showing, so it goes dead with the grid — and a
			// proposal the new filter just hid is no longer on offer, so it is withdrawn.
			if (this._proposed?.hidden) this._propose(null);
			this._syncRandomButton(shown);
		};

		for (const chip of chips) {
			chip.addEventListener("click", () => {
				const group = chip.dataset.filter;
				state[group] = chip.dataset.value;
				for (const c of chips) {
					if (c.dataset.filter === group) c.classList.toggle("is-on", c === chip);
				}
				apply();
			});
		}
	}

	// ── Picking ───────────────────────────────────────────────────────

	/**
	 * Apply a portrait and close. Only Accept gets here: every other route only proposes.
	 *
	 * Commits the WHOLE illustration and hands the square over as a FRAME, which is the layout a
	 * bestiary creature has always used and which people now share (book2-art/repoint-portraits.js
	 * has the reasoning and migrates worlds already holding the older shape). Committing the square
	 * as `img` looked identical on every surface in this system and was wrong one step outside it:
	 * a module reading `actor.img` — Image Hover on a token — got a small cropped face where the
	 * same gesture on a monster gave the artist's whole composition.
	 *
	 * The second argument carries BOTH halves of that arrangement — the frame the small round
	 * surfaces crop to, and the square file the map draws — because a caller that took only the
	 * picture would leave a following token on the tall illustration. Both are null for a tile with
	 * no square behind it and for a browsed file, which is why every `onPick` must still work from
	 * `src` alone.
	 */
	async _choose(btn) {
		const src = btn?.dataset?.full || btn?.dataset?.src;
		if (!src) return;
		const frame = this.constructor._frameOf(btn, src);
		await this._onPick?.(src, { frame, square: frame ? (btn?.dataset?.src ?? "") : "" });
		this.close();
	}

	/**
	 * The frame a tile commits: its hand-chosen rect, stamped against the picture it was measured on.
	 *
	 * Read back out of the square's own filename, which is the only place that rect survives
	 * (people-portraits.js). `data-src` IS the square whenever one was cut, so no second data
	 * channel is needed — and `portraitRectOf` returns null for the tile that carries no square
	 * (its `data-src` is the whole illustration) and for a square whose name predates the suffix,
	 * which are exactly the tiles with no frame to commit. Cache-busters are stripped there, so a
	 * served path with a query string still resolves.
	 */
	static _frameOf(btn, src) {
		const rect = portraitRectOf(btn?.dataset?.src);
		return rect ? normalizeFrame({ src, rect }) : null;
	}

	/** The tiles the filters currently leave on screen — the pool Random rolls from. */
	_visiblePicks() {
		return (this._picks ?? []).filter(p => !p.hidden);
	}

	/**
	 * Nothing showing, nothing to roll. Kept in step with the filters by their apply(), which
	 * passes the count it just tallied rather than making us walk all ~155 tiles again.
	 */
	_syncRandomButton(shown = this._visiblePicks().length) {
		if (this._randomBtn) this._randomBtn.disabled = shown === 0;
	}

	/**
	 * Hold a portrait as a PROPOSAL rather than applying it: it highlights the tile and arms
	 * Accept, so nothing is committed until you say so. Both ways in behave the same — a roll
	 * you don't like costs another click on Randomize, and a tile clicked by mistake (easy in
	 * a grid of cover-cropped thumbnails, where the wrong one is a few pixels away) costs a
	 * click on the right one, rather than a portrait you must reopen the gallery to fix.
	 *
	 * `how` only picks the wording of the hint. `scroll` is the real difference between the
	 * two: a roll lands anywhere in a ~155-tile grid, most of it off-screen, so it has to be
	 * brought into view — but a click is already under the pointer, and scrolling it to the
	 * middle would yank the grid out from under the eye that just chose it.
	 *
	 * Pass null to drop the proposal.
	 */
	_propose(tile, { how = "rolled", scroll = false } = {}) {
		if (this._proposed && this._proposed !== tile) this._proposed.classList.remove("is-proposed");
		this._proposed = tile ?? null;
		if (this._acceptBtn) this._acceptBtn.disabled = !this._proposed;
		if (tile) {
			tile.classList.add("is-proposed");
			if (scroll) this._scrollToProposed(tile);
		}
		this._updateHint(tile, how);
	}

	/**
	 * Glide the gallery body to a rolled tile in a fixed ROLL_SCROLL_MS, near or far — the
	 * point of the movement is to show WHERE the roll landed, and past a certain speed the
	 * eye follows it just as well. Animated by hand rather than with `behavior: "smooth"`
	 * because that duration is the browser's to choose, and it chooses by distance.
	 *
	 * Scrolls the body directly instead of `scrollIntoView`, which walks every scrollable
	 * ancestor and would drag the page behind the dialog around too.
	 */
	_scrollToProposed(tile) {
		this._cancelRollScroll();
		const body = this._bodyEl;
		// No scroll container (a gallery small enough to need none, or a changed template):
		// nothing to animate, and the tile is on screen already.
		if (!body) return;
		const view = body.getBoundingClientRect();
		const rect = tile.getBoundingClientRect();
		const to = rolledScrollTop({
			scrollTop: body.scrollTop, viewTop: view.top, viewHeight: body.clientHeight,
			tileTop: rect.top, tileHeight: rect.height, scrollHeight: body.scrollHeight,
		});
		const from = body.scrollTop;
		const distance = to - from;
		// Sub-pixel hops aren't worth a frame, and a reader who asked for less motion gets
		// the destination without the trip.
		if (Math.abs(distance) < 1 || window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches) {
			body.scrollTop = to;
			return;
		}
		const start = performance.now();
		const step = (now) => {
			const t = Math.min(1, (now - start) / ROLL_SCROLL_MS);
			// Ease-out cubic: leaves immediately (so the roll reads as instant) and settles
			// rather than stopping dead, which is what makes the landing legible.
			body.scrollTop = from + (distance * (1 - Math.pow(1 - t, 3)));
			this._rollScrollFrame = t < 1 ? requestAnimationFrame(step) : null;
		};
		this._rollScrollFrame = requestAnimationFrame(step);
	}

	/** Drop any scroll still in flight — a second roll, or a close, supersedes the first. */
	_cancelRollScroll() {
		if (this._rollScrollFrame) cancelAnimationFrame(this._rollScrollFrame);
		this._rollScrollFrame = null;
	}

	/**
	 * Say what is on offer, in the line that otherwise explains the grid. The tile is
	 * highlighted too, but a roll may have scrolled it from where the eye was, and the label
	 * under a cover-cropped thumbnail is easy to miss — so the name is repeated somewhere
	 * fixed, along with the reminder that nothing has been applied yet.
	 */
	_updateHint(tile, how = "rolled") {
		const hint = this._hintEl;
		if (!hint) return;
		if (!tile) {
			hint.textContent = this._hintDefault;
			return;
		}
		const name = tile.querySelector(".stonetop-people-label")?.textContent?.trim();
		// A portrait someone else already wears can be proposed either way (they are only
		// hidden if you filter them out), and the red tile edge is easy to miss mid-scroll —
		// so say it here rather than let it be discovered after Accept.
		const taken = tile.dataset.usedBy ? ` It is already assigned to ${tile.dataset.usedBy}.` : "";
		const verb = how === "picked" ? "Picked" : "Rolled";
		hint.textContent = name
			? `${verb} ${name}.${taken} Accept to use it, or keep looking.`
			: `Accept to use this portrait, or keep looking.${taken}`;
	}

	// ── Hover preview ─────────────────────────────────────────────────
	// Even at ~200px a tile is a cover-cropped thumbnail, so hovering one pops a large copy
	// that shows the whole portrait uncropped. Mirrors the arcana preview rather than the Welcome
	// guide's pure-CSS ::after: the grid lives in an `overflow-y: auto` body, which would
	// clip a pseudo-element, so the popup is a fixed-position node on <body> instead.

	_removePortraitPreview() {
		this._portraitPreview?.remove();
		this._portraitPreview = null;
		this._portraitAnchor = null;
	}

	_showPortraitPreview(btn) {
		this._removePortraitPreview();
		// The WHOLE illustration, never the square: the tile already shows the square, so a
		// preview of the same thing bigger would say nothing. This is where a standing figure
		// gets to be a standing figure, and where you check the square framed the right face.
		const src = btn.dataset.full || btn.dataset.src;
		if (!src) return;
		const popup = document.createElement("div");
		// `stonetop-hover-popup` is the shared marker Reduce Motion suppresses (styles/stonetop.css).
		popup.className = "stonetop-hover-popup stonetop-people-preview";
		const img = document.createElement("img");
		img.src = src;
		img.alt = "";
		popup.appendChild(img);
		const label = btn.querySelector(".stonetop-people-label")?.textContent?.trim();
		if (label) {
			const cap = document.createElement("span");
			cap.textContent = label;
			popup.appendChild(cap);
		}
		document.body.appendChild(popup);
		this._portraitPreview = popup;
		this._portraitAnchor = btn;
		// Position once the image has its intrinsic size, or the box is measured at zero and
		// lands in the wrong place. Portraits are lazy-loaded, so the first hover on a tile
		// that has not painted yet would otherwise mis-place.
		if (img.complete) this._positionPortraitPreview(popup, btn);
		else img.addEventListener("load", () => {
			if (this._portraitPreview === popup) this._positionPortraitPreview(popup, btn);
		}, { once: true });
	}

	// Prefer the side: these are tall portraits shown large, so an above/below popup rarely
	// fits, and sitting beside the tile leaves the row you are scanning visible.
	_positionPortraitPreview(popup, anchor) {
		const a = anchor.getBoundingClientRect();
		// offsetWidth/Height, not the rect: the grow-in animation starts at scale(0.4) and
		// would shrink the measured box (same trap as the arcana popup).
		const pw = popup.offsetWidth;
		const ph = popup.offsetHeight;
		const gap = 10;
		const right = a.right + gap;
		const left = a.left - pw - gap;
		// right unless it would run off, then left, then clamp
		let x = right + pw <= window.innerWidth - 8 ? right : (left >= 8 ? left : right);
		x = Math.max(8, Math.min(x, window.innerWidth - pw - 8));
		// vertically centred on the tile, clamped into the viewport
		let y = a.top + a.height / 2 - ph / 2;
		y = Math.max(8, Math.min(y, window.innerHeight - ph - 8));
		popup.style.left = `${x}px`;
		popup.style.top = `${y}px`;
	}

	_activatePortraitPreviews(root) {
		// Delegated from the grid, not four listeners per tile: a full import is ~155
		// portraits, so the per-tile shape meant ~620 registrations (and ~620 closures) every
		// time the gallery opened. mouseover/mouseout and focusin/focusout are the bubbling
		// counterparts of mouseenter/mouseleave and focus/blur, which do not bubble at all.
		const grid = root.querySelector(".stonetop-people-grid");
		if (!grid) return;
		// Both pairs re-fire while the pointer or focus moves BETWEEN a tile's own children
		// (the img and its label), which the non-bubbling events never did: entering a tile
		// we are already previewing is not a new hover, and leaving for somewhere still
		// inside it is not a leave.
		const tileOf = ev => ev.target.closest?.(".stonetop-people-pick");
		const stillInside = (btn, ev) => btn.contains(ev.relatedTarget);

		grid.addEventListener("mouseover", ev => {
			const btn = tileOf(ev);
			if (btn && btn !== this._portraitAnchor) this._showPortraitPreview(btn);
		});
		grid.addEventListener("mouseout", ev => {
			const btn = tileOf(ev);
			if (btn && !stillInside(btn, ev)) this._removePortraitPreview();
		});
		// keyboard parity: tabbing through the grid previews too
		grid.addEventListener("focusin", ev => {
			const btn = tileOf(ev);
			if (btn && btn !== this._portraitAnchor) this._showPortraitPreview(btn);
		});
		grid.addEventListener("focusout", ev => {
			const btn = tileOf(ev);
			if (btn && !stillInside(btn, ev)) this._removePortraitPreview();
		});
		// The popup is fixed while the tile scrolls under it, so it has to react to scrolling or
		// it ends up hanging beside the wrong portrait. FOLLOW the tile rather than dismiss:
		// dismissing races with any scroll that accompanies the hover itself (a scrolled-into-view
		// tile fires `scroll` a frame after `mouseenter`, which would kill the preview the moment
		// it appeared). Only drop it once the pointer has actually left the tile.
		//
		// Coalesced to one frame: `scroll` fires far faster than the screen paints, and the
		// reposition reads the anchor's rect and the popup's size — a forced layout flush each
		// time — to move something that can only visibly move once per frame.
		let repositionFrame = 0;
		this._bodyEl?.addEventListener("scroll", () => {
			if (repositionFrame) return;
			repositionFrame = requestAnimationFrame(() => {
				repositionFrame = 0;
				const anchor = this._portraitAnchor;
				if (!this._portraitPreview || !anchor?.isConnected) return;
				if (anchor.matches(":hover")) this._positionPortraitPreview(this._portraitPreview, anchor);
				else this._removePortraitPreview();
			});
		}, { passive: true });
	}

	async close(options) {
		this._removePortraitPreview();
		this._cancelRollScroll();
		return super.close(options);
	}

	activateListeners(html) {
		super.activateListeners(html);
		const root = html[0];
		// One walk of the grid, shared: a full import is ~155 tiles, and the filter pass, the
		// Random button and the click wiring below all want the same list.
		const picks = [...root.querySelectorAll(".stonetop-people-pick")];
		this._picks = picks;
		this._randomBtn = root.querySelector(".stonetop-people-random");
		this._acceptBtn = root.querySelector(".stonetop-people-accept");
		this._hintEl = root.querySelector(".stonetop-people-hint");
		this._hintDefault = this._hintEl?.textContent ?? "";
		this._proposed = null;
		// The grid's scroll container: both the roll's scroll animation and the hover preview
		// that has to follow it need this one, so it is found once here.
		this._bodyEl = root.querySelector(".stonetop-people-gallery-body");
		this._cancelRollScroll();
		this._activateFilters(root, picks);
		this._activatePortraitPreviews(root);
		this._syncRandomButton();

		// Clicking a tile only offers it. Accept is the one thing that writes the portrait.
		picks.forEach(btn => btn.addEventListener("click", () => this._propose(btn, { how: "picked" })));

		// Rolls from the tiles the filters left showing, and shows the result rather than
		// taking it. Avoid whatever is already on offer — the standing proposal if there is
		// one, else the member's current portrait — so rolling again always moves.
		//
		// Rolled over `data-full`, not `data-src`, for the reason getData spells out: a portrait
		// is held as the WHOLE illustration while its tile shows the square, so comparing the two
		// raw paths never matches and "avoid the current one" silently stops avoiding anything.
		// The comparison itself goes through `portraitIdentity`, which normalises either spelling,
		// so a world still holding the older square-as-img shape is avoided correctly too.
		this._randomBtn?.addEventListener("click", () => {
			const visible = this._visiblePicks();
			const held = this._proposed?.dataset.src || this._current;
			// One setting read for the whole roll: `keyOf` is called once for the held portrait and
			// once per pool tile, and the art root is the same for all of them.
			const artRoot = book2ArtRoot();
			const full = pickRandomPortrait(visible.map(p => p.dataset.full),
				{ current: held, keyOf: (s) => portraitIdentity(s, artRoot) });
			if (full) this._propose(visible.find(p => p.dataset.full === full), { scroll: true });
		});

		// The one door a portrait actually goes through, however it was landed on.
		this._acceptBtn?.addEventListener("click", () => this._choose(this._proposed));

		// Close first so the gallery isn't stacked over the FilePicker it opens.
		root.querySelector(".stonetop-people-browse")?.addEventListener("click", () => {
			this.close();
			this._onBrowse?.();
		});

		root.querySelector(".stonetop-people-clear")?.addEventListener("click", async () => {
			await this._onClear?.();
			this.close();
		});
	}
}

/**
 * Open the gallery on a portrait and apply whatever the user settles on. The one door every
 * portrait surface goes through — the steading's residents and neighbors, and the character
 * sheet's follower cards — so the two policy calls it makes are made once:
 *
 *   • who gets the raw FilePicker fallback. Only a user who can browse the data files; players
 *     pick from the broadcast gallery, which needs no file access; and
 *   • where FilePicker lives, which moved namespace in v13.
 *
 * `onPick` receives the chosen path and `onClear` nothing — "Use default" is a distinct
 * outcome from picking, since a caller may want to close a stale photo popout rather than
 * point it at an empty path.
 *
 * `onFrame`, when supplied, chains straight into the portrait framer once a file has been
 * BROWSED — the one case with no sensible default square, since shipped gallery art already
 * carries a hand-cut one and chaining off Accept would nag on the common path. Fail-closed: a
 * caller that passes no `onFrame` gets no chain, which is how a surface with nowhere to store a
 * frame simply never offers one.
 *
 * @param {{current?: string, used?: Record<string,string>, onPick: Function, onClear?: Function,
 *          onFrame?: Function}} opts
 */
export function openPeoplePortraitPicker({ current = "", used = {}, onPick, onClear, onFrame } = {}) {
	const canBrowse = !!(game.user?.isGM || game.user?.can?.("FILES_BROWSE"));
	const onBrowse = () => {
		const FilePickerClass = filePicker();
		if (FilePickerClass) new FilePickerClass({ type: "image", current, callback: async path => {
			// Awaited: the framer reads the NEW image off the document, so the write has to land
			// before it opens.
			await onPick(path);
			await onFrame?.(path);
		} }).render(true);
	};
	return new PeopleGalleryDialog({ current, canBrowse, used, onPick, onBrowse, onClear }).render(true);
}
