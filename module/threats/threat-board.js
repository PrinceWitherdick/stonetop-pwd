// The flagship "threats on the map" overlay (world setting threatOnCanvasCards).
// Draws each threat pin's full book card as an HTML element anchored to the pin,
// projected from scene coords to screen coords on every pan/zoom so it rides the
// map. The doom-track checkboxes are live for the GM. This is the ONE piece of
// bespoke canvas code in the system, so it is opt-in and the pin-opens-a-window
// path (Phase 4) remains the safe default.
//
// Per-user visibility rides the pin: the overlay only builds a card for a Note whose
// `n.visible` is true. Threats/hazards are GM-only prep (the entry stays NONE-owned), so
// a player never sees these pins and never gets a card; the overlay is effectively GM-only.
import { getSetting } from "../settings.js";
import { wireThreatDoomChange } from "./threat-view.js";
import {
	gmPrepCardTemplate, gmPrepCardVM, gmPrepPageById, isGmPrepDoc, wireGmPrepCardExtras,
} from "../journal/gm-prep-page.js";
import { renderTemplate } from "../utils/foundry-compat.js";

// Hazard and site pins ride the same board: all three cards share the threat card's markup
// conventions (doom checkboxes, wrapper classes), so only the template + VM differ — and which
// template and which VM is the kind table's to say, along with everything else that varies by
// kind. Two more per-kind maps lived here until they moved there.

export class ThreatBoard {
	constructor() {
		this.layer = null;
		this.cards = new Map();      // noteId -> { el: card element, note: placeable }
		this._bound = false;
		this._refreshQueued = false;
	}

	get enabled() { return !!getSetting("threatOnCanvasCards"); }

	/** Wire the canvas/document hooks once. */
	install() {
		if (this._bound) return;
		this._bound = true;
		Hooks.on("canvasReady", () => this.refresh());
		Hooks.on("canvasTearDown", () => this._teardown());
		Hooks.on("canvasPan", () => this.reposition());
		for (const h of ["createNote", "updateNote", "deleteNote"]) Hooks.on(h, () => this._schedule());
		Hooks.on("updateJournalEntryPage", (page) => { if (gmPrepCardTemplate(page?.type)) this._schedule(); });
		Hooks.on("deleteJournalEntryPage", () => this._schedule());
		// A threat/hazard journal being created or deleted (e.g. the first item minting it, or
		// the last delete tidying it away) doesn't touch the page hooks above, so refresh on any
		// change to one of our entries too, keeping the drawn cards in step with the pins.
		for (const h of ["createJournalEntry", "updateJournalEntry", "deleteJournalEntry"])
			Hooks.on(h, (entry) => {
				if (isGmPrepDoc(entry)) this._schedule();
			});
	}

	/** Coalesce bursts (multi-note ops, a page edit) into one rebuild next microtask. */
	_schedule() {
		if (this._refreshQueued) return;
		this._refreshQueued = true;
		Promise.resolve()
			.then(() => { this._refreshQueued = false; this.refresh(); })
			// The latch is cleared above before refresh() runs, so a throw here can't wedge the
			// board — but without the catch it would surface as an unhandled rejection with no
			// hint that it came from a note edit.
			.catch(err => console.error("Stonetop | threat board refresh failed", err));
	}

	_threatNotes() {
		const placeables = canvas?.notes?.placeables ?? [];
		// `n.visible` is the pin's per-user visibility: threats/hazards are GM-only, so a
		// player never sees the pin and its card is never built for them either.
		return placeables.filter(n => n?.visible && isGmPrepDoc(n?.document));
	}

	_pageFor(note) {
		const { entryId, pageId } = note.document;
		return gmPrepPageById(entryId, pageId);
	}

	_ensureLayer() {
		if (this.layer?.isConnected) return this.layer;
		// Append to document.body (screen space). NOT #hud — core stage-transforms #hud to
		// scene coordinates, which would double-transform our worldTransform.apply() below.
		const parent = document.body;
		const el = document.createElement("div");
		el.className = "stonetop stonetop-threat-overlay";
		parent.appendChild(el);
		wireThreatDoomChange(el, chk => fromUuid(chk.closest(".threat-card")?.dataset.pageUuid ?? ""));
		// Whatever controls each kind's own card carries (a site's random tables), so a pin of any
		// kind behaves on the map exactly as it does in the journal.
		wireGmPrepCardExtras(el, target => fromUuid(target.closest(".threat-card")?.dataset.pageUuid ?? ""));
		this.layer = el;
		return el;
	}

	// A cheap fingerprint of a card's rendered HTML (its content's last-modified stamp).
	// Lets refresh() re-enrich/re-render only the cards that actually changed instead of
	// rebuilding every visible card on any single event.
	_cardSig(page) {
		return `${page._stats?.modifiedTime ?? 0}`;
	}

	async refresh() {
		if (!this.enabled || !canvas?.ready) return this._teardown();
		const layer = this._ensureLayer();
		// Resolve visible cards and skip the ones whose fingerprint is unchanged, so a single
		// doom tick only re-enriches its own card. Enrich/render the changed ones concurrently
		// (each page is independent) rather than serializing the enrichHTML calls.
		const built = await Promise.all(this._threatNotes().map(async note => {
			const page = this._pageFor(note);
			if (!page) return null;
			const sig = this._cardSig(page);
			const existing = this.cards.get(note.id);
			if (existing && existing.sig === sig) return { note, sig, html: null }; // unchanged
			return { note, sig, html: await renderTemplate(gmPrepCardTemplate(page.type), await gmPrepCardVM(page.type)(page)) };
		}));
		const seen = new Set();
		for (const item of built) {
			if (!item) continue;
			const { note, html, sig } = item;
			seen.add(note.id);
			let entry = this.cards.get(note.id);
			if (!entry) {
				const el = document.createElement("div");
				el.className = "stonetop-threat-overlay-card";
				layer.appendChild(el);
				entry = { el, note };
				this.cards.set(note.id, entry);
			} else {
				entry.note = note; // a re-render may have replaced the placeable object
			}
			if (html !== null) entry.el.innerHTML = html; // only touch the DOM for changed cards
			entry.sig = sig;
		}
		for (const [id, entry] of [...this.cards]) {
			if (!seen.has(id)) { entry.el.remove(); this.cards.delete(id); }
		}
		this.reposition();
	}

	reposition() {
		if (!this.layer || !canvas?.ready) return;
		const transform = canvas.stage.worldTransform;
		const scale = Math.max(0.55, Math.min(1, canvas.stage.scale?.x ?? 1));
		// Runs on every canvasPan frame — read the note reference cached at refresh time
		// rather than scanning canvas.notes.placeables per card.
		for (const { el, note } of this.cards.values()) {
			const center = note?.center;
			if (!center) { el.style.display = "none"; continue; }
			el.style.display = "";
			const p = transform.apply(center);
			el.style.left = `${p.x}px`;
			el.style.top = `${p.y}px`;
			el.style.transform = `translate(-50%, 14px) scale(${scale})`;
		}
	}

	_teardown() {
		for (const { el } of this.cards.values()) el.remove();
		this.cards.clear();
		if (this.layer) { this.layer.remove(); this.layer = null; }
	}
}
