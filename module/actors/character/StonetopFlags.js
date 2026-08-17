import { SYSTEM_ID, LEGACY_FLAG_SCOPES, isCutOver } from "../../system-id.js";
import { deletionEntry } from "../../utils/foundry-compat.js";

const _scope = SYSTEM_ID;
export const STONETOP_SCOPE = _scope;

// Compendium pack ids, derived from the system scope so a system-id rename touches only
// system-id.js. Re-exported rather than declared here: they live beside packId now, where the
// journal, bestiary and macro packs could join them. Import from either; do not retype the
// literal pack path.
export { ITEMS_PACK, ARCANA_PACK } from "../../system-id.js";
// Compendium item documents store their custom flags under the original system ID.
// This intentionally differs from STONETOP_SCOPE (actor flags) — see system-id.js.
export { ITEM_FLAG_SCOPE } from "../../system-id.js";

// A document is "cut over" once the system-id migration has copied its flags into the
// active scope (system-id.js#isCutOver). From then on the active scope is authoritative on
// its own: continuing to fall back to the old scope would resurrect sub-keys the system
// deliberately deletes (e.g. CharacterArcana#removeArcanum dropping a re-drawn arcanum's
// unlock/boxes keys).

export class StonetopFlags {
	_namespace;


	constructor(actor, namespace) {
		this._actor = actor;
		this._namespace = namespace;
	}

	getFlag(key) {
		const path = this.buildKey(key);
		// getFlag() resolves the dot-path; the legacy rungs are read as a literal key,
		// which is how they were written before the scope was namespaced. The migration
		// folds those rungs into the active bag verbatim, so the active read has to try
		// the literal key too — same pair resolvedFlagProperty() uses.
		const active = this._actor.getFlag(_scope, path) ?? this._actor.flags?.[_scope]?.[path];
		if (isCutOver(this._actor)) return active;
		let value = active;
		for (const scope of LEGACY_FLAG_SCOPES) value = value ?? this._actor.flags?.[scope]?.[path];
		return value;
	}

	async setFlag(key, value, options) {
		// With document options (e.g. { render: false }) route through actor.update so the
		// caller can suppress the automatic sheet re-render; setFlag() takes no options.
		if (options) await this._actor.update(this.updateData(key, value), options);
		else await this._actor.setFlag(_scope, this.buildKey(key), value);
	}

	async unsetFlag(key) {
		await this._actor.unsetFlag(_scope, this.buildKey(key));
	}

	// Write a single nested sub-key of a flag object without rewriting its sibling keys, so two
	// writes to different sub-keys can't clobber each other via a stale `{ ...current }` spread
	// (e.g. rapid clicks on a card's back-power track and its back-item ammo track). `subKey` is
	// a literal object key used as one dot-path segment — a ':' (as in an arcanum's "<slug>:item"
	// resource) is safe; it must not contain '.'. `options` (e.g. { render: false }) routes
	// through actor.update.
	async setSubKey(key, subKey, value, options) {
		const path = `flags.${_scope}.${this.buildKey(key)}.${subKey}`;
		await this._actor.update({ [path]: value }, options);
	}

	// Returns an `actor.update()` fragment that writes this flag, so callers can
	// batch it into a single document update alongside other field changes.
	updateData(key, value) {
		return { [`flags.${_scope}.${this.buildKey(key)}`]: value };
	}

	// The same, for REMOVING a flag: the `unsetFlag` counterpart of `updateData`, so a caller
	// batching several changes can drop a flag in the same update rather than in a second write.
	// Emitted in whichever form the running core applies (deletionEntry: a ForcedDeletion on
	// v14+, the legacy "-=key" prefix below it).
	deletionData(key) {
		const [path, value] = deletionEntry(`flags.${_scope}.${this.buildKey(key)}`);
		return { [path]: value };
	}

	// Apply a fragment built by updateData/deletionData on its own, for a caller that has no
	// other changes to batch it with. No-op on an empty or absent fragment.
	async applyUpdateData(data, options) {
		if (data && Object.keys(data).length) await this._actor.update(data, options);
	}

	// Apply several flag writes and/or sub-key deletions in ONE actor.update (a single
	// document write / sheet re-render) instead of many sequential setFlag/unsetFlag calls.
	// `sets` is { key: value } — each REPLACES that flag wholesale (an array/primitive
	// replaces; note a plain-object value still deep-MERGES, so use `deletes` to drop keys).
	// `deletes` is { key: [subKey, …] } — each subKey is removed from that flag object in whichever
	// form the running core actually applies (deletionEntry: a ForcedDeletion on v14+, the legacy
	// "-=key" prefix below it). A subKey may contain ':' but not '.'. v14 still honours "-=", but
	// logs a deprecation for every key — a prune that drops a dozen answers filled the console.
	async batch({ sets = {}, deletes = {} } = {}, options) {
		const data = {};
		for (const [key, value] of Object.entries(sets)) {
			data[`flags.${_scope}.${this.buildKey(key)}`] = value;
		}
		for (const [key, subKeys] of Object.entries(deletes)) {
			for (const sub of subKeys) {
				const [path, value] = deletionEntry(`flags.${_scope}.${this.buildKey(key)}.${sub}`);
				data[path] = value;
			}
		}
		if (Object.keys(data).length) await this._actor.update(data, options);
	}

	buildKey(key) {
		return `${this._namespace}.${key}`;
	}
}

export function resolvedFlags(actor) {
	const active = actor.flags?.[_scope];
	if (isCutOver(actor)) return active ?? {};
	let bag = active;
	for (const scope of LEGACY_FLAG_SCOPES) bag = bag ?? actor.flags?.[scope];
	return bag ?? {};
}

export function resolvedFlagProperty(actor, path) {
	const scoped = resolvedFlags(actor);
	return foundry.utils.getProperty(scoped, path) ?? scoped?.[path];
}
