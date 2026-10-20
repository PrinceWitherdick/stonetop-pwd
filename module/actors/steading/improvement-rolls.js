/**
 * IMPROVEMENTS AT THE MOMENT OF A ROLL: what the steading has built, turned into the questions a
 * homefront move's window asks and the changes the answers make to the dice.
 *
 * Most of what an improvement does "henceforth" happens when the Seasons Change, and the season
 * window already handles it. These are the rest: the ones that change a MOVE. Some always apply
 * (a Township has advantage to Muster, Pull Together and Trade & Barter). Most turn on something
 * only the table knows ("when you take advantage of the stone wall", "when you specifically
 * involve the watch"), so the window asks, and asks only once the improvement is built.
 *
 * Pure: the sheet hands in the steading's RULES LIST (improvement-rules.js, the improvements in
 * force with their grants) and the militia's trained tactics, so every rule here can be tested as
 * a rule.
 *
 * Advantage is a GRANT now, not a slug: `rollAdvantage: {moves, ask?}` on the improvement (the
 * Township's three moves always; the Palisade's and the Stone Wall's Deploy when "you take
 * advantage of" the wall; Book II's Barrier Pass and Aetherium Crucible on Trade & Barter for named
 * goods). Always-on when it has no `ask`; asked, as an unticked box carrying the `ask` text, when it
 * does. What stays keyed by slug here is what no grant can say: the militia's tactic, the watch's
 * +1 Defenses, the herd's half-cost and its Requisition count.
 */
import { rulesHas } from "./improvement-rules.js";
import { HERO_MOVES } from "../../fight/hero-move-names.js";
import { WE_HAPPY_FEW } from "../character/fight-states.js";
import { format } from "../../utils/i18n.js";

/** The steading moves these rules name, by the label their roll card carries. */
export const STEADING_MOVE = Object.freeze({
	DEPLOY:        "Deploy",
	MUSTER:        "Muster",
	PULL_TOGETHER: "Pull Together",
	TRADE_BARTER:  "Trade & Barter",
	REQUISITION:   "Requisition",
	AUROCHS_HUNT:  "Aurochs Hunt",
	HEROIC:        "Heroic Reputation",
});

/** "Disadvantage to Deploy, Muster, or Pull Together" (the Diminished debility). */
export const DIMINISHED_MOVES = new Set([STEADING_MOVE.DEPLOY, STEADING_MOVE.MUSTER, STEADING_MOVE.PULL_TOGETHER]);

/**
 * The three moves Size names (Book I p. 509): a hamlet does them "with disadvantage", a town or a
 * city "with advantage". The Township's own grant names the same three ("When you Muster, Pull
 * Together, or Trade & Barter, you have advantage").
 */
const SIZE_MOVES = new Set([STEADING_MOVE.MUSTER, STEADING_MOVE.PULL_TOGETHER, STEADING_MOVE.TRADE_BARTER]);

/** The window's question name for an improvement's asked advantage. */
export function advantageQuestionName(slug) {
	return `advantage-${slug}`;
}

/**
 * The asked advantages a window's form answered, by question name: every `advantage-*` checkbox
 * under `root`, ticked or not. For the windows that draw their own controls (the Requisition
 * windows) rather than improvementQuestionHtml's.
 */
export function askedAdvantageAnswers(root) {
	const out = {};
	for (const box of root?.querySelectorAll?.('input[name^="advantage-"]') ?? []) out[box.name] = !!box.checked;
	return out;
}

/**
 * The We Happy Few answer a window's form gives (nervesQuestion): the shaken character's name when its
 * tick is ticked or its pick names someone, else "". For the windows that draw their own controls.
 */
export function nervesAnswer(root) {
	const field = root?.querySelector?.('[name="nerves"]');
	if (!field) return "";
	if (field.type === "checkbox") return field.checked ? String(field.value ?? "") : "";
	return String(field.value ?? "");
}

/**
 * How many horses a window's form says come from the herd: its `herdCount` field under `root`,
 * as a whole number, or 0 when the window does not ask. For the same Requisition windows.
 */
export function herdCountAnswer(root) {
	return Math.max(0, Math.trunc(Number(root?.querySelector?.('[name="herdCount"]')?.value) || 0));
}

/** The improvements in force whose `rollAdvantage` names this move: `asked` with an `ask`, else always-on. */
function advantagesFor(rules, moveName, { asked }) {
	return (rules ?? []).filter(r => {
		const adv = r.grants?.rollAdvantage;
		return adv?.moves?.includes(moveName) && !!adv.ask === asked;
	});
}

/**
 * Herd of Horses: "When you Requisition half the herd or less, treat a 6- as a 7-9." Read off the
 * NUMBER of horses being taken, which the Requisition windows ask for, against the whole herd.
 * Nothing taken from the herd is not a herd requisition at all.
 * @param {number|string} count  horses requisitioned from the herd
 * @param {number} total         the herd's size, every tier
 */
export function herdShareMet(count, total) {
	const n = Math.trunc(Number(count) || 0);
	const herd = Math.trunc(Number(total) || 0);
	return n > 0 && herd > 0 && n * 2 <= herd;
}

/**
 * The Marshal's Logistics: "When you have a steading Muster or Pull Together, or when you
 * Requisition, you have advantage." The advantage is the Marshal's, not the steading's, so it
 * turns on WHO is behind the roll, which only the table knows: the window asks, ticked, and only
 * when someone has the move learned (actors/character/logistics.js finds them).
 */
export const LOGISTICS = "Logistics";
export const LOGISTICS_MOVES = new Set([STEADING_MOVE.MUSTER, STEADING_MOVE.PULL_TOGETHER, STEADING_MOVE.REQUISITION]);

/** The Logistics line, naming who holds the move ("the Marshal" when nobody is named). */
function logisticsLabel(moveName, holders) {
	const who = holders.length ? holders.join(" or ") : "the Marshal";
	const act = moveName === STEADING_MOVE.REQUISITION ? "Requisitioning" : `having the steading ${moveName}`;
	return `${LOGISTICS} (${who}): ${holders.length > 1 ? "one of them is" : "they are"} the one ${act}, advantage`;
}

/**
 * The Ranger's Pathfinder: "When you lead your people to Pull Together or Deploy beyond sight of
 * home, you have advantage." The Ranger's like Logistics, and turning on fiction besides (beyond
 * sight of home), so the window asks UNTICKED, and only when someone has the move learned
 * (owns-move.js#worldLearnedHolderNames finds them).
 */
export const PATHFINDER = "Pathfinder";
export const PATHFINDER_MOVES = new Set([STEADING_MOVE.DEPLOY, STEADING_MOVE.PULL_TOGETHER]);

/** The Pathfinder line, naming who holds the move ("the Ranger" when nobody is named). */
function pathfinderLabel(holders) {
	const who = holders.length ? holders.join(" or ") : "the Ranger";
	return `${PATHFINDER} (${who}): ${holders.length > 1 ? "one of them leads" : "they lead"} the people beyond sight of home, advantage`;
}

/**
 * The Marshal's Stentorian (Book I p.127): "Spend 1 Command to shout an order or warning and pick 1: ... You
 * have advantage to Order Followers or Deploy." Spending is the Marshal's choice, so the Deploy window asks
 * UNTICKED, and only for a Marshal who holds Command (combat/command-holders.js#deployCommandOffers). The advantage
 * applies only once the Command is spent: the question's `spend` takes it off that Marshal and clears `command`
 * from the answers when it fails (combat/battle-holds.js#deployCommandAnswers), before they reach rollAdjustments
 * (spendImprovementAnswers).
 */
const STENTORIAN = HERO_MOVES.STENTORIAN;

/**
 * Stentorian's spend: 1 Command off the Marshal the answer names. Loaded when it is spent, not with this
 * module, so the windows that only ASK (and these rules' tests) do not pull in the fight code behind it.
 */
async function spendStentorianCommand(answers) {
	const { deployCommandAnswers } = await import("../../combat/battle-holds.js");
	const paid = await deployCommandAnswers(answers);
	return paid.commandRefused
		? { answers: paid, refused: "No Command was spent (that Marshal holds none, or you cannot update them), so the Deploy has no Stentorian advantage." }
		: { answers: paid };
}

/** The Stentorian line, naming the Marshal it spends from, or asking which one when there are several. */
function commandLabel(holders) {
	return holders.length === 1
		? `${STENTORIAN} (${holders[0].name}): spend 1 Command to shout an order or warning, advantage to Deploy`
		: `${STENTORIAN}: the Marshal Deploying spends 1 Command to shout an order or warning, advantage to Deploy`;
}

/**
 * Deploy's Stentorian question: a tick naming the one Marshal, or a pick among several. Its value is their id.
 * It carries its `spend` (spendImprovementAnswers runs it when the answer is taken).
 */
function commandQuestion(holders, spend) {
	const label = commandLabel(holders);
	if (holders.length === 1) return { name: "command", type: "checkbox", value: holders[0].id, label, spend };
	return {
		name: "command", type: "select", label, spend,
		options: [{ value: "", label: "No" }, ...holders.map(h => ({ value: h.id, label: h.name }))],
	};
}

/**
 * The Marshal's We Happy Few 6- (Book I p.127): "you have disadvantage on all rolls until you share your
 * nagging doubts with someone else". A steading roll they are behind is one of those rolls, so their
 * shaken nerves are one more source of disadvantage, and cancel against Logistics' advantage like any other
 * pair. Asked on every move, because it is every roll: a tick naming the one shaken character (ticked when
 * it is the user's own, who is the one rolling), or a pick among several. The answer is their name.
 * Who is shaken is fight-states.js's (shakenNervesOffers); a window that knows its roller hands the
 * answer in itself (ownShakenName).
 */
export const NERVES = "nerves";

function nervesQuestion(shaken) {
	if (shaken.length === 1) {
		const [one] = shaken;
		return {
			name: NERVES, type: "checkbox", value: one.name, checked: !!one.own,
			label: format("stonetop.nerves.steadingAsk", { name: one.name, move: WE_HAPPY_FEW }),
		};
	}
	return {
		name: NERVES, type: "select",
		label: format("stonetop.nerves.steadingAskPick", { move: WE_HAPPY_FEW }),
		options: [{ value: "", label: "No" }, ...shaken.map(s => ({ value: s.name, label: s.name }))],
	};
}

/** The nerves as the card names them: whose, when the answer names someone. */
export function nervesSource(answer) {
	const name = typeof answer === "string" ? answer.trim() : "";
	return name
		? format("stonetop.nerves.steadingRollNote", { name, move: WE_HAPPY_FEW })
		: format("stonetop.nerves.rollNote", { move: WE_HAPPY_FEW });
}

/**
 * Pay for every answer the window took whose question costs something (a `spend` on its row: Stentorian's
 * Command), in question order, BEFORE the roll is adjusted. A spend hands back the answers to roll by, with its
 * own answer cleared when it could not be paid, so the roll gets no advantage it did not pay for; `refused`
 * says why, and is passed to `warn`.
 *
 * @param {Array<{name: string, spend?: (answers: object) => Promise<{answers: object, refused?: string}>}>} questions
 * @param {object} answers  the window's answers, by question name
 * @param {{warn?: (message: string) => void}} [deps]
 * @returns {Promise<object>} the answers to roll by
 */
export async function spendImprovementAnswers(questions, answers, { warn = msg => globalThis.ui?.notifications?.warn?.(msg) } = {}) {
	let out = answers;
	for (const q of questions ?? []) {
		if (!q?.spend || !out?.[q.name]) continue;
		const paid = await q.spend(out);
		out = paid.answers;
		if (paid.refused) warn(paid.refused);
	}
	return out;
}

/**
 * The questions a move's window asks because of what the steading has built, plus Deploy's own
 * "position of strength", which the move itself asks and Well-Trained Militia feeds.
 *
 * Only one wall is ever asked about: the Stone Wall erases the Palisade, and an erased improvement
 * is not in force (improvement-rules.js), so its question goes with it.
 *
 * @param {string} moveName  STEADING_MOVE
 * @param {string} statKey   the stat the move rolls
 * @param {object} o
 * @param {Array} o.rules  the improvements in force (improvement-rules.js#improvementRulesFrom)
 * @param {Array<{index: number, label: string}>} [o.tactics]  the militia's trained tactics
 * @param {string[]} [o.logistics]  the names of the characters with Logistics learned; any at all
 *   asks the Logistics line, ticked (`checked`), since the Marshal is usually the one behind it
 * @param {string[]} [o.pathfinder]  the names of the characters with Pathfinder learned; any at all
 *   asks the Pathfinder line, unticked, since beyond sight of home is the table's call
 * @param {{grown: number, total: number}} [o.herd]  the tracked herd, for Requisition's count
 * @param {Array<{id: string, name: string}>} [o.command]  the Marshals Deploy's Stentorian line may spend
 *   Command from (combat/command-holders.js#deployCommandOffers); one asks an unticked box naming them, several
 *   a pick defaulting to "No". The answer is the Marshal's id.
 * @param {Function} [o.spendCommand]  that question's `spend` (injectable for tests)
 * @param {Array<{name: string, own?: boolean}>} [o.nerves]  the characters whose nerves are shaken
 *   (fight-states.js#shakenNervesOffers); any at all asks the We Happy Few line, on every move
 * @returns {Array<{name: string, type: "checkbox"|"select", label: string, checked?: boolean, options?: Array<{value: string, label: string}>, spend?: Function}>}
 *   `spend`, on a question whose answer costs something, is run by spendImprovementAnswers.
 */
export function improvementQuestions(moveName, statKey, {
	rules = [], tactics = [], logistics = [], pathfinder = [], herd = null, command = [], spendCommand = spendStentorianCommand,
	nerves = [],
} = {}) {
	const has = rulesHas(rules);
	const asks = [];
	if (moveName === STEADING_MOVE.DEPLOY) {
		asks.push({
			name: "strength", type: "checkbox",
			label: "The steading is acting from a position of strength (the high ground, superior numbers, surprise, magic): you pick the 7-9 consequence",
		});
		if (has("wellTrainedMilitia") && tactics.length) {
			asks.push({
				name: "tactic", type: "select",
				label: "Using one of the militia's trained tactics (a position of strength)",
				options: [{ value: "", label: "No" }, ...tactics.map(t => ({ value: String(t.index), label: t.label }))],
			});
		}
	}
	// Asked advantages, unticked: the table says whether the fiction reached for it this time.
	for (const rule of advantagesFor(rules, moveName, { asked: true })) {
		asks.push({ name: advantageQuestionName(rule.slug), type: "checkbox", label: `${rule.grants.rollAdvantage.ask}: advantage` });
	}
	if (statKey === "defenses" && has("standingWatch")) {
		asks.push({ name: "watch", type: "checkbox", label: "The standing watch is involved: treat Defenses as 1 higher" });
	}
	if (moveName === STEADING_MOVE.PULL_TOGETHER && has("herdOfHorses")) {
		asks.push({ name: "herd", type: "checkbox", label: "Leveraging the herd of horses: it takes half as long and costs half as much" });
	}
	if (moveName === STEADING_MOVE.REQUISITION && has("herdOfHorses")) {
		// A NUMBER, not a tick: "half the herd or less" is arithmetic the window can do, and the
		// same count is how many horses the take then removes from the herd. 0 = not the herd.
		asks.push({
			name: "herdCount", type: "number", min: 0, value: 0,
			...(Number.isFinite(herd?.grown) ? { max: herd.grown } : {}),
			label: `Horses from the herd (0 if none)${Number.isFinite(herd?.total) ? `, of ${herd.total}` : ""}: half the herd or less turns a 6- into a 7-9`,
		});
	}
	if (LOGISTICS_MOVES.has(moveName) && logistics.length) {
		asks.push({ name: "logistics", type: "checkbox", checked: true, label: logisticsLabel(moveName, logistics) });
	}
	if (PATHFINDER_MOVES.has(moveName) && pathfinder.length) {
		asks.push({ name: "pathfinder", type: "checkbox", label: pathfinderLabel(pathfinder) });
	}
	if (moveName === STEADING_MOVE.DEPLOY && command.length) asks.push(commandQuestion(command, spendCommand));
	if (nerves.length) asks.push(nervesQuestion(nerves));
	return asks;
}

/**
 * What the steading's improvements, its debilities and the window's answers do to one roll.
 *
 * Advantage and disadvantage are collected as their SOURCES rather than settled as they are found,
 * because "if you have advantage and disadvantage on the same roll, they cancel each other out"
 * (Book I). A Township that is Diminished musters at a plain 2d6, not at disadvantage.
 *
 * @param {object} o
 * @param {string} o.moveName
 * @param {string} o.statKey
 * @param {Array}   o.rules         the improvements in force (improvement-rules.js#improvementRulesFrom)
 * @param {object}  [o.answers]     the window's answers, by question name
 * @param {Array<{index: number, label: string}>} [o.tactics]
 * @param {boolean} [o.diminished]  the steading has Diminished marked
 * @param {boolean} [o.winter]      Trade & Barter's "In winter, you have disadvantage"
 * @param {string}  [o.held]        what bought a held advantage on this roll (Rites of the Land)
 * @param {boolean} [o.torsBlessing] Tor's blessing holds this season: "+1 to Pull Together"
 * @param {string}  [o.size]        the steading's Size: hamlet, village, town or city
 * @param {number}  [o.herdTotal]   the Herd of Horses' size, for `answers.herdCount`
 * @returns {{adv: string[], dis: string[], statBonus: number, bonus: number, notes: string[], strength: boolean, missAsPartial: string}}
 *   `bonus` is a plus to the ROLL, where `statBonus` treats the stat itself as higher.
 */
export function rollAdjustments({
	moveName, statKey, rules = [], answers = {}, tactics = [], diminished = false, winter = false, held = "",
	torsBlessing = false, size = "", herdTotal = 0,
}) {
	const has = rulesHas(rules);
	const adv = [];
	const dis = [];
	const notes = [];
	let statBonus = 0;
	let bonus = 0;
	// The seasonal gain: "Fine weather abounds. Take +1 to Pull Together this season."
	if (moveName === STEADING_MOVE.PULL_TOGETHER && torsBlessing) {
		bonus += 1;
		notes.push("Tor's blessing: +1");
	}
	// Always-on advantage from an improvement in force (the Township's three moves), named by it.
	const always = advantagesFor(rules, moveName, { asked: false });
	for (const rule of always) adv.push(rule.label);
	// One advantage source for a big steading, so the card names it once: an improvement that
	// already gives it (the Township, which is what made the steading a town), the Size otherwise.
	// A hamlet's disadvantage is the Size's alone, and nets against an advantage like any other pair.
	if (SIZE_MOVES.has(moveName)) {
		if (!always.length && size === "town") adv.push("A town");
		else if (!always.length && size === "city") adv.push("A city");
		if (size === "hamlet") dis.push("A hamlet");
	}
	if (LOGISTICS_MOVES.has(moveName) && answers.logistics) adv.push(LOGISTICS);
	if (PATHFINDER_MOVES.has(moveName) && answers.pathfinder) adv.push(PATHFINDER);
	if (moveName === STEADING_MOVE.DEPLOY && answers.command) adv.push(STENTORIAN);
	for (const rule of advantagesFor(rules, moveName, { asked: true })) {
		if (answers[advantageQuestionName(rule.slug)]) adv.push(rule.label);
	}
	if (held) adv.push(held);
	if (diminished && DIMINISHED_MOVES.has(moveName)) dis.push("Diminished");
	if (winter && moveName === STEADING_MOVE.TRADE_BARTER) dis.push("Winter");
	// We Happy Few's 6-, on whoever is behind this roll: any move, the answer naming them.
	if (answers[NERVES]) dis.push(nervesSource(answers[NERVES]));
	if (statKey === "defenses" && has("standingWatch") && answers.watch) {
		statBonus += 1;
		notes.push("Standing watch: Defenses +1");
	}
	const tactic = tactics.find(t => String(t.index) === String(answers.tactic ?? ""));
	if (moveName === STEADING_MOVE.DEPLOY && tactic) notes.push(`Trained tactic: ${tactic.label.split(":")[0]}`);
	const strength = moveName === STEADING_MOVE.DEPLOY && (!!answers.strength || !!tactic);
	if (strength) notes.push("A position of strength");
	if (moveName === STEADING_MOVE.PULL_TOGETHER && has("herdOfHorses") && answers.herd) {
		notes.push("Herd of Horses: half the time, half the cost");
	}
	// The count when the window asked for one (herdShareMet); a bare tick from a caller that
	// settled it already.
	const herdCount = Number(answers.herdCount);
	const herdShare = Number.isFinite(herdCount) && answers.herdCount !== "" && answers.herdCount != null
		? herdShareMet(herdCount, herdTotal)
		: !!answers.herdShare;
	const missAsPartial = moveName === STEADING_MOVE.REQUISITION && has("herdOfHorses") && herdShare
		? "Half the herd or less: a 6- counts as a 7-9"
		: "";
	return { adv, dis, statBonus, bonus, notes, strength, missAsPartial };
}

/**
 * The mode a roll goes out at, from the mode the player chose and every rule's advantage and
 * disadvantage. The player's choice counts as one more source: a GM-granted advantage on a
 * Diminished muster cancels out like any other.
 *
 * @param {string}   chosen  "adv" | "dis" | "normal"
 * @param {string[]} adv
 * @param {string[]} dis
 * @returns {"adv"|"dis"|"normal"}
 */
export function netRollMode(chosen, adv = [], dis = []) {
	const up   = chosen === "adv" || adv.length > 0;
	const down = chosen === "dis" || dis.length > 0;
	if (up && down) return "normal";
	if (up) return "adv";
	if (down) return "dis";
	return "normal";
}

/**
 * The pills a roll card shows for where its advantage and disadvantage came from, and the notes
 * that change what a result means. Diminished is left out: the card already shows it as the
 * steading's debility.
 */
export function rollConditionNotes({ adv = [], dis = [], notes = [] }) {
	return [
		...adv.map(source => `${source}: advantage`),
		...dis.filter(source => source !== "Diminished").map(source => `${source}: disadvantage`),
		...notes,
	];
}
