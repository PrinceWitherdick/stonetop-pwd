import { loadImage, cropToCanvas, artImageUrl } from "../book2-art/rebuild-crops.js";
import {
	normalizeRect, PORTRAIT_FRAME_BAKE_DIR, documentPortraitFrame, isValidFrame, sameSrc
} from "./portrait-frame.js";
import { ensureDataDir, uploadFile } from "./foundry-compat.js";

/**
 * The bridge to the Tokenizer module (`vtta-tokenizer`), which is where a token actually gets made.
 *
 * TWO SEPARATE JOBS LIVE HERE, and keeping them apart is the point of this module.
 *
 * 1. OPENING TOKENIZER. `openTokenizer` hands an actor to the module's own editor — the two-pane
 *    Avatar/Token window with its layers, masks, frame library, tints and magic lasso. That window
 *    is the whole reason not to build one: it already does everything a token needs, it is the one
 *    people who use it already know, and no per-actor frame can be passed into Tokenizer anyway
 *    (its headless `autoToken` reaches `_setTokenFrame()` with NO arguments, so it always applies
 *    whichever frame its own world settings name, and the API exposes only functions — never the
 *    `Tokenizer` or `View` classes — so there is nothing to reach past). Choosing a frame is
 *    therefore something Tokenizer does, in Tokenizer.
 *
 * 2. BAKING A SQUARE. `bakeFrameToFile` cuts a chosen frame to a real .webp so it can be a token
 *    image at all. That is unrelated to Tokenizer and happens whether or not the module is
 *    installed: a rect on a flag is invisible to the canvas, which draws a token straight from
 *    `prototypeToken.texture.src`, and Foundry's token texture carries scale, offset and fit but
 *    no crop rect. See portrait-token-frame.js for who calls it and which tokens it may move.
 *
 * The rect stays the source of truth. The bake is a one-way export taken at the moment the frame
 * is saved, writing ONE file per person that is overwritten every time — re-framing replaces it
 * rather than piling up a file per crop, which matters because Foundry exposes no delete.
 *
 * ⚠ Tokenizer rewrites `actor.img` to `<path>?<timestamp>` after it runs. Everything here compares
 * paths through helpers that strip query strings for exactly that reason.
 */

const MODULE_ID = "vtta-tokenizer";
const WEBP_QUALITY = 0.9;   // a face at token size, so slightly above the bulk-rebuild's 0.85

/** The module's API, or null when it is not installed or not enabled. */
export function tokenizerApi() {
	const mod = game.modules?.get(MODULE_ID);
	if (!mod?.active) return null;
	return mod.api ?? globalThis.Tokenizer ?? null;
}

/**
 * Should this user be offered the Tokenizer button?
 *
 * Only the module being present and this being a real Actor. Upload rights are deliberately NOT
 * checked: Tokenizer's own `launchTokenizer` warns about them and can still be opened read-only
 * (its `disable-player` setting decides), so gating here would hide a window the module itself is
 * willing to show.
 *
 * A follower card is a flag rather than a document, so it answers this with the Actor it has
 * already been placed on the map as (module/hooks/FollowerDrop.js) — and with null until then,
 * which is the whole gate: no actor, no token to make.
 */
export function canOpenTokenizer(actor) {
	return !!(actor && tokenizerApi()?.launch);
}

/** One of Tokenizer's own settings, or `fallback` if this version does not have it. */
function tokenizerSetting(key, fallback) {
	try {
		const value = game.settings?.get?.(MODULE_ID, key);
		return value === undefined ? fallback : value;
	} catch {
		return fallback;
	}
}

/**
 * The picture Tokenizer's AVATAR pane should open on.
 *
 * NOT blindly `actor.img`. A framed person's `actor.img` is usually a shipped SQUARE whose crop is
 * baked into its filename, and our framer deliberately never rewrites it — the rect lives on a
 * flag so the full illustration survives for whatever reads `actor.img`. The upshot was an Avatar
 * pane showing a square cut with a crop the user had already replaced, and — worse — ticking its
 * MODIFY box would bake that stale square in permanently as the new `actor.img`.
 *
 * The frame's own `src` is the right answer and a safe one: it is the picture the rect was
 * measured on (so it matches what every surface displays), it is the WHOLE illustration rather
 * than a square cut from it, and it is proven-loadable by construction — PortraitFrameDialog
 * stamps only the path that actually loaded onto its stage. A derived parent path would not be:
 * `fullPortraitSrc` swaps a basename without checking the file is there, and a miss would leave
 * Tokenizer showing its mystery-man, which is worse than the stale square.
 *
 * An unframed actor keeps `actor.img`, exactly as before.
 */
export function tokenizerAvatarSource(actor) {
	const frame = documentPortraitFrame(actor);
	if (isValidFrame(frame)) return frame.src;
	return actor?.img ?? "";
}

/**
 * Apply what Tokenizer produced.
 *
 * Stands in for Tokenizer's own `updateActor`, which is module-private — the price of using
 * `launch` (the only entry point that takes an `avatarFilename`) rather than `tokenizeActor`.
 *
 * ⚠ ONE DELIBERATE DIFFERENCE. Tokenizer rewrites `actor.img` on every Apply, even when the
 * avatar was untouched, appending a fresh `?timestamp` to the same path. Here `img` is written
 * ONLY when Tokenizer actually produced a new avatar file — which it does only if the user ticked
 * MODIFY on that pane. Otherwise the portrait is left completely alone, which is the whole point
 * of opening the pane on the full illustration rather than letting a square be baked in.
 *
 * ⚠ NOT REPLICATED: Tokenizer's dynamic-token-ring handling and its `reset-scaling` option. Those
 * live in the private updateActor. A world relying on them should tokenize from Tokenizer's own
 * sheet-header button instead of this pip.
 */
async function applyTokenizerResult(response, { avatarSentIn }) {
	const actor = response?.actor;
	if (!actor) return;
	const stamp = `${Date.now()}`;
	const bust = (path) => `${String(path).split("?")[0]}?${stamp}`;
	const update = {};

	// Compared through sameSrc, which strips the query string Tokenizer appends — otherwise every
	// Apply would look like a change.
	if (response.avatarFilename && !sameSrc(response.avatarFilename, avatarSentIn)) {
		update.img = bust(response.avatarFilename);
	}
	// A wildcard token path sends the upload somewhere else entirely and leaves prototypeToken
	// alone; Tokenizer's own update skips it for the same reason.
	//
	// Dotted keys rather than a nested object, matching portrait-token-frame.js and every other
	// token write in this system. Document#update expands them itself, and it keeps this function
	// free of `foundry.utils`, which is what lets it be unit-tested.
	const tokenized = !response.isWildCard && !!response.tokenFilename;
	if (tokenized) {
		update["prototypeToken.texture.src"] = bust(response.tokenFilename);
		update["prototypeToken.randomImg"] = false;
	}
	if (!Object.keys(update).length) return;

	await actor.update(update);
	// Carry it onto any tokens already on a scene. Tokenizer exposes this one, so the fiddly part
	// — rebuilding each token document from the new prototype — stays its code rather than ours.
	if (tokenized) await tokenizerApi()?.updateSceneTokenImg?.(actor);
}

/**
 * Open the Tokenizer module's editor on this actor.
 *
 * Uses `launch` rather than `tokenizeActor` for exactly one reason: it is the only entry point
 * that accepts an `avatarFilename`, and the Avatar pane must open on the full illustration rather
 * than on whatever square `actor.img` happens to hold. See tokenizerAvatarSource. Everything else
 * here reconstructs the options `tokenizeActor` would have built, from Tokenizer's own settings,
 * so the window behaves as it would by any other route — `type` in particular, because it is what
 * selects Tokenizer's PC-versus-NPC default frame.
 *
 * Returns true if it was opened.
 */
export function openTokenizer(actor) {
	const api = tokenizerApi();
	if (!api?.launch || !actor) return false;

	const prototype = actor.prototypeToken ?? {};
	// Mirrors Tokenizer's getWildCard: the flag, and — when it asks for it — a path that really
	// does carry a wildcard.
	const isWildCard = !!prototype.randomImg
		&& (!tokenizerSetting("check-for-wildcard-asterisk", false)
			|| String(prototype.texture?.src ?? "").includes("*"));
	// Mirrors Tokenizer's getActorType. Only a PC is "pc"; every other actor this system has
	// (npc, monster, stonetop) is an NPC as far as Tokenizer's frame defaults are concerned.
	const type = actor.type === "character" ? "pc" : "npc";
	const avatarFilename = tokenizerAvatarSource(actor);

	api.launch({
		actor,
		name: actor.name,
		type,
		disposition: prototype.disposition,
		avatarFilename,
		tokenFilename: prototype.texture?.src,
		isWildCard,
		nameSuffix: tokenizerSetting("actor-id-in-name", false) ? `.${actor.id}` : undefined
	}, (response) => applyTokenizerResult(response, { avatarSentIn: avatarFilename }));
	return true;
}

/** Where baked squares go. Beside the world's own data, not inside the system folder, which a
 *  system update would overwrite. */
function bakeDir() {
	return `worlds/${game.world?.id ?? "world"}/${PORTRAIT_FRAME_BAKE_DIR}`;
}


/**
 * ONE baked file per person, overwritten on every save. Deliberately carries no rect in its name.
 *
 * An earlier version stamped the crop into the filename so a re-frame could not disturb a file
 * something already pointed at. The only thing that points at a bake is the token, and a re-frame
 * is precisely when the token should move — so the rect in the name bought nothing and cost a new
 * file per crop, forever, with no way to clean them up.
 *
 * The actor id is in the name because the display name is not unique: two NPCs called "Guard"
 * would otherwise overwrite each other's bake.
 */
export function bakeFileName(name, id) {
	const slug = String(name ?? "").trim().replace(/[^\w.-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);
	const suffix = String(id ?? "").replace(/[^\w-]+/g, "").slice(0, 16);
	return `${slug || "portrait"}${suffix ? `-${suffix}` : ""}-frame.webp`;
}

/**
 * Cut `rect` out of `src` and upload it as a square .webp. Returns the stored path.
 *
 * crossOrigin stays "anonymous" here — unlike the editor, this DOES touch a canvas, and a tainted
 * one throws only at toBlob, i.e. after all the work. The practical effect is that an external
 * URL without CORS headers cannot be baked; the caller reports that rather than half-failing.
 */
export async function bakeFrameToFile(src, rect, { name = "portrait", id = "" } = {}) {
	const r = normalizeRect(rect);
	if (!src || !r) return null;
	// Strip the query/hash before routing, but let artImageUrl decide whether to route at all: a
	// portrait on a hosted setup is a full Assets Library URL, and putting the world route in front
	// of one yields `/https://…`, which never loads — so the frame silently never bakes.
	const path = String(src).split("#")[0].split("?")[0];
	const img = await loadImage(artImageUrl(path));
	if (!(img.naturalWidth > 0) || !(img.naturalHeight > 0)) return null;

	const canvas = cropToCanvas(img, r);
	const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/webp", WEBP_QUALITY));
	if (!blob) return null;

	const dir = bakeDir();
	await ensureDataDir(dir);
	const file = new File([blob], bakeFileName(name, id), { type: "image/webp" });
	// `uploadFile` already answers null for a refused upload — which is exactly this function's own
	// "could not bake" signal (see portrait-token-frame.js), so a rejection needs no handling here
	// beyond passing it along. Stamping a path to a file nobody wrote onto a prototype token is
	// what that null exists to prevent.
	return await uploadFile("data", dir, file);
}
