// The three authoring windows, reopened after a reload where they were left, the way the Playbook
// Builder is (playbooks/playbook-builder-restore.js, by way of utils/window-restore.js): the Steading
// Improvement builder, the custom move author and the inventory item author. Each holds what is typed
// in it only in its form until Save, so a reload (a setting that asks for one, a dropped connection)
// used to throw all of it away.
//
// Its own small module so stonetop.js can register it at load WITHOUT importing the dialogs. The
// classes are named here rather than passed, since window-restore builds the hook names from them;
// tests/dialogs/authoring-restore.test.js holds these names and the classes' own together.
//
// WHERE A WINDOW SAVES TO is the part a reload has to rebuild, and it is never guessed from the
// window: every saver factory stamps `restoreAs` ({ saver, actor?, slug? }) on the saver it returns.
// A saver without one (the Level Up window's, which takes the level as it saves) is not tracked at
// all, so it can't come back as a window that saves somewhere else.
//
// The key is "<kind>:<saver>|<actor uuid>|<target>", the target being the item edited (its uuid),
// the improvement edited ("slug-<slug>"), or "new-<id>" so two new ones open at once are kept apart.

import { registerRestorableWindow } from "../utils/window-restore.js";

export const IMPROVEMENT_BUILDER_RESTORE_KIND = "improvementBuilder";
export const IMPROVEMENT_BUILDER_WINDOW_CLASS = "ImprovementBuilderDialog";
export const CUSTOM_MOVE_RESTORE_KIND = "customMove";
export const CUSTOM_MOVE_WINDOW_CLASS = "CustomMoveDialog";
export const ADD_ITEM_RESTORE_KIND = "addInventoryItem";
export const ADD_ITEM_WINDOW_CLASS = "AddInventoryItemDialog";

const NEW_PREFIX = "new-";
const SLUG_PREFIX = "slug-";

/**
 * The key a window is saved under, or null for one whose saver can't be rebuilt after a reload.
 * @param {string} kind
 * @param {object} saver     the window's saver, with `restoreAs` stamped by its factory
 * @param {object} [opts]
 * @param {object} [opts.item]     the item being edited
 * @param {string} [opts.windowId] the window's own id, for a new one
 */
export function authoringRestoreKey(kind, saver, { item = null, windowId = "" } = {}) {
	const as = saver?.restoreAs;
	if (!as?.saver) return null;
	let target;
	if (item) {
		if (!item.uuid) return null;
		target = item.uuid;
	} else if (as.slug) {
		target = `${SLUG_PREFIX}${as.slug}`;
	} else {
		if (!windowId) return null;
		target = `${NEW_PREFIX}${windowId}`;
	}
	return `${kind}:${as.saver}|${as.actor ?? ""}|${target}`;
}

/** A key's parts, or null when it isn't one of `kind`'s. */
export function parseAuthoringKey(key, kind) {
	const at = String(key ?? "").indexOf(":");
	if (at < 0 || key.slice(0, at) !== kind) return null;
	const [saver, actor, target] = key.slice(at + 1).split("|");
	if (!saver || !target) return null;
	return {
		saver,
		actor: actor || null,
		itemUuid: target.startsWith(NEW_PREFIX) || target.startsWith(SLUG_PREFIX) ? null : target,
		slug: target.startsWith(SLUG_PREFIX) ? target.slice(SLUG_PREFIX.length) : null,
		windowId: target.startsWith(NEW_PREFIX) ? target.slice(NEW_PREFIX.length) : null,
	};
}

// ── The form, as plain values ──────────────────────────────────────────────────────────────────────
// The custom move and inventory item authors keep everything in their fields, so what a reload
// carries is the fields themselves: by `name`, read as the GM types (never at unload, when a window
// half taken down would read back blank) and written back over the fresh form before its own
// listeners read it.

const FIELDS = "input[name], textarea[name], select[name], prose-mirror[name]";
const SKIP_TYPES = new Set(["file", "button", "submit", "reset", "image"]);

/** Every named field's value: a string, or a boolean for a checkbox, or the picked radio's value. */
export function readFormFields(root) {
	const out = {};
	for (const el of root?.querySelectorAll?.(FIELDS) ?? []) {
		const name = el.getAttribute("name");
		const type = String(el.type ?? "").toLowerCase();
		if (!name || SKIP_TYPES.has(type)) continue;
		if (type === "checkbox") out[name] = !!el.checked;
		else if (type === "radio") { if (el.checked) out[name] = String(el.value); }
		else out[name] = String(el.value ?? "");
	}
	return out;
}

/**
 * Put saved values back into the form, each only where it has the shape that field takes: a boolean
 * for a checkbox, a string for the rest, and for a select only one of its options. A live editor
 * (<prose-mirror>) is skipped: the caller hands its text to the template instead.
 */
export function writeFormFields(root, fields) {
	if (!fields || typeof fields !== "object" || Array.isArray(fields)) return;
	for (const el of root?.querySelectorAll?.(FIELDS) ?? []) {
		const name = el.getAttribute("name");
		if (!name || !Object.hasOwn(fields, name) || el.tagName === "PROSE-MIRROR") continue;
		const value = fields[name];
		const type = String(el.type ?? "").toLowerCase();
		if (SKIP_TYPES.has(type)) continue;
		if (type === "checkbox") { if (typeof value === "boolean") el.checked = value; }
		else if (type === "radio") { if (typeof value === "string") el.checked = el.value === value; }
		else if (typeof value !== "string") continue;
		else if (el.tagName === "SELECT") { if ([...el.options].some(o => o.value === value)) el.value = value; }
		else el.value = value;
	}
}

/** The saved fields, if they are a plain map of strings and booleans; else null. */
export function fieldsFromView(fields) {
	if (!fields || typeof fields !== "object" || Array.isArray(fields)) return null;
	const out = {};
	for (const [k, v] of Object.entries(fields)) if (typeof v === "string" || typeof v === "boolean") out[k] = v;
	return out;
}

// ── Rebuilding where a window saves to ─────────────────────────────────────────────────────────────

const reRenderSheet = (actor) => () => { if (actor?.sheet?.rendered) actor.sheet.render(false); };

/** An actor this user may write, from its uuid, or null. */
async function ownedActor(uuid) {
	if (!uuid) return null;
	const actor = await fromUuid(uuid).catch(() => null);
	return actor?.isOwner ? actor : null;
}

/** The item a window was editing, if it is still there and this user may still write it; else null. */
async function editableItem(uuid) {
	const item = await fromUuid(uuid).catch(() => null);
	return item?.isOwner ? item : null;
}

/** The Steading Improvement builder a reload brings back, unrendered, or null when it should stay shut. */
export async function reopenImprovementBuilder(key) {
	const k = parseAuthoringKey(key, IMPROVEMENT_BUILDER_RESTORE_KIND);
	if (!k) return null;
	const mod = await import("./ImprovementBuilderDialog.js");
	let saver = null;
	if (k.saver === "improvementCard") {
		if (!game.user?.isGM && !game.user?.can?.("JOURNAL_CREATE")) return null;
		saver = mod.improvementCardSaver();
	} else if (k.saver === "steadingImprovement" || k.saver === "improvementEdit") {
		const actor = await ownedActor(k.actor);
		const steading = actor?.typedActor;
		if (typeof steading?.addCustomImprovement !== "function") return null;
		if (k.saver === "steadingImprovement") saver = mod.steadingImprovementSaver(steading, reRenderSheet(actor));
		else {
			if (!k.slug) return null;
			saver = mod.improvementEditSaver(steading, k.slug, reRenderSheet(actor));
			// Its improvement has gone from the steading since: nothing to rewrite.
			if (!saver.editing) return null;
		}
	}
	if (!saver) return null;
	return new mod.ImprovementBuilderDialog(saver, { restoreId: k.windowId });
}

/** The custom move author a reload brings back, unrendered, or null when it should stay shut. */
export async function reopenCustomMove(key) {
	const k = parseAuthoringKey(key, CUSTOM_MOVE_RESTORE_KIND);
	if (!k) return null;
	const { canAuthorCustomMoves } = await import("../utils/authoring-gates.js");
	if (!canAuthorCustomMoves()) return null;
	const mod = await import("../actors/character/dialogs/CustomMoveDialog.js");
	const item = k.itemUuid ? await editableItem(k.itemUuid) : null;
	if (k.itemUuid && !item) return null;
	if (k.saver === "characterMove") {
		const actor = await ownedActor(k.actor);
		const character = actor?.typedActor;
		if (typeof character?.addCustomMove !== "function") return null;
		return new mod.CustomMoveDialog(mod.characterMoveSaver(character), { item, onSaved: reRenderSheet(actor), restoreId: k.windowId });
	}
	if (k.saver === "worldMove") {
		if (!item && !game.user?.isGM && !game.user?.can?.("ITEM_CREATE")) return null;
		return new mod.CustomMoveDialog(mod.worldMoveSaver(), { item, restoreId: k.windowId });
	}
	return null;
}

/** The inventory item author a reload brings back, unrendered, or null when it should stay shut. */
export async function reopenAddInventoryItem(key) {
	const k = parseAuthoringKey(key, ADD_ITEM_RESTORE_KIND);
	if (!k) return null;
	const mod = await import("../actors/character/dialogs/AddInventoryItemDialog.js");
	const item = k.itemUuid ? await editableItem(k.itemUuid) : null;
	if (k.itemUuid && !item) return null;
	if (k.saver === "characterInventoryItem") {
		const actor = await ownedActor(k.actor);
		const character = actor?.typedActor;
		if (typeof character?.createCustomInventoryItem !== "function") return null;
		return new mod.AddInventoryItemDialog(mod.characterInventoryItemSaver(character), { item, onSaved: reRenderSheet(actor), restoreId: k.windowId });
	}
	if (k.saver === "worldInventoryItem" || k.saver === "worldTreasure") {
		const treasure = k.saver === "worldTreasure";
		// A treasure is GM-only (worldInventoryItemSaver), and a new world item needs the right to make one.
		if (treasure && !game.user?.isGM) return null;
		if (!item && !game.user?.isGM && !game.user?.can?.("ITEM_CREATE")) return null;
		return new mod.AddInventoryItemDialog(mod.worldInventoryItemSaver({ treasure }), { item, restoreId: k.windowId });
	}
	return null;
}

/** Registered once, at module scope in stonetop.js. */
export function registerAuthoringRestore() {
	registerRestorableWindow({ name: IMPROVEMENT_BUILDER_WINDOW_CLASS }, IMPROVEMENT_BUILDER_RESTORE_KIND, reopenImprovementBuilder);
	registerRestorableWindow({ name: CUSTOM_MOVE_WINDOW_CLASS }, CUSTOM_MOVE_RESTORE_KIND, reopenCustomMove);
	registerRestorableWindow({ name: ADD_ITEM_WINDOW_CLASS }, ADD_ITEM_RESTORE_KIND, reopenAddInventoryItem);
}
