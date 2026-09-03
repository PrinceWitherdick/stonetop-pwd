// One relationship map, open.
//
// The board is a fixed-size virtual sheet the reader pans and zooms as a whole
// (utils/zoom-pan-surface.js); the portraits, the lines and the labels are all positioned in
// percentages of it (utils/relmap-geometry.js); and the data is a flag on a JournalEntry every
// player owns (relmap/relmap-doc.js), so a change one person makes reaches everyone else's open
// window through Foundry's own document broadcast with no socket of ours.
//
// WHAT THIS FILE IS CAREFUL ABOUT, in one place, because both are easy to get wrong and neither
// fails loudly:
//
//  • A live update NEVER re-renders the Application. It repaints the board's markup and swaps it
//    in. A render would re-fit the board and throw away the corner the reader had zoomed into,
//    which is the exact state they were using when somebody else's change arrived.
//  • A live update that lands mid-drag, or mid-edit of a label, is BUFFERED rather than applied.
//    Repainting under a drag replaces the element the pointer is holding.

import { StonetopDialog } from "../utils/stonetop-dialog.js";
import { themedDialogClasses } from "../utils/window-theme.js";
import { escHtml } from "../utils/strings.js";
import { openOrFocus } from "../utils/open-or-focus.js";
import { openingSize } from "../utils/opening-size.js";
import { getDragEventData, renderTemplate } from "../utils/foundry-compat.js";
import { openLinkedActorSheet } from "../utils/actor-link.js";
import { documentPortraitFrame, portraitOrNone } from "../utils/portrait-frame.js";
import { format, localize } from "../utils/i18n.js";
import { SYSTEM_ID } from "../system-id.js";
import { ZoomPanSurface } from "../utils/zoom-pan-surface.js";
import { wireRelmapDrag } from "../utils/relmap-drag.js";
import {
	RELMAP_BOARD_ASPECT, RELMAP_BOARD_HEIGHT, RELMAP_BOARD_WIDTH, ROUTE_HEAD_PATH,
	ROUTE_HEAD_VIEWBOX, clampPct, edgeArrowheads, edgeCurve, edgeLabelAnchor, fanBow, freeSpot,
	nodeRadiusPct, ringLayout,
} from "../utils/relmap-geometry.js";
import {
	RELMAP_FLAG, addEdgePatch, addNodePatch, dropEdgePatch, dropNodePatch, edgePatch, fanIndexes,
	nodePatch, takenSpots,
} from "../relmap/relmap-store.js";
import { applyPatch, canEditRelationshipMap, readGraph } from "../relmap/relmap-doc.js";
import { castPlan, gatherCast, gatherRatings, importPlan } from "../relmap/relmap-import.js";
import { openLinkEditor, pickPersonToLink } from "./RelationshipLinkDialog.js";

// Plain literals, not built from SYSTEM_ID: tests/templates/partial-registration.test.js proves
// every precached template is actually reached by finding its PATH in the JS, and an interpolated
// one is a path that appears nowhere in the source for it to find.
const TEMPLATE = "systems/stonetop-pwd/templates/dialogs/relationship-map.hbs";
const BOARD_PARTIAL = "systems/stonetop-pwd/templates/dialogs/partials/relationship-map-board.hbs";

/** How long a burst of remote writes is allowed to coalesce before the board repaints. */
const SYNC_DEBOUNCE_MS = 50;

/**
 * How long after the last arrow key a nudge is written.
 *
 * A held arrow repeats about thirty times a second. Writing each one is thirty document
 * updates, each a round trip broadcast to every client, each repainting the board on all of
 * them — and each repaint replaces the very button the reader is holding the key on, so the
 * focus they were nudging from is gone mid-press. The portrait moves on every key; the
 * document learns about it once the reader stops.
 */
const NUDGE_COMMIT_MS = 250;

/**
 * Which children of the viewport a press must NOT start a pan from.
 *
 * ⚠ THIS LIST IS THE WHOLE OF WHAT MAKES A CONTROL CLICKABLE IN HERE. A press the surface does not
 * recognise takes a pointer capture, and that capture retargets the later click at the viewport, so
 * the delegated handler never sees it and the control is dead on a dead-centre click that never
 * moved a pixel (utils/zoom-pan-surface.js explains it at length). Anything clickable added inside
 * the viewport has to be named here — including `[data-relmap-action]`, which is in the viewport at
 * all only because the empty board offers "Add everyone" where somebody meeting a new map looks.
 */
const BOARD_CONTROLS =
	"[data-relmap-node], [data-relmap-handle], [data-relmap-edge], [data-relmap-open], [data-relmap-action]";

export class RelationshipMapWindow extends StonetopDialog {
	constructor(entry, options = {}) {
		super(options);
		this._entry = entry;
		this._entryId = entry?.id ?? null;
		this._surface = null;
		this._teardownDrag = null;
		this._onUpdate = null;
		// Locked on open. Everyone at the table owns these maps, so everyone can move a portrait —
		// which means everyone can move one by accident while trying to drag the board. Reading is
		// the common act; editing is the deliberate one, so the deliberate one asks first.
		this._locked = true;
		// Set while a repaint arrived at a moment it could not be applied. Flushed by whatever was
		// in the way once it is out of the way.
		this._pendingSync = false;
		this._root = null;
		// Where an arrow-key nudge has put a portrait that is not written yet, and the debounced
		// write that will. Held on the instance so `nodeAt` can answer from it: the next key must
		// step on from where the portrait IS, not from the stale spot still in the document.
		this._pendingNudge = null;
		this._commitNudge = foundry.utils.debounce(() => this._writeNudge(), NUDGE_COMMIT_MS);
	}

	static get defaultOptions() {
		const { width, height } = openingSize({ maxAspect: 1.2 });
		return foundry.utils.mergeObject(super.defaultOptions, {
			classes: ["stonetop", "stonetop-relmap-app"],
			template: TEMPLATE,
			width,
			height,
			resizable: true,
		});
	}

	get entry() {
		// Re-read rather than held: the document this window was opened on can be replaced under it
		// by a re-import, and a stale handle writes into a document nothing is watching.
		return game.journal?.get?.(this._entryId) ?? this._entry ?? null;
	}

	get canEdit() {
		return canEditRelationshipMap(this.entry);
	}

	get editable() {
		return this.canEdit && !this._locked;
	}

	async getData() {
		const graph = readGraph(this.entry);
		const empty = !Object.keys(graph.nodes).length;
		return {
			title: this.entry?.name ?? localize("stonetop.relmap.untitled"),
			canEdit: this.canEdit,
			locked: this._locked,
			empty,
			board: await this._renderBoard(graph),
			lockLabel: localize(this._locked ? "stonetop.relmap.locked" : "stonetop.relmap.unlocked"),
			lockHint: localize(this._locked ? "stonetop.relmap.lockHintOn" : "stonetop.relmap.lockHintOff"),
			lockToggle: localize("stonetop.relmap.lockToggle"),
			addLabel: localize("stonetop.relmap.add"),
			addHint: localize("stonetop.relmap.addHint"),
			tidyLabel: localize("stonetop.relmap.tidy"),
			tidyHint: localize("stonetop.relmap.tidyHint"),
			pullLabel: localize("stonetop.relmap.pull"),
			pullHint: localize("stonetop.relmap.pullHint"),
			castLabel: localize("stonetop.relmap.cast"),
			castHint: localize("stonetop.relmap.castHint"),
			emptyLead: localize("stonetop.relmap.emptyLead"),
			emptyHint: localize(this.canEdit ? "stonetop.relmap.emptyHint" : "stonetop.relmap.emptyHintReadonly"),
		};
	}

	/**
	 * The board's markup for one graph.
	 *
	 * Separate from `getData` because it is rendered on its own for every live update — see `sync`.
	 */
	async _renderBoard(graph) {
		return renderTemplate(BOARD_PARTIAL, this._boardContext(graph));
	}

	/**
	 * Everything the board partial draws, worked out once.
	 *
	 * The three renderers of one line — the stroke, its label and its heads — all take their
	 * numbers from the same `edgeCurve` call here, which is what keeps a label on its own stroke.
	 */
	_boardContext(graph) {
		const r = nodeRadiusPct();
		const fans = fanIndexes(graph);
		const canEdit = this.editable;

		const nodes = Object.entries(graph.nodes).map(([id, node]) => {
			const actor = node.uuid ? fromUuidSync(node.uuid, { strict: false }) : null;
			// The live actor wins where it resolves; the stored name and picture are the fallback
			// that keeps somebody on the map after their actor is deleted or moved out of reach.
			const name = actor?.name || node.name || localize("stonetop.relmap.someone");
			const portrait = portraitOrNone(actor?.img ?? node.img, documentPortraitFrame(actor));
			return {
				id,
				name,
				left: node.x,
				top: node.y,
				img: portrait.src,
				imgStyle: portrait.style,
				// A person whose actor has gone. Drawn differently rather than dropped: the links
				// they are part of are still somebody's notes about the story.
				missing: !!node.uuid && !actor,
				tooltip: node.uuid && actor
					? format("stonetop.relmap.openSheet", { name })
					: name,
				linkLabel: format("stonetop.relmap.linkFrom", { name }),
			};
		});

		const edges = [];
		const labels = [];
		const heads = [];
		for (const shape of edgeShapes(graph, { r, fans })) {
			const { id, edge, curve, anchor } = shape;
			// Two portraits stacked on each other have no line between them to draw. The link is
			// still stored, and reappears the moment either is dragged clear.
			if (!curve) continue;
			edges.push({ id, d: curve.d, ink: edge.ink });
			// The id and the end ride on every head, because the live drag finds these elements
			// again by them: a link may wear two, and each has to go back to its own end.
			for (const head of shape.heads) heads.push({ ...head, id, ink: edge.ink });
			if (anchor) {
				labels.push({
					id, ink: edge.ink, text: edge.label,
					left: anchor.left, top: anchor.top, angle: anchor.angle,
					tooltip: canEdit
						? format("stonetop.relmap.editLink", { label: edge.label })
						: edge.label,
				});
			}
		}

		return {
			nodes, edges, labels, heads,
			canEdit,
			headD: ROUTE_HEAD_PATH,
			headBox: ROUTE_HEAD_VIEWBOX,
			linkHint: localize("stonetop.relmap.linkHint"),
		};
	}

	activateListeners(html) {
		super.activateListeners(html);
		const root = html[0];

		// Everything below points into the render being replaced.
		this._surface?.destroy();
		this._teardownDrag?.();
		this._surface = null;
		this._teardownDrag = null;

		// Adopted BEFORE the early return. Left until after it, a render that somehow produced no
		// viewport would leave this pointing at the PREVIOUS render, and the next live update would
		// paint the board into a node that has already left the document.
		this._root = root;
		// Every element the last render's preview was holding has just been thrown away.
		this._preview = null;

		const view = root.querySelector(".stonetop-relmap-view");
		const board = root.querySelector(".stonetop-relmap-board");
		if (!view || !board) return;

		this._surface = new ZoomPanSurface({
			view, content: board,
			naturalWidth: RELMAP_BOARD_WIDTH,
			naturalHeight: RELMAP_BOARD_HEIGHT,
			controls: BOARD_CONTROLS,
		}).attach();

		this._teardownDrag = wireRelmapDrag(root, {
			surface: this._surface,
			canEdit: () => this.editable,
			nodeAt: id => {
				// An unwritten nudge is where the portrait actually is, so it answers first.
				if (this._pendingNudge?.id === id) return { ...this._pendingNudge.at };
				const node = readGraph(this.entry).nodes[id];
				return node ? { x: node.x, y: node.y } : null;
			},
			onMove: (id, at) => this._moveNode(id, at),
			onNudge: (id, at) => this._nudgeNode(id, at),
			onDragMove: (id, at) => this._previewMove(id, at),
			onDragEnd: (id, restore) => this._endPreview(id, restore),
			onLink: (a, b) => this._createLink(a, b),
			onLinkFrom: id => this._linkFrom(id),
			onOpen: id => this._openPerson(id),
			onEditEdge: id => this._editLink(id),
			onRemove: id => this._removePerson(id),
		});

		// The drag layer owns the board; these are the window's own chrome.
		root.querySelectorAll("[data-relmap-action]").forEach(button => {
			button.addEventListener("click", ev => this._onToolClick(ev));
		});

		// A repaint held back while a drag or an edit was in the way, let through the moment it
		// clears. Both on a timeout so the handlers that END the obstruction run first: the drag
		// layer takes its class off in its own pointerup, which is bound before this one.
		const flush = () => setTimeout(() => this._flushPendingSync(), 0);
		root.addEventListener("focusout", flush);
		view.addEventListener("pointerup", flush);

		this._wireDrop(view);
		this._wireSync();
	}

	// ── Live updates ────────────────────────────────────────────────────────

	/**
	 * Repaint when this map changes anywhere in the world.
	 *
	 * Filtered cheapest-first, because EVERY journal write in the world arrives here.
	 *
	 * ⚠ `changed.flags[SYSTEM_ID]` in BRACKETS, never a dotted path. The package id is hyphenated,
	 * so `changed.flags.stonetop-pwd` parses as a subtraction and throws — inside a global hook,
	 * which takes down every other listener registered on it. See hooks/CondemnedTag.js.
	 */
	_wireSync() {
		if (this._onUpdate) return;
		const repaint = foundry.utils.debounce(() => this.sync(), SYNC_DEBOUNCE_MS);
		this._onUpdate = (doc, changed) => {
			if (doc?.id !== this._entryId) return;
			const bag = changed?.flags?.[SYSTEM_ID];
			if (!bag) return;
			// A deletion arrives as `-=key`, so the prefix is stripped before the comparison.
			const touched = Object.keys(bag).some(key => key.replace(/^-=/, "") === RELMAP_FLAG);
			if (touched) repaint();
		};
		Hooks.on("updateJournalEntry", this._onUpdate);
	}

	/**
	 * Redraw the board, WITHOUT touching the zoom or the pan.
	 *
	 * The markup is replaced and the surface is left alone: scale and offset live on the surface,
	 * not in the DOM, so the reader keeps the corner they were looking at. A `render()` here would
	 * re-fit and throw it away — which is the state they were using when the change arrived.
	 *
	 * Deferred rather than dropped when it cannot be applied. A repaint under a live drag replaces
	 * the element the pointer is holding; one under a focused field takes the field away mid-word.
	 * Both flush as soon as the obstruction clears, so nothing is ever silently lost.
	 */
	async sync() {
		if (!this._root || !this.rendered) return;
		if (this._isBusy()) { this._pendingSync = true; return; }
		this._pendingSync = false;
		const board = this._root.querySelector(".stonetop-relmap-board");
		if (!board) return;
		const graph = readGraph(this.entry);
		board.innerHTML = await this._renderBoard(graph);
		// The lines and labels the preview was holding are gone with the markup.
		this._preview = null;
		this._toggleEmpty(!Object.keys(graph.nodes).length);
	}

	/**
	 * Is this a moment a repaint would interrupt?
	 *
	 * The live drag is read off the CLASS the drag layer sets rather than a flag mirrored here.
	 * One source of truth: a flag would have to be cleared on every one of the four ways a drag can
	 * end, and the one that got missed would wedge the board's live updates off for good with no
	 * sign of why.
	 */
	_isBusy() {
		const board = this._root?.querySelector(".stonetop-relmap-board");
		if (board?.classList.contains("is-dragging")) return true;
		// A nudge not written yet is the same kind of obstruction: a repaint would redraw the
		// portrait at the spot the document still holds, undoing the keys already pressed.
		if (this._pendingNudge) return true;
		const active = this._root?.ownerDocument?.activeElement;
		return !!active && this._root.contains(active)
			&& ["INPUT", "TEXTAREA", "SELECT"].includes(active.tagName);
	}

	/** Flush a repaint that arrived while something was in the way. */
	_flushPendingSync() {
		if (this._pendingSync) this.sync();
	}

	_toggleEmpty(empty) {
		const panel = this._root?.querySelector(".stonetop-relmap-empty");
		if (panel) panel.hidden = !empty;
	}

	// ── Editing ─────────────────────────────────────────────────────────────

	async _write(patch, { announce = "" } = {}) {
		if (!patch) return false;
		// Announced BEFORE the write. The write repaints the board and takes the live region's
		// neighbours with it; announcing afterwards can land on a node already replaced.
		if (announce) this._announce(announce);
		try {
			return await applyPatch(this.entry, patch);
		} catch (err) {
			this.reportWriteFailure(localize("stonetop.relmap.noun"), err);
			return false;
		}
	}

	_announce(message) {
		const live = this._root?.querySelector(".stonetop-relmap-live");
		if (live) live.textContent = message;
	}

	// ── The live drag ────────────────────────────────────────────────
	//
	// A portrait under the pointer is moved by a transform on the one element, which is cheap and
	// leaves the rest of the board alone. Its LINES are not on that element, so without the two
	// methods below they stay pinned to the spot the portrait was picked up from until the pointer
	// is released — the map looking like it has not noticed the drag.
	//
	// WHY NOT SIMPLY REPAINT THE BOARD PER FRAME. It would replace the element the pointer is
	// holding, which is the very thing `sync` refuses to do mid-drag, and it would rebuild every
	// node's markup to move a handful of lines. So the geometry is recomputed for the links that
	// actually moved, and written straight onto the elements already on the board.

	/**
	 * Redraw the links touching one portrait, at a spot it has not been dropped at yet.
	 *
	 * NOT CLAMPED, deliberately, though the write on release is: the point of this is that the line
	 * stays welded to the portrait the reader is holding, and a line that stopped at the board's
	 * edge while the portrait carried on past it would read as the line coming loose. The drop
	 * reconciles the two.
	 */
	_previewMove(id, at) {
		const preview = this._preview?.id === id ? this._preview : this._beginPreview(id);
		if (!preview) return;
		// The cached graph is a private copy — `readGraph` normalizes into a fresh object on every
		// call — so moving the node in it costs nothing and is thrown away with the preview.
		const node = preview.graph.nodes[id];
		node.x = at.x;
		node.y = at.y;
		for (const shape of edgeShapes(preview.graph, { r: preview.r, fans: preview.fans, only: id })) {
			const parts = preview.parts.get(shape.id);
			if (parts) redrawEdge(parts, shape);
		}
	}

	/**
	 * The state one drag's worth of previewing needs, gathered ONCE.
	 *
	 * Per drag rather than per frame because all of it is stable for the length of one: the graph
	 * cannot change under a drag (`sync` defers while the board is busy), the fan indexes come from
	 * the graph, and the elements are only replaced by a repaint. Rebuilding it per frame would
	 * re-parse the flag and re-walk the board sixty times a second to learn the same answers.
	 */
	_beginPreview(id) {
		const board = this._root?.querySelector(".stonetop-relmap-board");
		if (!board) return null;
		const graph = readGraph(this.entry);
		if (!graph.nodes[id]) return null;
		this._preview = {
			id,
			graph,
			fans: fanIndexes(graph),
			r: nodeRadiusPct(),
			parts: indexEdgeParts(board),
		};
		return this._preview;
	}

	/**
	 * That drag is over.
	 *
	 * `restore` is where the portrait went back to when the drag was ABANDONED — Escape, a lost
	 * pointer, a board that stopped being editable mid-gesture. The drag layer puts the portrait
	 * back itself by dropping its transform, and the lines have to follow or they are left hanging
	 * where the pointer stopped with nothing coming to correct them.
	 *
	 * On a real drop it is null and the lines are left exactly where they were previewed: the write
	 * is already on its way, and its repaint draws the same geometry over the top with nothing to
	 * see in between. Putting them back first would flash every line to the old spot for a frame.
	 */
	_endPreview(id, restore) {
		if (restore) this._previewMove(id, restore);
		this._preview = null;
	}

	/**
	 * One arrow key: move the portrait and its lines NOW, and remember to write it.
	 *
	 * The same split a pointer drag makes — the board follows the gesture, the document hears
	 * about it at the end — so that holding an arrow key costs one write rather than one per
	 * repeat, and so that no repaint arrives to take away the button the key is being held on.
	 */
	_nudgeNode(id, at) {
		const el = this._root?.querySelector(`[data-relmap-node="${id}"]`);
		if (!el) return;
		// CLAMPED HERE, unlike the drag preview. A drag is bounded by the pointer and its drop
		// reconciles the two; a held arrow key is bounded by nothing, so showing it unclamped would
		// walk the portrait off the board and snap it back the moment the write landed. Clamping to
		// the same rule `nodePatch` applies means what the keys show is what gets written — and it
		// is what stops `nodeAt` handing the next key a spot further off the board again.
		const spot = { x: clampPct(at.x), y: clampPct(at.y) };
		el.style.left = `${spot.x}%`;
		el.style.top = `${spot.y}%`;
		this._previewMove(id, spot);
		this._pendingNudge = { id, at: spot };
		this._commitNudge();
	}

	/** Write the nudge the reader has stopped making, and let repaints back in. */
	_writeNudge() {
		const pending = this._pendingNudge;
		if (!pending) return;
		this._pendingNudge = null;
		this._preview = null;
		this._moveNode(pending.id, pending.at);
		// A repaint that was held back while the keys were coming lands now.
		this._flushPendingSync();
	}

	/**
	 * No read first. `readGraph` normalizes every node and every edge to build a fresh object, and
	 * the only thing this wanted from it was whether the node still exists — which decides nothing:
	 * `nodePatch` clamps the coordinates itself, and a patch naming a node that has since been
	 * removed is dropped by `normalizeGraph` on the next repaint rather than resurrecting it.
	 */
	async _moveNode(id, { x, y }) {
		await this._write(nodePatch(id, { x, y }));
	}

	async _openPerson(id) {
		const node = readGraph(this.entry).nodes[id];
		if (!node) return;
		if (!node.uuid) {
			ui.notifications?.info?.(format("stonetop.relmap.noSheet", { name: node.name }));
			return;
		}
		openLinkedActorSheet({ uuid: node.uuid }, "stonetop.relmap.gone");
	}

	/** The handle CLICKED rather than dragged: ask who, then draw the same line. */
	async _linkFrom(id) {
		const graph = readGraph(this.entry);
		const others = Object.entries(graph.nodes)
			.filter(([otherId]) => otherId !== id)
			.map(([otherId, node]) => ({ id: otherId, name: node.name }));
		if (!others.length) {
			ui.notifications?.info?.(localize("stonetop.relmap.nobodyToLink"));
			return;
		}
		const to = await pickPersonToLink({ from: graph.nodes[id]?.name ?? "", options: others });
		if (to) await this._createLink(id, to);
	}

	/** Every label already used on this map, for the editor to suggest. */
	_labelSuggestions(graph) {
		return [...new Set(Object.values(graph.edges).map(edge => edge.label).filter(Boolean))].sort();
	}

	async _createLink(a, b) {
		if (a === b) return;
		const graph = readGraph(this.entry);
		if (!graph.nodes[a] || !graph.nodes[b]) return;
		const link = await openLinkEditor({
			from: graph.nodes[a].name, to: graph.nodes[b].name,
			suggestions: this._labelSuggestions(graph),
		});
		if (!link || link.deleted) return;
		await this._write(addEdgePatch(foundry.utils.randomID(), { a, b, ...link }), {
			announce: format("stonetop.relmap.linked", {
				a: graph.nodes[a].name, b: graph.nodes[b].name,
			}),
		});
	}

	async _editLink(id) {
		const graph = readGraph(this.entry);
		const edge = graph.edges[id];
		if (!edge) return;
		const result = await openLinkEditor({
			edge,
			from: graph.nodes[edge.a]?.name ?? "", to: graph.nodes[edge.b]?.name ?? "",
			suggestions: this._labelSuggestions(graph),
		});
		if (!result) return;
		if (result.deleted) {
			await this._write(dropEdgePatch(id), { announce: localize("stonetop.relmap.unlinked") });
			return;
		}
		await this._write(edgePatch(id, result));
	}

	/**
	 * Take somebody off the map, with every line that touched them.
	 *
	 * Confirmed, because it is not only the portrait that goes: the links are somebody's notes
	 * about the story and there is no undo. The buttons NAME the outcome rather than answering a
	 * question the reader has to hold in their head, and the count of lines is in the question so
	 * nobody learns about them afterwards.
	 */
	async _removePerson(id) {
		const graph = readGraph(this.entry);
		const node = graph.nodes[id];
		if (!node) return;
		const links = Object.values(graph.edges).filter(e => e.a === id || e.b === id).length;
		const ok = await foundry.applications.api.DialogV2.wait({
			classes: themedDialogClasses(),
			window: { title: localize("stonetop.relmap.removeTitle") },
			content: `<p>${escHtml(links
				? format("stonetop.relmap.removeBodyLinks", { name: node.name, count: links })
				: format("stonetop.relmap.removeBody", { name: node.name }))}</p>`,
			buttons: [
				{ action: "remove", label: format("stonetop.relmap.removeConfirm", { name: node.name }), default: true },
				{ action: "keep", label: localize("stonetop.relmap.removeCancel") },
			],
			rejectClose: false,
		});
		if (ok !== "remove") return;
		await this._write(dropNodePatch(graph, id), {
			announce: format("stonetop.relmap.removed", { name: node.name }),
		});
	}

	// ── The bar ─────────────────────────────────────────────────────────────

	async _onToolClick(ev) {
		const action = ev.currentTarget.dataset.relmapAction;
		if (action === "lock") {
			this._locked = !this._locked;
			this._announce(localize(this._locked ? "stonetop.relmap.lockedNow" : "stonetop.relmap.unlockedNow"));
			// A full render here, deliberately: the lock changes which controls exist at all, and
			// it is the reader's own act rather than somebody else's change arriving.
			this.render(false);
			return;
		}
		if (!this.editable) return;
		if (action === "add") return this._addPerson();
		if (action === "tidy") return this._tidy();
		if (action === "pull") return this._pullRatings();
		if (action === "cast") return this._addEveryone();
	}

	async _addPerson() {
		const graph = readGraph(this.entry);
		const already = new Set(Object.values(graph.nodes).map(n => n.uuid).filter(Boolean));
		const actors = (game.actors?.contents ?? [])
			.filter(actor => ["character", "npc"].includes(actor.type) && !already.has(actor.uuid));
		if (!actors.length) {
			ui.notifications?.info?.(localize("stonetop.relmap.everyoneAdded"));
			return;
		}
		const chosen = await pickPersonToLink({
			from: "",
			title: localize("stonetop.relmap.addTitle"),
			options: actors.map(actor => ({ id: actor.uuid, name: actor.name })),
		});
		if (!chosen) return;
		const actor = actors.find(a => a.uuid === chosen);
		if (!actor) return;
		await this._addNodeFor(actor, freeSpot(takenSpots(graph)));
	}

	async _addNodeFor(actor, spot) {
		const id = foundry.utils.randomID();
		return this._write(addNodePatch(id, {
			uuid: actor.uuid, name: actor.name, img: actor.img ?? "",
			x: spot.left, y: spot.top,
		}), { announce: format("stonetop.relmap.added", { name: actor.name }) });
	}

	/** Put everyone back on a ring. The way out of a board somebody has piled into one corner. */
	async _tidy() {
		const graph = readGraph(this.entry);
		const ids = Object.keys(graph.nodes);
		if (!ids.length) return;
		const ring = ringLayout(ids.length);
		// One write for the whole board: several would broadcast several times and every other
		// client would watch the portraits walk to their places one at a time.
		const patch = {};
		ids.forEach((id, i) => Object.assign(patch, nodePatch(id, { x: ring[i].left, y: ring[i].top })));
		await this._write(patch, { announce: localize("stonetop.relmap.tidied") });
	}

	/**
	 * Put the whole cast on the board: every player character, and everybody on a steading's
	 * Residents and Neighbors rosters.
	 *
	 * PEOPLE ONLY, no lines — see relmap-import.js `castPlan`. This is clearing the desk, and
	 * guessing at who knows whom would be asserting relationships nobody recorded.
	 *
	 * ONE WRITE for the whole cast, so the table watches the board appear rather than fill in one
	 * portrait at a time.
	 */
	async _addEveryone() {
		const cast = gatherCast();
		if (!cast.length) {
			ui.notifications?.info?.(localize("stonetop.relmap.castNobody"));
			return;
		}
		const plan = castPlan(readGraph(this.entry), cast);
		if (!plan.added) {
			ui.notifications?.info?.(localize("stonetop.relmap.castAllHere"));
			return;
		}
		const said = format("stonetop.relmap.castAdded", { count: plan.added });
		if (await this._write(plan.patch, { announce: said })) ui.notifications?.info?.(said);
	}
	/**
	 * Seed the board from the 1-5 hearts the sheets already carry.
	 *
	 * ONE-TIME, and idempotent: relmap/relmap-import.js says why it is an import rather than a
	 * live mirror, and does all the work. This is the button.
	 *
	 * ONE WRITE for the whole import, however many people and lines it adds. Several would
	 * broadcast several times, and every other client at the table would watch the board fill in
	 * one portrait at a time.
	 */
	async _pullRatings() {
		const graph = readGraph(this.entry);
		const rows = gatherRatings(game.actors?.contents ?? []);
		const plan = importPlan(graph, rows);
		if (!plan.addedPeople && !plan.addedLinks) {
			// Said out loud rather than left silent. Nothing happening looks identical to a broken
			// button, and the two commonest reasons are worth telling apart: nobody has rated
			// anybody yet, or everything rated is already on this board.
			ui.notifications?.info?.(localize(rows.length
				? "stonetop.relmap.pullNothingNew"
				: "stonetop.relmap.pullNothingRated"));
			return;
		}
		// Built once and said twice, the way `_addEveryone` does it: the ledger line and the toast
		// are the same sentence, and two calls is two places for them to drift apart.
		const said = format("stonetop.relmap.pulled", {
			people: plan.addedPeople, links: plan.addedLinks,
		});
		if (await this._write(plan.patch, { announce: said })) ui.notifications?.info?.(said);
	}
	// ── Dropping an actor from the sidebar ──────────────────────────────────

	/**
	 * The one HTML5-drag path in the feature, because the sidebar is the drag SOURCE and there is
	 * no choice about it. Safe here where it is not on a character sheet: this window installs no
	 * capture-phase drop handler for it to fight with.
	 */
	_wireDrop(view) {
		view.addEventListener("dragover", ev => {
			if (!this.editable) return;
			ev.preventDefault();
			view.classList.add("is-dropping");
		});
		view.addEventListener("dragleave", () => view.classList.remove("is-dropping"));
		view.addEventListener("drop", async ev => {
			view.classList.remove("is-dropping");
			if (!this.editable) return;
			ev.preventDefault();
			// Through the compat helper, which already knows where this moved between cores. The
			// version dance was written out here once and that is one more place to fix it.
			const data = getDragEventData(ev);
			if (data?.type !== "Actor") return;
			const actor = await fromUuid(data.uuid);
			if (!actor) return;
			const graph = readGraph(this.entry);
			if (Object.values(graph.nodes).some(node => node.uuid === actor.uuid)) {
				ui.notifications?.info?.(format("stonetop.relmap.alreadyHere", { name: actor.name }));
				return;
			}
			// Where they were dropped, or a clear spot when the drop landed off the board.
			const at = this._surface?.pointToPercent(ev);
			const spot = at && at.left >= 0 && at.left <= 100 && at.top >= 0 && at.top <= 100
				? { left: at.left, top: at.top }
				: freeSpot(takenSpots(graph));
			await this._addNodeFor(actor, spot);
		});
	}

	async close(options = {}) {
		this._surface?.destroy();
		this._surface = null;
		// A nudge still waiting on its debounce would otherwise be lost with the window.
		this._writeNudge();
		this._teardownDrag?.();
		this._teardownDrag = null;
		if (this._onUpdate) {
			Hooks.off("updateJournalEntry", this._onUpdate);
			this._onUpdate = null;
		}
		return super.close(options);
	}
}

/**
 * Every link's geometry for one graph, each of them from ONE `edgeCurve` call.
 *
 * WHY IT IS SHARED. The three renderers of a line — the stroke, its label and its arrowheads — have
 * to agree to the pixel, or a label sits off its own stroke. There are now two callers wanting
 * those numbers, the board's markup and the live drag, and the second working them out its own way
 * is exactly how the two would come to disagree.
 *
 * `only` narrows it to the links touching one person, which is all that a drag of that person can
 * move: everybody else's lines are where they were, and recomputing them would be work per frame
 * for no pixel changed.
 */
function edgeShapes(graph, { r, fans, only = null } = {}) {
	const out = [];
	for (const [id, edge] of Object.entries(graph.edges)) {
		if (only && edge.a !== only && edge.b !== only) continue;
		const from = graph.nodes[edge.a];
		const to = graph.nodes[edge.b];
		const curve = edgeCurve({
			from: { left: from.x, top: from.y },
			to: { left: to.x, top: to.y },
			bow: fanBow(fans[id] ?? 0),
			aspect: RELMAP_BOARD_ASPECT,
			r,
		});
		out.push({
			id,
			edge,
			curve,
			anchor: curve && edge.label ? edgeLabelAnchor(curve, RELMAP_BOARD_ASPECT) : null,
			heads: curve ? edgeArrowheads(curve, RELMAP_BOARD_ASPECT, edge.dir) : [],
		});
	}
	return out;
}

/**
 * Every piece of every line already on the board, found once and filed under its link's id.
 *
 * By one walk into a Map rather than a selector per link: an id goes into a selector as text, and a
 * selector built by hand out of a stored id is a syntax error waiting for the first id with a
 * quote or a colon in it. Reading `dataset` back off the elements asks no such question.
 */
function indexEdgeParts(board) {
	const parts = new Map();
	const partsFor = id => {
		let found = parts.get(id);
		if (!found) parts.set(id, found = { line: null, label: null, heads: {} });
		return found;
	};
	const each = (selector, put) => board.querySelectorAll?.(selector)?.forEach?.(put);
	each("[data-relmap-line]", el => { partsFor(el.dataset.relmapLine).line = el; });
	each("[data-relmap-edge]", el => { partsFor(el.dataset.relmapEdge).label = el; });
	each("[data-relmap-head]", el => { partsFor(el.dataset.relmapHead).heads[el.dataset.relmapEnd] = el; });
	return parts;
}

/** Where one thing that rides on a line sits, and how far it is turned over. */
function placeOnLine(el, { left, top, angle }) {
	if (!el) return;
	el.style.left = `${left}%`;
	el.style.top = `${top}%`;
	el.style.setProperty("--relmap-turn", `${angle}deg`);
}

const showPart = el => { if (el) el.style.display = ""; };
const hidePart = el => { if (el) el.style.display = "none"; };

/**
 * Move one link's stroke, its label and its heads onto a curve just recomputed.
 *
 * A link whose two portraits have come to sit on top of each other has no curve at all, and is
 * HIDDEN rather than left drawn: that is what a repaint does with it, and a stroke frozen at its
 * last good position while the portraits pile up on it is worse than no stroke. It comes back the
 * moment the drag pulls them apart, without a repaint.
 */
function redrawEdge({ line, label, heads }, { curve, anchor, heads: arrows }) {
	if (!curve) {
		hidePart(line);
		hidePart(label);
		for (const head of Object.values(heads)) hidePart(head);
		return;
	}
	if (line) {
		showPart(line);
		line.setAttribute("d", curve.d);
	}
	if (label && anchor) {
		showPart(label);
		placeOnLine(label, anchor);
	}
	// Hidden first and then shown, so a head the new geometry has no place for cannot be left
	// behind pointing at nothing. One frame either way: nothing is painted in between.
	for (const head of Object.values(heads)) hidePart(head);
	for (const arrow of arrows) {
		const head = heads[arrow.end];
		if (!head) continue;
		showPart(head);
		placeOnLine(head, arrow);
	}
}

/**
 * Open (or re-focus) one map's window.
 *
 * PER DOCUMENT, via `perDocumentOptions`. AppV1 resolves an Application's element by its id, so two
 * windows sharing one id both resolve to the FIRST one's frame: the second paints into the first's
 * window and the first's handlers are left bound to nodes nothing will re-render. Several named
 * maps is exactly the case that hits this.
 */
export function openRelationshipMap(entry) {
	if (!entry) return null;
	const options = StonetopDialog.perDocumentOptions("stonetop-relmap", entry.id, {
		title: entry.name,
	});
	return openOrFocus(options.id, () => {
		const app = new RelationshipMapWindow(entry, options);
		app.render(true);
		return app;
	});
}
