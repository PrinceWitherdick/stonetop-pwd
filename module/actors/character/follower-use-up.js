// "Use up their resources" on a follower: the GM move (Book I p.182) as a button on the follower's own card.
//
// "Something happens that whittles away at their stuff, or that takes it away from them entirely. 'Resources'
// here can be... concrete and specific (their shield, their torch, their lamp oil); ... concrete but abstract
// (supplies, ammo); ... intangible (their reputation, someone's trust); and/or ... entirely mechanical
// abstractions (HP, Fortunes, Loyalty, etc.)." And for followers in particular: "If he held any Loyalty, he's
// got 1 less now." (p.182). Supplies "get used when ... you use up their resources, and supplies are what you
// use up" (p.304).
//
// So one button, and a short list of what THIS follower has to lose: 1 Loyalty, uses of the crew's Supplies,
// a step down the ammo track, or a piece of carried gear. HP is not offered: damage has its own row on the
// card. The GM makes the move; whoever presses the button (the GM, or the player applying what the GM said)
// writes it to the leader's sheet under the move's name, and the table gets a card saying what was lost and,
// if typed, how it shows ("bring that back to the fiction and show how it manifests", p.182).
//
// Read off the follower's FINISHED card (StonetopCharacterSheet#_followerCards), the same rows the Followers
// tab draws, so the list cannot offer what the card does not show.

import { fillFollowerSlug, followerDetailBase, followerDetailFlags, FOLLOWER_FLAGS } from "./follower-roster.js";
import { stripHtmlToText } from "../../utils/strings.js";
import { clampInt } from "../../utils/custom-move-data.js";
import { crewSuppliesHeld, crewSuppliesLeaving } from "./supply-cost.js";

export const USE_UP_RESOURCES = "Use up their resources";

/**
 * The crew's Supplies as their card draws them: one set per member of the roster (`size`), each of
 * `perSet` pips (4+Prosperity), and the uses each drawn set shows. Make Camp and the days on the road
 * read the same flag through supply-cost.js#crewSuppliesHeld with the same two numbers, so all three
 * count and spend it one way.
 */
function crewSupplyShape(card) {
	const sets = Array.isArray(card?.supplySets) ? card.supplySets : [];
	return {
		size:   sets.length,
		perSet: sets[0]?.pips?.length ?? 0,
		drawn:  sets.map(set => (set?.pips ?? []).filter(p => p?.filled).length),
	};
}

/**
 * What this follower has to lose, off their finished card. PURE. Each choice is `{key, label}`; `supplies`
 * carries `left`, and `gear` carries `items: [{ref, label}]`, where `ref` is `detail:<index>` for the
 * follower's own gear list or `crew:<slug>` for a row of the crew's inventory.
 */
export function useUpChoices(card) {
	if (!card?.ftype) return [];
	const choices = [];
	const loyalty = Math.max(0, Number(card.loyaltyValue) || 0);
	if (Array.isArray(card.loyalty) && loyalty > 0) choices.push({ key: "loyalty", label: `1 Loyalty (${loyalty} held)` });
	if (card.ftype === "crew") {
		const { size, perSet, drawn } = crewSupplyShape(card);
		const left = crewSuppliesHeld(drawn, size, perSet);
		if (left > 0) choices.push({ key: "supplies", left, label: `Uses of Supplies (${left} left)` });
	}
	const ammo = Math.max(0, Math.min(2, Number(card.ammoValue) || 0));
	if (card.usesAmmo && ammo < 2) choices.push({ key: "ammo", label: ammo === 0 ? "Ammo: they're running low" : "Ammo: they're all out" });
	// A card label as plain text: the crew's printed kit carries markup (applyPiercing).
	const items = [];
	if (card.ftype === "crew") {
		for (const row of card.gear ?? []) if (row?.checked && row.slug) items.push({ ref: `crew:${row.slug}`, label: stripHtmlToText(row.label) });
		for (const row of card.produced ?? []) if (row?.checked) items.push({ ref: `detail:${row.index}`, label: stripHtmlToText(row.label) });
	} else {
		for (const row of card.gear ?? []) if (row?.checked) items.push({ ref: `detail:${row.index}`, label: stripHtmlToText(row.label) });
	}
	const named = items.filter(i => i.label);
	if (named.length) choices.push({ key: "gear", items: named, label: "A piece of their gear" });
	return choices;
}

/**
 * The flag update for one choice other than Loyalty (which moves through follower-bond.js), and `what`, the
 * words for what was lost ("2 uses of Supplies lost (5 left)"). PURE. Null when there is nothing to take.
 *
 * @param {object} card     the follower's finished card
 * @param {object} flags    the leader's `stonetop-pwd` flags
 * @param {{key: string, count?: number, ref?: string}} pick
 * @param {string} scope    the flag scope (SYSTEM_ID)
 */
export function useUpUpdate(card, flags, pick, scope) {
	const get = path => foundry.utils.getProperty(flags ?? {}, path);
	if (pick?.key === "supplies") {
		// The one spend rule for `crew.supplies` (supply-cost.js#crewSuppliesLeaving): what is held is the
		// roster's sets, capped at a ◇ now, and the uses come out of the last member's set first.
		const { size, perSet } = crewSupplyShape(card);
		const stored = get("crew.supplies");
		const held = crewSuppliesHeld(stored, size, perSet);
		const spent = Math.min(held, clampInt(pick.count, 0, Infinity));
		if (!spent) return null;
		return {
			update: { [`flags.${scope}.crew.supplies`]: crewSuppliesLeaving(stored, size, perSet, held - spent) },
			what:   `${spent} use${spent === 1 ? "" : "s"} of Supplies lost (${held - spent} left)`,
		};
	}
	if (pick?.key === "ammo") {
		const path = fillFollowerSlug(FOLLOWER_FLAGS[card.ftype]?.ammo, card.slug ?? "");
		const from = Math.max(0, Math.min(2, Number(get(path ?? "")) || 0));
		if (!path || from >= 2) return null;
		return { update: { [`flags.${scope}.${path}`]: from + 1 }, what: from === 0 ? "low on ammo" : "all out of ammo" };
	}
	if (pick?.key === "gear") {
		const [kind, id] = String(pick.ref ?? "").split(":");
		const label = useUpChoices(card).find(c => c.key === "gear")?.items.find(i => i.ref === pick.ref)?.label ?? "";
		if (kind === "crew" && id) {
			return { update: { [`flags.${scope}.crew.gear.${id}`]: 0 }, what: `${label || "an item"} lost` };
		}
		if (kind === "detail") {
			const base = followerDetailBase(card.ftype, card.slug ?? "");
			const list = followerDetailFlags(flags, card.ftype, card.slug ?? "").gear;
			const i = Number(id);
			if (!Array.isArray(list) || !list[i]) return null;
			// Unticked, not struck off: it stays on the list to be re-Outfitted, as a dropped tick always has.
			const next = list.map((g, j) => (j === i ? { ...g, checked: false } : g));
			return { update: { [`flags.${scope}.${base}.gear`]: next }, what: `${label || "an item"} lost` };
		}
	}
	return null;
}
