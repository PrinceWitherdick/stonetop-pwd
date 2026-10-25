// Who is fighting whom, worked out from where the tokens stand.
//
// Book I p.414: "When the PCs face multiple foes (and they often will), break up the action into
// multiple smaller engagements... This isn't anything formal." So nothing here is a record anybody
// keeps. A player shows who they are fighting by moving their token up against it, or by targeting
// it from range, and every client works the same answer out of the same token positions: nobody
// writes anything when a token moves, and nothing can fall out of step with the map.
//
// PURE. Fighters arrive as plain data (fight-state.js builds them from documents), which is what
// lets this be tested without a canvas and lets the Fight tab, the map overlay and the damage
// pre-fill all ask one function the same question.
//
// WHAT COUNTS:
//  • Two fighters on OPPOSITE sides whose tokens touch (diagonals included) are in melee.
//  • A ranged link is a shot: a player's target (their fighter shooting at a fighter on the other
//    side), or a shot on record from the last damage a fighter rolled at range (fight-shots.js).
//    Melee wins when both hold, since standing in contact is the stronger claim, and a shot on
//    record lapses while its shooter is in melee with anybody: they are fighting hand to hand now.
//  • EVERYONE HITTING A FIGHTER IS ATTACKING IT, near or far, whichever side it is on: an archer
//    shooting a character is one more on them, as a character's arrow is one more on a foe.
//  • NO MORE CAN CLOSE WITH ONE FIGHTER THAN FIT ROUND IT. A horde token of twelve touching a lone
//    hero counts only as many as there are squares around the hero (8 round a man-sized token).
//    "Holding a chokepoint reduces the number of foes they have to fight at once" (p.414) is still
//    the table's to say: the seed that carries the count is theirs to leave off.
//  • A fighter who is out (defeated, 0 HP, a routed group) or has no bodies left is not a "capable
//    attacker" (p.414) and is never linked or counted.
//  • A fighter this client may not see is not there at all, so a hidden foe never changes what a
//    player's screen says.
//  • BODIES, not tokens: a horde token fighting as a group stands for the members still standing,
//    and a crew token for its headcount (fight-sides.js#bodiesFor). Two crinwin on one token count
//    as two attackers, exactly as two tokens would.

import { pileOnBonus, outnumberBonus } from "../data/follower-build.js";

export const HEROES = "heroes";
export const FOES = "foes";

/** Everyone a fighter is fighting, once each: in contact, then shooting at. `entry` is engage().byFighter[id]. */
export const opponentsOf = entry => [...new Set([...(entry?.melee ?? []), ...(entry?.shootingAt ?? [])])];

/**
 * @typedef {object} Fighter
 * @property {string} id                     the combatant's id
 * @property {"heroes"|"foes"} side
 * @property {{x: number, y: number, w: number, h: number}} rect  the token's footprint in scene
 *   pixels, top-left and size, from its SAVED position (never the animating one)
 * @property {string|null} [level]           the scene level the token stands on, if any
 * @property {number} bodies                 capable bodies this token stands for
 * @property {boolean} [out]                 defeated, at 0 HP, or routed
 * @property {boolean} [visible]             false = this client must not count it
 * @property {string} [name]
 */

/**
 * Do two tokens touch?
 *
 * SQUARE GRIDS measure the empty space between the two footprints along each axis. Tokens side by
 * side, or corner to corner, leave no gap; one square between them leaves a whole square. Under half
 * a square on both axes is touching, which also forgives a token a hair off its grid lines and works
 * for any token size.
 *
 * GRIDLESS scenes use the same test, inclusive, since nothing snaps there.
 *
 * HEX GRIDS are approximate: neighbouring hexes sit about one grid size apart, centre to centre, and
 * the next ring out about 1.73 sizes, so "touching" is centres within the two tokens' average extents
 * plus a quarter of a hex.
 *
 * @param {Fighter} a
 * @param {Fighter} b
 * @param {{size?: number, kind?: "square"|"hex"|"gridless"}} [grid]
 */
export function touching(a, b, grid = {}) {
	const A = a?.rect;
	const B = b?.rect;
	if (!A || !B) return false;
	if ((a.level ?? null) !== (b.level ?? null)) return false;
	const size = Number(grid.size) > 0 ? Number(grid.size) : 100;

	if (grid.kind === "hex") {
		const dx = (A.x + A.w / 2) - (B.x + B.w / 2);
		const dy = (A.y + A.h / 2) - (B.y + B.h / 2);
		const reach = ((A.w + A.h) / 2 + (B.w + B.h) / 2) / 2 + size / 4;
		return Math.hypot(dx, dy) <= reach;
	}

	const gapX = Math.max(A.x - (B.x + B.w), B.x - (A.x + A.w));
	const gapY = Math.max(A.y - (B.y + B.h), B.y - (A.y + A.h));
	const tolerance = size / 2;
	return grid.kind === "gridless"
		? gapX <= tolerance && gapY <= tolerance
		: gapX < tolerance && gapY < tolerance;
}

/** A small union-find over ids, for grouping linked fighters into engagements. */
export function unionFind(ids) {
	const parent = new Map(ids.map(id => [id, id]));
	const find = id => {
		let root = id;
		while (parent.get(root) !== root) root = parent.get(root);
		let node = id;
		while (parent.get(node) !== root) { const next = parent.get(node); parent.set(node, root); node = next; }
		return root;
	};
	return { find, union: (a, b) => { const ra = find(a); const rb = find(b); if (ra !== rb) parent.set(rb, ra); } };
}

const bodiesOf = fighter => Math.max(0, Math.trunc(Number(fighter?.bodies) || 0));
const sum = (ids, byId) => ids.reduce((total, id) => total + bodiesOf(byId.get(id)), 0);

/**
 * Every engagement on the map.
 *
 * @param {object} p
 * @param {Fighter[]} p.fighters  in the order the fight lists them (clusters keep that order)
 * @param {{size?: number, kind?: string}} [p.grid]
 * @param {Array<{from: string, to: string, recorded?: boolean}>} [p.ranged]  a fighter shooting at
 *   another; `recorded` for a shot on record rather than a live target
 * @returns {{
 *   links: Array<{hero: string, foe: string, kind: "melee"|"ranged", from?: string}>,
 *   clusters: Array<{id: string, heroIds: string[], foeIds: string[],
 *     groups: null|{heroGroupBodies: number, foeGroupBodies: number,
 *     bigger: "heroes"|"foes"|null, bonus: number, individuals: boolean}}>,
 *   byFighter: Object<string, {melee: string[], shootingAt: string[], shotBy: string[],
 *     attackers: string[], attackerBodies: number, attackerBodiesAll: number, reach: number,
 *     ganged: boolean, pileOn: number}>,
 *   unengaged: {heroes: string[], foes: string[]},
 *   out: {heroes: string[], foes: string[]},
 *   signature: string,
 * }}
 */
export function engage({ fighters = [], grid = {}, ranged = [] } = {}) {
	const seen = new Set();
	const present = [];
	for (const fighter of Array.isArray(fighters) ? fighters : []) {
		if (!fighter || typeof fighter.id !== "string" || seen.has(fighter.id)) continue;
		if (fighter.side !== HEROES && fighter.side !== FOES) continue;
		if (fighter.visible === false) continue;
		seen.add(fighter.id);
		present.push(fighter);
	}
	const byId = new Map(present.map(f => [f.id, f]));
	const order = new Map(present.map((f, i) => [f.id, i]));
	const capable = present.filter(f => !f.out && bodiesOf(f) > 0);
	const heroes = capable.filter(f => f.side === HEROES);
	const foes = capable.filter(f => f.side === FOES);

	// Melee: every hero against every foe. A few dozen tokens is a few hundred rectangle tests.
	const links = [];
	const pairKey = (hero, foe) => `${hero}\0${foe}`;
	const meleePairs = new Set();
	for (const hero of heroes) {
		for (const foe of foes) {
			if (!touching(hero, foe, grid)) continue;
			meleePairs.add(pairKey(hero.id, foe.id));
			links.push({ hero: hero.id, foe: foe.id, kind: "melee" });
		}
	}

	// Ranged: a shot between two capable fighters on opposite sides that are not already in contact. A
	// shot on record lapses while its shooter is in melee with anyone.
	const inMelee = new Set(links.flatMap(link => [link.hero, link.foe]));
	const rangedPairs = new Set();
	for (const shot of Array.isArray(ranged) ? ranged : []) {
		const from = byId.get(shot?.from);
		const to = byId.get(shot?.to);
		if (!from || !to || from.side === to.side) continue;
		if (shot.recorded && inMelee.has(from.id)) continue;
		if (from.out || to.out || !bodiesOf(from) || !bodiesOf(to)) continue;
		const hero = from.side === HEROES ? from.id : to.id;
		const foe = from.side === FOES ? from.id : to.id;
		const key = pairKey(hero, foe);
		if (meleePairs.has(key) || rangedPairs.has(`${key}\0${from.id}`)) continue;
		rangedPairs.add(`${key}\0${from.id}`);
		links.push({ hero, foe, kind: "ranged", from: from.id });
	}

	// Per fighter.
	const byFighter = {};
	for (const fighter of present) {
		byFighter[fighter.id] = {
			melee: [], shootingAt: [], shotBy: [],
			attackers: [], attackerBodies: 0, attackerBodiesAll: 0, reach: 0, ganged: false, pileOn: 0,
		};
	}
	for (const link of links) {
		if (link.kind === "melee") {
			byFighter[link.hero].melee.push(link.foe);
			byFighter[link.foe].melee.push(link.hero);
		} else {
			const to = link.from === link.hero ? link.foe : link.hero;
			if (!byFighter[link.from].shootingAt.includes(to)) byFighter[link.from].shootingAt.push(to);
			if (!byFighter[to].shotBy.includes(link.from)) byFighter[to].shotBy.push(link.from);
		}
	}
	for (const fighter of present) {
		const entry = byFighter[fighter.id];
		for (const list of [entry.melee, entry.shootingAt, entry.shotBy]) list.sort((a, b) => order.get(a) - order.get(b));
		// Everyone fighting a fighter is attacking it, near or far, on either side. Those in contact count
		// only as many bodies as fit round it; those shooting count in full.
		entry.attackers = [...new Set([...entry.melee, ...entry.shotBy])].sort((a, b) => order.get(a) - order.get(b));
		entry.reach = reachAround(fighter, grid);
		const meleeBodies = sum(entry.melee, byId);
		const shootingBodies = sum(entry.shotBy, byId);
		entry.attackerBodiesAll = meleeBodies + shootingBodies;
		entry.attackerBodies = Math.min(meleeBodies, entry.reach) + shootingBodies;
		//
		// ONLY A SINGLE FIGHTER CAN BE GANGED UP ON. p.414's "+1 extra damage for each capable
		// attacker after the first" is for damage dealt "to a single foe"; a token standing for a
		// crew or a horde is several foes, and fighting it is the group rules' business (p.416), not
		// a pile-on worth +5 against six people at once.
		entry.ganged = bodiesOf(fighter) === 1 && entry.attackerBodies >= 2;
		entry.pileOn = entry.ganged ? pileOnBonus(entry.attackerBodies).bonus : 0;
	}

	// Engagements: fighters joined by any chain of links.
	const linked = present.filter(f => links.some(l => l.hero === f.id || l.foe === f.id));
	const uf = unionFind(linked.map(f => f.id));
	for (const link of links) uf.union(link.hero, link.foe);
	const groupsByRoot = new Map();
	for (const fighter of linked) {
		const root = uf.find(fighter.id);
		if (!groupsByRoot.has(root)) groupsByRoot.set(root, []);
		groupsByRoot.get(root).push(fighter);
	}
	const clusters = [...groupsByRoot.values()]
		.map(members => members.sort((a, b) => order.get(a.id) - order.get(b.id)))
		.sort((a, b) => order.get(a[0].id) - order.get(b[0].id))
		.map(members => {
			const id = members[0].id;
			const heroIds = members.filter(f => f.side === HEROES).map(f => f.id);
			const foeIds = members.filter(f => f.side === FOES).map(f => f.id);
			return {
				id, heroIds, foeIds,
				groups: groupExchange(heroIds, foeIds, byId, byFighter),
			};
		});

	const isLinked = new Set(linked.map(f => f.id));
	const unengaged = {
		heroes: heroes.filter(f => !isLinked.has(f.id)).map(f => f.id),
		foes: foes.filter(f => !isLinked.has(f.id)).map(f => f.id),
	};
	const outIds = present.filter(f => f.out || bodiesOf(f) <= 0);
	const out = {
		heroes: outIds.filter(f => f.side === HEROES).map(f => f.id),
		foes: outIds.filter(f => f.side === FOES).map(f => f.id),
	};

	// Everything the tab and the overlay draw from, with every list sorted, so the same map gives the
	// same string however the fighters arrived and a redraw is skipped when nothing changed.
	const sorted = ids => [...ids].sort().join(",");
	const signature = JSON.stringify({
		links: links.map(l => [l.hero, l.foe, l.kind, l.from ?? ""].join("|")).sort(),
		clusters: clusters.map(c => JSON.stringify([sorted(c.heroIds), sorted(c.foeIds), c.groups])).sort(),
		bodies: present.map(f => `${f.id}:${bodiesOf(f)}:${f.out ? 1 : 0}`).sort(),
		unengaged: [sorted(unengaged.heroes), sorted(unengaged.foes)],
		out: [sorted(out.heroes), sorted(out.foes)],
	});

	return { links, clusters, byFighter, unengaged, out, signature };
}

/**
 * How many attackers can stand in contact with a fighter: the squares round its footprint, eight round
 * a one-square token and twelve round a two-square one. Hex and gridless maps count the same squares:
 * it is a ceiling on a crowd, not a measurement.
 */
export function reachAround(fighter, grid = {}) {
	const size = Number(grid.size) > 0 ? Number(grid.size) : 100;
	const w = Math.max(1, Math.round((Number(fighter?.rect?.w) || size) / size));
	const h = Math.max(1, Math.round((Number(fighter?.rect?.h) || size) / size));
	return 2 * (w + h) + 4;
}

/**
 * The optional group-against-group abstraction (p.416), offered when BOTH sides of an engagement
 * bring a group: a token standing for more than one body.
 *
 * ONLY THE GROUPS ARE COUNTED. "Foes that are engaged by individual PCs aren't really part of a
 * group," so a PC in the same scrum adds nothing to the ratio; `individuals` says one is there, so
 * the tab can quote that sentence where it applies.
 *
 * AND EACH HERO IN CONTACT WITH A FOE GROUP HOLDS ONE OF ITS MEMBERS OUT OF IT (the user's ruling on
 * p.416: "the Marshal's crew of six would be left contending with only eight crinwin (20 to start, less 7
 * dead from Letting Fly, less 5 occupied by PCs)"). How many a PC really keeps busy is the fiction's; one
 * apiece is the tab's reading, said on the fact line (`held`) so the table can see where it went. A hero
 * is an individual here when their token stands for one body: a token the GM gave a headcount is a group
 * of its own, and joins the ratio as one rather than holding anybody out of it.
 *
 * @returns {null|{heroGroupBodies: number, foeGroupBodies: number, bigger: "heroes"|"foes"|null,
 *   bonus: number, individuals: boolean, held: Array<{group: string, by: string}>}}
 *   `held` is each hero holding one member of a foe group out of the exchange
 */
function groupExchange(heroIds, foeIds, byId, byFighter = {}) {
	const groupIds = ids => ids.filter(id => bodiesOf(byId.get(id)) > 1);
	const heroGroups = groupIds(heroIds);
	const foeGroups = groupIds(foeIds);
	if (!heroGroups.length || !foeGroups.length) return null;
	const held = [];
	// One apiece: a hero in contact with two foe groups holds one body, out of the first of them it reaches.
	const busy = new Set();
	for (const group of foeGroups) {
		const holders = (byFighter[group]?.melee ?? []).filter(id => !busy.has(id) && byId.get(id)?.side === HEROES && bodiesOf(byId.get(id)) === 1);
		for (const by of holders.slice(0, bodiesOf(byId.get(group)))) {
			busy.add(by);
			held.push({ group, by });
		}
	}
	const heroGroupBodies = sum(heroGroups, byId);
	const foeGroupBodies = sum(foeGroups, byId) - held.length;
	// Every member of the foes' groups held by somebody: nobody is left to trade blows group to group.
	if (foeGroupBodies <= 0) return null;
	const heroesAhead = outnumberBonus(heroGroupBodies, foeGroupBodies).bonus;
	const foesAhead = outnumberBonus(foeGroupBodies, heroGroupBodies).bonus;
	const bigger = heroesAhead > 0 ? HEROES : foesAhead > 0 ? FOES : null;
	return {
		heroGroupBodies,
		foeGroupBodies,
		bigger,
		bonus: Math.max(heroesAhead, foesAhead),
		individuals: heroGroups.length < heroIds.length || foeGroups.length < foeIds.length,
		held,
	};
}
