// The Fight tab's own words: the short lines it computes, beside the book's (fight-rules.js).
//
// PURE. Every function takes the localizer as `format(key, data)` so it can be tested against the
// real language file without Foundry. The strings live under `stonetop.fight.*` in languages/en.json.
//
// OUR LINES SAY NUMBERS, THE BOOK SAYS RULES. A computed line names who and how much ("+1 damage on
// Crinwin (2 attackers)"); the rule that makes it so is quoted underneath in the book's words. A
// paraphrase of a rule is how a sheet ends up teaching the table something the book never said.

import { joinNames } from "../utils/strings.js";
import { HEROES, FOES, opponentsOf } from "./engagements.js";

const KEY = "stonetop.fight";

/**
 * A list of names for a sentence: "Bram", "Bram & Aeliana", "Bram, Aeliana & Cadi", and past `max`
 * names "Bram, Aeliana & 3 others", so a crowd does not turn one line into a paragraph.
 */
export function namesPhrase(names, format, { max = 3 } = {}) {
	const list = (Array.isArray(names) ? names : []).filter(Boolean);
	if (list.length <= max) return joinNames(list);
	const shown = list.slice(0, Math.max(1, max - 1));
	return format(`${KEY}.names.andOthers`, { names: shown.join(", "), count: list.length - shown.length });
}

/**
 * What a fighter's row says they are doing: "fighting Crinwin; shooting at the Wolf", or, for a foe,
 * "fought by Bram & Aeliana; shot at by Cadi". Empty when they are not engaged.
 *
 * @param {{melee: string[], shootingAt: string[], shotBy: string[]}} entry  engage().byFighter[id]
 * @param {"heroes"|"foes"} side
 * @param {(id: string) => string} nameOf
 */
export function fighterReadout(entry, side, nameOf, format) {
	if (!entry) return "";
	const names = ids => namesPhrase(ids.map(nameOf), format);
	const parts = [];
	if (entry.melee?.length) parts.push(format(`${KEY}.readout.${side === FOES ? "foughtBy" : "fighting"}`, { names: names(entry.melee) }));
	if (entry.shootingAt?.length) parts.push(format(`${KEY}.readout.shootingAt`, { names: names(entry.shootingAt) }));
	if (entry.shotBy?.length) parts.push(format(`${KEY}.readout.shotBy`, { names: names(entry.shotBy) }));
	return parts.join(format(`${KEY}.readout.joiner`, {}));
}

/**
 * The count badge on a fighter being ganged up on, or null: everyone attacking them, in contact (as many
 * as can reach) or shooting.
 *
 * @returns {{count: number, label: string}|null}
 */
export function gangedBadge(entry, side, format) {
	if (!entry?.ganged) return null;
	const count = entry.attackerBodies;
	return { count, label: format(`${KEY}.badge.${side === FOES ? "foughtBy" : "facing"}`, { count }) };
}

/**
 * The computed lines for one engagement: the damage bonus on each fighter being ganged up on
 * (p.414), a group of followers aiding itself (p.414), and the group-against-group numbers when both
 * sides bring a group (p.416).
 *
 * A crowd bigger than can reach one fighter says so ("8 of 12 can reach", engagements.js#reachAround),
 * so the table sees the number was held down and why.
 *
 * @param {object} cluster                       engage().clusters[i]
 * @param {object} byFighter                      engage().byFighter
 * @param {(id: string) => string} nameOf
 * @param {(key: string, data?: object) => string} format
 * @param {(id: string) => number} [bodiesOf]     how many bodies a fighter stands for
 * @returns {string[]}
 */
export function clusterFacts(cluster, byFighter, nameOf, format, bodiesOf = () => 1) {
	if (!cluster) return [];
	const facts = [];
	for (const [ids, key] of [[cluster.foeIds, "onFoe"], [cluster.heroIds, "onHero"]]) {
		for (const id of ids ?? []) {
			const entry = byFighter?.[id];
			if (!entry?.ganged) continue;
			const crowded = entry.attackerBodiesAll > entry.attackerBodies;
			facts.push(format(`${KEY}.fact.${key}${crowded ? "Crowd" : ""}`, {
				bonus: entry.pileOn, name: nameOf(id), count: entry.attackerBodies, all: entry.attackerBodiesAll,
			}));
		}
	}
	for (const id of cluster.heroIds ?? []) {
		const against = aidsItselfAgainst(byFighter?.[id], bodiesOf(id), bodiesOf);
		if (against) facts.push(format(`${KEY}.fact.aidsItself`, { name: nameOf(id), against: namesPhrase(against.map(nameOf), format) }));
	}
	const groups = cluster.groups;
	if (groups) {
		const data = { heroes: groups.heroGroupBodies, foes: groups.foeGroupBodies, bonus: groups.bonus };
		facts.push(groups.bonus > 0
			? format(`${KEY}.fact.groups`, { ...data, side: format(`${KEY}.fact.${groups.bigger === HEROES ? "sideHeroes" : "sideFoes"}`, {}) })
			: format(`${KEY}.fact.groupsEven`, data));
		// Each hero in contact with a foe group keeps one of its members out of the ratio (engagements.js#groupExchange).
		for (const { group, by } of groups.held ?? []) facts.push(format(`${KEY}.fact.holdsOne`, { name: nameOf(by), group: nameOf(group) }));
	}
	return facts;
}

/**
 * The foes a group on the heroes' side is fighting, when it "effectively Aid[s] themselves" (p.414): "If a
 * group of followers attacks a single foe (or a significantly smaller group)". Significantly smaller is
 * taken as half their number or fewer. Null when it does not.
 *
 * @param {object} entry     engage().byFighter[id] for the group
 * @param {number} bodies    the group's bodies
 * @param {(id: string) => number} bodiesOf
 * @returns {string[]|null}
 */
export function aidsItselfAgainst(entry, bodies, bodiesOf) {
	if (!entry || !(bodies > 1)) return null;
	const against = opponentsOf(entry);
	if (!against.length) return null;
	const theirs = against.reduce((total, id) => total + (Number(bodiesOf(id)) || 0), 0);
	return theirs === 1 || bodies >= 2 * theirs ? against : null;
}

/**
 * Which of the book's passages (fight-rules.js) speak to this engagement, in reading order.
 * Duplicates are fine: fightRuleQuotes keeps the first.
 */
export function clusterRuleKeys(cluster, byFighter, bodiesOf = () => 1) {
	if (!cluster) return [];
	const keys = [];
	if ((cluster.heroIds ?? []).some(id => aidsItselfAgainst(byFighter?.[id], bodiesOf(id), bodiesOf))) keys.push("oneRollsOthersAid");
	if ((cluster.foeIds ?? []).some(id => byFighter?.[id]?.ganged)) keys.push("oneRollsOthersAid", "pileOnDamage");
	if ((cluster.heroIds ?? []).some(id => byFighter?.[id]?.ganged)) keys.push("engagesMultiple", "pileOnDamage", "hurtMultiple");
	const groups = cluster.groups;
	if (groups) {
		keys.push("groupAsOne");
		if (groups.bonus > 0) keys.push("groupOutnumbers");
		keys.push("groupCasualties");
		if (groups.individuals) keys.push("engagedByPcs");
		keys.push("routed");
	}
	return keys;
}
