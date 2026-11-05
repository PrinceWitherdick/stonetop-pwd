// Telling the system that a GM's own Scene is one of the poster maps.
//
// A Scene counts as The Vicinity (or any poster map) when it carries the `posterMap` flag, which
// the Import Book Art macro stamps on the Scenes it builds. A GM who made their own Scene of the
// map had no way to stamp it, so the expedition route, the place pins and the site pins all
// treated it as a stranger and the route button told them no such Scene existed (user report,
// 2026-11-04). This is the stamp, reachable two ways: the Scenes sidebar's right-click menu, and
// the route button itself when it finds the GM standing on an unmarked Scene.
//
// Whether the PICTURE fits is still asked separately, every time anything is placed on it
// (`sceneFrame` in data/travel-times.js): marking a Scene says which map it is, not that every
// image is the right shape.

import { SYSTEM_ID } from "../system-id.js";
import { POSTER_MAPS, posterMapFor, scopedFlag, scopedFlagDeletions } from "./poster-map-catalog.js";
import { TRAVEL_MAPS } from "../data/travel-times.js";
import { askWithButtons } from "../utils/ask-with-buttons.js";
import { contextMenuEntry } from "../utils/foundry-compat.js";
import { escHtml } from "../utils/strings.js";
import { format, localize } from "../utils/i18n.js";
import { error } from "../utils/logger.js";

const FLAG = "posterMap";

/**
 * The write that marks `scene` as `slug`'s map, or unmarks it for null.
 *
 * Every OTHER flag scope is cleared on the way past: `scopedFlag` walks the historical package ids
 * ahead of the current one, so a stamp left under an old id would otherwise outrank this one.
 */
export function posterMapFlagUpdate(scene, slug) {
	if (!slug) return scopedFlagDeletions(scene, FLAG);
	return { ...scopedFlagDeletions(scene, FLAG, { except: SYSTEM_ID }), [`flags.${SYSTEM_ID}.${FLAG}`]: slug };
}

/**
 * Mark `scene` as the Scene for poster map `slug`, or unmark it with null.
 *
 * ONE SCENE PER MAP. Everything that looks a map's Scene up takes the first it finds, so a second
 * Scene carrying the same stamp would leave which one the route goes on to the order of the
 * sidebar. Any other Scene holding this map's stamp gives it up.
 *
 * Then the place pins go down on it straight away, through the same pass a world load runs, rather than
 * arriving unannounced on the next load. Best effort: the stamp is what was asked for.
 */
export async function setScenePosterMap(scene, slug, { scenes = globalThis.game?.scenes ?? [] } = {}) {
	if (!scene) return;
	const wanted = slug && posterMapFor(slug) ? slug : null;
	if (wanted) {
		// Independent documents, so their stamps come off together.
		await Promise.all([...scenes]
			.filter(other => other?.id !== scene.id && scopedFlag(other, FLAG) === wanted)
			.map(other => other.update(posterMapFlagUpdate(other, null))));
	}
	const update = posterMapFlagUpdate(scene, wanted);
	if (Object.keys(update).length) await scene.update(update);
	if (!wanted) return;
	try {
		const { markPosterMapScenes } = await import("./poster-maps.js");
		// This Scene only: every other stamped Scene's pins are as the last pass left them.
		await markPosterMapScenes({ scenes: [scene] });
	} catch (err) {
		error(`Poster maps: could not lay the place pins on "${scene.name}"`, err);
	}
}

/** The words every "this is a poster map" question carries: what the stamp does, and its limit. */
function stampExplained() {
	return `<p>${localize("stonetop.posterMapScene.explain")}</p>`;
}

/**
 * Ask which poster map `scene` is, and stamp the answer. From the Scenes sidebar.
 *
 * One button per map, so the answer is a single press, plus "Not a Stonetop map" to take a stamp
 * back off. Closing the window changes nothing.
 */
export async function askScenePosterMap(scene) {
	if (!scene) return;
	const current = scopedFlag(scene, FLAG);
	const buttons = POSTER_MAPS.map(map => ({
		key: map.slug,
		label: map.name,
		icon: map.slug === current ? "fa-check" : "fa-map",
		value: map.slug,
	}));
	buttons.push({ key: "none", label: localize("stonetop.posterMapScene.none"), icon: "fa-xmark", value: "none" });
	const picked = await askWithButtons({
		title: format("stonetop.posterMapScene.title", { scene: scene.name ?? "" }),
		content: `<p>${format("stonetop.posterMapScene.ask", { scene: escHtml(scene.name ?? "") })}</p>${stampExplained()}`,
		buttons,
		defaultKey: current ?? "none",
	});
	if (!picked) return;
	const slug = picked === "none" ? null : picked;
	if (slug === current || (!slug && !current)) return;
	await setScenePosterMap(scene, slug);
	ui.notifications?.info(slug
		? format("stonetop.posterMapScene.marked", { scene: scene.name ?? "", map: posterMapFor(slug).name })
		: format("stonetop.posterMapScene.unmarked", { scene: scene.name ?? "" }));
}

/**
 * For the route button, standing on a Scene that is no map of ours: ask whether it is one of the
 * two maps a route can go on, and stamp the answer. Returns the slug it is now, or null.
 *
 * BOTH TRAVEL MAPS ARE OFFERED, the one the trip needs first. A yes/no about that one alone would
 * ask a GM standing on their own Vicinity whether it is The World's End, and leave "no" as the
 * only true answer with nothing after it that marks the Scene as what it is.
 */
export async function askRouteScenePosterMap(scene, wanted) {
	if (!scene) return null;
	const slugs = [wanted, ...TRAVEL_MAPS.map(tier => tier.slug)]
		.filter((slug, i, all) => posterMapFor(slug) && all.indexOf(slug) === i);
	if (!slugs.length) return null;
	const picked = await askWithButtons({
		title: localize("stonetop.posterMapScene.confirmTitle"),
		content: `<p>${format("stonetop.posterMapScene.confirmAsk", {
			scene: escHtml(scene.name ?? ""), map: escHtml(posterMapFor(slugs[0]).name),
		})}</p>${stampExplained()}`,
		buttons: [
			...slugs.map(slug => ({
				key: slug,
				label: format("stonetop.posterMapScene.confirmYes", { map: posterMapFor(slug).name }),
				icon: "fa-map",
				value: slug,
			})),
			{ key: "no", label: localize("stonetop.posterMapScene.confirmNo"), icon: "fa-xmark", value: "no" },
		],
		defaultKey: slugs[0],
	});
	if (!picked || picked === "no") return null;
	await setScenePosterMap(scene, picked);
	return picked;
}

/** The world Scene a Scenes-sidebar row stands for. */
const sceneOfRow = target => globalThis.game?.scenes?.get?.(target?.dataset?.entryId) ?? null;

/** The Scenes sidebar's right-click entry, readable by both v13 and v14 cores. */
export function scenePosterMapMenuEntries() {
	return [
		contextMenuEntry({
			label: localize("stonetop.posterMapScene.menu"),
			icon: "fa-solid fa-map-location-dot",
			visible: target => !!globalThis.game?.user?.isGM && !!sceneOfRow(target),
			run: target => askScenePosterMap(sceneOfRow(target)),
		}),
	];
}

/** Register the menu entry. Call once, in init. */
export function registerScenePosterMapMenu() {
	Hooks.on("getSceneContextOptions", (_directory, options) => {
		options.push(...scenePosterMapMenuEntries());
	});
}
