// A settlement's portrait: a square cut from its own Book II picture, else its initials on a disc.
// The actor's image only; the sheet's banner carries no picture, as Stonetop's carries none.
//
// THE BOOK PICTURE (the user's picks, data/settlement-portraits.js). A fractional square of a
// picture the Import Book Art macro extracted from the GM's own PDF. Nothing ships: on the GM's
// machine the square is cut from the picture on disk and written beside it, at
// `<art root>/assets/settlements/<key>-q<x0>-<y0>-<x1>-<y1>.webp`. The rect is in the name, so a
// re-framed pick is a new file rather than a stale one wearing the old name.
//
// THE INITIALS (the user's call, 2026-10-14): one letter per word, so Marshedge is M, "Mammoth-herder
// band" is MB (a hyphenated word is one word) and "North Manmarch hillfort" is NMH, at most three.
// Avara Bold capitals on the house portrait disc. Any combination can come up, so the discs cannot
// all ship drawn: the 26 outlines ship as data (data/settlement-letter-glyphs.js; an SVG loaded
// through an img cannot use a web font) and the GM's client composes the disc and writes it to
// `<art root>/assets/settlements/letters/<INITIALS>-v<n>.svg`, shared by every place with those
// initials. A name with no Latin letter, or a client that cannot write, gets the village icon.
//
// ADOPTED, NEVER IMPOSED. Only an image this system set is ever replaced: a disc, the village icon,
// an earlier build's placeholder, or a cut of ours. A picture the GM chose is left alone, so this
// runs on every load; a sheet made before the art was imported picks its picture up on the next one,
// and a sheet renamed while on its disc takes the new initials. An earlier build's poster map is
// the one exception that cannot be told from a choice by its path (a GM may pick that same map), so
// it counts as ours only on the first pass a world sees (`legacyMaps`; Ready.js stamps it done).

import { SYSTEM_ID } from "../../system-id.js";
import { systemAssetVariants } from "../../migration/compat.js";
import { book2ArtRoot, book2ArtSrcWith } from "../../book2-art/art-root.js";
import { browseArtDirs, forgetArtBrowseDirs, servedPath } from "../../book2-art/browse.js";
import { rectSuffix } from "../../book2-art/people-portraits.js";
import { ensureDataDir, uploadFile } from "../../utils/foundry-compat.js";
import { SETTLEMENT_PORTRAITS } from "../../data/settlement-portraits.js";
import { LETTER_CAP_INK, LETTER_FOOT, LETTER_GLYPHS } from "../../data/settlement-letter-glyphs.js";
import { isSettlementActor, settlementActors } from "./settlement-type.js";
import { isDefaultImg } from "../../utils/strings.js";

/** The village icon: a name with no letter to show, or a client that cannot write a disc. */
export const SETTLEMENT_DEFAULT_IMG = `systems/${SYSTEM_ID}/assets/icons/settlement.svg`;

/** Where the cut squares go, inside the art root; the discs go in its `letters` folder. */
export const SETTLEMENT_PORTRAIT_DIR = "assets/settlements";
const LETTERS_DIR = `${SETTLEMENT_PORTRAIT_DIR}/letters`;
/** Bumped when the disc's drawing changes, so every world writes the new one instead of reusing. */
const LETTER_VERSION = 1;

// ── The initials disc ─────────────────────────────────────────────────────────────

/** One capital per word, at most three: "Mammoth-herder band" -> "MB". Empty when there are none. */
export function settlementInitials(name) {
	return String(name ?? "").split(/\s+/)
		.map(word => word.match(/[A-Za-z]/)?.[0]?.toUpperCase() ?? "")
		.filter(Boolean).slice(0, 3).join("");
}

/** The disc's path inside the art root, e.g. `assets/settlements/letters/MB-v1.svg`. */
export function settlementLetterOut(initials) {
	return initials ? `${LETTERS_DIR}/${initials}-v${LETTER_VERSION}.svg` : null;
}

// The house portrait disc (see assets/icons/gm-toolkit.svg): a 1600 canvas, a cream disc, a black
// field 10.85 inside it, the ink in cream.
const CENTRE = 800, RIM = 723.45, FIELD = 712.6, CREAM = "#f0ece3";
/** One letter's ink stands this tall; two or three shrink until the row fits inside the field. */
const ONE_LETTER_CAP = 660;
/** How far inside the field the row's corners must stay. */
const INSET = 110;

/**
 * The disc for some initials, as SVG text. Pure.
 *
 * Centred on the row's own INK, both ways: across, from the first letter's left edge to the last
 * one's right; down, from the tallest top to the lowest foot. Avara's capitals are not uniform (A, T
 * and S peak above H; E, M and W have feet that dip below the baseline), so centring on a fixed band,
 * let alone the font's cap-height metric, sat letters visibly low. A true descender (J, Q) hangs
 * below the centred row, as it does in print, so its tail is not counted. A row too wide for the disc
 * at full size shrinks until its corners clear the field.
 */
export function letterDiscSvg(initials) {
	const chars = [...String(initials ?? "")].filter(c => LETTER_GLYPHS[c]);
	let pen = 0;
	const placed = chars.map(c => { const g = LETTER_GLYPHS[c]; const at = pen; pen += g.advance; return { g, at }; });
	const left = placed.length ? placed[0].at + placed[0].g.xMin : 0;
	const right = placed.length ? placed.at(-1).at + placed.at(-1).g.xMax : 0;
	const top = placed.length ? Math.max(...placed.map(p => p.g.yMax)) : LETTER_CAP_INK;
	const bottom = placed.length ? Math.min(...placed.map(p => Math.max(p.g.yMin, LETTER_FOOT))) : 0;
	const width = Math.max(1, right - left);
	const height = Math.max(1, top - bottom);
	// The row is a box centred on the disc; it fits while its corners sit inside a circle of radius
	// FIELD - INSET. Solved for the scale directly: (w s / 2)^2 + (h s / 2)^2 <= r^2. One letter is
	// sized by H, so every single-letter disc carries the same size of capital.
	const r = FIELD - INSET;
	const scale = Math.min(ONE_LETTER_CAP / LETTER_CAP_INK, (2 * r) / Math.hypot(width, height));
	const tx = CENTRE - (left + width / 2) * scale;
	const ty = CENTRE + ((top + bottom) / 2) * scale;      // font units are y-up
	const paths = placed.map(({ g, at }) => `<path transform="translate(${at} 0)" d="${g.d}"/>`).join("");
	return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 1600" width="200" height="200" role="img" aria-label="${chars.join("")}">`
		+ `<circle cx="${CENTRE}" cy="${CENTRE}" r="${RIM}" fill="${CREAM}"/><circle cx="${CENTRE}" cy="${CENTRE}" r="${FIELD}" fill="#000"/>`
		+ `<g fill="${CREAM}" transform="translate(${tx.toFixed(2)} ${ty.toFixed(2)}) scale(${scale.toFixed(5)} ${(-scale).toFixed(5)})">${paths}</g></svg>\n`;
}

// ── What counts as ours ───────────────────────────────────────────────────────────

const bare = img => String(img ?? "").replace(/^\//, "");
// Served from wherever the host serves the art root, so matched on the path, not its start.
const isLetterImg = img => bare(img).includes(`/${LETTERS_DIR}/`) || bare(img).startsWith(`${LETTERS_DIR}/`);

// The village icon and the transparent region marker the first build used (under every system id
// this package has shipped under). Foundry's own defaults are isDefaultImg's.
const PLACEHOLDERS = new Set([
	...systemAssetVariants("assets/icons/settlement.svg"),
	...systemAssetVariants("assets/icons/landmarks/place-region.svg"),
]);

/** A placeholder (a disc of initials, an icon), which shows nothing of the place itself. */
export function isSettlementPlaceholderImg(img) {
	const b = bare(img);
	return isDefaultImg(b) || isLetterImg(b) || PLACEHOLDERS.has(b);
}

/**
 * Any image this system put on a settlement, and so may replace: a placeholder or a square it cut;
 * with `legacyMaps`, the poster map an earlier build used too.
 */
export function isSystemSettlementImg(img, { legacyMaps = false } = {}) {
	if (isSettlementPlaceholderImg(img)) return true;
	const b = bare(img);
	if (b.includes(`/${SETTLEMENT_PORTRAIT_DIR}/`)) return true;
	return legacyMaps && /\/assets\/maps\/map-[a-z-]+\.webp$/.test(b);
}

// ── The book picture ──────────────────────────────────────────────────────────────

/** The cut square's path inside the art root, e.g. `assets/settlements/lygos-q542-000-876-1000.webp`. */
export function settlementPortraitOut(key, pick = SETTLEMENT_PORTRAITS[key]) {
	if (!key || !pick?.crop) return null;
	return `${SETTLEMENT_PORTRAIT_DIR}/${key}${rectSuffix("q", pick.crop)}.webp`;
}

const dirOf = path => path.slice(0, path.lastIndexOf("/"));

/**
 * What one place's picture needs, given what is on disk. Pure.
 *  • `{ src }` when the square is already cut;
 *  • `{ cut: { parent, crop, out } }` when its book picture is on disk and the square is not;
 *  • null when there is no pick, or no book picture to cut it from.
 */
export function settlementPortraitPlan(key, present, root, picks = SETTLEMENT_PORTRAITS) {
	const pick = picks[key];
	const out = settlementPortraitOut(key, pick);
	if (!out || !present?.has) return null;
	const outKey = book2ArtSrcWith(root, out);
	if (present.has(outKey)) return { src: servedPath(present, outKey) };
	const parentKey = book2ArtSrcWith(root, pick.src);
	if (!present.has(parentKey)) return null;
	return { cut: { parent: servedPath(present, parentKey), crop: pick.crop, out } };
}

// The cutting tools, loaded the first time a square is cut rather than with every sheet; asked for
// once, so the cuts of one pass going out together share the one load. A failed load is dropped, so
// the next pass tries again.
let _cropTools = null;
const cropTools = () => (_cropTools ??= import("../../book2-art/rebuild-crops.js")
	.catch(err => { _cropTools = null; throw err; }));

/**
 * Cut one square into a webp File. `loadParent` decodes the book picture; a pass hands every cut the
 * same one, so two places framed from one picture (the two North Manmarch ones) decode it once.
 */
async function cutPortraitFile({ parent, crop, out }, loadParent) {
	const { cropToCanvas, WEBP_QUALITY } = await cropTools();
	const canvas = cropToCanvas(await loadParent(parent), crop);
	const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/webp", WEBP_QUALITY));
	if (!blob) throw new Error("encode returned no blob");
	return new File([blob], out.slice(out.lastIndexOf("/") + 1), { type: "image/webp" });
}

// ── Resolving ─────────────────────────────────────────────────────────────────────

/**
 * The portrait for each place: its book square when the art is on disk (cut now if need be), else
 * its initials disc (written now if need be), else the village icon. One browse for the lot.
 * GM-only for the writing; anyone else gets the icon, and no one but a GM makes or renames these.
 *
 * Every place is planned up front and the writes go out together. The places do not wait on one
 * another, but a file two of them need is written once (`made` holds the write's promise, so the
 * second asks after the first's), and a book picture two of them are cut from is decoded once.
 *
 * @param {{key: string, name: string}[]} places  `key` is the settlement's `system.sourceSlug`
 * @returns {Promise<string[]>} one path per place, in order
 */
export async function resolveSettlementPortraits(places) {
	if (!globalThis.game?.user?.isGM) return places.map(() => SETTLEMENT_DEFAULT_IMG);
	const root = book2ArtRoot();
	const dirs = new Set([SETTLEMENT_PORTRAIT_DIR, LETTERS_DIR]);
	for (const { key } of places) if (SETTLEMENT_PORTRAITS[key]) dirs.add(dirOf(SETTLEMENT_PORTRAITS[key].src));
	let present = null;
	try { present = await browseArtDirs(root, [...dirs]); }
	catch (err) { console.warn("Stonetop | could not look for settlement portraits", err); }

	// Promises, not answers, in all three: two places that ask at once share the one in flight
	// rather than each finding nothing there yet and starting their own.
	const made = new Map();       // out -> its written path, so two places sharing a file write it once
	const dirsMade = new Map();   // each folder is asked for once per pass, not before every file
	const parents = new Map();    // book picture -> its decoded image, so a shared one decodes once
	// createDirectory makes one folder, never its parents: on a world the art was never imported
	// into, the art root and its `assets` are not there yet, so every folder on the way is asked
	// for, outermost first.
	const ensurePath = path => {
		if (!dirsMade.has(path)) {
			const up = path.includes("/") ? ensurePath(dirOf(path)) : Promise.resolve();
			dirsMade.set(path, up.then(() => ensureDataDir(path)));
		}
		return dirsMade.get(path);
	};
	const loadParent = parent => {
		if (!parents.has(parent)) {
			parents.set(parent, cropTools()
				.then(({ loadImage, artImageUrl }) => loadImage(artImageUrl(parent))));
		}
		return parents.get(parent);
	};
	let wrote = false;
	const writeOnce = async (out, makeFile) => {
		const outKey = book2ArtSrcWith(root, out);
		if (present?.has(outKey)) return servedPath(present, outKey);
		try {
			const file = await makeFile();
			await ensurePath(`${root}/${dirOf(out)}`);
			const src = await uploadFile("data", `${root}/${dirOf(out)}`, file);
			wrote ||= !!src;
			return src;
		}
		catch (err) { console.warn(`Stonetop | could not write ${out}`, err); return null; }
	};
	const write = (out, makeFile) => {
		if (!made.has(out)) made.set(out, writeOnce(out, makeFile));
		return made.get(out);
	};

	const plans = places.map(({ key }) => settlementPortraitPlan(key, present, root));
	const results = await Promise.all(places.map(async ({ name }, i) => {
		const plan = plans[i];
		let src = plan?.src ?? (plan?.cut ? await write(plan.cut.out, () => cutPortraitFile(plan.cut, loadParent)) : null);
		if (!src) {
			const initials = settlementInitials(name);
			const out = settlementLetterOut(initials);
			if (out) src = await write(out, () => new File([letterDiscSvg(initials)], out.slice(out.lastIndexOf("/") + 1), { type: "image/svg+xml" }));
		}
		return src ?? SETTLEMENT_DEFAULT_IMG;
	}));
	// Only the two folders written into are re-listed next time; the rest of the session's art
	// browse (seven folders, ~350 files) has not changed and stays cached.
	if (wrote) forgetArtBrowseDirs(root, [SETTLEMENT_PORTRAIT_DIR, LETTERS_DIR]);
	return results;
}

/** The portrait a new settlement starts with. */
export async function settlementPortraitFor(key, name) {
	return (await resolveSettlementPortraits([{ key, name }]))[0];
}

/**
 * What one settlement's image (and token) should become, or null to leave them. Pure. Only an image
 * this system set is replaced; the token follows the portrait while it is one of ours too.
 */
export function settlementPortraitUpdate(actor, want, { legacyMaps = false } = {}) {
	if (!want || !isSystemSettlementImg(actor?.img, { legacyMaps })) return null;
	const update = {};
	if (actor.img !== want) update.img = want;
	const token = actor?.prototypeToken?.texture?.src ?? "";
	if (isSystemSettlementImg(token, { legacyMaps }) && token !== want) update["prototypeToken.texture.src"] = want;
	return Object.keys(update).length ? update : null;
}

/**
 * Bring these settlements' portraits up to date. How many changed. One batched write for the lot;
 * should the batch be refused, one at a time, so one bad actor cannot sink the rest.
 */
async function refreshPortraits(actors, { legacyMaps = false } = {}) {
	const wants = await resolveSettlementPortraits(actors.map(a => ({ key: a.system?.sourceSlug ?? "", name: a.name })));
	const changes = actors
		.map((actor, i) => ({ actor, update: settlementPortraitUpdate(actor, wants[i], { legacyMaps }) }))
		.filter(c => c.update);
	if (!changes.length) return 0;
	const cls = globalThis.getDocumentClass?.("Actor") ?? globalThis.Actor;
	if (changes.length > 1 && cls?.updateDocuments) {
		try {
			await cls.updateDocuments(changes.map(({ actor, update }) => ({ _id: actor.id, ...update })));
			return changes.length;
		} catch (err) { console.warn("Stonetop | batched settlement portrait update failed; trying one at a time", err); }
	}
	let changed = 0;
	for (const { actor, update } of changes) {
		try { await actor.update(update); changed++; }
		catch (err) { console.warn(`Stonetop | could not set ${actor.name}'s portrait`, err); }
	}
	return changed;
}

/**
 * Every settlement still on an image of ours gets its book square, or its initials. Primary GM,
 * every load (hooks/Ready.js); idempotent. `legacyMaps`: an earlier build's poster map counts as
 * ours this pass (the world's first; see the head of this file).
 */
export async function adoptSettlementPortraits(actors = globalThis.game?.actors, { legacyMaps = false } = {}) {
	if (!globalThis.game?.user?.isGM) return 0;
	const settlements = settlementActors(actors).filter(a => isSystemSettlementImg(a.img, { legacyMaps }));
	return settlements.length ? refreshPortraits(settlements, { legacyMaps }) : 0;
}

/**
 * `updateActor`: a settlement renamed while it wears its initials takes the new name's initials.
 * Runs on the client that made the rename, when that is a GM (the only one who can write the disc).
 */
export function reletterOnRename(actor, changed, _options, userId) {
	if (!isSettlementActor(actor) || typeof changed?.name !== "string") return;
	if (!globalThis.game?.user?.isGM || userId !== globalThis.game.user.id) return;
	if (!isSettlementPlaceholderImg(actor.img)) return;
	refreshPortraits([actor]).catch(err => console.warn("Stonetop | could not re-letter a settlement", err));
}
