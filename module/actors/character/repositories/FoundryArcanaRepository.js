import { MinorArcanum } from "../../../model/MinorArcanum.js";
import { FoundryPackStore } from "./FoundryPackStore.js";
import { ITEM_FLAG_SCOPE, ARCANA_PACK, StonetopFlags } from "../StonetopFlags.js";
import { ARCANA_RULE_SLUGS, noteArcanumBack } from "../../../data/arcana-rules.js";

// Shared slug → world-arcanum-Item index. Built lazily and reused across every repository
// instance and every render, so resolving a homebrew slug is O(1) instead of a full
// game.items linear scan per slug per sheet render. Invalidated on any Item CRUD (so a new
// or deleted card is reflected) and rebuilt when the backing collection changes identity
// (covers test global swaps). The index stores live Item references, so edits to an
// existing card's flags are read fresh on each lookup — no stale snapshots.
let _worldArcanaIndex = null;
let _indexedItemsRef  = null;
let _worldIndexHooksBound = false;

function _invalidateWorldArcanaIndex() { _worldArcanaIndex = null; }

function _bindWorldIndexHooks() {
	if (_worldIndexHooksBound) return;
	const Hooks = globalThis.Hooks;
	if (!Hooks?.on) return;
	for (const hook of ["createItem", "updateItem", "deleteItem"]) Hooks.on(hook, _invalidateWorldArcanaIndex);
	_worldIndexHooksBound = true;
}

function _worldArcanumItem(slug) {
	const items = globalThis.game?.items;
	if (!items) return null;
	if (!_worldArcanaIndex || _indexedItemsRef !== items) {
		_bindWorldIndexHooks();
		_indexedItemsRef  = items;
		_worldArcanaIndex = new Map();
		for (const i of items) {
			if (i.type !== "move" || i.system?.moveType !== "arcanum") continue;
			const s = i.flags?.[ITEM_FLAG_SCOPE]?.slug;
			if (s && !_worldArcanaIndex.has(s)) _worldArcanaIndex.set(s, i);
		}
	}
	return _worldArcanaIndex.get(slug) ?? null;
}

export class FoundryArcanaRepository {
	constructor() {
		this._store = new FoundryPackStore(ARCANA_PACK, [`flags.${ITEM_FLAG_SCOPE}.slug`]);
		this._cache = new Map();
	}

	async findBySlug(slug) {
		if (this._cache.has(slug)) return this._cache.get(slug);
		// Shipped (compendium) arcana take precedence on slug collision and are
		// immutable at runtime, so they're safe to cache forever.
		const packArc = await this._findInPack(slug);
		if (packArc) {
			this._cache.set(slug, packArc);
			return packArc;
		}
		// Homebrew arcana live as world Items. Resolve them through the shared, hook-
		// invalidated index (O(1)) and rebuild the MinorArcanum from the item's live flags
		// each call, so edits show up immediately without caching a stale snapshot.
		return this._findInWorld(slug);
	}

	async _findInPack(slug) {
		const entry = await this._store.findEntry(e => e.flags?.[ITEM_FLAG_SCOPE]?.slug === slug);
		if (!entry) return null;
		const doc = await this._store.getDocument(entry._id);
		noteArcanumBack(slug, doc.flags[ITEM_FLAG_SCOPE]?.back?.description);
		return new MinorArcanum({ ...doc.flags[ITEM_FLAG_SCOPE], img: doc.img });
	}

	_findInWorld(slug) {
		const item = _worldArcanumItem(slug);
		if (!item) return null;
		return new MinorArcanum({ ...item.flags[ITEM_FLAG_SCOPE], img: item.img });
	}

	async findBySlugs(slugs) {
		return (await Promise.all(slugs.map(s => this.findBySlug(s)))).filter(Boolean);
	}
}

// The rule cards whose backs this client has asked for, so each is read once.
const _primedRuleSlugs = new Set();
let _ruleGainHooksBound = false;

/** The rule cards (ARCANA_RULE_SLUGS) these actors' characters hold. */
function _heldRuleSlugs(actors) {
	const held = new Set();
	for (const actor of actors ?? []) {
		if (actor?.type !== "character") continue;
		for (const slug of new StonetopFlags(actor, "arcana").getFlag("owned") ?? []) {
			if (ARCANA_RULE_SLUGS.includes(slug)) held.add(slug);
		}
	}
	return held;
}

async function _primeHeld(actors, repo) {
	const slugs = [..._heldRuleSlugs(actors)].filter(slug => !_primedRuleSlugs.has(slug));
	if (!slugs.length) return;
	for (const slug of slugs) _primedRuleSlugs.add(slug);
	try {
		await (repo ?? new FoundryArcanaRepository()).findBySlugs(slugs);
	} catch (err) {
		// Not read: let the next gain or update try again.
		for (const slug of slugs) _primedRuleSlugs.delete(slug);
		console.warn("Stonetop | Could not read the arcana cards the fight rules follow", err);
	}
}

/**
 * Read the backs of the cards the per-card rules name (data/arcana-rules.js) that a character in the world
 * holds, at `ready`, so a blow struck before any sheet has loaded them still finds its boxes by their printed
 * labels. Those rules are asked synchronously and read a card not yet loaded as unmarked, and they only ask
 * about a card its bearer holds, so a card held later is read as it is gained: a character created, or one
 * whose flags change (the owned list among them), primes what it now holds that is not read yet.
 *
 * @param {{actors?: Iterable<Actor>, hooks?: object, repo?: {findBySlugs: Function}}} [deps]
 */
export async function primeArcanaRules({ actors = globalThis.game?.actors, hooks = globalThis.Hooks, repo = null } = {}) {
	if (!_ruleGainHooksBound && hooks?.on) {
		_ruleGainHooksBound = true;
		hooks.on("createActor", actor => { _primeHeld([actor], repo); });
		hooks.on("updateActor", (actor, changes) => { if (changes?.flags) _primeHeld([actor], repo); });
	}
	await _primeHeld(actors, repo);
}

/** Forget what was primed and the hooks bound. Tests only. */
export function _resetArcanaRulePriming() {
	_primedRuleSlugs.clear();
	_ruleGainHooksBound = false;
}
