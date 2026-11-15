// WHAT A HOMEBREW MOVE'S OWN WORDS SAY ABOUT IT: the stat it rolls and its 10+ / 7-9 / 6- results,
// and the track it holds or marks. One reading for both ways a move arrives: the PDF reader
// (pdf/read-playbook.js, with the pips printed beside the move) and a move typed into the Playbook
// Builder by hand, which has only its words. Pure: plain strings in, plain objects out.

import { parseTiersFromProse } from "../utils/move-tiers.js";
import { escapeRegExp, nounStem } from "../utils/strings.js";
import { truncateValue } from "../utils/ledger-core.js";

/** "Once per session, you can…": a thing done once a stretch of play. */
export const ONCE_PER = /\bonce (?:per|a|each) (session|day|adventure|expedition|season|fight)\b/i;

// A roll worded as part of ANOTHER move ("when you taste blood and Seek Insight you may roll +CON",
// Nightbreed) bends that move's roll; it is not a roll of this one.
const BENDS_ANOTHER = /\b(instead|seek insight|defy danger|clash|know things|persuade|let fly|defend|aid|interfere|forage|make camp|recover)\b/i;

/**
 * The roll and its results, as the sheet itself reads tiers out of a move's words (move-tiers.js),
 * "on a 7+" and all: `{rollType, results: {success, partial, failure}}`, rollType "" for none.
 * @param {string} words  the move's words, *emphasis* and all
 */
export function rollFromWords(words) {
	const plain = String(words ?? "").replace(/\*/g, "");
	const results = { success: "", partial: "", failure: "" };
	const tiers = parseTiersFromProse(plain);
	const rollAt = plain.match(/roll\s*\+\s*(STR|DEX|CON|INT|WIS|CHA)\b/i);
	const sentence = rollAt ? plain.slice(0, rollAt.index).split(/[.!?]\s/).pop() + rollAt[0] : "";
	const rollType = rollAt && (tiers || !BENDS_ANOTHER.test(sentence)) ? rollAt[1].toLowerCase() : "";
	if (rollType && tiers) for (const k of Object.keys(results)) results[k] = String(tiers[k]?.value ?? "").trim();
	// "…on a 6-, death has changed it, the GM will tell you how. Mark XP." A "Mark XP" opening the
	// sentence after the 6- is still the 6-'s (the book says it inside the clause): left out, the
	// sheet shows it under the trigger as if every roll marked XP.
	if (rollType && results.failure && !/\bmark\s+xp\b/i.test(results.failure)) {
		const miss = [...plain.matchAll(/\bon\s+a\s+6-/gi)].pop();
		const rest = miss ? plain.slice(miss.index) : "";
		const end = rest.search(/[.!?](?:\s|$)/);
		const tail = end >= 0 ? rest.slice(end + 1).trim().match(/^Mark\s+XP\b[^.!?]*[.!?]?/i)?.[0] : null;
		if (tail) results.failure = `${results.failure} ${tail.trim()}`;
	}
	return { rollType, results };
}

/** "Used this session" for a move done once a session (ONCE_PER), else "". */
export function onceTitle(words) {
	const m = String(words ?? "").replace(/\*/g, "").match(ONCE_PER);
	return m ? `Used this ${m[1].toLowerCase()}` : "";
}

/**
 * The currency a move holds ("hold 2 Authority", "hold 1 Reminder, or 2 Reminders"), and the most it
 * ever holds at once: `{title, max}`, or null when it holds nothing by name.
 */
export function heldFromWords(words) {
	const plain = String(words ?? "").replace(/\*/g, "");
	const title = plain.match(/\bhold\s+(?:\d+|one|two|three)\s+([A-Z][\w'’-]*)/)?.[1] ?? "";
	if (!title) return null;
	return { title, max: Math.max(1, ...heldCounts(title, plain)) };
}

/**
 * Every "<n> <Title>" count in `text`, singular or plural alike ("1 Reminder, or 2 Reminders"), kept
 * from 1 to 20: what a held currency's track has to have room for.
 */
export function heldCounts(title, text) {
	const pattern = new RegExp(`\\b(\\d+)\\s+${escapeRegExp(nounStem(title))}[sS]?\\b`, "g");
	return [...String(text ?? "").replace(/\*/g, "").matchAll(pattern)].map(m => Number(m[1])).filter(n => n > 0 && n <= 20);
}

/**
 * A move that learns ANOTHER playbook's move, as the book's Wild Soul does ("take a move from the
 * Ranger"): "Take a move from the Blessed for which you qualify" is `{playbooks: ["The Blessed"]}`,
 * "…from any other playbook" `{playbooks: "any"}`, the shape a move's `system.crossPlaybook` takes.
 * Null for anything else. A playbook the world doesn't have simply offers nothing to pick.
 */
export function crossPlaybookFrom(words) {
	const plain = String(words ?? "").replace(/\*/g, "");
	// The verb in either case; the playbook's name is found by its capitals, so no `i` flag below.
	const verb = String.raw`\b(?:[Tt]ake|[Cc]hoose|[Pp]ick|[Gg]ain|[Ll]earn)\s+(?:[Aa]|[Oo]ne)\s+(?:new\s+)?move\s+from\s+`;
	if (new RegExp(`${verb}any\\s+(?:other\\s+)?playbook\\b`, "i").test(plain)) return { playbooks: "any" };
	const m = plain.match(new RegExp(`${verb}(?:the\\s+)?([A-Z][\\w'’-]*(?:\\s+[A-Z][\\w'’-]*)*)`));
	if (!m) return null;
	const name = m[1].replace(/^The\s+/, "").trim();
	return name ? { playbooks: [`The ${name}`] } : null;
}

/**
 * The post-death inserts a background lets its character take after coming back from the Last Door on any
 * result: "When you visit the Last Door and return, you may adopt the Ghost or Revenant insert regardless
 * of the result" (the Stranger's Grave Tender) is `["ghost", "revenant"]`. [] for words that say no such thing.
 */
export function lastDoorInsertsFrom(words) {
	const plain = String(words ?? "").replace(/\*/g, "").replace(/\s+/g, " ");
	const m = plain.match(/\b(?:visit|reach|pass\s+through|face|stand\s+at)\s+the\s+Last\s+Door\b[^.]*?\b(?:adopt|take|gain|become)\s+(?:a|an|the)\s+((?:Ghost|Revenant|Thrall)(?:\s*(?:,|or|and|\/)\s*(?:a\s+|an\s+|the\s+)?(?:Ghost|Revenant|Thrall))*)\b/i);
	if (!m) return [];
	return [...new Set(m[1].match(/Ghost|Revenant|Thrall/gi).map(s => s.toLowerCase()))];
}

/**
 * A possession's use spent for a bigger hold on one move's roll: "Spend ☐ to hold +1 Fear when you roll
 * the Pariah move, even on a 6-" (the Stranger's Ephemera) is `{hold: 1, track: "Fear", move: "Pariah",
 * evenOnMiss: true}`. Null for words that say no such thing.
 */
export function possessionRollHoldFrom(words) {
	const plain = String(words ?? "").replace(/\*/g, "").replace(/\s+/g, " ");
	const m = plain.match(/\b[Ss]pend\s+(?:[☐○□◯]\s*|(?:a|1|one)\s+use\s+|it\s+)?to\s+hold\s+\+?(\d+)\s+([A-Z][\w'’-]*)\s+when\s+you\s+roll\s+(?:the\s+|your\s+)?([A-Z][\w'’-]*(?:\s+(?:[A-Z][\w'’-]*|of|the|a|and|to))*)(?:\s+move)?(?=[\s,.;]|$)/);
	if (!m) return null;
	const rest = plain.slice(m.index + m[0].length, m.index + m[0].length + 30);
	return { hold: Math.max(1, Number(m[1])), track: m[2], move: m[3].trim(), evenOnMiss: /^\s*,?\s*even\s+on\s+a\s+6-/i.test(rest) };
}

/**
 * The special possession a move's words hand over: "Mark the Poisons special possession" is "Poisons".
 * Null for none.
 */
export function possessionMarkedFrom(words) {
	const plain = String(words ?? "").replace(/\*/g, "").replace(/\s+/g, " ");
	return plain.match(/\b(?:mark|gain|take|add|get|receive)\s+(?:the|your|a|an)\s+([A-Za-z][\w'’ -]{1,40}?)\s+(?:special\s+)?possession\b/i)?.[1]?.trim() ?? null;
}

/**
 * Which of a playbook's possessions `name` means: its own label, or one whose label shares the word's
 * stem ("Poisons" is the "Poisoner's kit"). `options` are `{slug, label}`; null when none or several fit.
 */
export function possessionMatching(name, options) {
	const stem = w => w.toLowerCase().replace(/[’']s?$/, "").replace(/(?:ers?|s|ing)$/, "");
	const plainLabel = s => String(s ?? "").replace(/<[^>]+>/g, "").trim();
	const want = plainLabel(name).toLowerCase();
	if (!want) return null;
	const exact = (options ?? []).filter(o => plainLabel(o.label).toLowerCase() === want);
	if (exact.length === 1) return exact[0];
	const head = stem(want.split(/\s+/)[0]);
	if (head.length < 4) return null;
	const hits = (options ?? []).filter(o => plainLabel(o.label).toLowerCase().split(/[\s,]+/).some(w => {
		const s = stem(w);
		return s.length >= 4 && (s.startsWith(head) || head.startsWith(s));
	}));
	return hits.length === 1 ? hits[0] : null;
}

/**
 * What a move lets its character pay INSTEAD of Stock, for the Blessed's moves it brings in with no
 * sacred pouch to pay from (the Stranger's Witchcraft: "In place of Sacred Pouch uses you must mark a
 * debility, lose 5HP, or sacrifice an item of value 1 or more"). One row per way to pay, as
 * stock-cost.js#stockSources offers them: `{kind: "debility"}`, `{kind: "hp", amount}`, or `{kind:
 * "other", text}` for a price the table settles ("sacrifice an item of value 1 or more"). Null when
 * the words offer none.
 */
export function stockStandInsFrom(words) {
	const plain = String(words ?? "").replace(/\*/g, "").replace(/\s+/g, " ");
	const m = plain.match(/\bin\s+(?:place|lieu)\s+of\s+(?:(?:your\s+|the\s+)?sacred\s+pouch(?:\s+uses)?|(?:spending\s+)?Stock)\b,?\s+you\s+(?:must|may|can|instead)\s+([^.;]+)/i);
	if (!m) return null;
	// "mark a debility, lose 5HP, or sacrifice an item of value 1 or more": the commas part the ways to
	// pay. Only a list without one is parted at its "or" ("lose 5 HP or mark a debility"), since a way
	// to pay may say "or" itself ("of value 1 or more").
	let parts = m[1].split(/\s*,\s*/).map(p => p.replace(/^(?:or|and)\s+/i, "").trim()).filter(Boolean);
	if (parts.length === 1) parts = parts[0].split(/\s+or\s+/i).map(p => p.trim()).filter(Boolean);
	const out = parts.map(p => {
		if (/^mark\s+(?:a|one)\s+debility\b/i.test(p)) return { kind: "debility" };
		const hp = p.match(/^(?:lose|take|suffer)\s+(\d+)\s*HP\b/i);
		if (hp) return { kind: "hp", amount: Math.max(1, Number(hp[1])) };
		return { kind: "other", text: p };
	});
	return out.length ? out : null;
}

// The book's basic and expedition moves a homebrew move can bend, as the sheet names them. `lower`: also
// found written in lower case ("when you forage in ruins"), for the names no ordinary sentence uses
// otherwise; "aid", "defend", "recover" and "outfit" are ordinary words, so only their capitals count.
const BENDABLE_MOVES = Object.freeze([
	{ name: "Defy Danger", lower: true }, { name: "Seek Insight", lower: true }, { name: "Know Things", lower: true },
	{ name: "Let Fly", lower: true }, { name: "Persuade", lower: true }, { name: "Clash", lower: true },
	{ name: "Forage", lower: true }, { name: "Make Camp", lower: true }, { name: "Chart a Course", lower: true },
	{ name: "Have What You Need", lower: true }, { name: "Keep Company", lower: true }, { name: "Struggle as One", lower: true },
	{ name: "Interfere", lower: false }, { name: "Defend", lower: false }, { name: "Aid", lower: false },
	{ name: "Recover", lower: false }, { name: "Outfit", lower: false },
]);
const STAT = "(STR|DEX|CON|INT|WIS|CHA)";
const NAME = "([A-Z][\\w'’-]*)";

// What a roll "to do" something is, by the book's moves: "you make any rolls to hide, hunt prey, or
// traverse terrain with advantage" (Night Crawler) is Defy Danger and Forage, not every roll there is.
const ACTIVITY_MOVES = Object.freeze([
	[/\b(?:hide|hiding|sneak|sneaking|stay\s+hidden|go\s+unseen|climb|climbing|traverse|traversing|cross|balance|escape|evade|dodge)\b/i, "Defy Danger"],
	[/\b(?:hunt|hunting|forage|foraging|gather|gathering|track\s+(?:prey|game|animals))\b/i, "Forage"],
	[/\b(?:navigate|navigating|find\s+(?:your|the)\s+way|lead\s+the\s+way)\b/i, "Chart a Course"],
	[/\b(?:notice|spot|search|perceive|sense)\b/i, "Seek Insight"],
	[/\b(?:recall|remember|identify)\b/i, "Know Things"],
]);

/** The book moves a "rolls to <do something>" clause means (ACTIVITY_MOVES), in the order first named; [] for none. */
export function movesForActivities(sentence) {
	const clause = String(sentence ?? "").match(/\brolls?\s+(?:made\s+)?to\s+([^.;]+)/i)?.[1];
	if (!clause) return [];
	const out = [];
	for (const [re, move] of ACTIVITY_MOVES) if (re.test(clause) && !out.includes(move)) out.push(move);
	return out;
}

/**
 * How a homebrew move (or background) changes OTHER rolls, read sentence by sentence from its words, as
 * the book's moves do through the roll window's lines (StonetopCharacter FICTION_ROLL_OFFERS) and the stat
 * picker (data/alt-stat-grants.js):
 *   "When you Seek Insight within a dream, you may roll with +CHA instead of +WIS"  {kind: "stat", stat: "cha"}
 *   "When you Know Things you have advantage so long as it deals with death"       {kind: "advantage"}
 *   "While doing something well-practiced, treat a 6- as a 7-9"                    {kind: "missAsPartial"}
 *   "…treat a 7-9 as a 10+"                                                        {kind: "partialAsSuccess"}
 *   "for any moves you make in the attempt, roll +3 instead of rolling as normal"  {kind: "statValue", value: 3}
 *   "you may add +1 to any roll and mark Doom"                                     {kind: "modifier", value: 1}
 * Each `{kind, moves, stat?, value?, spends?, marks?, whileHolding?, text}`: `moves` the book moves it
 * names (null: any move roll), `spends`/`marks` a track it costs ("spend Memory", "mark Doom"),
 * `whileHolding` a track that must hold something ("so long as you hold Fear"), `text` its sentence.
 * A sentence giving the move's OWN roll ("roll +CHA: on a 10+…", or "When you Aid a monster, roll +CHA."
 * with its tiers in the next sentence) is not a bend; a stat swap must name the move it swaps for. Pure.
 */
export function rollBendsFrom(words) {
	const plain = String(words ?? "").replace(/\*/g, "").replace(/\s+/g, " ").trim();
	const sentences = plain.split(/(?<=[.!?])\s+(?=[A-Z(])/);
	const out = [];
	const tiers = /\bon a (?:10\+|7-9|7\+|6-)/i;
	const ownRoll = new RegExp(`\\broll\\s+\\+\\s*${STAT}\\b`, "i");
	for (const [i, raw] of sentences.entries()) {
		const s = raw.trim();
		if (!s || tiers.test(s)) continue;
		// The move's own roll with its tiers in the sentence after: "…, roll +CHA." then "On a 10+, …".
		// A swap says what it replaces ("instead"), so one that does is still read.
		if (/^on a /i.test(sentences[i + 1]?.trim() ?? "") && tiers.test(sentences[i + 1]) && ownRoll.test(s) && !/\binstead\b/i.test(s)) continue;
		const named = BENDABLE_MOVES.filter(m => new RegExp(`\\b${m.name.replace(/ /g, "\\s+")}\\b`, m.lower ? "i" : "").test(s)).map(m => m.name);
		// No move named, but what the rolls are for is ("rolls to hide, hunt prey…"): those moves.
		const moves = named.length ? named : movesForActivities(s);
		const anyRoll = /\bany\s+(?:of\s+your\s+)?(?:rolls?|moves?)\b|\brolls?\b/i.test(s);
		const kinds = [];
		let m;
		if ((m = s.match(/\broll\s+\+\s*(\d)\s+instead\b/i))) kinds.push({ kind: "statValue", value: Number(m[1]) });
		else if (moves.length && (m = s.match(new RegExp(`(?:\\broll(?:s|ing)?\\s+(?:with\\s+)?|\\bwith\\s+)\\+\\s*${STAT}\\b`, "i")))) kinds.push({ kind: "stat", stat: m[1].toLowerCase() });
		if (/\btreat\s+(?:a|any|that|the)\s+(?:roll\s+of\s+)?6-?\s+as\s+(?:a\s+)?7-9\b/i.test(s)) kinds.push({ kind: "missAsPartial" });
		if (/\btreat\s+(?:a|any|that|the)\s+7-9\s+as\s+(?:a\s+)?10\+/i.test(s)) kinds.push({ kind: "partialAsSuccess" });
		if (/\b(?:with|have|gain|get|has|at)\s+advantage\b/i.test(s)) kinds.push({ kind: "advantage" });
		if ((m = s.match(/\b(?:add\s+)?\+(\d)\s+to\s+(?:any|all|every)\s+rolls?\b/i))) kinds.push({ kind: "modifier", value: Number(m[1]) });
		// "Treat a 6- as a 7-9", "+1 to any roll", "roll +3 instead" can only be about a roll, said or not.
		const aboutRolls = anyRoll || kinds.some(k => k.kind !== "advantage");
		if (!kinds.length || (!moves.length && !aboutRolls)) continue;
		// The verbs in either case (a sentence may open with one); the track by its capital.
		const spends = s.match(new RegExp(`\\b[Ss]pend\\s+(?:1\\s+|one\\s+)?${NAME}`))?.[1] ?? null;
		const marks = s.match(new RegExp(`\\b[Mm]ark\\s+(?!XP\\b)${NAME}`))?.[1] ?? null;
		const whileHolding = s.match(new RegExp(`\\b(?:[Ss]o\\s+long\\s+as|[Aa]s\\s+long\\s+as|[Ww]hile)\\s+you\\s+hold\\s+(?:any\\s+)?${NAME}`))?.[1] ?? null;
		// "When you reveal your darkest self and transform you may add +1…": only in a form put on.
		const whileTransformed = /\b(?:and|you)\s+transform\b|\bwhile\s+(?:you(?:'re|’re|\s+are)\s+)?(?:transformed|in\s+(?:your\s+)?(?:monstrous|monster|second|other|true)\s+form)\b/i.test(s);
		for (const k of kinds) {
			out.push({
				...k, moves: moves.length ? moves : null,
				...(spends ? { spends } : {}), ...(marks ? { marks } : {}), ...(whileHolding ? { whileHolding } : {}),
				...(whileTransformed ? { whileTransformed: true } : {}),
				// At most 220 characters, the ellipsis included.
				text: truncateValue(s, 219),
			});
		}
	}
	return out;
}

/**
 * What a track's words say happens when it fills: "At 3 Doom, the GM advances a dark plot relating to your
 * cursed lineage and resets the Doom track" is `{at: 3, resets: true, text}` for the label "Doom", `text`
 * the sentence. Null when the words say nothing of it.
 */
export function trackFillFrom(words, label) {
	const name = escapeRegExp(String(label ?? "").trim());
	if (!name) return null;
	const plain = String(words ?? "").replace(/\*/g, "").replace(/\s+/g, " ");
	const m = plain.match(new RegExp(String.raw`\b(?:at|on|when\s+you\s+(?:reach|mark|hit|have))\s+(\d+)\s+${name}\b[^.!?]*[.!?]`, "i"));
	if (!m) return null;
	const resets = new RegExp(String.raw`\b(?:resets?|clears?|erases?|empt(?:y|ies))\s+(?:the\s+|your\s+)?${name}\b`, "i").test(m[0]);
	return { at: Math.max(1, Number(m[1])), resets, text: m[0].trim() };
}

/**
 * A roll printed inside a background's words: the paragraph that has a ***trigger***, a "roll +STAT"
 * of its own and tiers ("When you ***whisper the name…***, roll +CHA: on a 10+, …; on a 7-9, …"), with
 * the paragraphs before and after it, as `{paragraph, before, after}`; null when there is none. A
 * background that only says a move is given ("Gain the Child of the Night move") has no roll of its own.
 */
export function backgroundRollFrom(words) {
	const paragraphs = String(words ?? "").split(/\n{2,}/);
	const at = paragraphs.findIndex(p => /\*\*\*[^*]+\*\*\*/.test(p) && rollFromWords(p).rollType && /\bon a (?:10\+|7-9|7\+)/i.test(p.replace(/\*/g, "")));
	if (at < 0) return null;
	// From the sentence its trigger opens: "Gain the Child of the Night move… They start with loyalty 2."
	// before it in the same paragraph is still the background's.
	const p = paragraphs[at];
	const head = p.slice(0, p.indexOf("***"));
	const cut = head.match(/^[\s\S]*[.!?]["'”’)]?\s+/)?.[0].length ?? 0;
	return {
		paragraph: p.slice(cut).trim(),
		before: [...paragraphs.slice(0, at), p.slice(0, cut)].map(x => x.trim()).filter(Boolean).join("\n\n"),
		after: paragraphs.slice(at + 1).join("\n\n").trim(),
	};
}

/**
 * "Draw three random Minor Arcana and choose one; you have unlocked its secrets" (the Familiar Face's
 * Occult Interest): `{count: 3}`, the cards to draw, of which one is kept, unlocked, as the Seeker's
 * mastered card is. Null for words that draw none.
 */
export function occultDrawFrom(words) {
	const plain = String(words ?? "").replace(/\*/g, "").replace(/\s+/g, " ");
	const m = plain.match(/\bdraw\s+(two|three|four|five|2|3|4|5)\s+(?:random\s+)?minor\s+arcana\b[^.]*?\b(?:choose|pick|keep)\s+(?:one|1)\b/i);
	if (!m) return null;
	const n = { two: 2, three: 3, four: 4, five: 5 }[m[1].toLowerCase()] ?? Number(m[1]);
	return { count: n };
}

/**
 * A follower a background's words give: "work with the GM to create a monstrous follower. They start
 * with loyalty 2." is `{kind: "monstrous follower", loyalty: 2}` (loyalty null when unsaid). Null when
 * the words give none.
 */
export function backgroundFollowerFrom(words) {
	const plain = String(words ?? "").replace(/\*/g, "").replace(/\s+/g, " ");
	const m = plain.match(/\bcreate\s+(?:a|an|your)\s+((?:[\w'’-]+\s+){0,3}?)follower\b/i);
	if (!m) return null;
	const loyalty = plain.match(/\bloyalty\s+(?:of\s+)?(\d)\b|\b(\d)\s+loyalty\b/i);
	const kind = `${m[1].trim()} follower`.trim();
	return { kind, loyalty: loyalty ? Math.min(3, Number(loyalty[1] ?? loyalty[2])) : null };
}

/**
 * What a homebrew move's words add to the damage a character deals, for the damage window's lines:
 * "increase all damage dice by one size" (Deadly) is `{dieStep: 1}`, "you deal +1d4 damage" is
 * `{dice: "1d4"}`, "+2 damage" `{dice: "2"}`. Null for neither. Always a choice in the window: when it
 * applies ("with the intent to kill") is the table's to say.
 */
export function damageFromWords(words) {
	const plain = String(words ?? "").replace(/\*/g, "").replace(/\s+/g, " ");
	const step = plain.match(/\b(?:increase|raise|step\s+up)\s+(?:all\s+|each\s+of\s+)?(?:your\s+|its\s+|the\s+)?damage\s+(?:dice|die)\s+(?:by\s+)?(one|two|1|2)\s+sizes?\b/i);
	if (step) return { dieStep: /two|2/i.test(step[1]) ? 2 : 1 };
	const dice = plain.match(/\b(?:deal|do|deals|does)\s+\+\s*(\d*d\d+|\d+)\s+(?:extra\s+|more\s+)?damage\b/i);
	return dice ? { dice: dice[1] } : null;
}

/**
 * The armor a homebrew move's words add: "Also gain +1 Armor when you go unarmored" (Formless) is
 * `{unarmored: 1}`, counted only while the character wears no armor; a flat "gain +1 armor" with no
 * condition after it is `{armor: 1}`. Null for neither. A move that says when ("while touching the
 * earth") other than unarmored is the table's to apply, so it is not read.
 */
export function armorFromWords(words) {
	const plain = String(words ?? "").replace(/\*/g, "").replace(/\s+/g, " ");
	let m = plain.match(/\+\s*(\d)\s+armou?r\b[^.]*?\b(?:when|while|if)\s+(?:you\s+(?:go|are|fight|stay)\s+|you're\s+)?unarmou?red\b/i)
		?? plain.match(/\b(?:when|while|if)\s+(?:you\s+(?:go|are|fight|stay)\s+|you're\s+)?unarmou?red\b[^.]*?\+\s*(\d)\s+armou?r\b/i);
	if (m) return { unarmored: Math.min(5, Number(m[1])) };
	m = plain.match(/\b(?:gain|get|have|take)\s+\+\s*(\d)\s+armou?r\b(?![^.]*\b(?:when|while|if|against|vs\.?|until|so long as)\b)/i);
	return m ? { armor: Math.min(5, Number(m[1])) } : null;
}

/**
 * The track a move's words ask for, with no pips printed beside it (a move typed by hand): what it
 * holds by name, else a box to mark a once-a-session use. `{max, title, labels: []}` or null.
 */
export function trackFromWords(words) {
	const held = heldFromWords(words);
	if (held) return { max: held.max, title: held.title, labels: [] };
	const once = onceTitle(words);
	return once ? { max: 1, title: once, labels: [] } : null;
}

/**
 * Whether a background's words give an insert's moves in the character's own shape, not only while its
 * form is worn ("access to your monster moves in your human guise", the Stranger's Cursed).
 */
export function insertMovesInHumanGuise(words) {
	return /\b(?:in|with)\s+your\s+human\s+(?:guise|form|shape)\b/i.test(String(words ?? ""));
}
