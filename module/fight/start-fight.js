// Starting a fight, adding to one, and lining everyone up. GM only.
//
// THE START WINDOW OPENS ALREADY ANSWERED, as far as it can be. A GM who selected the tokens that are
// fighting has said who is in it; one who selected nothing most often means "the party and the monsters
// on this map". So the window opens with those ticked, lists everyone else on the map beside them, and
// lets a search reach whoever is not on the map yet: a character elsewhere, a person from the village,
// a monster from the bestiary. Those are put on the map as they join, heroes to the left of the middle
// of the view and foes to the right.
//
// A FOLLOWER IS LISTED UNDER THEIR CHARACTER, indented, with a tick of their own: wherever the character
// is listed (on this map, or not), and on no other list. A character who cannot be ticked (already in
// the fight) still heads their followers, as a row with no tick. Starting a fight with nothing
// selected ticks the followers on the map of every character it ticks.
//
// A BYSTANDER IS NEVER TICKED FOR BEING ON THE MAP. An NPC who is neither a follower nor marked friendly
// is listed under "Others", unticked; ticked, they join as a foe, and the tab moves them across.
//
// A MONSTER THAT COMES IN NUMBERS IS ASKED ABOUT. Once the GM has said who is fighting, each group or
// horde monster among them is asked "how many?" and at which scale (group-size.js): that many tokens
// join, new ones beside a token already on the map or all of them among the arrivals, or one token
// fighting as a group of that many (group-scale.js).
//
// LINING UP moves every token in the fight in one write, straight to its place (core's "displace"
// movement: through walls, no animation along the way).

import { SYSTEM_ID, BESTIARY_PACK } from "../system-id.js";
import { ensurePackIndex } from "../utils/pack-index.js";
import { format, localize } from "../utils/i18n.js";
import { joinNames } from "../utils/strings.js";
import { personNote } from "../utils/people-groups.js";
import { creatureTypeLabel } from "../bestiary/creature-types.js";
import { MONSTER_ORGANIZATIONS } from "../bestiary/bestiary-sections.js";
import { getPlayerCharacters } from "../utils/playbook-actors.js";
import { placeActors } from "../utils/token-drop.js";
import { displaceTokens } from "../utils/foundry-compat.js";
import { worldActorsBySource, resolveDeployableActor } from "../utils/deployable-actor.js";
import { compendiumRefTail } from "../migration/compat.js";
import { HEROES, FOES } from "./engagements.js";
import { classifySide } from "./fight-sides.js";
import { followerMasterIndex } from "../actors/character/follower-masters.js";
import { combatantBodies, combatantSide, controlledTokenIds, fightOnScene, gridOf, isFight, sideInfoFor, sceneRectOf, tokenLevel, SIDE_FLAG } from "./fight-state.js";
import { fightWindowComing, fightWindowWillShow } from "./fight-window.js";
import { askGroupSize, groupSizeQuestions } from "./group-size.js";
import { gatherAround, makeGroupToken, settleNewcomers } from "./group-scale.js";
import { lineUpPositions } from "./line-up.js";
import { StartFightDialog } from "./StartFightDialog.js";

const KEY = "stonetop.fight.startWindow";
const TOKEN = "token:";
const ACTOR = "actor:";

/** A row's line under the name: the parts it has, in one breath. */
const hintOf = (...parts) => parts.filter(Boolean).join(" · ");

/**
 * What a monster is, as the bestiary browser's badges say it: its creature type, how many of them
 * come (which is also what the window asks about next), and its HP. Enough to tell the Rat from the
 * Rat Swarm without opening either.
 */
export function monsterNote(system) {
	const org = system?.organization ?? "";
	const hp = system?.attributes?.hp?.max ?? 0;
	return hintOf(
		creatureTypeLabel(system?.creatureType ?? ""),
		MONSTER_ORGANIZATIONS.find(o => o.key === org)?.label ?? org,
		hp ? format(`${KEY}.hp`, { hp }) : "",
	);
}

/** Who an actor is, in the few words a row has room for. */
const noteOf = actor => (actor?.type === "monster" ? monsterNote(actor.system) : personNote(actor));

/**
 * The start window's lists, pre-ticks and sides, from plain descriptions of what is on the map and
 * in the world. PURE.
 *
 * @param {object} p
 * @param {Array<{id, actorId, name, img, note, type, hasPlayerOwner, isFollower, disposition, hidden, inFight, master}>} p.sceneTokens
 *   `master` is the character a follower follows, `{id, name, img}`, else null; `note` is who they
 *   are in a few words (people-groups.js#personNote), so two people of one name can be told apart
 * @param {Array<{uuid, actorId, name, img, note}>} [p.pcsElsewhere]   player characters with no token on this map
 * @param {Array<{uuid, name, img, note, disposition, master}>} [p.people]  world NPCs with no token on this map
 * @param {Array<{uuid, name, img, note, fromPack}>} [p.monsters]  `note` from monsterNote
 * @param {string[]} [p.controlled]     token ids the GM has selected
 * @param {string[]|null} [p.preselect] token ids to tick instead of the selection (Deploy and fight)
 * @param {boolean} [p.preselectPcs]    also tick every player character's token
 * @param {string[]} [p.forceFoes]      token ids that fight as foes whatever they are
 * @param {"start"|"add"} [p.mode]
 * @param {(key: string, data?: object) => string} p.format
 * @returns {{groups: Array, selected: string[], sides: Map<string, string>}}
 *   a follower's row carries `parent`, the id of the row it sits under; a character's row that cannot
 *   be ticked carries `header`
 */
export function startWindowModel({
	sceneTokens = [], pcsElsewhere = [], people = [], monsters = [],
	controlled = [], preselect = null, preselectPcs = false, forceFoes = [], mode = "start", format: say,
}) {
	const sides = new Map();
	const lists = { heroes: [], foes: [], others: [], pcsElsewhere: [], people: [], monsters: [] };
	const forced = new Set(forceFoes);
	const tokenRows = [];
	// Followers, and the row of the character each one goes under, by the character's actor id.
	const followers = [];
	const masterRows = new Map();

	for (const token of sceneTokens) {
		if (mode === "add" && token.inFight) continue;
		const placed = forced.has(token.id)
			? { side: FOES, list: FOES }
			: classifySide(token);
		if (!placed) continue;
		const id = `${TOKEN}${token.id}`;
		const row = { id, name: token.name, img: token.img ?? "", hint: hintOf(token.note, token.hidden ? say(`${KEY}.hidden`) : "") };
		// A follower fights beside their character, whatever their token's disposition says.
		const master = forced.has(token.id) ? null : (token.master ?? null);
		sides.set(id, master ? HEROES : placed.side);
		tokenRows.push({ token, id, row, master, list: master ? HEROES : placed.list });
		if (master) { followers.push({ row, master }); continue; }
		lists[placed.list].push(row);
		if (placed.list === HEROES && token.actorId && !masterRows.has(token.actorId)) masterRows.set(token.actorId, row);
	}

	const actorRow = (item, side, hint = "") => {
		const id = `${ACTOR}${item.uuid}`;
		sides.set(id, side);
		return { id, name: item.name, img: item.img ?? "", hint: hintOf(item.note, hint) };
	};
	for (const item of pcsElsewhere) {
		const row = actorRow(item, HEROES);
		lists.pcsElsewhere.push(row);
		if (item.actorId && !masterRows.has(item.actorId)) masterRows.set(item.actorId, row);
	}
	for (const item of people) {
		if (item.master) {
			followers.push({ row: actorRow(item, HEROES, say(`${KEY}.notHere`)), master: item.master });
			continue;
		}
		lists.people.push(actorRow(item, classifySide({ type: "npc", disposition: item.disposition })?.side ?? FOES));
	}
	for (const item of monsters) lists.monsters.push(actorRow(item, FOES, item.fromPack ? say(`${KEY}.fromBestiary`) : ""));

	// Each follower under their character's row, else under a row naming the character that cannot be
	// ticked: one already fighting, or one who is not a player character.
	const children = new Map();
	for (const { row, master } of followers) {
		let home = masterRows.get(master.id);
		if (!home) {
			const token = sceneTokens.find(t => t.actorId === master.id);
			home = { id: `master:${master.id}`, name: master.name, img: master.img ?? "", hint: token?.inFight ? say(`${KEY}.inFight`) : "", header: true };
			lists[token ? "heroes" : "pcsElsewhere"].push(home);
			masterRows.set(master.id, home);
		}
		row.parent = home.id;
		row.hint = hintOf(say(`${KEY}.followerOf`, { name: master.name }), row.hint);
		if (!children.has(row.parent)) children.set(row.parent, []);
		children.get(row.parent).push(row);
	}
	for (const key of ["heroes", "pcsElsewhere"]) lists[key] = lists[key].flatMap(row => [row, ...(children.get(row.id) ?? [])]);

	const groups = [
		{ key: "heroesHere", icon: "fa-shield-halved", label: say(`${KEY}.lists.heroesHere`), people: lists.heroes },
		{ key: "foesHere", icon: "fa-skull", label: say(`${KEY}.lists.foesHere`), people: lists.foes },
		{ key: "othersHere", icon: "fa-user", label: say(`${KEY}.lists.othersHere`), hint: say(`${KEY}.lists.othersHint`), people: lists.others },
		{ key: "pcsElsewhere", icon: "fa-user-group", label: say(`${KEY}.lists.pcsElsewhere`), people: lists.pcsElsewhere },
		{ key: "people", icon: "fa-users", label: say(`${KEY}.lists.people`), people: lists.people },
		{ key: "monsters", icon: "fa-dragon", label: say(`${KEY}.lists.monsters`), people: lists.monsters },
	].filter(group => group.people.length);

	// Who is ticked: whoever Deploy placed, else the GM's selection, else (starting a fight with
	// nothing selected) the party and every monster a player could see. The party brings the
	// followers they have on the map.
	const ticked = new Set();
	const tick = ids => { for (const id of ids) if (sides.has(`${TOKEN}${id}`)) ticked.add(`${TOKEN}${id}`); };
	const party = !Array.isArray(preselect) && !controlled.length && mode === "start";
	if (Array.isArray(preselect)) tick(preselect);
	else if (controlled.length) tick(controlled);
	else if (party) {
		for (const { token, id, list } of tokenRows) {
			if (token.type === "character" || (list === FOES && token.type === "monster" && !token.hidden)) ticked.add(id);
		}
	}
	if (preselectPcs) {
		for (const { token, id } of tokenRows) if (token.type === "character") ticked.add(id);
	}
	if (party || preselectPcs) {
		for (const { id, row, master } of tokenRows) if (master && ticked.has(row.parent)) ticked.add(id);
	}
	return { groups, selected: [...ticked], sides };
}

/**
 * What group-size.js needs to know about a monster, and the key shared by every copy of it.
 *
 * `fightAsGroup` is the sheet switch's answer, and only a token ALREADY ON THE MAP may give it.
 * A world or pack pick has not been placed yet, so its prototype's switch would set the scale of
 * every copy dragged out of it without anyone being asked "how many?" (groupSizeQuestion returns
 * null once it is on). How many bodies a fight starts with is the fight's question now, not the
 * sheet's (fight/group-scale.js), so an unplaced pick answers false and goes through the window.
 */
function groupInfoOf(kind, type, system, { placed = true } = {}) {
	if (type !== "monster" || !kind) return null;
	return { kind, organization: system?.organization ?? "", count: system?.count ?? 0, fightAsGroup: placed && !!system?.fightAsGroup };
}

/**
 * What is on the map and in the world, as startWindowModel reads it. Monsters also carry `group`,
 * what group-size.js asks about them, which the window itself does not read.
 */
async function gatherStartWindow(scene, combat) {
	const game = globalThis.game;
	const inFight = new Set([...(combat?.combatants ?? [])].filter(c => c.sceneId === scene.id).map(c => c.tokenId));
	const tokens = [...(scene.tokens ?? [])].filter(t => t.actor);
	const actors = [...(game.actors ?? [])];
	const masters = followerMasterIndex({ characters: actors.filter(a => a.type === "character"), actors });
	const masterOf = actorId => {
		const master = masters.get(actorId);
		return master ? { id: master.id, name: master.name, img: master.img ?? "" } : null;
	};
	const sceneTokens = tokens.map(t => ({
		id: t.id,
		actorId: t.actorId,
		master: masterOf(t.actorId),
		name: t.name || t.actor.name,
		img: t.texture?.src || t.actor.img || "",
		note: noteOf(t.actor),
		...sideInfoFor(t.actor, t),
		hidden: !!t.hidden,
		inFight: inFight.has(t.id),
		group: groupInfoOf(`Actor.${t.actorId}`, t.actor.type, t.actor.system),
	}));
	const here = new Set(tokens.map(t => t.actorId));
	const pcsElsewhere = getPlayerCharacters()
		.filter(a => !here.has(a.id))
		.map(a => ({ uuid: a.uuid, actorId: a.id, name: a.name, img: a.img, note: personNote(a) }));
	const people = actors
		.filter(a => a.type === "npc" && !here.has(a.id))
		.map(a => ({ uuid: a.uuid, name: a.name, img: a.img, note: personNote(a), disposition: a.prototypeToken?.disposition ?? null, master: masterOf(a.id) }))
		.sort((a, b) => a.name.localeCompare(b.name));
	const worldMonsters = [...(game.actors ?? [])].filter(a => a.type === "monster");
	const monsters = worldMonsters.map(a => ({ uuid: a.uuid, name: a.name, img: a.img, note: monsterNote(a.system), fromPack: false, group: groupInfoOf(a.uuid, a.type, a.system, { placed: false }) }));
	// The bestiary entries the world has no copy of. The index is enough to list them; a pick is
	// imported only if it is chosen (utils/deployable-actor.js), and never twice.
	// Through the shared index, so this field list and every other reader's widen one another instead of refetching.
	const pack = await ensurePackIndex(BESTIARY_PACK, ["img", "type", "system.organization", "system.count", "system.fightAsGroup", "system.creatureType", "system.attributes.hp.max"]).catch(() => null);
	if (pack) {
		const worldCopy = worldActorsBySource();
		for (const entry of pack.index ?? []) {
			if (entry.type && entry.type !== "monster") continue;
			const uuid = entry.uuid ?? `Compendium.${pack.collection}.Actor.${entry._id}`;
			if (worldCopy(compendiumRefTail(uuid))) continue;
			monsters.push({ uuid, name: entry.name, img: entry.img, note: monsterNote(entry.system), fromPack: true, group: groupInfoOf(uuid, "monster", entry.system, { placed: false }) });
		}
	}
	monsters.sort((a, b) => a.name.localeCompare(b.name));
	return { sceneTokens, pcsElsewhere, people, monsters };
}

let windowsOpened = 0;

/**
 * Open the start window (or, with a fight already on the map, the add window), then do what it says.
 *
 * @param {object} [p]
 * @param {Combat|null} [p.combat]      the fight to add to; defaults to the fight on the canvas scene
 * @param {string[]|null} [p.preselect] token ids to tick
 * @param {boolean} [p.preselectPcs]
 * @param {string[]} [p.forceFoes]
 */
export async function openStartFight({ combat = null, preselect = null, preselectPcs = false, forceFoes = [] } = {}) {
	const game = globalThis.game;
	const canvas = globalThis.canvas;
	if (!game?.user?.isGM) return null;
	const scene = canvas?.scene ?? null;
	if (!scene) {
		globalThis.ui?.notifications?.warn(localize(`${KEY}.noScene`));
		return null;
	}
	// A Combat we never stamped (the old Introductions roster, one made with the Fight tab off) is
	// not a fight to add to, even when the tab is showing it.
	if (combat && !isFight(combat)) combat = null;
	combat ??= fightOnScene(scene);
	const mode = combat ? "add" : "start";
	const gathered = await gatherStartWindow(scene, combat);
	const model = startWindowModel({
		...gathered,
		controlled: controlledTokenIds(),
		preselect, preselectPcs, forceFoes, mode, format,
	});
	if (!model.groups.length) {
		globalThis.ui?.notifications?.info(localize(`${KEY}.nobody`));
		return null;
	}
	const dialog = new StartFightDialog({
		title: localize(`${KEY}.${mode === "add" ? "titleAdd" : "titleStart"}`),
		hint: localize(`${KEY}.${mode === "add" ? "hintAdd" : "hintStart"}`),
		buttonLabel: localize(`${KEY}.${mode === "add" ? "buttonAdd" : "buttonStart"}`),
		icon: mode === "add" ? "fa-user-plus" : "fa-swords",
		groups: model.groups,
		selected: model.selected,
		sides: model.sides,
		mode,
		// Only a new fight offers to line everyone up; adding to one leaves that to the tab's own button.
		toggles: mode === "add" ? [] : [{ key: "lineUp", label: localize("stonetop.fight.lineUp"), hint: localize("stonetop.fight.lineUpHint"), checked: false }],
	}, { id: `stonetop-start-fight-${++windowsOpened}` });
	const answer = await dialog.promise();
	if (!answer) return null;
	const groups = new Map([
		...gathered.sceneTokens.filter(t => t.group).map(t => [`${TOKEN}${t.id}`, t.group]),
		...gathered.monsters.filter(m => m.group).map(m => [`${ACTOR}${m.uuid}`, m.group]),
	]);
	// A monster already fighting here has had its numbers settled; one more of it is just one more.
	const fighting = new Set([...(combat?.combatants ?? [])].filter(c => c.sceneId === scene.id).map(c => `Actor.${c.actorId}`));
	const picks = await withGroupSizes(answer.picks, pick => {
		const group = groups.get(pick.id);
		return group && !fighting.has(group.kind) ? group : null;
	});
	return startFight({ scene, combat, picks, lineUp: answer.lineUp });
}

/**
 * Ask how many of each monster that comes in numbers, one monster at a time, and write the answer on
 * that monster's pick: `size`, and `asGroup` when they fight as one group token. A question closed
 * without an answer leaves its pick as it was.
 *
 * @param {Array<{id: string, name: string, side: string}>} picks
 * @param {(pick) => object|null} infoFor  see group-size.js#groupSizeQuestions
 * @param {(question) => Promise<{size: number, asGroup: boolean}|null>} [ask]
 */
export async function withGroupSizes(picks, infoFor, ask = askGroupSize) {
	const answers = new Map();
	for (const question of groupSizeQuestions(picks, infoFor)) {
		const answer = await ask(question);
		if (answer?.size > 1) answers.set(question.pickId, { size: answer.size, asGroup: !!answer.asGroup });
	}
	return picks.map(pick => (answers.has(pick.id) ? { ...pick, ...answers.get(pick.id) } : pick));
}

/**
 * A pick as it can actually be placed. A LINKED token cannot stand for a group (group-scale.js#makeGroupToken
 * writes the group onto the token's own actor, and a linked token has none), so a group answer on one
 * becomes that many tokens, and its name goes on `ungrouped` for the GM to be told.
 */
function placeablePick(pick, linked, ungrouped) {
	if (!pick.asGroup || !linked) return pick;
	ungrouped.push(pick.name);
	return { ...pick, asGroup: false };
}

/** How many tokens a pick puts on the map: one for a group fighting as one token. */
const copiesOf = pick => (pick?.asGroup ? 1 : Math.max(1, Math.trunc(Number(pick?.size) || 1)));

/**
 * Where arriving tokens are dropped: their line-up places, as the CENTRE points core's drop takes.
 */
function arrivalPoints(canvas, arrivals, { starting = false } = {}) {
	const size = canvas.dimensions?.size ?? canvas.grid?.size ?? 100;
	const sized = arrivals.map((a, i) => ({
		id: String(i), side: a.side,
		w: a.actor.prototypeToken?.width ?? 1, h: a.actor.prototypeToken?.height ?? 1,
	}));
	const positions = lineUpPositions({
		view: viewRectWorld(canvas, { coming: fightWindowComing({ started: starting }) }),
		size,
		sceneRect: sceneRectOf(canvas),
		heroes: sized.filter(s => s.side === HEROES),
		foes: sized.filter(s => s.side !== HEROES),
	});
	return sized.map(s => {
		const at = positions.get(s.id);
		return at ? { x: at.x + (s.w * size) / 2, y: at.y + (s.h * size) / 2 } : null;
	});
}

/**
 * The part of the scene the GM can see, in scene pixels: the window, less the scene controls on the
 * left, the sidebar on the right, and the Fight window on whichever side of the view it stands.
 *
 * The Fight window is left out only while that keeps at least half of the view's width: a GM who has
 * dragged it wide across the middle of the map still gets the fight in front of them, not squeezed
 * into a strip beside it. A window not open yet but about to open for a fight being started (`coming`,
 * fight-window.js#fightWindowComing) is left out the same way, so the arrivals do not land under it.
 *
 * @param {object} [canvas]
 * @param {{coming?: {left: number, right: number, width: number}|null}} [options]
 */
export function viewRectWorld(canvas = globalThis.canvas, { coming = null } = {}) {
	const doc = globalThis.document;
	const width = globalThis.innerWidth ?? 1920;
	const height = globalThis.innerHeight ?? 1080;
	let left = 0;
	let right = width;
	const controls = doc?.getElementById?.("ui-left")?.getBoundingClientRect?.();
	if (controls?.width) left = Math.max(left, controls.right);
	const sidebar = doc?.getElementById?.("sidebar")?.getBoundingClientRect?.();
	if (sidebar?.width) right = Math.min(right, sidebar.left);
	const fightWindow = globalThis.ui?.combat?.popout;
	const box = fightWindow?.rendered ? (fightWindow.minimized ? null : fightWindow.element?.getBoundingClientRect?.()) : coming;
	if (box?.width) {
		const onRight = box.left + box.width / 2 >= (left + right) / 2;
		const narrowed = onRight ? [left, Math.min(right, box.left)] : [Math.max(left, box.right), right];
		if (narrowed[1] - narrowed[0] >= (right - left) / 2) [left, right] = narrowed;
	}
	const transform = canvas?.stage?.worldTransform;
	if (!transform?.applyInverse) {
		const rect = sceneRectOf(canvas);
		return rect ?? { x: 0, y: 0, w: width, h: height };
	}
	const topLeft = transform.applyInverse({ x: left, y: 0 });
	const bottomRight = transform.applyInverse({ x: right, y: height });
	return { x: topLeft.x, y: topLeft.y, w: bottomRight.x - topLeft.x, h: bottomRight.y - topLeft.y };
}

/**
 * Put the picks into the fight on `scene`, starting one when there is none.
 *
 * @returns {Promise<{combat: Combat|null, added: number, placed: number, imported: number, missed: string[]}>}
 */
export async function startFight({ scene, combat = null, picks = [], lineUp = false } = {}) {
	const game = globalThis.game;
	const canvas = globalThis.canvas;
	const notify = globalThis.ui?.notifications;
	const result = { combat: null, added: 0, placed: 0, imported: 0, missed: [] };
	if (!game?.user?.isGM || !scene) return result;

	// Whoever is not on the map yet: find (or import, once) their actor, then drop a token, one at a
	// time. Each drop reads the layer's top sort, and each import must be seen by the next row.
	const joiners = [];
	const arrivals = [];
	const worldCopy = worldActorsBySource();
	const ungrouped = [];
	for (const asked of picks.filter(p => p.id.startsWith(ACTOR))) {
		const found = await resolveDeployableActor(asked.id.slice(ACTOR.length), worldCopy);
		if (!found) { result.missed.push(asked.name); continue; }
		if (found.imported) result.imported += 1;
		const pick = placeablePick(asked, !!found.actor?.prototypeToken?.actorLink, ungrouped);
		for (let n = copiesOf(pick); n > 0; n -= 1) arrivals.push({ actor: found.actor, side: pick.side, name: pick.name, pick });
	}
	if (arrivals.length && canvas?.scene?.id === scene.id) {
		// A fight starting here opens its window as it starts: the arrivals keep clear of where it will be.
		const starting = !(combat && isFight(combat)) && !fightOnScene(scene);
		const points = arrivalPoints(canvas, arrivals, { starting });
		const drop = await placeActors(canvas, arrivals.map(a => a.actor), i => points[i]);
		result.missed.push(...drop.missed);
		const groupsPlaced = new Map();
		for (const { i, actor, token } of drop.dropped) {
			if (token?.documentName !== "Token") { result.missed.push(actor.name); continue; }
			joiners.push({ token, side: arrivals[i].side });
			result.placed += 1;
			const { pick } = arrivals[i];
			if (pick.asGroup) await makeGroupToken(token, pick.size);
			if (copiesOf(pick) < 2) continue;
			if (!groupsPlaced.has(pick)) groupsPlaced.set(pick, { actor, tokens: [] });
			groupsPlaced.get(pick).tokens.push(token);
		}
		for (const { actor, tokens } of groupsPlaced.values()) await settleNewcomers(scene, actor, tokens);
	} else {
		for (const arrival of arrivals) result.missed.push(arrival.actor.name);
	}
	for (const asked of picks.filter(p => p.id.startsWith(TOKEN))) {
		const token = scene.tokens?.get?.(asked.id.slice(TOKEN.length));
		if (!token) { result.missed.push(asked.name); continue; }
		const pick = placeablePick(asked, !!token.actorLink, ungrouped);
		joiners.push({ token, side: pick.side });
		if (pick.asGroup) await makeGroupToken(token, pick.size);
		if (copiesOf(pick) < 2) continue;
		const more = await gatherAround(canvas, scene, token, copiesOf(pick) - 1);
		for (const extra of more.tokens) joiners.push({ token: extra, side: pick.side });
		result.placed += more.tokens.length;
		result.missed.push(...more.missed);
	}

	// The fight: the one on this map, or a new one.
	if (combat && !isFight(combat)) combat = null;
	combat ??= fightOnScene(scene);
	const started = !combat;
	if (!combat) {
		const CombatClass = globalThis.getDocumentClass?.("Combat") ?? globalThis.CONFIG?.Combat?.documentClass;
		combat = await CombatClass.create({ scene: scene.id, active: true });
	} else if (!combat.active) {
		await combat.activate?.({ render: false });
	}
	result.combat = combat;
	if (!combat) return result;

	const already = new Set([...(combat.combatants ?? [])].filter(c => c.sceneId === scene.id).map(c => c.tokenId));
	const data = [];
	for (const { token, side } of joiners) {
		if (already.has(token.id)) continue;
		already.add(token.id);
		data.push({
			tokenId: token.id, sceneId: scene.id, actorId: token.actorId, hidden: !!token.hidden,
			flags: { [SYSTEM_ID]: { [SIDE_FLAG]: side } },
		});
	}
	if (data.length) await combat.createEmbeddedDocuments("Combatant", data);
	result.added = data.length;

	if (lineUp) await lineUpFight(combat, { scene });
	// Show the GM the fight: in the Fight window when that is open or opening for it, which leaves their
	// sidebar on Chat where the rolls land; else in the tab, as before there was a window.
	if (!fightWindowWillShow({ started })) globalThis.ui?.sidebar?.changeTab?.("combat", "primary");

	if (result.added) notify?.info(format(`${KEY}.joined`, { count: result.added }));
	if (result.imported) notify?.info(format(`${KEY}.imported`, { count: result.imported }));
	if (result.missed.length) notify?.warn(format(`${KEY}.missed`, { names: joinNames(result.missed) }));
	if (ungrouped.length) notify?.warn(format(`${KEY}.ungrouped`, { names: joinNames(ungrouped) }));
	return result;
}

/**
 * Everyone in the fight lined up in one move. The fights already
 * going on are kept as they stand and only shifted about (line-up.js); the fighters nobody is up
 * against go into columns, heroes on the left and foes on the right, around where they all stand. Only for a
 * fight on the canvas scene, where there is a view to line up in.
 */
export async function lineUpFight(combat, { scene = globalThis.canvas?.scene } = {}) {
	const game = globalThis.game;
	const canvas = globalThis.canvas;
	if (!game?.user?.isGM || !combat || !scene || canvas?.scene?.id !== scene.id) return false;
	const size = canvas.dimensions?.size ?? scene.grid?.size ?? 100;
	const fighters = [...(combat.combatants ?? [])]
		.filter(c => c.sceneId === scene.id && c.token)
		.map(c => ({ combatant: c, token: c.token, side: combatantSide(c), out: combatantBodies(c).out }))
		.filter(f => f.side)
		.sort((a, b) => (a.token._source.y - b.token._source.y) || (a.token._source.x - b.token._source.x));
	if (!fighters.length) return false;
	const entry = f => ({
		id: f.token.id,
		w: f.token._source.width ?? 1, h: f.token._source.height ?? 1,
		x: f.token._source.x, y: f.token._source.y,
		level: tokenLevel(f.token),
		out: f.out,
	});
	const positions = lineUpPositions({
		view: viewRectWorld(canvas),
		size,
		sceneRect: sceneRectOf(canvas),
		gridKind: gridOf(scene).kind,
		heroes: fighters.filter(f => f.side === HEROES).map(entry),
		foes: fighters.filter(f => f.side === FOES).map(entry),
	});
	const moves = [];
	// A SCRUM IS SNAPPED ONCE. Everyone already fighting moves as one piece, so snapping each of them
	// to the grid on their own could pull two of them apart and end the fight between them: the first
	// one of a scrum to be snapped sets the correction the rest of that scrum takes.
	const corrections = new Map();
	for (const { token } of fighters) {
		const target = positions.get(token.id);
		if (!target) continue;
		// Everyone takes a delta off the place line-up.js put them; a scrum's first member works theirs
		// out by snapping and the rest of that scrum reuse it, so the scrum lands as one piece.
		let delta = target.group ? corrections.get(target.group) : null;
		if (!delta) {
			const fixed = typeof token.getSnappedPosition === "function"
				? token.getSnappedPosition({ x: target.x, y: target.y })
				: target;
			delta = { x: fixed.x - target.x, y: fixed.y - target.y };
			if (target.group) corrections.set(target.group, delta);
		}
		const snapped = { x: target.x + delta.x, y: target.y + delta.y };
		if (snapped.x === token._source.x && snapped.y === token._source.y) continue;
		moves.push({ id: token.id, x: snapped.x, y: snapped.y });
	}
	if (!moves.length) return false;
	await displaceTokens(scene, moves);
	return true;
}

