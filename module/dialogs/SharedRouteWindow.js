// The route the GM has shown the players, on a player's own screen rather than on the canvas.
//
// "Draw it on the scene" reaches a player only while that Scene is in front of them, and reaches a
// player who cannot see the map not at all. So the walkthrough's "Show players" press stores the
// trip in a world setting (utils/shared-route.js), posts a chat card, and lights a "See the route"
// button on the steading sheet. This is what both of those open: the map, zoomable and read-only,
// with the way drawn on it, and the whole journey written out beside it.
//
// It is an ImageZoomWindow with a column of text, built the way the GM's "See the whole map"
// window is (TravelMapWindow.js), and it never writes anything except the GM's own "Stop showing
// players", which goes through the same setting the walkthrough writes.
//
// TWO KINDS OF WINDOW. The LIVE one (`stonetop-shared-route`) follows the setting: it is what the
// steading button opens and what a card for the route now being shown opens, and when the GM shows
// a new way it redraws in place. An OLDER card opens a SNAPSHOT of the route it posted, under its
// own id, marked as older: a chat log is a record, and a card that changed what it said after the
// fact would be a worse one.

import { ImageZoomWindow } from "../utils/image-zoom-window.js";
import { openOrFocus } from "../utils/open-or-focus.js";
import { openingSize } from "../utils/opening-size.js";
import { findOpenApp } from "../utils/open-windows.js";
import { isSteadingActor } from "../utils/world.js";
import { renderTemplate } from "../utils/foundry-compat.js";
import { stonetopChatCard } from "../utils/chat.js";
import { SYSTEM_ID } from "../system-id.js";
import { SHARED_ROUTE_HOOK } from "../settings.js";
import { localize, format } from "../utils/i18n.js";
import { warn } from "../utils/logger.js";
import {
	SHARED_ROUTE_FLAG, readSharedRoute, sharedRequirementsHtml, sharedRouteCardHtml, sharedRouteChip, sharedRouteChipHtml,
	sharedRouteView, stopSharingRoute,
} from "../utils/shared-route.js";

const TEMPLATE = "systems/stonetop-pwd/templates/dialogs/shared-route.hbs";
// The pin layer, rendered here rather than through a `{{> }}` in the window's template, because a
// live update swaps it in place without re-rendering the window (see `follow`).
export const SHARED_ROUTE_PINS_TEMPLATE = "systems/stonetop-pwd/templates/dialogs/partials/shared-route-pins.hbs";

/** The live window's id. */
export const SHARED_ROUTE_WINDOW_ID = "stonetop-shared-route";

/** A snapshot's id, one per share. */
export function sharedRouteSnapshotId(id) {
	return `${SHARED_ROUTE_WINDOW_ID}-${String(id ?? "").replace(/[^\w-]/g, "_")}`;
}

// The same clamp the GM's map window opens at, for the same reason: the maps are roughly
// landscape-page shaped, and width past this is white mat down both sides.
const MAX_ASPECT = 1.2;

export class SharedRouteWindow extends ImageZoomWindow {
	/**
	 * @param {object} config
	 * @param {object|null} config.payload  the share to show; ignored by the live window, which
	 *                                      reads the setting
	 * @param {boolean} config.live          follow the setting, or hold one snapshot
	 */
	constructor({ payload = null, live = true } = {}, options = {}) {
		const shown = live ? readSharedRoute() : payload;
		const view = sharedRouteView(shown);
		// NO `onPick`: ImageZoomWindow binds its overlay click delegate only when one is given, so
		// nothing on this picture does anything when clicked, and every press pans.
		super({ src: view?.map?.src ?? "", alt: view?.map?.alt ?? "" }, options);
		this._live = live;
		this._payload = shown;
		// NOT `_view`: ImageZoomWindow keeps its viewport element under that name.
		this._shownView = view;
	}

	static get defaultOptions() {
		const { width, height } = openingSize({ maxAspect: MAX_ASPECT });
		return foundry.utils.mergeObject(super.defaultOptions, {
			classes: ["stonetop", "stonetop-image-zoom", "stonetop-shared-route-app"],
			template: TEMPLATE,
			title: localize("stonetop.expedition.shared.windowTitle"),
			width,
			height,
		});
	}

	/** Is this snapshot no longer the route being shown? Never true of the live window. */
	_isOlder() {
		if (this._live) return false;
		return readSharedRoute()?.id !== this._payload?.id;
	}

	async getData() {
		const view = this._shownView;
		return {
			view,
			overlay: view?.map ? await renderTemplate(SHARED_ROUTE_PINS_TEMPLATE, view.map) : "",
			older: !!view && this._isOlder(),
			canStop: !!view && this._live && !!game.user?.isGM,
			olderText: localize("stonetop.expedition.shared.older"),
			noneText: localize("stonetop.expedition.shared.none"),
			noMapText: localize("stonetop.expedition.shared.noMap"),
			legsLabel: localize("stonetop.expedition.shared.legs"),
			stopLabel: localize("stonetop.expedition.shared.stop"),
			requirementsHtml: sharedRequirementsHtml(view?.requirements),
		};
	}

	/**
	 * Draw, then make sure the announcement channel is there.
	 *
	 * The live region lives on the WINDOW, outside `.window-content`, because AppV1 replaces the
	 * content on every render and `follow` swaps parts of it in place. A live region that is
	 * replaced along with its words is a new region arriving already full, and a screen reader
	 * reads nothing (audit RTE-3). This one is put up once, empty, and only its text ever changes.
	 */
	async _render(force, options) {
		await super._render(force, options);
		this._liveRegion();
	}

	/** The window's own live region, made on first ask and kept for its lifetime. */
	_liveRegion() {
		const root = this.element?.[0];
		if (!root?.querySelector) return null;
		let region = root.querySelector(":scope > .stonetop-shared-route-live");
		if (!region && root.ownerDocument) {
			region = root.ownerDocument.createElement("div");
			region.className = "stonetop-shared-route-live";
			region.setAttribute("role", "status");
			region.setAttribute("aria-live", "polite");
			region.setAttribute("aria-atomic", "true");
			root.append(region);
		}
		return region;
	}

	/** Say what changed, through the live region. */
	_announce(text) {
		const region = this._liveRegion();
		if (region) region.textContent = String(text ?? "");
	}

	/** What a change to the share sounds like: the new way and its time, or that it has gone. */
	_announcement() {
		const view = this._shownView;
		if (!view) return localize("stonetop.expedition.shared.none");
		if (this._isOlder()) return localize("stonetop.expedition.shared.older");
		return `${view.title}. ${view.total}`;
	}

	activateListeners(html) {
		super.activateListeners(html);
		this._wireStop(html[0] ?? html);
	}

	/** The GM's Stop button, wherever it was just drawn. */
	_wireStop(root) {
		root?.querySelector?.(".stonetop-shared-route-stop")?.addEventListener("click", () =>
			stopSharingRoute().catch(err => warn("couldn't stop showing the route", err)));
	}

	/**
	 * The setting changed: follow it, if this is the live window. Snapshots only re-read whether
	 * they are still the route being shown, which is the one thing about them that can change.
	 *
	 * The SAME PICTURE is redrawn in place, so the zoom and the corner the reader had dragged to
	 * survive the GM showing a new way across the same map. A different picture, or one appearing
	 * or going, is a full render, because the fit has to start again from the new file.
	 */
	async follow() {
		if (!this.rendered) return;
		// ONE FOLLOW AT A TIME WINS (audit RTE-11). Two changes in quick succession (one GM shows a
		// new way, another hides it) start two of these; the first is still awaiting its templates
		// when the second starts a full render, and the first would then swap its stale words into
		// the fresh window. Each takes a number, and one that is no longer the latest stops at its
		// next await.
		const turn = (this._followTurn = (this._followTurn ?? 0) + 1);
		const current = () => turn === this._followTurn;
		if (!this._live) {
			await this.render(false);
			if (current()) this._announce(this._announcement());
			return;
		}
		const shown = readSharedRoute();
		const view = sharedRouteView(shown);
		const before = this._shownView;
		this._payload = shown;
		this._shownView = view;
		const samePicture = !!before?.map && !!view?.map && before.map.src === view.map.src;
		if (!samePicture) {
			this._src = view?.map?.src ?? "";
			this._alt = view?.map?.alt ?? "";
			this._fitting = true;
			await this.render(false);
			if (current()) this._announce(this._announcement());
			return;
		}
		this._alt = view.map.alt;
		const root = this.element?.[0];
		const data = await this.getData();
		if (!current()) return;
		this.setOverlay(data.overlay);
		const img = root?.querySelector?.(".stonetop-image-zoom-img");
		if (img) img.alt = view.map.alt;
		// The two text columns are re-rendered from the same template and swapped whole, so what
		// they say cannot drift from what a fresh window would say.
		const fresh = await renderTemplate(TEMPLATE, data);
		if (!current()) return;
		const holder = globalThis.document?.createElement?.("div");
		if (!root || !holder) return;
		holder.innerHTML = fresh;
		for (const part of [".stonetop-shared-route-head", ".stonetop-travel-map-foot"]) {
			const now = root.querySelector(part);
			const next = holder.querySelector(part);
			if (now && next) now.replaceWith(next);
		}
		this._wireStop(root);
		this._announce(this._announcement());
	}
}

/**
 * Open the route the players are being shown, or one card's snapshot of a route shown before.
 *
 * With no payload, or a payload that IS the route being shown now, this is the live window. A
 * payload from an older share opens its own snapshot window. Either way a second press raises
 * the window already open rather than stacking another.
 */
export function openSharedRoute(payload = null) {
	const live = !payload || payload.id === readSharedRoute()?.id;
	const id = live ? SHARED_ROUTE_WINDOW_ID : sharedRouteSnapshotId(payload.id);
	return openOrFocus(id, () => {
		const app = new SharedRouteWindow({ payload, live }, { id });
		app.render(true);
		return app;
	});
}

/**
 * Tell the table the GM has shown them a route: the journey in words, and a button that opens it.
 *
 * The card carries its own copy of the share in a flag, so a card scrolled back to later opens the
 * route it was posted with, marked as older once the GM has moved on.
 */
export async function postSharedRouteCard(payload) {
	const view = sharedRouteView(payload);
	if (!view || !globalThis.ChatMessage?.create) return null;
	return ChatMessage.create({
		content: stonetopChatCard(view.title, sharedRouteCardHtml(view), "stonetop-shared-route-card"),
		speaker: { alias: "Stonetop" },
		flags: { [SYSTEM_ID]: { [SHARED_ROUTE_FLAG]: payload } },
	});
}

/**
 * Wire a shared route's card (dispatched from stonetop.js renderChatMessageHTML): its "See the
 * route" button opens the route the card carries.
 */
export function wireSharedRouteCard(message, html) {
	const payload = message?.getFlag?.(SYSTEM_ID, SHARED_ROUTE_FLAG);
	if (!payload?.id) return;
	const root = html?.[0] ?? html;
	const button = root?.querySelector?.(".stonetop-shared-route-open");
	if (!button) return;
	button.addEventListener("click", ev => {
		ev.preventDefault();
		Promise.resolve(openSharedRoute(payload)).catch(err => warn("couldn't open the shared route", err));
	});
}

/**
 * Everything that follows the shared route, on every client: the players' windows, the GM's
 * walkthrough (whose button says whether this trip's way is the one being shown), and the steading
 * sheets, whose "See the route" button comes and goes with it.
 */
export function registerSharedRouteHooks() {
	globalThis.Hooks?.on?.(SHARED_ROUTE_HOOK, () => {
		// The chip is the same for every steading sheet: worked out once, the first time one asks.
		let chip;
		for (const app of Object.values(globalThis.ui?.windows ?? {})) {
			if (app instanceof SharedRouteWindow) {
				app.follow().catch(err => warn("couldn't redraw the shared route", err));
			} else if (isSteadingActor(app?.actor) && app.rendered) {
				if (chip === undefined) chip = sharedRouteChip(readSharedRoute());
				refreshSteadingRouteChip(app, chip);
			}
		}
		findOpenApp(w => w.id === "stonetop-expedition")?._sharedRouteChanged?.();
	});
}

/**
 * Put the steading header's "See the route" button up, take it down, or re-word it, IN PLACE.
 *
 * NOT A RE-RENDER (audit RTE-10). Players own the steading, and a share lands whenever the GM
 * presses the button: a full render of every open steading sheet on every client threw away
 * whatever a player was halfway through typing on it (an AppV1 sheet saves a field on change,
 * which a render before blur never fires) and the scroll they had. The chip is one element in the
 * header, so it is the one element touched. A sheet whose header is not there to patch (not drawn
 * yet) is left to its own next render, which reads the share fresh anyway.
 */
export function refreshSteadingRouteChip(app, chip = sharedRouteChip(readSharedRoute())) {
	const root = app?.element?.[0] ?? app?.element ?? null;
	const header = root?.querySelector?.(".steading-header");
	if (!header) return false;
	const old = header.querySelector(".steading-header-route");
	if (!chip) {
		old?.remove();
		return true;
	}
	const holder = header.ownerDocument.createElement("div");
	holder.innerHTML = sharedRouteChipHtml(chip);
	const button = holder.firstElementChild;
	button.addEventListener("click", () => openSharedRoute());
	if (old) old.replaceWith(button);
	else {
		const clock = header.querySelector(".steading-header-clock");
		if (clock) clock.before(button);
		else header.append(button);
	}
	return true;
}

/** The notice the GM gets once a route is being shown, worded for what was shown. */
export function sharedRouteNotice(payload) {
	const view = sharedRouteView(payload);
	if (!view) return "";
	return view.place
		? format("stonetop.expedition.share.shown", { place: view.place })
		: localize("stonetop.expedition.share.shownDrawn");
}
