// Some special possessions are kits/stations that bundle a fixed set of mundane
// gear — the Blessed's Apiary is "beeswax, honey, ◇ bee smokers…". Rather than make
// the player hand-type each line, a possession's authored `grantsItems` array is
// materialized into real inventory items when the possession is selected, and
// removed when it's deselected. Items the book writes plainly land in the small
// column (no load); items it marks ◇ land in the regular column with a load weight.
//
// Granted items are ordinary `inventory-custom` items (so they render and delete
// like any write-in) tagged with `sourcePossession`/`sourceKey` for sync, plus a
// `sourceLabel` that drives the "from <possession>" note on the gear tab.

import { deletionEntry } from "../../utils/foundry-compat.js";

/**
 * Every name one grant answers to, qualified by the column it lands in
 * (`regular:Bee smokers` / `small:Honey`).
 *
 * De-duped WITHIN the grant: a grant that repeats a name (the Distillery's whisky lists its
 * `sourceKey` verbatim in `aliases` too) must not read as the same name coming from two places
 * and null itself out of the source map below.
 */
function grantKeys(grant) {
	const column = grant.column === "regular" ? "regular" : "small";
	return [...new Set([grant.name, grant.sourceKey, ...(grant.aliases ?? [])].filter(Boolean))]
		.map(name => `${column}:${name}`);
}

/**
 * The column-qualified name an inventory ITEM answers to, for matching an untagged write-in
 * against the grant keys above.
 */
export function itemGrantKey(item) {
	return `${item?.system?.inventoryColumn === "regular" ? "regular" : "small"}:${item?.name ?? ""}`;
}

/**
 * Which active possession each grant key belongs to: `key → {slug, grant}`, or `null` for a key
 * two grants both produce.
 *
 * This is the ONE rule for recognising untagged gear, and all three places that ask about it go
 * through it: the gear tab, which renders a legacy item inside its possession's card; the select
 * path, which declines to duplicate a grant that is already sitting there as a write-in; and the
 * deselect path, which tears the same items down. Legacy gear carries no `sourcePossession`
 * (MoveModel stripped the field before it declared it), so name inference is the only way to
 * recognise it at all — but a bare name match is not the rule:
 *
 *  • the COLUMN has to agree. A hand-written small "Grappling hook" is not the Burglar's Kit's ◇
 *    regular one, and a name-only match let a deselect delete the player's own item;
 *  • a key TWO grants produce is claimed by NEITHER — whether they come from two possessions
 *    (Carpenter's tools and the Distillery both grant firkins) or from one. Guessing a parent
 *    there is how an item ends up rendered under one possession and deleted by another.
 *
 * The three have to agree because they are the two halves of one sync plus the view of it:
 * adopting on the way in on a looser rule than the one that disowns on the way out leaves a sheet
 * full of orphans, and the reverse leaves a grant that can never materialize.
 *
 * `activeOptions` is the possessions the character actually holds (selected + preselected) — and
 * on the teardown path must still INCLUDE the one being deselected, which the selection has
 * already dropped by then. Pure — unit-tested without Foundry.
 */
export function grantSourceMap(activeOptions = []) {
	const sources = new Map();
	for (const opt of activeOptions) {
		for (const grant of (opt?.grantsItems ?? [])) {
			if (!grant?.name) continue;
			for (const key of grantKeys(grant)) {
				sources.set(key, sources.has(key) ? null : { slug: opt.slug, grant });
			}
		}
	}
	return sources;
}

/** Just the keys one possession may claim, as `key → grant`. See grantSourceMap. */
export function grantAdoptionKeys(slug, activeOptions = []) {
	const mine = new Map();
	for (const [key, source] of grantSourceMap(activeOptions)) {
		if (source?.slug === slug) mine.set(key, source.grant);
	}
	return mine;
}

/**
 * The grant a TAGGED item was made from, within its own possession `opt`, or null.
 *
 * Asked by `sourceKey` first, because that is what grantsToCreate stamped and what a renamed
 * grant keeps pointing at (the lanterns' `sourceKey` is their old name). Then by every name a
 * grant answers to, first the item's `sourceKey` and then its current name, for an item whose
 * grant has since been renamed without keeping the old spelling. A name two grants of the one
 * possession both answer to matches neither: guessing there would rewrite the wrong item.
 */
export function grantOfTaggedItem(item, opt) {
	const grants = (opt?.grantsItems ?? []).filter(g => g?.name);
	const key    = item?.system?.sourceKey ?? null;
	const one    = hits => (hits.length === 1 ? hits[0] : null);
	const byKey  = key ? one(grants.filter(g => (g.sourceKey ?? g.name) === key)) : null;
	if (byKey) return byKey;
	const answersTo = (g, name) => [g.name, g.sourceKey, ...(g.aliases ?? [])].includes(name);
	for (const name of [key, item?.name]) {
		if (!name) continue;
		const hit = one(grants.filter(g => answersTo(g, name)));
		if (hit) return hit;
	}
	return null;
}

// Armor shapes compared as data: `{}` and null both mean "no armor", and key order is noise.
function armorShape(armor) {
	if (!armor || typeof armor !== "object") return null;
	const entries = Object.entries(armor).filter(([, v]) => v != null).sort(([a], [b]) => a.localeCompare(b));
	return entries.length ? Object.fromEntries(entries) : null;
}

/**
 * What an item a possession granted has to change to match its grant AS AUTHORED NOW: the
 * embedded-item update (dotted `system.*` keys, no `_id`) plus the new track size, or null when
 * it already matches.
 *
 * Gear is materialized once (grantsToCreate) and never revisited, so a grant corrected after a
 * character took it stayed wrong on that character forever: the Tannery's cuirass was made as a
 * `{modifier: 1}` from 1.3.2 to 1.6.0 and still stacks on a hauberk in those worlds. Only what
 * the grant itself defines is compared, which is the gear's rules shape: `armor`, `weight` (a ◇
 * item's), `inventoryColumn` and the uses track's `max`. Never the name, the marks or the count
 * on the track, which are the player's; the caller clamps that count when `resourceMax` shrinks.
 *
 * Armor keys the grant no longer has are DELETED rather than overwritten, because `system.armor`
 * is an object field and an update merges into it: writing `{base: 1}` over `{modifier: 1}`
 * would leave a `{base: 1, modifier: 1}` that counts twice. Pure but for `deletionEntry`, which
 * picks the deletion spelling the running core applies.
 *
 * @returns {{update: object, resourceMax: number|null}|null}
 */
export function grantRepair(item, grant) {
	if (!item || !grant) return null;
	const sys    = item.system ?? {};
	const update = {};
	const column = grant.column === "regular" ? "regular" : "small";
	if (sys.inventoryColumn !== column) update["system.inventoryColumn"] = column;
	// Only a ◇ item's weight is the grant's; a small item carries whatever the model defaulted.
	if (column === "regular") {
		const weight = grant.weight ?? 1;
		if (Number(sys.weight) !== weight) update["system.weight"] = weight;
	}
	const want = armorShape(grant.armor);
	const have = armorShape(sys.armor);
	if (JSON.stringify(want) !== JSON.stringify(have)) {
		if (!want) update["system.armor"] = null;
		else if (!have) update["system.armor"] = { ...want };
		else {
			for (const [k, v] of Object.entries(want)) if (have[k] !== v) update[`system.armor.${k}`] = v;
			for (const k of Object.keys(sys.armor)) {
				if (!(k in want)) { const [path, value] = deletionEntry(`system.armor.${k}`); update[path] = value; }
			}
		}
	}
	// The track's SIZE only. An item with no track of its own reads the grant's already
	// (StonetopCharacter#_buildInventorySection's mapCustomItem), so there is nothing to correct.
	let resourceMax = null;
	const wantMax = Number(grant.resource?.max);
	if (sys.resource && typeof sys.resource === "object" && Number.isFinite(wantMax)
		&& Number(sys.resource.max) !== wantMax) {
		update["system.resource.max"] = wantMax;
		resourceMax = wantMax;
	}
	return Object.keys(update).length ? { update, resourceMax } : null;
}

// Build the embedded-item create payloads for a possession's grants, skipping any
// already present (matched by `sourceKey`) so re-selecting / re-running onboarding
// never duplicates. Pure — unit-tested without Foundry.
export function grantsToCreate(grantsItems = [], existingKeys = new Set(), { slug, sourceLabel } = {}) {
	return (grantsItems ?? [])
		.filter(g => g?.name && !existingKeys.has(g.sourceKey ?? g.name))
		.map(g => {
			const regular = g.column === "regular";
			const system = {
				moveType:         "inventory-custom",
				inventoryColumn:  regular ? "regular" : "small",
				sourcePossession: slug,
				sourceKey:        g.sourceKey ?? g.name,
				sourceLabel:      sourceLabel ?? null,
			};
			// Small items have no ◇ load, so they carry no weight (mirrors a write-in
			// small item); regular items take their authored weight, defaulting to 1 ◇.
			if (regular) system.weight = g.weight ?? 1;
			// Worn gear (the Tannery's boiled leather cuirass) carries an `armor`
			// shape ({base}/{modifier}) that counts toward armor when its ◇ is checked
			// — i.e. when the character is actually wearing it.
			if (g.armor) system.armor = g.armor;
			if (g.resource) system.resource = g.resource;
			return { name: g.name, type: "move", system };
		});
}
