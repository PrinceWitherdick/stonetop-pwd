// The People of Stonetop gallery, opened on an ACTOR'S OWN portrait.
//
// The two surfaces that had the gallery before this each keep a face somewhere of their own — a
// steading roster row living in a flag array, a follower card living under its own detail
// namespace — so each has to wire the gallery up to that place itself. The three SHEETS do not
// differ like that: a player character, an NPC and a monster all wear their face as `actor.img`
// and frame it at `flags["stonetop-pwd"].portraitFrame`. All three therefore ask the same three
// questions — what is this person wearing, who else is already wearing what, and where does a
// pick go — so this is where those answers are given once, and each sheet only has to say which
// actor it means.

import { openPeoplePortraitPicker } from "../actors/steading/PeopleGalleryDialog.js";
import { usedPersonPortraits } from "../actors/steading/steading-people.js";
import { getStonetopSteadingActor } from "./world.js";
import { openPortraitFrameEditor } from "./PortraitFrameDialog.js";
import { addPopoutHeaderControl, addPortraitFrameControl, addTokenizerControl } from "./popout-header-control.js";
import { actorFrameHandle, actorPortraitPickUpdate } from "./portrait-frame-handles.js";
import { PERSON_DEFAULT_IMG } from "./person-portrait.js";
import { resolvedFlags } from "../actors/character/StonetopFlags.js";
import { claimRosterPortraits } from "../actors/character/roster-portraits.js";
import { displayPortraitSrc } from "../book2-art/people-portraits.js";
import { hasVideoExtension, imagePopout, setAppOption } from "./foundry-compat.js";
import { documentPortraitFrame, resolvePortrait } from "./portrait-frame.js";
import { canOpenTokenizer, openTokenizer } from "./portrait-tokenizer.js";
import { isDefaultImg } from "./strings.js";
import { format, localize } from "./i18n.js";

/**
 * Where the followers a player character keeps store their portraits.
 *
 * Mirrors `_FOLLOWER_FLAGS` in StonetopCharacterSheet.js, which is the write side's source of
 * truth and stays private to it — this only ever READS, and only wants the one key of the five
 * that side knows about, so importing the sheet (and the module graph behind it) to learn five
 * string literals would cost more than it saved. `keyed` stores hold one card per slug; the two
 * singular follower types hold a single card and keep its name a level up, beside the details
 * rather than inside them.
 */
const FOLLOWER_PORTRAIT_STORES = [
	{ path: "animalCompanion.details", keyed: false, nameAt: "animalCompanion.name" },
	{ path: "crew.details",            keyed: false, nameAt: "crew.name" },
	{ path: "initiateDetails",         keyed: true },
	{ path: "beastDetails",            keyed: true },
	{ path: "customFollowers",         keyed: true },
];

/**
 * The actor types that wear a person's face — the three the gallery opens from. The fourth,
 * `stonetop`, is the steading, whose portrait is a picture of the place.
 */
const PERSON_ACTOR_TYPES = new Set(["character", "npc", "monster"]);

/** Hand every follower portrait `actor` keeps to `claim`, named as well as it can be. */
function claimFollowerPortraits(actor, claim) {
	// resolvedFlags rather than a bare read, so a world not yet cut over from a legacy flag
	// scope still reports its followers as wearing what they wear.
	const flags = resolvedFlags(actor);
	for (const store of FOLLOWER_PORTRAIT_STORES) {
		const at = foundry.utils.getProperty(flags, store.path);
		if (!at || typeof at !== "object") continue;
		for (const card of (store.keyed ? Object.values(at) : [at])) {
			if (!card || typeof card !== "object") continue;
			const own = String(card.name ?? "").trim()
				|| String(store.nameAt ? foundry.utils.getProperty(flags, store.nameAt) ?? "" : "").trim();
			// An initiate or beast takes its name from pack data by slug rather than carrying one,
			// so name those by the character who keeps them: the gallery only has to say the face
			// is spoken for clearly enough to go and find who has it.
			claim(card.img, own || `${actor.name}'s follower`);
		}
	}
	// The members INSIDE a group follower — the crew's named individuals and anonymous bodies,
	// and any custom group's roster. Those are neither documents nor cards, so they are invisible
	// to both of this module's sweeps; without this a face on the crew's roster would read as
	// free from every sheet in the world. The stores live with the code that writes them.
	claimRosterPortraits(flags, claim);
}

/**
 * Every face already spoken for in this world, as { stored path -> who wears it }.
 *
 * The gallery marks these and offers to hide them, which is only honest if the scan covers
 * everywhere a face can be worn. That used to mean the steading roster alone, because the roster
 * was the only place the gallery opened; now that a PC, an NPC and a monster can each pick one
 * from their own sheet, a portrait taken on any of them has to read as taken on all of them.
 *
 * So: every actor that can wear a person's face — the three the gallery now opens from — plus the
 * follower cards a character keeps in flags, which are not documents and would otherwise be
 * invisible to an actor sweep. The fourth actor type is the steading itself, whose portrait is a
 * picture of a PLACE (utils/person-portrait.js has no say over it), so it is not swept.
 *
 * The steading's own legacy text rows — people from before roster rows became NPCs — are not
 * covered here either; they have no document, and the roster merges its own `usedPersonPortraits`
 * on top for exactly that reason.
 *
 * `exclude` is the actor being edited, left out so their own portrait reads as selected rather
 * than as taken by themselves.
 */
export function usedActorPortraits(exclude = null) {
	try {
		const used = {};
		const excludeId = exclude?.id ?? null;
		const claim = (img, who) => {
			const src = String(img ?? "").trim();
			// isDefaultImg covers Foundry's own defaults as well as this system's people
			// silhouette, so nobody art-less ever marks a gallery face as taken.
			if (!src || isDefaultImg(src)) return;
			// First claim wins the label: when two people share a face the gallery only needs to
			// say it is spoken for, and naming one of them is enough to go and find it.
			used[src] ??= String(who ?? "").trim() || "someone else";
		};
		for (const actor of game.actors?.contents ?? []) {
			if (!actor || !PERSON_ACTOR_TYPES.has(actor.type)) continue;
			if (excludeId && actor.id === excludeId) continue;
			claim(actor.img, actor.name);
			if (actor.type === "character") claimFollowerPortraits(actor, claim);
		}
		return used;
	} catch { return {}; }
}

/**
 * What "Use default" puts back, per kind of actor.
 *
 * An NPC wears the people silhouette (utils/person-portrait.js) — what `_preCreate` stamps on a
 * new one, and what every surface showing an art-less person expects to meet. Anything else
 * falls back to the stock default it was created with. Both are values `isDefaultImg` already
 * recognises, so a cleared portrait reads back as "no art" everywhere rather than as somebody's
 * deliberate choice of a grey icon.
 */
function defaultPortraitFor(actor) {
	if (actor?.type === "npc") return PERSON_DEFAULT_IMG;
	return globalThis.CONST?.DEFAULT_TOKEN ?? "icons/svg/mystery-man.svg";
}

/**
 * Open the gallery on an actor's own portrait and write whatever they settle on.
 *
 * `editable` is the sheet's own judgement (an unowned or locked sheet passes false); it defaults
 * to the actor's ownership, so a caller with nothing to add can leave it out. Returns null
 * without opening anything when the portrait may not be written, so a caller can hand over
 * whatever it has rather than gating first.
 *
 * @param {Actor}    actor
 * @param {object}   [opts]
 * @param {boolean}  [opts.editable]  may this portrait be written?
 * @param {Function} [opts.onSaved]   called after a pick or a clear lands, with the new path
 */
export function openActorPortraitPicker(actor, { editable = null, onSaved } = {}) {
	if (!actor) return null;
	const canWrite = editable ?? !!actor.isOwner;
	if (!canWrite) return null;
	return openPeoplePortraitPicker({
		current: actor.img ?? "",
		// Two scans, the same pair the steading roster and the follower cards make: every actor
		// in the world, plus the steading's own legacy text rows, which are not documents and so
		// are invisible to an actor sweep. Without the second, a face worn by a person from
		// before roster rows became NPCs read as free from every sheet in the system.
		used: { ...usedActorPortraits(actor), ...usedPersonPortraits(getStonetopSteadingActor()) },
		// Picture, frame and token in ONE update — see actorPortraitPickUpdate, which owns why all
		// three move together and which of them a browsed file leaves behind.
		onPick: async (src, pick) => {
			await actor.update(actorPortraitPickUpdate(actor, src, pick));
			onSaved?.(actor.img);
		},
		// The same one atomic update, through the same helper: "Use default" is a pick whose
		// picture happens to be the placeholder and which carries no square, and
		// actorPortraitPickUpdate already answers that — the frame is dropped when the new
		// picture brings none, and no token key is emitted without a square. Dropping the frame
		// is the load-bearing half, for the reason the follower card's clear spells out: a rect
		// measured on the portrait being replaced would otherwise sit there as an orphan. It
		// would not misapply — the frame's `src` stamp neutralises it against a different
		// picture — but the dead data would accumulate with nothing to ever clear it.
		onClear: async () => {
			await actor.update(actorPortraitPickUpdate(actor, defaultPortraitFor(actor)));
			onSaved?.(actor.img);
		},
		// A browsed file is the one case with no hand-cut square behind it, so chain straight
		// into the framer. Gallery picks are deliberately not chained: that art arrives framed.
		onFrame: () => openFramerForActor(actor, {
			editable: canWrite,
			onSaved: () => onSaved?.(actor.img),
		}),
	});
}

/**
 * Wire a sheet header's portrait: the click that settles the face — the People of Stonetop
 * gallery in edit mode, the portrait window in play mode — and the two pips over it.
 *
 * One function for all three sheets that draw this header. They differ in nothing here, and the
 * whole point of the header is that it means the same thing wherever it is met, so the wiring
 * cannot be left to drift apart by being written out three times. `root` is the sheet root
 * element. See openActorPortraitFromSheet for why the click owns both modes.
 *
 * @param {Application} sheet  needs `.actor`, `._editMode`, `.isEditable` and `.render`
 * @param {Element}     root
 */
export function wirePortraitPopout(sheet, root) {
	// The pip sits ON the picture, so its click must not also reach the portrait underneath.
	root.querySelector(".stonetop-portrait-frame-pip")?.addEventListener("click", ev => {
		ev.preventDefault();
		ev.stopPropagation();
		openActorPortraitFramer(sheet);
	});

	// Its neighbour, for the TOKEN. Same swallow-the-click reason: it sits on the picture, whose
	// own click opens the gallery or the portrait window.
	root.querySelector(".stonetop-portrait-tokenize-pip")?.addEventListener("click", ev => {
		ev.preventDefault();
		ev.stopPropagation();
		openTokenizer(sheet.actor);
	});

	// Not gated on the actor having art: an art-less portrait is exactly the state this click is
	// most needed from, and refusing left a fresh NPC's avatar doing nothing when clicked.
	root.querySelector(".stonetop-portrait")?.addEventListener("click", ev => {
		ev.preventDefault();
		ev.stopPropagation();
		openActorPortraitFromSheet(sheet, ev.currentTarget);
	});
}

/**
 * Open the framing editor on an actor's own portrait.
 *
 * The one place the editor is opened FOR AN ACTOR, so the three routes to it — the crop pip on a
 * sheet header, the control in the portrait window, and the chain straight out of "Browse files…"
 * — cannot come to disagree about which handle they hand over or what the window is called. No
 * `img` is passed: the editor resolves the picture off the handle when it opens, which is what
 * lets a face chosen a moment earlier be the one that gets framed.
 */
function openFramerForActor(actor, { editable = null, onSaved } = {}) {
	const handle = actorFrameHandle(actor, { editable });
	return openPortraitFrameEditor({
		handle,
		img: handle?.img,
		title: format("stonetop.portraitFrame.title", { name: actor.name }),
		onSaved,
	});
}

/**
 * What a sheet header needs to draw its portrait and the two pips over it.
 *
 * The character, NPC and monster headers all render the same partial
 * (templates/actor/partials/portrait-frame-pip.hbs) over the same kind of picture, and all three
 * used to answer its questions themselves — which meant one partial's contract lived in three
 * getData bodies and the pip's visibility policy could be changed on one sheet and silently not
 * the others. `img` stays the caller's, because that part genuinely differs: a monster with no art
 * falls back to its creature-type mark, and an art-less character still draws its placeholder.
 *
 * @param {Application} sheet  needs `.actor` and `.isEditable`
 * @param {string}      img    the picture this header is about to draw
 */
export function headerPortraitContext(sheet, img) {
	const actor = sheet?.actor;
	const portrait = resolvePortrait(img ?? "", documentPortraitFrame(actor));
	// BOTH pips key off art the actor actually OWNS. A stock icon, the people silhouette or a
	// monster's creature-type mark is decorative: there is no face in it to choose a square of, and
	// it is what every brand-new actor wears. Choosing art comes first, by clicking the portrait
	// itself, and the pips are there the moment there is a picture to use them on.
	const onOwnArt = !isDefaultImg(actor?.img) && !!sheet?.isEditable;
	return {
		portraitImg: portrait.src,
		portraitImgStyle: portrait.style,
		portraitFramed: portrait.framed,
		canFramePortrait: onOwnArt,
		// Tokenizer must also be installed. This one used to be offered with no art at all, on the
		// grounds that an art-less actor is exactly when you would reach for Tokenizer and that it
		// brings its own image picker; what that bought in practice was a button hovering over the
		// blank silhouette of every fresh character sheet.
		canTokenizePortrait: onOwnArt && canOpenTokenizer(actor),
	};
}

/**
 * What the portrait window shows for an actor, given the slot that was clicked.
 *
 * Normally the WHOLE illustration behind a People-of-Stonetop square: the square is a face cut
 * out of a standing figure, so a window showing it would answer "show me this bigger" with a
 * picture smaller than the one just clicked.
 *
 * With no art of its own, the stored path is a stock icon or the people silhouette — so fall back
 * to whatever the sheet is actually drawing in the slot (a monster's creature-type mark, say), and
 * the window shows the picture that was clicked rather than the placeholder it was standing in
 * for. `getAttribute`, not `.src`: the DOM resolves the latter to an absolute URL.
 */
function portraitWindowSrc(actor, slot) {
	const stored = displayPortraitSrc(actor?.img ?? "");
	if (!isDefaultImg(actor?.img)) return stored;
	const el = slot?.matches?.("img") ? slot : slot?.querySelector?.("img");
	return el?.getAttribute("src") || stored;
}

/**
 * The window a sheet's header portrait opens on click: the picture at full size, with the two
 * controls that settle a face in its header — "Edit Photo", which opens the People of Stonetop
 * gallery, and "Frame Face", which chooses the square the small round surfaces show.
 *
 * One function rather than one per sheet. The character, NPC and monster headers differ in
 * nothing here, and the whole point of this window is that it means the same thing wherever it is
 * opened — so the three cannot be left to drift apart by being written out three times.
 *
 * Opened even when the actor has no art yet: the placeholder is not worth looking at, but this
 * window is the route to choosing a face, and an avatar that does nothing when clicked is exactly
 * the state a person most needs it from.
 *
 * @param {Application} sheet  needs `.actor`, `.isEditable` and `.render`
 * @param {Element}     [slot] the element that was clicked, for the no-art fallback above
 */
export function openActorPortraitWindow(sheet, slot = null) {
	const actor = sheet?.actor;
	if (!actor) return null;
	const popout = imagePopout({ src: portraitWindowSrc(actor, slot), title: actor.name });
	if (!popout) return null;
	popout.render(true);

	// The same "Edit Photo" the steading roster puts on a member's photo, opening the same
	// gallery, so the control means one thing wherever it is met.
	if (sheet.isEditable) {
		addPopoutHeaderControl(popout, {
			key: "stonetop-edit-actor-photo",
			icon: "fa-camera",
			label: localize("stonetop.portraitPicker.popout"),
			onClick: () => openActorPortraitPicker(actor, {
				editable: sheet.isEditable,
				onSaved: () => sheet.render(false),
			}),
		});
	}
	// Follow the actor rather than patch at the call site: this window sits open while the
	// portrait can be changed from its own header, from the sheet behind it, or by another user,
	// and it should be right after all three.
	bindImagePopoutToActor(popout, actor);

	// Which square of this portrait the small round surfaces show: the relationship rows on every
	// sheet that lists this person, and the steading roster. The frame lives on the actor, so
	// setting it here shows up everywhere at once. No `img` — the control resolves the picture off
	// the handle when it is CLICKED, which is what lets Edit Photo above change the face first.
	const handle = actorFrameHandle(actor, { editable: sheet.isEditable });
	// Before the framing control so it lands to its LEFT, matching the pips on the sheet header.
	// Only when the Tokenizer module is installed; it makes the token, not the portrait.
	addTokenizerControl(popout, handle);
	addPortraitFrameControl(popout, handle, {
		name: actor.name,
		onSaved: () => sheet.render(false),
	});
	return popout;
}

/**
 * What a sheet's header portrait does when clicked, in either mode.
 *
 * EDIT MODE goes straight to the People of Stonetop gallery, rather than opening the picture and
 * making you find "Edit Photo" in its title bar — the same split the steading roster makes on its
 * member avatars. Edit mode is the mode you are in to change things, so the click that changes
 * this one should not need a stop on the way.
 *
 * This is where Foundry's own file picker used to live, bound to `data-edit="img"` on the image.
 * That binding is registered before ours and cannot be called off from a listener, so the two
 * could not share the click — and the gallery carries "Browse files…" and "Use default", so it is
 * a superset of what the attribute reached rather than a replacement for it.
 *
 * PLAY MODE opens the portrait window, which shows the picture at full size and carries the same
 * gallery in its header.
 *
 * @param {Application} sheet  needs `.actor`, `._editMode`, `.isEditable` and `.render`
 * @param {Element}     [slot] the element that was clicked
 */
export function openActorPortraitFromSheet(sheet, slot = null) {
	if (!sheet?._editMode) return openActorPortraitWindow(sheet, slot);
	return openActorPortraitPicker(sheet.actor, {
		editable: sheet.isEditable,
		onSaved: () => sheet.render(false),
	});
}

/**
 * Open the framer on a sheet's own portrait — what the crop pip over the header picture does.
 * A null or unwritable handle is reported by the editor rather than silently ignored, which is
 * the difference between a diagnosable message and a dead button.
 */
export function openActorPortraitFramer(sheet) {
	const actor = sheet?.actor;
	if (!actor) return null;
	return openFramerForActor(actor, {
		editable: sheet.isEditable,
		onSaved: () => sheet.render(false),
	});
}

/**
 * Point an already-open portrait window at a new picture, patching it in place so the window
 * keeps the position and size the reader put it at rather than re-rendering under them.
 *
 * Matches the element to the kind of picture coming in: core renders a still as an `<img>` and an
 * animated portrait as a `<video>`, so a swap between the two finds no element of the new kind
 * and has to fall back to a re-render, which builds whichever one the new path needs.
 *
 * Returns true when the window was patched in place, false when it had to re-render — a caller
 * that hung its own controls on the window header has to hang them again after one.
 */
export function pointImagePopoutAt(popout, display) {
	if (!popout || !display) return false;
	const root = popout.element?.jquery ? popout.element[0] : popout.element;
	const selector = hasVideoExtension(display) ? ".window-content video, video" : ".window-content img, img";
	const media = root?.querySelector?.(selector);
	if (media) media.src = display;
	// Keep the window's own state in step either way: a re-render reads `options.src`, and so
	// does core's Share Image control — both want what is on screen.
	setAppOption(popout, "src", display);
	if (!media) popout.render?.(false);
	return !!media;
}

/**
 * Keep an open portrait window in step with the actor whose face it is showing.
 *
 * The gallery reached from this window's own header is only one of the ways that portrait can
 * change while the window sits there — the sheet behind it can change it, and so can another
 * user. Watching the actor rather than patching at the call site means the window is right after
 * all of them. The hook is torn down on close so it does not leak.
 *
 * Shows the WHOLE illustration behind a People-of-Stonetop square, which is what the window was
 * opened with: the square is a face cut out of a standing figure, so a window showing it would
 * answer "show me this bigger" with a picture smaller than the one that was clicked.
 *
 * `onChange` is for a caller that keeps state of its own beside the window — the steading roster
 * hangs the row it is editing off the popout — and is handed the actor's new STORED path, since
 * that is what such state is about. It replaces the default repaint rather than running beside it,
 * so a caller that takes it over owns the whole refresh.
 */
export function bindImagePopoutToActor(popout, actor, { onChange } = {}) {
	if (!popout || !actor?.id || typeof popout.close !== "function") return;
	const repaint = onChange ?? ((img) => pointImagePopoutAt(popout, displayPortraitSrc(img)));
	const hookId = Hooks.on("updateActor", (changed, changes) => {
		if (changed?.id !== actor.id || !foundry.utils.hasProperty(changes, "img")) return;
		repaint(changed.img);
	});
	const originalClose = popout.close.bind(popout);
	popout.close = (...args) => {
		Hooks.off("updateActor", hookId);
		return originalClose(...args);
	};
}
