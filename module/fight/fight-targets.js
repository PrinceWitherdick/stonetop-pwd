// Who a roll hits when nobody picked a target by hand: whoever the roller is fighting.
//
// The Fight tab already knows that (engagements.js): tokens touching are in melee, and a player's target
// is a shot. So a character's Clash lands on the foe they are standing against, and a monster's damage
// lands on the character standing against it, without anyone reaching for T.
//
// HAND TARGETS STILL WIN. A player who targeted something meant it, and the GM's own targets are the
// only way to aim a monster at somebody it is not touching.
//
// A HERO hits the foes they are in melee with, then any they are shooting at. A FOE hits the heroes in
// melee with it, and only when there are none, the heroes it has a shot on record at (fight-shots.js),
// then the heroes shooting at it: a monster with a character in its face is not swinging at the archer
// behind them.
//
// SEVERAL IS A QUESTION, NOT A DEFAULT. Clash and Let Fly are written against one foe. Book I p.414 (and
// Clash's own notes, p.215): "When a PC or follower's attack could feasibly hurt multiple foes—because of
// the area tag, because a group of followers is making or Aiding the attack, or just because the player
// describes it in a way that makes sense—then the player rolls to Clash or Let Fly just once, but they
// roll damage separately against each foe." Only the roller knows which of those this is, so a roller
// fighting more than one is asked, with the first ticked.

import { escHtml } from "../utils/strings.js";
import { format, localize } from "../utils/i18n.js";
import { themedDialogClasses } from "../utils/window-theme.js";
import { contentElement } from "../utils/dialogv2-content.js";
import { HEROES, touching } from "./engagements.js";
import { gridOf } from "./fight-state.js";
import { rollerEngagement, asTarget } from "./damage-seed.js";
import { namesPhrase } from "./fight-copy.js";

const KEY = "stonetop.fight.targets";
export const TARGET_FIELD = "stonetopFightTarget";

/**
 * Everyone `actor` is fighting on the canvas scene, as targets, in the order the Fight tab lists them.
 * Empty with the Fight tab off, no fight here, the actor not in it, or nobody engaged with them.
 *
 * @param {Actor} actor  the roller (an unlinked token's own actor, for a monster)
 * @param {object} [options]
 * @param {Scene} [options.scene]
 * @param {object|null} [options.engagement]  rollerEngagement's answer, when the caller already has it
 */
export function engagedOpponents(actor, { scene = globalThis.canvas?.scene ?? null, engagement } = {}) {
	const found = engagement === undefined ? rollerEngagement(actor, { scene }) : engagement;
	if (!found) return [];
	const self = found.fighters.find(f => f.id === found.combatant.id);
	const { melee = [], shootingAt = [], shotBy = [] } = found.entry;
	const ids = self?.side === HEROES
		? [...new Set([...melee, ...shootingAt])]
		: (melee.length ? melee : [...new Set([...shootingAt, ...shotBy])]);
	return ids.map(id => found.combatants.get(id)).filter(c => c?.token).map(asTarget);
}

/**
 * Everyone on the other side of the fight `actor` is in, engaged with them or not, still up, as targets:
 * whom a move made at "your enemy" with nothing targeted could mean (Speak Softly). Those `actor` is engaged
 * with come first. Empty where engagedOpponents is.
 */
export function foesInFight(actor, { scene = globalThis.canvas?.scene ?? null, engagement } = {}) {
	const found = engagement === undefined ? rollerEngagement(actor, { scene }) : engagement;
	if (!found) return [];
	const self = found.fighters.find(f => f.id === found.combatant.id);
	const near = engagedOpponents(actor, { engagement: found });
	const seen = new Set(near.map(foe => foe.uuid));
	const rest = found.fighters
		.filter(f => f.id !== found.combatant.id && f.side !== self?.side && !f.out)
		.map(f => found.combatants.get(f.id)).filter(c => c?.token).map(asTarget)
		.filter(foe => !seen.has(foe.uuid));
	return [...near, ...rest];
}

/**
 * The "Who does this hit?" window's words: a checkbox per opponent, the first ticked. PURE.
 *
 * AN AREA ATTACK TICKS THEM ALL, and says why. Two moves reach here on their own: Berserker ("add the
 * area tag to your melee attacks, lashing out at anyone nearby, friend and foe alike") and Blot Out the
 * Sun's volley. That is also why the list holds allies: both moves hit them too, and a window that
 * quietly left them out would be answering the question the moves deliberately do not.
 *
 * `areaAround` picks which of the two the hint speaks in the voice of — it is the same distinction the
 * list itself was built on (see bystanders), so the words and the names agree.
 *
 * @param {{roller: string, candidates: Array<{name: string}>, area?: boolean, areaAround?: string}} question
 */
export function whoItHitsWindow({ roller, candidates, area = false, areaAround = "roller" }) {
	const rows = candidates.map((candidate, index) => `<li>
			<label class="stonetop-fight-targets-option">
				<input type="checkbox" name="${TARGET_FIELD}" value="${index}"${area || index === 0 ? " checked" : ""}>
				<span>${escHtml(candidate.name)}${candidate.ally ? ` <em>${escHtml(localize(`${KEY}.ally`))}</em>` : ""}</span>
			</label>
		</li>`).join("");
	return {
		title: format(`${KEY}.title`, { name: roller }),
		content: `<div class="stonetop-fight-targets">
		<p>${escHtml(format(`${KEY}.body`, { name: roller }))}</p>
		<ul class="stonetop-fight-targets-list">${rows}</ul>
		<p class="stonetop-fight-targets-hint">${escHtml(area ? localize(`stonetop.fight.heroMoves.${areaAround === "targets" ? "volleyHint" : "berserkerHint"}`) : localize(`${KEY}.hint`))}</p>
	</div>`,
		confirm: whoItHitsConfirm(area ? candidates : candidates.slice(0, 1)),
		cancel: localize(`${KEY}.cancel`),
	};
}

/** The confirm button's words for what is ticked: "Attack Wolf", "Attack Wolf & Crinwin". */
export function whoItHitsConfirm(ticked) {
	return ticked.length
		? format(`${KEY}.confirm`, { names: namesPhrase(ticked.map(t => t.name), format) })
		: localize(`${KEY}.confirmNone`);
}

/**
 * Ask the roller which of the opponents they are fighting this roll hits. Resolves to the ticked ones,
 * or null when the window is cancelled or closed, which calls the roll off.
 *
 * @param {{roller: string, candidates: object[]}} question
 */
export async function askWhoItHits(question, { DialogV2 = globalThis.foundry?.applications?.api?.DialogV2, document = globalThis.document } = {}) {
	if (!DialogV2 || !document || !question?.candidates?.length) return null;
	const { candidates } = question;
	const view = whoItHitsWindow(question);
	// An element, not a string: core runs a string through its sanitizer, and this markup is ours.
	const content = contentElement(view.content, document);
	const ticked = form => [...(form?.querySelectorAll?.(`input[name="${TARGET_FIELD}"]:checked`) ?? [])]
		.map(input => candidates[Number(input.value)])
		.filter(Boolean);
	return DialogV2.wait({
		classes: themedDialogClasses("stonetop-fight-targets-app"),
		window: { title: view.title },
		// Sized, or core fits the window to the hint's one long line and it spans the whole screen.
		position: { width: 440 },
		content,
		buttons: [
			{ action: "hit", label: view.confirm, default: true, callback: (_event, button) => ticked(button?.form) },
			{ action: "cancel", label: view.cancel, callback: () => null },
		],
		// The confirm button names who is ticked, and cannot be pressed with nobody ticked.
		render: (_event, dialog) => {
			const root = dialog?.element ?? dialog;
			const form = root?.querySelector?.("form") ?? root;
			const confirm = root?.querySelector?.('button[data-action="hit"]');
			root?.addEventListener?.("change", () => {
				if (!confirm) return;
				const now = ticked(form);
				// Core puts a button's label in a span of its own (DialogV2#_renderButtons); keep it there.
				(confirm.querySelector?.("span") ?? confirm).textContent = whoItHitsConfirm(now);
				confirm.disabled = now.length === 0;
			});
		},
		rejectClose: false,
	}).catch(() => null).then(answer => (Array.isArray(answer) && answer.length ? answer : null));
}

/**
 * Who a roll hits: the hand targets when there are any, else whoever the roller is fighting, asking
 * which when that is more than one. Resolves to an array (empty when there is nobody to hit, which
 * rolls damage at no one, as before), or null when the roller backed out of the question.
 *
 * @param {Actor} actor
 * @param {object} [options]
 * @param {object[]} [options.handTargets]  the roller's own targets, frozen
 * @param {string} [options.roller]  who the question names, when that is not `actor`: a follower
 *   off the map, fighting beside the character it is aimed by
 * @param {boolean} [options.area]  an area attack: everyone in reach, ticked, allies too
 * @param {"roller"|"targets"} [options.areaAround]  WHERE that area is. Berserker's is around the
 *   Heavy, who is lashing out at what stands next to THEM; Blot Out the Sun's is around the foes the
 *   arrows fall on, which is nowhere near the archer.
 * @param {typeof askWhoItHits} [options.ask]
 * @returns {Promise<object[]|null>}
 */
export async function rollTargets(actor, { handTargets = [], roller = "", area = false, areaAround = "roller", ask = askWhoItHits } = {}) {
	// Hand targets win outright for an ordinary blow — but an AREA attack is not aimed at one thing, it
	// is aimed at a PLACE, and who else is standing there is the whole of what the tag buys. Returned
	// here, a Blot Out the Sun fired at a targeted foe spent the quiver on a volley that fell on that
	// foe alone. So the hand targets become what the area is measured AROUND, not the end of the question.
	if (handTargets?.length && !area) return handTargets;
	// ONE fight snapshot for both questions: `engage` is a pairwise geometry solve over every fighter,
	// and who is engaged and who is merely standing nearby are two readings of the same answer.
	const engagement = rollerEngagement(actor);
	const engaged = handTargets?.length ? handTargets : engagedOpponents(actor, { engagement });
	// An area attack asks even about a single foe, because the answer includes who ELSE is standing there.
	if (!area) return engaged.length < 2 ? engaged : ask({ roller: roller || actor?.name || "", candidates: engaged });
	const candidates = [...engaged, ...bystanders(engaged, engagement, { areaAround })];
	if (!candidates.length) return [];
	return ask({ roller: roller || actor?.name || "", candidates, area: true, areaAround });
}

/**
 * Who else is standing close enough to be caught by an area attack, and not already among the foes it
 * is aimed at. Anyone on the roller's own side is marked `ally` so the window can say so.
 *
 * WHAT COUNTS AS "CLOSE" IS THE MOVE'S OWN QUESTION. A Heavy in their Battle Joy lashes out around
 * themselves, so the neighbourhood is the roller's; a volley of arrows falls where it was aimed, so the
 * neighbourhood is the FOES', and measuring it from the archer would sweep the Ranger's own line into a
 * shot fired over their heads. A foe touching the roller is already in melee with them and so already
 * among `engaged`, which is why the roller-anchored reading only ever turns up allies.
 */
function bystanders(engaged, found, { areaAround = "roller" } = {}) {
	if (!found) return [];
	const aimed = new Set(engaged.map(t => t.uuid));
	const grid = gridOf(found.scene);
	const me = found.fighters.find(f => f.id === found.combatant.id);
	if (!me) return [];
	const byUuid = new Map(found.fighters.map(f => [found.combatants.get(f.id)?.token?.uuid, f]).filter(([uuid]) => uuid));
	const anchors = areaAround === "targets" ? engaged.map(t => byUuid.get(t.uuid)).filter(Boolean) : [me];
	if (!anchors.length) return [];
	const out = [];
	for (const fighter of found.fighters) {
		// `visible` is the tracker's own rule (fight-state.js#fighterOf), and it is the reason this list
		// is safe to show a PLAYER. Without it the window named a GM-hidden token standing beside the
		// Berserker, pre-ticked, and gave away the ambush before it was sprung. A GM sees everyone, so
		// they can still sweep it in; nobody else is told it is there.
		if (fighter.id === me.id || fighter.out || !fighter.visible) continue;
		if (!anchors.some(anchor => anchor.id !== fighter.id && touching(anchor, fighter, grid))) continue;
		const combatant = found.combatants.get(fighter.id);
		if (!combatant?.token || aimed.has(combatant.token.uuid)) continue;
		out.push({ ...asTarget(combatant), ...(fighter.side === me.side ? { ally: true } : {}) });
	}
	return out;
}
