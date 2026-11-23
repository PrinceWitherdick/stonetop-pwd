import { confirmOutcome } from "../utils/ask-with-buttons.js";
import { escHtml } from "../utils/strings.js";
import { themedDialogClasses } from "../utils/window-theme.js";

/**
 * Core's own yes/no questions, asked in our window.
 *
 * Core asks the questions met in play (delete this from the sidebar, clear the chat log, end the
 * combat, delete a region, clear a layer, delete a token in combat) through a bare
 * DialogV2.confirm: Foundry chrome, "Yes" / "No", and no class of its own. Tagging them from a
 * render hook would mean tagging every DialogV2 in the world, other modules' included. So the
 * core method that asks each one is wrapped instead, the way journal-image-titles.js wraps a sheet
 * handler, and the window gets the Stonetop skin plus buttons that name what they do.
 *
 * Core's callbacks are kept rather than rewritten: what Clear All deletes (locked objects, scene
 * levels), what a folder delete takes with it, all stays core's, so a core update to any of it
 * still runs. Only the window's classes and the two buttons' words change. Two ways in:
 *
 *  - `deleteDialog(options)` merges its options into the confirm, so the dress goes in there.
 *  - The rest take no options. For those, DialogV2.confirm is swapped for the ONE call the method
 *    makes before its first await (withDressedConfirm). Each reaches it synchronously today; if
 *    a later core awaits first, the swap is already undone and core's own window shows: a plain
 *    window, never a broken one.
 *
 * The token question is the exception: core's version is asked again in our words, below.
 *
 * Guarded by tests/hooks/core-confirms.test.js.
 */

const WRAPPED = Symbol("stonetop.coreConfirm");

/** Core's label for a document type, localized ("Actor", "Journal Entry"). */
function docLabel(cls, plural = false) {
	const key = plural ? cls?.metadata?.labelPlural : cls?.metadata?.label;
	const text = key ? (globalThis.game?.i18n?.localize?.(key) ?? key) : "";
	return text || (plural ? "documents" : "document");
}

/** "Journal Entry" -> "journal entry", but "GM Toolkit" -> "GM toolkit": an acronym stays. */
function lowerWords(text) {
	return text.split(" ").map(w => (w.length > 1 && w === w.toUpperCase()) ? w : w.toLowerCase()).join(" ");
}

/**
 * A DialogV2.confirm config in our dress: the Stonetop window classes and outcome-named buttons.
 * The buttons' callbacks and anything else core put on them are kept.
 */
export function dressConfirm(config = {}, { yes, yesIcon = "fa-check", no = "Keep it", danger = true }) {
	return {
		...config,
		classes: [...(config.classes ?? []), ...themedDialogClasses("stonetop-ask", "stonetop-core-confirm")],
		yes: {
			...config.yes,
			label: yes,
			icon:  `fas ${yesIcon}`,
			...(danger ? { class: "stonetop-dialog-btn--danger" } : {}),
		},
		no: { ...config.no, label: no, icon: "fas fa-xmark" },
	};
}

/**
 * Run `run` with the next DialogV2.confirm call dressed by `skin`. One call only, and the swap is
 * undone before `run` returns, so nothing asked later (by anyone) is touched.
 */
export function withDressedConfirm(skin, run) {
	const DialogV2 = globalThis.foundry?.applications?.api?.DialogV2;
	if (!DialogV2 || !skin) return run();
	const own = Object.hasOwn(DialogV2, "confirm");
	const original = DialogV2.confirm;
	const restore = () => { if (own) DialogV2.confirm = original; else delete DialogV2.confirm; };
	DialogV2.confirm = function (config) {
		restore();
		return original.call(this, dressConfirm(config, skin));
	};
	try {
		return run();
	} finally {
		restore();
	}
}

/** Wrap `proto[method]` once, dressing the confirm it asks with `skinFor(this, args)`. */
function dressMethod(proto, method, skinFor) {
	const base = proto?.[method];
	if (typeof base !== "function" || base[WRAPPED]) return;
	const wrapped = function (...args) {
		return withDressedConfirm(skinFor(this, args), () => base.apply(this, args));
	};
	wrapped[WRAPPED] = true;
	proto[method] = wrapped;
}

/* ── Sidebar and folder deletes ─────────────────────────────────────────── */

/** The skin for `deleteDialog` on this document, given the options its caller passed. */
export function deleteSkin(doc, options = {}) {
	const cls = doc?.constructor;
	if (cls?.documentName === "Folder") {
		// The sidebar's Delete Folder passes its own yes-callback (folder and contents); Remove
		// Folder does not, and core's plain delete moves the contents up a level.
		return options.yes?.callback
			? { yes: "Delete the folder and everything in it", yesIcon: "fa-dumpster" }
			: { yes: "Remove the folder, keep what's in it", yesIcon: "fa-folder-minus" };
	}
	return { yes: `Delete the ${lowerWords(docLabel(cls))}`, yesIcon: "fa-trash" };
}

/**
 * Each document class gets ClientDocumentMixin applied on its own, so there is no one prototype
 * that owns `deleteDialog`: find the owner in each class's chain and wrap each owner once.
 */
function patchDeleteDialogs() {
	for (const cls of Object.values(globalThis.foundry?.documents ?? {})) {
		let proto = cls?.prototype;
		while (proto && !Object.hasOwn(proto, "deleteDialog")) proto = Object.getPrototypeOf(proto);
		const base = proto?.deleteDialog;
		if (typeof base !== "function" || base[WRAPPED]) continue;
		const wrapped = function (options = {}, operation = {}) {
			return base.call(this, dressConfirm(options, deleteSkin(this, options)), operation);
		};
		wrapped[WRAPPED] = true;
		proto.deleteDialog = wrapped;
	}
}

/* ── Canvas: the Delete key and Clear All ───────────────────────────────── */

/** Why deleting these tokens needs asking: the sentences to show, or none. */
export function tokenDeleteWarnings(documents) {
	const tokens = new Set(documents);
	const many = documents.length > 1;
	const warnings = [];
	// `attachments` is v14; a v13 token has no regions to lose.
	if (documents.some(t => t?.attachments?.regions?.size)) {
		warnings.push(many
			? "A region is attached to one of them, and is deleted with it."
			: "A region is attached to it, and is deleted with it.");
	}
	const inCombat = Array.from(globalThis.game?.combats ?? [])
		.some(combat => Array.from(combat.combatants ?? []).some(c => tokens.has(c.token)));
	if (inCombat) {
		warnings.push(many
			? "One of them is in combat, so it leaves the encounter and the turn order as well."
			: "It is in combat, so it leaves the encounter and the turn order as well.");
	}
	return warnings;
}

/** The token question itself: true to delete, false (or a closed window) to keep. */
export async function confirmTokenDelete(documents, warnings) {
	const one = documents.length === 1;
	const name = documents[0]?.name;
	const what = one
		? (name ? `<strong>${escHtml(name)}</strong>` : "this token")
		: `these ${documents.length} tokens`;
	const ok = await confirmOutcome({
		title:   one ? "Delete Token" : "Delete Tokens",
		content: `<p>Delete ${what} from the scene?</p>${warnings.map(w => `<p>${w}</p>`).join("")}`,
		yes:     { label: one ? "Delete the token" : "Delete the tokens", icon: "fa-trash", className: "stonetop-dialog-btn--danger" },
		no:      { label: one ? "Keep it" : "Keep them" },
		classes: ["stonetop-token-delete-dialog"],
	});
	return ok === true;
}

/**
 * Core's TokenLayer question (client/canvas/layers/tokens.mjs, v14) is asked again here rather
 * than dressed, so it can name the token and say what the combat loses. The two reasons core asks
 * are restated from its source: an attached region, and a token that is some combat's combatant.
 * When neither holds core does not ask, and this goes straight to core.
 */
function patchTokenDeleteKey(proto) {
	const base = proto?._confirmDeleteKey;
	if (typeof base !== "function" || base[WRAPPED]) return;
	const wrapped = async function (documents) {
		const warnings = tokenDeleteWarnings(documents ?? []);
		if (!warnings.length) return base.call(this, documents);
		return confirmTokenDelete(documents, warnings);
	};
	wrapped[WRAPPED] = true;
	proto._confirmDeleteKey = wrapped;
}

function layerDocClass(layer) {
	const name = layer?.constructor?.documentName;
	return name ? globalThis.CONFIG?.[name]?.documentClass : null;
}

/* ── Everything, once, in init ──────────────────────────────────────────── */

export function patchCoreConfirms() {
	const f = globalThis.foundry;
	patchDeleteDialogs();

	dressMethod(f?.documents?.collections?.ChatMessages?.prototype, "flush", () => ({
		yes: "Clear the chat log", yesIcon: "fa-trash",
	}));

	dressMethod(f?.documents?.Combat?.prototype, "endCombat", () => ({
		yes: "End the combat", yesIcon: "fa-flag-checkered", no: "Keep fighting",
	}));

	// The base layer's Delete-key question: regions with behaviours today (RegionLayer calls
	// super), and any layer core turns `confirmDeleteKey` on for later.
	const layers = f?.canvas?.layers;
	dressMethod(layers?.PlaceablesLayer?.prototype, "_confirmDeleteKey", (layer, [documents]) => {
		const many = (documents?.length ?? 0) > 1;
		const label = lowerWords(docLabel(layerDocClass(layer), many));
		return { yes: `Delete the ${label}`, yesIcon: "fa-trash", no: many ? "Keep them" : "Keep it" };
	});

	dressMethod(layers?.PlaceablesLayer?.prototype, "deleteAll", layer => {
		const label = lowerWords(docLabel(layerDocClass(layer), true));
		const whose = globalThis.game?.user?.isGM ? "all the" : "all your";
		return { yes: `Delete ${whose} ${label}`, yesIcon: "fa-trash", no: "Keep them" };
	});

	patchTokenDeleteKey(layers?.TokenLayer?.prototype);
}
