// What the Fight tab shows, built from a fight snapshot (fight-state.js#snapshotFight).
//
// PURE apart from the helpers handed in, so the whole tab can be rendered in a test from plain data.
//
// ONE CARD PER ENGAGEMENT (Book I p.414's "smaller engagements"), heroes on the left and foes on the
// right, then the fighters nobody is engaged with, the ones out of the fight, and the ones whose token
// is on another map. Each card carries our own short computed lines (fight-copy.js) and, folded away
// under "What the book says", the passages that apply, in the book's words with a page to open.
//
// EACH ROW'S LINE IS ITS HP AND ARMOR (fight-vitals.js). Who it is fighting is already its place on the
// card; the words for it ("fought by Bram & Aeliana") are the name's tooltip.
//
// EACH HERO'S FOES SIT INDENTED UNDER THEM. A foe fought by several heroes is listed once, under the
// first of them, and its own line names the rest. A fighter's row can be dragged onto anyone on the
// other side to send them at each other (send-against.js), either way about: a foe onto a hero to
// bring it at them, a hero onto a foe to close with it. A row is a reader's to pick up when the token
// is theirs to move, so a GM may send anyone and a player only their own; a row takes a drop when the
// reader has someone to send from the other side (`draggable`, `dropTarget`), and `side` is what keeps
// a drag from landing on the side it came from.
//
// THE TAB CARRIES EVERYTHING THE MAP OVERLAY DRAWS. A reader using a screen magnifier, or one who has
// switched the lines off, gets every engagement and every count here as text.

import { fighterReadout, gangedBadge, clusterFacts, clusterRuleKeys } from "./fight-copy.js";
import { fightRuleQuotes } from "./fight-rules.js";
import { HEROES, FOES } from "./engagements.js";
import { otherSide } from "./fight-sides.js";
import { vitalsLine } from "./fight-vitals.js";

/**
 * @param {object} p
 * @param {ReturnType<import("./fight-state.js").snapshotFight>} p.snapshot
 * @param {Map<string, {name: string, img: string, hidden?: boolean, defeated?: boolean,
 *   canPing?: boolean, onCanvas?: boolean, group?: boolean, standing?: number|null, size?: number|null,
 *   vitals?: {hp: number|null, hpMax: number|null, armor: number|null}, seesFoeVitals?: boolean,
 *   side?: "heroes"|"foes"|null}>} p.rows
 *   what each combatant's row shows, keyed by combatant id (fighters and `elsewhere` alike); `side` is
 *   the combatant's own, for a row the snapshot has no fighter for (a token on another map)
 * @param {boolean} p.isGM
 * @param {(key: string, data?: object) => string} p.format
 * @param {(entry: {page: number, book: number}) => Array} p.cites  gm-toolkit/book-ref.js#bookPageCites
 * @param {Set<string>} [p.openRules]  which "What the book says" folds this reader left open
 */
export function fightTrackerView({ snapshot, rows, isGM = false, format, cites, openRules = new Set() }) {
	if (!snapshot) return null;
	const { result, fighters, elsewhere = [] } = snapshot;
	const sideOf = new Map(fighters.map(f => [f.id, f.side]));
	const nameOf = id => rows.get(id)?.name ?? fighters.find(f => f.id === id)?.name ?? "";
	const isOut = new Set([...result.out.heroes, ...result.out.foes]);
	const bodiesOf = id => fighters.find(f => f.id === id)?.bodies ?? 0;
	const quotes = keys => ruleQuotesView(keys, { isGM, cites });

	// Who may be sent at whom. A fighter is in play while their token is on this map and they are still
	// in the fight; of those, a reader may pick up whoever is theirs to move (`canSend`, a GM anyone),
	// and may drop onto anyone in play whose side they have someone to send from, which is `dragFrom`.
	const inPlay = id => {
		const info = rows.get(id) ?? {};
		return !!info.onCanvas && !isOut.has(id);
	};
	const canPickUp = id => inPlay(id) && (isGM || !!rows.get(id)?.canSend);
	const dragFrom = new Set(fighters.filter(f => f.side && f.visible !== false && canPickUp(f.id)).map(f => f.side));
	// Whether one side has anybody on the map to be closed with, which is what a drag hint needs to
	// know about the OTHER side; asked of the fighters themselves, so no roster has to be built up.
	const sideInPlay = side => fighters.some(f => f.side === side && f.visible !== false && inPlay(f.id));

	const row = id => {
		const info = rows.get(id) ?? {};
		const side = sideOf.get(id) ?? null;
		const entry = result.byFighter[id];
		const badge = side ? gangedBadge(entry, side, format) : null;
		return {
			id,
			side,
			name: info.name ?? "",
			img: info.img ?? "",
			readout: side ? fighterReadout(entry, side, nameOf, format) : "",
			// A foe's HP only to whoever may read its sheet. A row with no side known is treated as a foe,
			// so a monster on another map does not show its HP for want of one.
			vitals: isGM || info.seesFoeVitals || (side ?? info.side ?? null) === HEROES ? vitalsLine(info.vitals, format) : "",
			badge,
			// A character's gear tags and typed reminders (actors/character/gear-reminders.js).
			reminders: info.reminders ?? [],
			standing: info.group && info.size
				? (info.standing == null
					? format("stonetop.fight.readout.together", { count: info.size })
					: format("stonetop.fight.readout.standing", { standing: info.standing, size: info.size }))
				: "",
			hidden: !!info.hidden,
			defeated: !!info.defeated,
			canPing: !!info.canPing,
			draggable: !!side && canPickUp(id),
			dropTarget: !!side && inPlay(id) && dragFrom.has(otherSide(side)),
			css: [info.hidden ? "hide" : "", info.defeated ? "defeated" : "", badge ? "is-ganged" : ""].filter(Boolean).join(" "),
		};
	};

	const clusters = result.clusters.map(cluster => {
		const ruleKey = `cluster:${[...cluster.heroIds, ...cluster.foeIds].sort().join(",")}`;
		const clusterQuotes = quotes(clusterRuleKeys(cluster, result.byFighter, bodiesOf));
		const heroes = cluster.heroIds.map(row);
		const foes = cluster.foeIds.map(row);
		return {
			id: cluster.id,
			heroes,
			foes,
			pairs: pairUp(heroes, foes, result.byFighter, name => format("stonetop.fight.aria.against", { name })),
			facts: clusterFacts(cluster, result.byFighter, nameOf, format, bodiesOf),
			quotes: clusterQuotes,
			ruleKey,
			rulesOpen: openRules.has(ruleKey),
		};
	});

	const unengagedHeroes = result.unengaged.heroes.map(row);
	const unengagedFoes = result.unengaged.foes.map(row);
	const unengagedQuotes = unengagedFoes.length ? quotes(["unengagedFoes"]) : [];
	const out = [...result.out.heroes, ...result.out.foes].map(row);
	const away = elsewhere.map(combatant => ({ ...row(combatant.id), readout: "" }));

	return {
		isGM,
		// Each hint sits over whichever loose fighters could be sent somewhere, and names that direction.
		dragHints: {
			foes: unengagedFoes.some(r => r.draggable) && sideInPlay(HEROES),
			heroes: unengagedHeroes.some(r => r.draggable) && sideInPlay(FOES),
		},
		hasAnyone: fighters.some(f => f.visible !== false) || away.length > 0,
		clusters,
		unengaged: {
			heroes: unengagedHeroes,
			foes: unengagedFoes,
			quotes: unengagedQuotes,
			ruleKey: "unengaged",
			rulesOpen: openRules.has("unengaged"),
		},
		out,
		elsewhere: away,
	};
}

/** Book passages as the tab prints them: the words, and each one's citation. */
function ruleQuotesView(keys, { isGM, cites }) {
	return fightRuleQuotes(keys, { isGM }).map(q => ({ key: q.key, text: q.text, cites: cites(q) }));
}

/**
 * One engagement's rows as each hero with the foes under them. A foe goes under the first hero in
 * contact with it, else the first shooting at it, else the first it is shooting at.
 *
 * ALL THREE LINKS, because an engagement is built from all three. A foe whose only tie to this
 * cluster is the shot IT fired — an archer picking off the Fox across the field, nobody in reach of
 * it and nobody shooting back — has neither `melee` nor `shotBy`, so it fell through to the first
 * hero in the list and the tab filed it under a character it had nothing to do with.
 */
function pairUp(heroes, foes, byFighter, againstLabel) {
	const pairs = heroes.map(hero => ({ hero, foes: [], label: againstLabel(hero.name) }));
	const byHero = new Map(pairs.map(pair => [pair.hero.id, pair]));
	for (const foe of foes) {
		const entry = byFighter[foe.id] ?? {};
		const heroId = [...(entry.melee ?? []), ...(entry.shotBy ?? []), ...(entry.shootingAt ?? [])].find(id => byHero.has(id));
		(byHero.get(heroId) ?? pairs[0])?.foes.push(foe);
	}
	return pairs;
}
