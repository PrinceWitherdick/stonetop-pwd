// A HOMEBREW PLAYBOOK BUNDLE: one playbook and its moves as one plain object, in the text a GM
// would type. It is the one shape everything about homebrew playbooks passes through:
//   - the Playbook Builder edits a bundle in memory (PlaybookBuilderDialog);
//   - a JSON export IS a bundle, and an import is read back through normalizeBundle;
//   - the PDF reader's whole job is to produce a draft bundle (playbooks/pdf/read-playbook.js).
// bundleToItemData turns it into the world Items the system reads (playbook-catalog.js), and
// itemsToBundle turns those Items back into a bundle.
//
// PURE: no Foundry calls. Every string that lands in a field drawn raw goes through
// playbook-text.js first, so a shared file can never carry live markup into a player's browser.

import { formatPlaybookText, formatPlaybookInline, playbookTextFromHtml, plainLine } from "./playbook-text.js";
import { CUSTOM_MOVE_ROLL_TYPES } from "../utils/roll-types.js";
import { buildMoveTierResults } from "../utils/move-results.js";
import { clampInt } from "../utils/custom-move-data.js";
import { slugify, looseName, clipText } from "../utils/strings.js";
import { SYSTEM_ID, ITEM_FLAG_SCOPE } from "../system-id.js";
import { HOMEBREW_MOVE_FLAG, HOMEBREW_INSERT_FLAG, HOMEBREW_SLUG_PREFIX } from "./playbook-catalog.js";

export const BUNDLE_FORMAT  = "stonetop-homebrew-playbook";
export const BUNDLE_VERSION = 1;

export const DAMAGE_DICE = Object.freeze(["d4", "d6", "d8", "d10", "d12"]);
/** The HP a playbook may be saved with; outside the usual range it is flagged, never refused. */
export const HP_LIMITS = Object.freeze({ min: 1, max: 40, usualMin: 10, usualMax: 24 });
export const MAX_MOVES = 120;

const MAX = { name: 80, line: 200, text: 6000, list: 60 };

const str  = (v, max = MAX.line) => clipText(String(v ?? "").trim(), max);
const text = v => clipText(String(v ?? "").replace(/\r\n?/g, "\n").trim(), MAX.text);
const list = (v, max = MAX.list) => Array.isArray(v) ? v.slice(0, max) : [];
const names = v => [...new Set(list(v).map(n => str(n, MAX.name)).filter(Boolean))];

/** An empty bundle, the builder's starting point. */
export function emptyBundle() {
	return {
		format: BUNDLE_FORMAT,
		version: BUNDLE_VERSION,
		playbook: {
			name: "", slug: "", img: "", published: false, author: "",
			summary: "", complexity: "", description: "", notes: "",
			statsNote: "Assign these scores to your stats: +2, +1, +1, +0, +0, -1",
			hp: 16, damage: "d6",
			instinctLabel: "Instinct",
			backgrounds: [], instincts: [], appearance: [], origin: [],
			possessions: { pickCount: 2, pickNote: "Pick 2", options: [] },
			startingMovesNote: "", moveChoices: [], moveGroups: [],
			lore: [],
			introductions: { step3: "", step4: [], step6: [] },
			inserts: [],
		},
		moves: [],
	};
}

/** How many inserts, lists per insert and options per list a playbook may carry. */
export const INSERT_LIMITS = Object.freeze({ inserts: 4, lists: 12, options: 60 });
/** What an insert list holds: options a player ticks, or the insert's own moves to pick from. */
export const INSERT_LIST_KINDS = Object.freeze(["pick", "moves"]);

/**
 * A write-in among options to tick ("☐ ____" under a list, "Something else") is one more option to
 * tick, with a blank to fill: "Something else: ___", the house shape (the Fox's "…running for your
 * life from ___"), which character creation and the sheet draw as a tick with a box in it. Left a
 * write-in of its own, it made the whole list a set of questions to TYPE into, and character
 * creation wouldn't go on until it was typed in, while drawing nowhere to type. A list of nothing
 * but write-ins stays as it is: those are questions to answer in words.
 */
export function writeInsAsBlanks(options) {
	if (!options.some(o => !o.freeText)) return options;
	return options.map(o => (o.freeText ? { ...o, description: blankWriteIn(o.description), freeText: false, ...("preselected" in o ? { preselected: false } : {}) } : o));
}

/**
 * The write-ins a save turns into ticks (writeInsAsBlanks), read off a playbook Item's flags as they
 * were (`before`) and as the save writes them (`after`). A playbook saved before write-ins became
 * ticks holds them as write-ins, and a character may have typed an answer into one: `from` is the
 * key their words sit under, `to` the tick that keeps them now (a lore section's options are slugged
 * by place, so the two match; an insert list's by their words, so the tick's slug is a new one).
 * `store` names the character's answer store: "lore" for the questions, "insertLore" for inserts.
 * @returns {{moves: Array<{store: string, from: string, to: string}>, labels: string[]}}
 */
export function writeInsTurnedToTicks(before, after) {
	const out = { moves: [], labels: [] };
	const pair = (was, now, slug, store) => {
		const old = was?.options ?? [];
		const next = now?.options ?? [];
		// writeInsAsBlanks keeps every option in its place, so a list of another length was edited too.
		if (old.length !== next.length) return;
		old.forEach((o, j) => {
			const n = next[j];
			if (o?.type !== "text" || !n || n.type === "text") return;
			out.moves.push({ store, from: `${slug}:${o.slug}`, to: `${slug}:${n.slug}` });
			out.labels.push(playbookTextFromHtml(n.description ?? ""));
		});
	};
	for (const s of before?.lore ?? []) {
		const now = (after?.lore ?? []).find(x => x.slug === s.slug);
		if (now) pair(s, now, s.slug, "lore");
	}
	for (const ins of before?.inserts ?? []) {
		const insNow = (after?.inserts ?? []).find(x => x.key === ins.key);
		for (const l of ins.lists ?? []) {
			const now = insNow?.lists?.find(x => x.key === l.key);
			const slug = l.slug || `${ins.key}-${l.key}`;
			if (now && (now.slug || `${insNow.key}-${now.key}`) === slug) pair(l, now, slug, "insertLore");
		}
	}
	return out;
}

/** "Something else" → "Something else: ___"; "To devour: something else" → "To devour: ___"; a blank kept. */
export function blankWriteIn(description) {
	const d = String(description ?? "").replace(/\s*\(write in\)\s*$/i, "").trim();
	if (/_{3,}/.test(d)) return d;
	const stem = d.replace(/\b(?:something else|your answer|write (?:it )?in)\s*$/i, "").trim();
	if (!stem) return "Something else: ___";
	return `${stem}${/[:…?]$/.test(stem) ? "" : ":"} ___`;
}

/** Unique slugs for `wanted` keys, minting from `names` when a key is missing or taken. */
function _uniqueKeys(wanted, names, fallback) {
	const used = new Set();
	return wanted.map((k, i) => {
		const base = slugify(k) || slugify(names[i]) || `${fallback}-${i + 1}`;
		let key = base;
		for (let n = 2; used.has(key); n++) key = `${base}-${n}`;
		used.add(key);
		return key;
	});
}

/**
 * A playbook's INSERTS (the Stranger's Monster Compendium): a page of its own that a move unlocks
 * (Otherkin), holding lists a player ticks (Traits, Armament, Bane) and moves of its own to pick
 * from (Monster Moves), and optionally a FORM the character transforms into. The insert's moves are
 * ordinary bundle moves carrying `insert` (this key) and `insertList` (a "moves" list's key); a
 * `starting` one is always held while the insert is unlocked (Metamorphosis).
 *
 * `key`s are minted once and kept: a character's ticks are stored under them. An empty insert (no
 * name, no lists) is dropped, unless a move is part of it (`movedInto`, the raw moves' insert keys):
 * dropped, those moves would quietly become the playbook's own, offered at Level Up.
 */
function _normalizeInserts(raw, check, movedInto = new Set()) {
	const items = list(raw, INSERT_LIMITS.inserts).filter(i => i && typeof i === "object");
	if (Array.isArray(raw) && raw.length > INSERT_LIMITS.inserts) check(`Only the first ${INSERT_LIMITS.inserts} inserts were kept.`);
	const inserts = items.map(i => {
		const lists = list(i.lists, INSERT_LIMITS.lists).filter(l => l && typeof l === "object").map(l => {
			const kind = INSERT_LIST_KINDS.includes(l.kind) ? l.kind : "pick";
			const pick = clampInt(l.pick, 0, 20, 1);
			return {
				key: String(l.key ?? ""),
				title: str(l.title, 120),
				prompt: text(l.prompt),
				kind,
				pick,
				min: Math.min(clampInt(l.min, 0, 20, 0), pick),
				// Extra picks for each copy of the unlocking move after the first ("each time you select
				// this move, choose a new monster move").
				perUnlock: clampInt(l.perUnlock, 0, 5, 0),
				// Extra picks a learned move gives ("choose 2 additional monstrous armaments").
				bonusPicks: list(l.bonusPicks, 10)
					.map(b => ({ move: str(b?.move, MAX.name), count: clampInt(b?.count, 1, 10, 1) }))
					.filter(b => b.move),
				options: kind === "moves" ? [] : writeInsAsBlanks(list(l.options, INSERT_LIMITS.options).map(o => ({
					description: str(o?.description, 400),
					max: clampInt(o?.max, 1, 9, 1),
					freeText: !!o?.freeText,
					preselected: !!o?.preselected && !o?.freeText,
				})).filter(o => o.description)),
			};
		});
		const listKeys = _uniqueKeys(lists.map(l => l.key), lists.map(l => l.title), "list");
		lists.forEach((l, j) => { l.key = listKeys[j]; });
		const form = i.form && typeof i.form === "object" ? i.form : {};
		return {
			key: String(i.key ?? ""),
			name: str(i.name, MAX.name),
			description: text(i.description),
			unlockedBy: str(i.unlockedBy, MAX.name),
			form: {
				enabled: !!form.enabled,
				on: plainLine(form.on, 30) || "Transform",
				off: plainLine(form.off, 30) || "Revert",
			},
			lists,
		};
	}).filter(i => i.name || i.lists.length || (i.key && movedInto.has(i.key)));
	const keys = _uniqueKeys(inserts.map(i => i.key), inserts.map(i => i.name), "insert");
	inserts.forEach((ins, i) => {
		ins.key = keys[i];
		if (!ins.name) { ins.name = "Insert"; check("An insert had no name, so it is called \"Insert\"."); }
	});
	return inserts;
}

/**
 * Read any object claiming to be a bundle (a JSON file, the PDF reader's draft, the builder's
 * state) into a clean one. Never throws.
 *
 * @returns {{bundle: object|null, issues: Array<{severity: "error"|"check", message: string}>}}
 *          `bundle` is null only when the object is not a bundle at all (wrong format, a newer
 *          version this system cannot read); everything else is repaired and reported.
 */
export function normalizeBundle(raw) {
	const issues = [];
	const check = message => issues.push({ severity: "check", message });
	if (!raw || typeof raw !== "object") {
		return { bundle: null, issues: [{ severity: "error", message: "That file is not a Stonetop homebrew playbook." }] };
	}
	if (raw.format !== BUNDLE_FORMAT) {
		return { bundle: null, issues: [{ severity: "error", message: "That file is not a Stonetop homebrew playbook (it has no \"stonetop-homebrew-playbook\" format mark)." }] };
	}
	const version = Number(raw.version);
	if (!Number.isFinite(version) || version > BUNDLE_VERSION) {
		return { bundle: null, issues: [{ severity: "error", message: "That playbook was saved by a newer version of the Stonetop system. Update the system, then import it again." }] };
	}

	const p = raw.playbook && typeof raw.playbook === "object" ? raw.playbook : {};
	const out = emptyBundle();
	const pb = out.playbook;

	pb.name = str(p.name, MAX.name);
	if (!pb.name) check("The playbook has no name yet.");
	pb.slug = String(p.slug ?? "").startsWith(HOMEBREW_SLUG_PREFIX) ? slugify(p.slug) : "";
	pb.img = /^[\w./%:-]+\.(webp|png|jpe?g|svg|gif|avif)$/i.test(String(p.img ?? "")) ? String(p.img) : "";
	pb.published = !!p.published;
	pb.summary = str(p.summary, 400);
	pb.author = str(p.author, 80);
	pb.complexity = str(p.complexity, 40);
	pb.description = text(p.description);
	pb.notes = text(p.notes);
	pb.statsNote = str(p.statsNote, 300) || pb.statsNote;

	const hp = Math.trunc(Number(p.hp));
	if (!Number.isFinite(hp) || hp < HP_LIMITS.min) {
		check(`Max HP was missing or unreadable, so it is set to ${pb.hp}.`);
	} else {
		pb.hp = Math.min(hp, HP_LIMITS.max);
		if (hp > HP_LIMITS.max) check(`Max HP ${hp} is more than ${HP_LIMITS.max}, so it is set to ${HP_LIMITS.max}. Check the playbook.`);
		else if (hp < HP_LIMITS.usualMin || hp > HP_LIMITS.usualMax) check(`Max HP ${hp} is unusual for a playbook (most are ${HP_LIMITS.usualMin}-${HP_LIMITS.usualMax}). Check it.`);
	}
	const damage = String(p.damage ?? "").trim().toLowerCase();
	if (DAMAGE_DICE.includes(damage)) pb.damage = damage;
	else check(`Damage "${str(p.damage, 10) || "(none)"}" is not a die from d4 to d12, so it is set to ${pb.damage}.`);

	pb.instinctLabel = /^drive$/i.test(String(p.instinctLabel ?? "").trim()) ? "Drive" : "Instinct";

	pb.backgrounds = list(p.backgrounds).map(b => ({
		label: str(b?.label, MAX.name),
		description: text(b?.description),
		moves: names(b?.moves),
		moveChoice: names(b?.moveChoice),
		// Special possessions this background gives on top of the pick ("You get Weapons of War as
		// a special possession"), by name; matched to this playbook's own when Items are written.
		possessions: names(b?.possessions),
		// A track of its own (the Cursed's Doom ○○○).
		track: b?.track && clampInt(b.track.max, 0, 20, 0) > 0 ? { label: str(b.track.label, 40) || "Track", max: clampInt(b.track.max, 1, 20, 1) } : null,
	})).filter(b => b.label || b.description);

	pb.instincts = list(p.instincts).map(i => ({
		word: plainLine(i?.word, 40),
		description: plainLine(i?.description),
	})).filter(i => i.word);

	pb.appearance = list(p.appearance, 12)
		.map(line => list(line, 12).map(o => plainLine(o, 60)).filter(Boolean))
		.filter(line => line.length);

	pb.origin = list(p.origin, 20).map(o => ({
		region: plainLine(o?.region, 80),
		names: list(o?.names, 30).map(n => plainLine(n, 40)).filter(Boolean),
	})).filter(o => o.region);

	const poss = p.possessions && typeof p.possessions === "object" ? p.possessions : {};
	pb.possessions = {
		pickCount: clampInt(poss.pickCount, 0, 10, 2),
		pickNote: str(poss.pickNote, 200),
		options: list(poss.options).map(o => ({
			label: str(o?.label, MAX.name),
			description: text(o?.description),
			preselected: !!o?.preselected,
		})).filter(o => o.label),
	};
	if (!pb.possessions.pickNote) pb.possessions.pickNote = `Pick ${pb.possessions.pickCount}`;

	pb.startingMovesNote = str(p.startingMovesNote, 400);
	pb.moveChoices = list(p.moveChoices, 10).map(c => ({
		label: str(c?.label, 60) || "Choose one",
		options: names(c?.options),
	})).filter(c => c.options.length >= 2);
	pb.moveGroups = list(p.moveGroups, 12).map(g => ({
		label: str(g?.label, 60),
		moves: names(g?.moves),
	})).filter(g => g.label && g.moves.length);

	pb.lore = list(p.lore, 30).map(s => ({
		title: str(s?.title, 120),
		description: text(s?.description),
		options: writeInsAsBlanks(list(s?.options).map(o => ({
			description: str(o?.description, 400),
			max: clampInt(o?.max, 1, 9, 1),
			freeText: !!o?.freeText,
		})).filter(o => o.description)),
	})).filter(s => s.title || s.description || s.options.length);

	const intro = p.introductions && typeof p.introductions === "object" ? p.introductions : {};
	pb.introductions = {
		step3: str(intro.step3, 400),
		step4: list(intro.step4, 8).map(q => plainLine(q, 200)).filter(Boolean),
		step6: list(intro.step6, 8).map(q => plainLine(q, 200)).filter(Boolean),
	};

	pb.inserts = _normalizeInserts(p.inserts, check, new Set(list(raw.moves, MAX_MOVES).map(m => String(m?.insert ?? "")).filter(Boolean)));

	// Moves: names must be unique, because a character's moves, the either/or groups and every
	// requirement name them.
	const seen = new Set();
	for (const m of list(raw.moves, MAX_MOVES)) {
		const move = normalizeMove(m);
		if (!move.name) { check("A move with no name was left out."); continue; }
		const key = move.name.toLowerCase();
		if (seen.has(key)) { check(`Two moves are called "${move.name}"; only the first was kept.`); continue; }
		seen.add(key);
		out.moves.push(move);
	}
	if (Array.isArray(raw.moves) && raw.moves.length > MAX_MOVES) check(`Only the first ${MAX_MOVES} moves were kept.`);

	// Every reference to one of this playbook's own moves takes that move's exact spelling, so the
	// paths that match a move by name exactly (either/or picks, move groups, requirements) find it
	// however a PDF or a typed list spelled it ("Lion’s", "the lion's den"). A name no own move has
	// is another playbook's and stays as written: its grant matches it loosely.
	const ownByLoose = new Map(out.moves.map(m => [looseName(m.name), m.name]));
	const canonList = refs => [...new Set(refs.map(n => ownByLoose.get(looseName(n)) ?? n))];
	for (const b of pb.backgrounds) { b.moves = canonList(b.moves); b.moveChoice = canonList(b.moveChoice); }
	for (const c of pb.moveChoices) c.options = canonList(c.options);
	for (const g of pb.moveGroups) g.moves = canonList(g.moves);
	for (const m of out.moves) m.requiresMoves = canonList(m.requiresMoves);
	_linkInsertMoves(out, ownByLoose, check);

	// References to moves this playbook does not have. A background may name ANOTHER playbook's
	// move ("Frosty from the Heavy"), so those are kept and only reported.
	const own = new Set(out.moves.map(m => m.name.toLowerCase()));
	for (const c of pb.moveChoices) {
		const missing = c.options.filter(n => !own.has(n.toLowerCase()));
		if (missing.length) check(`The starting choice "${c.label}" names moves this playbook doesn't have: ${missing.join(", ")}.`);
	}
	const gaps = backgroundGaps(out);
	pb.backgrounds.forEach((b, i) => {
		const unknown = gaps[i].unknownPossessions;
		if (unknown.length) check(`The background "${b.label || "unnamed"}" gives ${unknown.map(n => `"${n}"`).join(", ")}, which isn't one of this playbook's special possessions. Add it as one, or characters won't get it.`);
	});
	pb.backgrounds.forEach((b, i) => {
		const missing = gaps[i].foreign;
		if (missing.length) check(`The background "${b.label || "unnamed"}" gives moves from other playbooks: ${missing.join(", ")}. A character gets each from the playbook it belongs to, so that playbook has to be in this world (the book's always are) and spell the move the same way.`);
	});
	return { bundle: out, issues };
}

/**
 * Tie the insert moves to their inserts, and each insert to the move that unlocks it, by the moves'
 * exact spelling. A move naming an insert (or a list) this playbook doesn't have becomes one of the
 * playbook's own moves again; an unlocking move it doesn't have is kept as written and reported
 * (the GM may be about to add it), as is one inside an insert, which nobody could ever reach.
 */
function _linkInsertMoves(bundle, ownByLoose, check) {
	const inserts = bundle.playbook.inserts;
	const byKey = new Map(inserts.map(i => [i.key, i]));
	for (const m of bundle.moves) {
		if (!m.insert) { m.insertList = ""; continue; }
		const ins = byKey.get(m.insert);
		if (!ins) {
			check(`The move "${m.name}" belonged to an insert this playbook doesn't have, so it is one of the playbook's own moves again.`);
			m.insert = ""; m.insertList = "";
			continue;
		}
		if (m.insertList && !ins.lists.some(l => l.key === m.insertList && l.kind === "moves")) {
			check(`The move "${m.name}" was in a list "${ins.name}" doesn't have, so it is one of that insert's moves outside any list.`);
			m.insertList = "";
		}
	}
	const insertMoves = new Set(bundle.moves.filter(m => m.insert).map(m => looseName(m.name)));
	for (const ins of inserts) {
		if (ins.unlockedBy) {
			const own = ownByLoose.get(looseName(ins.unlockedBy));
			if (!own) check(`The insert "${ins.name}" opens with "${ins.unlockedBy}", which isn't one of this playbook's moves, so no character will see it until a move of that name is added.`);
			else {
				ins.unlockedBy = own;
				if (insertMoves.has(looseName(own))) check(`The insert "${ins.name}" opens with "${own}", which is one of the insert's own moves, so no character could ever open it. Pick one of the playbook's moves.`);
			}
		}
		for (const l of ins.lists) {
			for (const b of l.bonusPicks) b.move = ownByLoose.get(looseName(b.move)) ?? b.move;
			if (l.kind === "pick" && !l.options.length) check(`The list "${l.title || "unnamed"}" in "${ins.name}" has nothing to pick yet.`);
		}
	}
}

/** The moves of a bundle that belong to an insert, or (with `key`) to that one insert. */
export function insertMovesOf(bundle, key = null) {
	return (bundle?.moves ?? []).filter(m => m.insert && (key === null || m.insert === key));
}

/** The moves that are the playbook's own: not in any insert. */
export function playbookOwnMoves(bundle) {
	return (bundle?.moves ?? []).filter(m => !m.insert);
}

/**
 * Per background, what it names that this playbook doesn't have: `foreign` moves (another
 * playbook's, kept and only reported) and `unknownPossessions`. PURE; the builder shows the same
 * lists on each background card that a save reports.
 */
export function backgroundGaps(bundle) {
	const pb = bundle.playbook;
	const own = new Set(bundle.moves.map(m => m.name.toLowerCase()));
	const ownPossessions = new Set(pb.possessions.options.map(o => looseName(o.label, { article: true })));
	return pb.backgrounds.map(b => ({
		foreign: [...(b.moves ?? []), ...(b.moveChoice ?? [])].filter(n => !own.has(String(n).toLowerCase())),
		unknownPossessions: (b.possessions ?? []).filter(n => !ownPossessions.has(looseName(n, { article: true }))),
	}));
}

const WORD_COUNT = { one: 1, two: 2, three: 3, a: 1, an: 1 };

/**
 * "Increase one of your stats by 1 (to a max of +2)": the cap the book's Improved Stat carries
 * (+2) and Superior Stat (+3). Level Up asks which stat to raise only for a move with a cap, so a
 * homebrew stat move needs one or it raises nothing. Read off the move's own words.
 */
export function statCapFrom(description) {
	const m = String(description ?? "").replace(/\*/g, "").match(/increase (?:one of )?your stats? by \+?1\b[^(]*\(\s*to a max(?:imum)? of \+?(\d)\s*\)/i);
	return m ? Math.max(1, Math.min(3, Number(m[1]))) : null;
}

/**
 * "Mark one:" followed by bullets: the options a player ticks on the move (Eccentricity's "the best
 * at games of chance"), which the sheet draws as mark boxes (system.markOptions). Read off the
 * move's own words; null when it has none.
 * @returns {{labels: string[], count: number}|null}
 */
export function markOptionsFrom(description) {
	const lines = String(description ?? "").split("\n");
	for (let i = 0; i < lines.length; i++) {
		const lead = lines[i].replace(/\*/g, "").match(/\bmark (one|two|three|a|an|\d)\b[^:]*:\s*$/i);
		if (!lead) continue;
		const labels = [];
		for (let j = i + 1; j < lines.length; j++) {
			if (!lines[j].trim()) { if (labels.length) break; continue; }
			if (!/^- /.test(lines[j])) break;
			labels.push(lines[j].slice(2).replace(/\*/g, "").trim());
		}
		const real = labels.filter(l => l && !/^\(?discuss with (the )?gm\)?$/i.test(l));
		if (real.length >= 2) return { labels: real, count: Number(lead[1]) || WORD_COUNT[lead[1].toLowerCase()] || 1 };
	}
	return null;
}

/**
 * What a roll holds on the move's own track, read off its words: "on a 10+, hold 3 Fear; on a 7-9,
 * hold 1 Fear" for a track called Fear. "On a 7+" counts for both hits, and a later "on a 10+"
 * overrides it (the Monster Squad's "on a 7+ … hold 1 Reign; on a 10+, hold 2 Reign"). A hold of
 * some other currency than the track's is not this track's. Null when the words hold nothing.
 * @returns {{success?: number, partial?: number, failure?: number}|null}
 */
export function holdOnRollFrom(description, trackTitle = "") {
	const plain = String(description ?? "").replace(/\*/g, "");
	const word = w => looseName(w, { article: true }).replace(/s$/, "");
	const out = {};
	// Not \b after the tier: "10+," has no word boundary between its "+" and the comma.
	for (const part of plain.split(/(?=\bon an? (?:10\+|7-9|7\+|6-|miss)(?![\w+-]))/i)) {
		const tier = part.match(/^on an? (10\+|7-9|7\+|6-|miss)(?![\w+-])/i)?.[1]?.toLowerCase();
		if (!tier) continue;
		const hold = part.match(/\bhold (\d+)(?:\s+([A-Za-z]+))?/i);
		if (!hold) continue;
		if (trackTitle && hold[2] && word(hold[2]) !== word(trackTitle)) continue;
		const n = Math.min(20, Number(hold[1]));
		if (tier === "7+") { out.success = n; out.partial = n; }
		else if (tier === "10+") out.success = n;
		else if (tier === "7-9") out.partial = n;
		else out.failure = n;
	}
	return Object.keys(out).length ? out : null;
}

const _holds = h => {
	if (!h || typeof h !== "object") return null;
	const out = {};
	for (const k of ["success", "partial", "failure"]) { const n = clampInt(h[k], 0, 20, 0); if (n) out[k] = n; }
	return Object.keys(out).length ? out : null;
};

export function normalizeMove(m) {
	const results = m?.results && typeof m.results === "object" ? m.results : {};
	const res = m?.resource && typeof m.resource === "object" ? m.resource : {};
	const resMax = clampInt(res.max, 0, 20, 0);
	const rollType = String(m?.rollType ?? "").trim().toLowerCase();
	const description = text(m?.description);
	// What the GM filled in wins; left empty (the builder's empty box is 0, its empty list []), both
	// are read from the move's own words, so a move typed by hand gets them as well as an import.
	const explicitMarks = Array.isArray(m?.marks) ? m.marks.map(l => plainLine(l, 120)).filter(Boolean).slice(0, 20) : [];
	const readMarks = explicitMarks.length ? null : markOptionsFrom(description);
	return {
		cap: clampInt(m?.cap, 0, 3, 0) || statCapFrom(description),
		marks: explicitMarks.length ? explicitMarks : (readMarks?.labels ?? []),
		markCount: clampInt(m?.markCount ?? readMarks?.count, 1, 5, 1),
		name: str(m?.name, MAX.name),
		description,
		starting: !!m?.starting,
		level: clampInt(m?.level, 1, 10, 1),
		requires: str(m?.requires, 200),
		requiresMoves: names(m?.requiresMoves),
		repeatMax: clampInt(m?.repeatMax, 1, 9, 1),
		// The insert this move belongs to (its key) and the moves list it's picked from; "" for one of
		// the playbook's own moves. Checked against the playbook's inserts by normalizeBundle.
		insert: slugify(m?.insert ?? ""),
		insertList: slugify(m?.insertList ?? ""),
		rollType: CUSTOM_MOVE_ROLL_TYPES.includes(rollType) ? rollType : "",
		results: {
			success: str(results.success, 600),
			partial: str(results.partial, 600),
			failure: str(results.failure, 600),
		},
		resource: resMax > 0
			? {
				max: resMax, title: str(res.title, 40), labels: list(res.labels, 20).map(l => plainLine(l, 40)).filter(Boolean),
				// What a roll holds on it: the GM's numbers, else read from the words (holdOnRollFrom).
				holdOnRoll: _holds(res.holdOnRoll) ?? holdOnRollFrom(description, str(res.title, 40)),
			}
			: null,
	};
}

// ---- Bundle → Items -------------------------------------------------------------------------

function _uniqueSlugs(labels) {
	const used = new Set();
	return labels.map((label, i) => {
		const base = slugify(label) || `option-${i + 1}`;
		let slug = base;
		for (let n = 2; used.has(slug); n++) slug = `${base}-${n}`;
		used.add(slug);
		return slug;
	});
}

/**
 * The playbook Item's data and its moves' Item data, ready for Item.create / update. `slug` is
 * the playbook's FIXED slug (minted once, playbook-catalog.js mintHomebrewSlug); the caller adds
 * `folder`. Names here are the bundle's, already checked by the caller (playbookNameProblem).
 *
 * @param {object} bundle   a normalized bundle
 * @param {object} opts
 * @param {string} opts.slug
 * @param {string} [opts.source]  "builder" | "json" | "pdf"
 */
export function bundleToItemData(bundle, { slug, source = "builder" } = {}) {
	const pb = bundle.playbook;
	const bgSlugs = _uniqueSlugs(pb.backgrounds.map(b => b.label));
	const possSlugs = _uniqueSlugs(pb.possessions.options.map(o => o.label));
	const loreSlugs = _uniqueSlugs(pb.lore.map(s => s.title || "questions"));

	const possSlugByName = new Map(pb.possessions.options.map((o, i) => [looseName(o.label, { article: true }), possSlugs[i]]));
	const backgrounds = pb.backgrounds.map((b, i) => {
		const out = {
			slug: bgSlugs[i],
			label: formatPlaybookInline(b.label),
			description: formatPlaybookText(b.description),
		};
		if (b.moves.length) out.moves = [...b.moves];
		if (b.moveChoice.length >= 2) {
			out.setup = { choices: [{
				key: "extraMove", label: "Extra move", apply: "move",
				options: b.moveChoice.map(n => ({ value: n, label: n })),
			}] };
		} else if (b.moveChoice.length === 1) {
			out.moves = [...(out.moves ?? []), b.moveChoice[0]];
		}
		// Possessions it gives on top of the pick: the system reads them as this playbook's own
		// options by slug (the Judge's Missionary and its aviary), so a name with no option is dropped.
		const extra = (b.possessions ?? []).map(n => possSlugByName.get(looseName(n, { article: true }))).filter(Boolean);
		if (extra.length) out.extraPossessions = [...new Set(extra)];
		if (b.track) {
			out.setup = { ...(out.setup ?? {}), resources: [{ key: `${bgSlugs[i]}-${slugify(b.track.label) || "track"}`, label: b.track.label, max: b.track.max, value: 0 }] };
		}
		return out;
	});

	const flags = {
		homebrew: { v: BUNDLE_VERSION, published: !!pb.published, source },
		picker: { complexity: pb.complexity, summary: pb.summary, author: pb.author },
		instinctLabel: pb.instinctLabel,
		hp: pb.hp,
		damage: pb.damage,
		statsNote: pb.statsNote,
		backgrounds,
		instincts: pb.instincts.map(i => ({ word: i.word, description: i.description })),
		appearance: pb.appearance.map(line => [...line]),
		origin: pb.origin.map(o => ({ region: o.region, names: [...o.names] })),
		specialPossessions: {
			pickNote: pb.possessions.pickNote,
			pickCount: pb.possessions.pickCount,
			preselected: pb.possessions.options.map((o, i) => o.preselected ? possSlugs[i] : null).filter(Boolean),
			options: pb.possessions.options.map((o, i) => ({
				slug: possSlugs[i],
				label: formatPlaybookInline(o.label),
				description: formatPlaybookText(o.description).replace(/^<p>([\s\S]*)<\/p>$/, "$1"),
			})),
		},
		moves: {
			startingMovesNote: pb.startingMovesNote,
			choices: pb.moveChoices.map(c => ({ label: c.label, options: [...c.options] })),
		},
		lore: pb.lore.map((s, i) => ({
			slug: loreSlugs[i],
			title: plainLine(s.title, 120),
			description: formatPlaybookText(s.description),
			options: s.options.map((o, j) => o.freeText
				? { slug: `${loreSlugs[i]}-${j + 1}`, description: formatPlaybookInline(o.description), type: "text" }
				: { slug: `${loreSlugs[i]}-${j + 1}`, description: formatPlaybookInline(o.description), max: o.max }),
		})),
		introductions: {
			step3: pb.introductions.step3,
			step4: [...pb.introductions.step4],
			step6: [...pb.introductions.step6],
		},
		moveGroups: pb.moveGroups.map((g, i) => ({ key: slugify(g.label) || `group-${i + 1}`, label: g.label, moves: [...g.moves] })),
		notes: formatPlaybookText(pb.notes),
		inserts: pb.inserts.map(insertToFlags),
	};

	const playbook = {
		name: pb.name,
		type: "playbook",
		...(pb.img ? { img: pb.img } : {}),
		system: { slug, actorType: "character", description: plainLine(pb.description, MAX.text) },
		flags: { [ITEM_FLAG_SCOPE]: flags },
	};

	const moves = bundle.moves.map(m => moveToItemData(m, { playbookName: pb.name, slug }));
	return { playbook, moves };
}

/**
 * An insert as the playbook Item stores it. Each "pick" list is in the LORE-ENTRY shape the sheet's
 * shared lore partial draws (`slug`, `title`, `description`, `options[{slug, description, max |
 * type:"text"}]`), and its options are slugged from their LABELS, not their places, because a
 * character's ticks are stored by slug: a GM reordering a list must not move them.
 */
export function insertToFlags(ins) {
	return {
		key: ins.key,
		name: plainLine(ins.name, MAX.name),
		description: formatPlaybookText(ins.description),
		unlockedBy: ins.unlockedBy,
		form: { ...ins.form },
		lists: ins.lists.map(l => {
			const optionSlugs = _uniqueSlugs(l.options.map(o => o.description));
			return {
				key: l.key,
				slug: `${ins.key}-${l.key}`,
				kind: l.kind,
				title: plainLine(l.title, 120),
				description: formatPlaybookText(l.prompt),
				pick: l.pick,
				min: l.min,
				perUnlock: l.perUnlock,
				bonusPicks: l.bonusPicks.map(b => ({ ...b })),
				options: l.options.map((o, j) => o.freeText
					? { slug: optionSlugs[j], description: formatPlaybookInline(o.description), type: "text" }
					: { slug: optionSlugs[j], description: formatPlaybookInline(o.description), max: o.max, ...(o.preselected ? { preselected: true } : {}) }),
			};
		}),
	};
}

/** An insert as stored on a playbook Item, back into the bundle's shape. */
export function insertFromFlags(f) {
	const form = f?.form ?? {};
	return {
		key: String(f?.key ?? ""),
		name: String(f?.name ?? ""),
		description: playbookTextFromHtml(f?.description ?? ""),
		unlockedBy: String(f?.unlockedBy ?? ""),
		form: { enabled: !!form.enabled, on: String(form.on ?? "Transform"), off: String(form.off ?? "Revert") },
		lists: (f?.lists ?? []).map(l => ({
			key: String(l.key ?? ""),
			title: String(l.title ?? ""),
			prompt: playbookTextFromHtml(l.description ?? ""),
			kind: l.kind === "moves" ? "moves" : "pick",
			pick: Number.isFinite(Number(l.pick)) ? Number(l.pick) : 1,
			min: Number(l.min) || 0,
			perUnlock: Number(l.perUnlock) || 0,
			bonusPicks: (l.bonusPicks ?? []).map(b => ({ move: String(b.move ?? ""), count: Number(b.count) || 1 })),
			options: (l.options ?? []).map(o => ({
				description: playbookTextFromHtml(o.description),
				max: Number(o.max) || 1,
				freeText: o.type === "text",
				preselected: !!o.preselected,
			})),
		})),
	};
}

export function moveToItemData(m, { playbookName, slug }) {
	const hasResults = !!(m.rollType && (m.results.success || m.results.partial || m.results.failure));
	const requirement = {};
	if (m.level > 1) requirement.level = m.level;
	if (m.requiresMoves.length) requirement.moves = [...m.requiresMoves];
	if (m.requires) requirement.note = m.requires;
	return {
		name: m.name,
		type: "move",
		system: {
			moveType: "playbook",
			playbook: playbookName,
			description: formatPlaybookText(m.description),
			isStartingMove: !!m.starting,
			rollType: m.rollType || null,
			moveResults: hasResults ? buildMoveTierResults(m.results) : null,
			requirement: Object.keys(requirement).length ? requirement : null,
			repeatMax: m.repeatMax > 1 ? m.repeatMax : null,
			// A stat move's ceiling: what makes Level Up ask which stat (the book's Improved Stat).
			cap: m.cap ?? null,
			// Tick-one options, drawn as mark boxes; a repeatable move gets the same again each time.
			markOptions: m.marks?.length ? m.marks.map((label, i) => ({ slug: slugify(label).slice(0, 40) || `mark-${i + 1}`, label, marks: 1 })) : null,
			markBudget: m.marks?.length ? { base: m.markCount ?? 1, perExtra: m.markCount ?? 1 } : null,
			resource: m.resource ? { max: m.resource.max, title: m.resource.title || null, labels: [...m.resource.labels], ...(m.resource.holdOnRoll ? { holdOnRoll: { ...m.resource.holdOnRoll } } : {}) } : null,
		},
		flags: { [SYSTEM_ID]: {
			[HOMEBREW_MOVE_FLAG]: slug,
			// An insert's move: which insert, which of its moves lists (a character's copy keeps it, so
			// the sheet files it under the insert and Level Up never offers it as an ordinary advance).
			...(m.insert ? { [HOMEBREW_INSERT_FLAG]: { key: m.insert, list: m.insertList || "" } } : {}),
		} },
	};
}

// ---- Items → Bundle -------------------------------------------------------------------------

/**
 * A playbook Item and its move Items back into a bundle: for the builder to edit, and for a JSON
 * export. Reads plain objects or Documents alike.
 */
export function itemsToBundle(playbook, moves = []) {
	const f = playbook?.flags?.[ITEM_FLAG_SCOPE] ?? {};
	const out = emptyBundle();
	const pb = out.playbook;
	pb.name = String(playbook?.name ?? "");
	pb.slug = String(playbook?.system?.slug ?? "");
	pb.img = String(playbook?.img ?? "");
	if (pb.img === "icons/svg/item-bag.svg") pb.img = "";
	pb.published = !!f.homebrew?.published;
	pb.summary = String(f.picker?.summary ?? "");
	pb.author = String(f.picker?.author ?? "");
	pb.complexity = String(f.picker?.complexity ?? "");
	pb.description = String(playbook?.system?.description ?? "");
	pb.notes = playbookTextFromHtml(f.notes ?? "");
	pb.statsNote = String(f.statsNote ?? pb.statsNote);
	pb.hp = Number(f.hp) || pb.hp;
	pb.damage = DAMAGE_DICE.includes(f.damage) ? f.damage : pb.damage;
	pb.instinctLabel = f.instinctLabel === "Drive" ? "Drive" : "Instinct";
	const possLabelBySlug = new Map((f.specialPossessions?.options ?? []).map(o => [o.slug, playbookTextFromHtml(o.label)]));
	pb.backgrounds = (f.backgrounds ?? []).map(b => {
		const choice = (b.setup?.choices ?? []).find(c => c?.apply === "move");
		const res = b.setup?.resources?.[0];
		return {
			label: playbookTextFromHtml(b.label),
			description: playbookTextFromHtml(b.description),
			moves: [...(b.moves ?? [])],
			moveChoice: (choice?.options ?? []).map(o => String(o.value ?? o.label ?? "")).filter(Boolean),
			possessions: (b.extraPossessions ?? []).map(s => possLabelBySlug.get(s)).filter(Boolean),
			track: res ? { label: String(res.label ?? ""), max: Number(res.max) || 1 } : null,
		};
	});
	pb.instincts = (f.instincts ?? []).map(i => ({ word: String(i.word ?? ""), description: String(i.description ?? "") }));
	pb.appearance = (f.appearance ?? []).map(line => (Array.isArray(line) ? line : []).map(String));
	pb.origin = (f.origin ?? []).map(o => ({ region: String(o.region ?? ""), names: (o.names ?? []).map(String) }));
	const sp = f.specialPossessions ?? {};
	const pre = new Set(sp.preselected ?? []);
	pb.possessions = {
		pickCount: Number(sp.pickCount) || 0,
		pickNote: String(sp.pickNote ?? ""),
		options: (sp.options ?? []).map(o => ({
			label: playbookTextFromHtml(o.label),
			description: playbookTextFromHtml(o.description),
			preselected: pre.has(o.slug),
		})),
	};
	pb.startingMovesNote = String(f.moves?.startingMovesNote ?? "");
	pb.moveChoices = (f.moves?.choices ?? []).map(c => ({ label: String(c.label ?? ""), options: [...(c.options ?? [])] }));
	pb.moveGroups = (f.moveGroups ?? []).map(g => ({ label: String(g.label ?? ""), moves: [...(g.moves ?? [])] }));
	pb.lore = (f.lore ?? []).map(s => ({
		title: String(s.title ?? ""),
		description: playbookTextFromHtml(s.description),
		options: (s.options ?? []).map(o => ({
			description: playbookTextFromHtml(o.description),
			max: Number(o.max) || 1,
			freeText: o.type === "text",
		})),
	}));
	const intro = f.introductions ?? {};
	pb.introductions = {
		step3: String(intro.step3 ?? ""),
		step4: [...(intro.step4 ?? [])].map(String),
		step6: [...(intro.step6 ?? [])].map(String),
	};
	pb.inserts = (Array.isArray(f.inserts) ? f.inserts : []).map(insertFromFlags);
	out.moves = moves.map(itemToMove).sort((a, b) => a.name.localeCompare(b.name));
	return out;
}

export function itemToMove(item) {
	const s = item?.system ?? {};
	const r = s.requirement ?? {};
	const res = s.resource;
	const ins = item?.flags?.[SYSTEM_ID]?.[HOMEBREW_INSERT_FLAG];
	return {
		insert: String(ins?.key ?? ""),
		insertList: String(ins?.list ?? ""),
		name: String(item?.name ?? ""),
		description: playbookTextFromHtml(s.description),
		starting: !!s.isStartingMove,
		level: Number(r.level) || 1,
		requires: String(r.note ?? ""),
		requiresMoves: [...(r.moves ?? [])].map(String),
		repeatMax: Number(s.repeatMax) || 1,
		cap: Number(s.cap) || null,
		marks: (s.markOptions ?? []).map(o => String(o.label ?? "")).filter(Boolean),
		markCount: Number(s.markBudget?.base) || 1,
		rollType: String(s.rollType ?? ""),
		results: {
			success: String(s.moveResults?.success?.value ?? ""),
			partial: String(s.moveResults?.partial?.value ?? ""),
			failure: String(s.moveResults?.failure?.value ?? ""),
		},
		resource: res?.max ? { max: Number(res.max), title: String(res.title ?? ""), labels: [...(res.labels ?? [])].map(String), holdOnRoll: res.holdOnRoll ? { ...res.holdOnRoll } : null } : null,
	};
}

/**
 * What changed between two versions of one playbook, in words, for a GM updating a playbook from
 * a newer PDF or file: moves and options added, dropped or reworded, and the numbers that moved.
 * @returns {{ lines: string[], changedMoves: string[] }}  `changedMoves`: moves in both, reworded
 */
export function diffBundles(before, after) {
	const lines = [];
	// Both read the one way first: a playbook read back from the world lists its fields in another
	// order and spaces its text differently (a save sets a list off with a blank line), and neither is
	// a change anyone made.
	before = normalizeBundle(before).bundle ?? before;
	after = normalizeBundle(after).bundle ?? after;
	const a = before?.playbook ?? {};
	const b = after?.playbook ?? {};
	for (const [key, label] of [["hp", "Max HP"], ["damage", "Damage"], ["statsNote", "Stats"]]) {
		if (String(a[key] ?? "") !== String(b[key] ?? "")) lines.push(`${label}: ${a[key] ?? "(none)"} → ${b[key] ?? "(none)"}`);
	}
	const json = canonicalJson;
	const named = (list, key) => new Map((list ?? []).map(x => [String(x[key] ?? "").toLowerCase(), x]));
	const compare = (label, oldList, newList, key) => {
		const o = named(oldList, key);
		const n = named(newList, key);
		const added = [...n.keys()].filter(k => !o.has(k)).map(k => n.get(k)[key]);
		const dropped = [...o.keys()].filter(k => !n.has(k)).map(k => o.get(k)[key]);
		const changed = [...n.keys()].filter(k => o.has(k) && json(o.get(k)) !== json(n.get(k))).map(k => n.get(k)[key]);
		if (added.length) lines.push(`New ${label}: ${added.join(", ")}`);
		if (dropped.length) lines.push(`No longer there (${label}): ${dropped.join(", ")}`);
		if (changed.length) lines.push(`Changed ${label}: ${changed.join(", ")}`);
		return changed;
	};
	const changedMoves = compare("moves", before?.moves, after?.moves, "name");
	compare("backgrounds", a.backgrounds, b.backgrounds, "label");
	compare("special possessions", a.possessions?.options, b.possessions?.options, "label");
	compare("instincts", a.instincts, b.instincts, "word");
	compare("inserts", a.inserts, b.inserts, "name");
	// An insert renamed keeps its key (and every character's ticks); one whose KEY went is a new
	// insert to the sheet, so ticks made in the old one are no longer shown.
	const lostKeys = (a.inserts ?? []).filter(i => !(b.inserts ?? []).some(n => n.key === i.key) && (b.inserts ?? []).some(n => String(n.name).toLowerCase() === String(i.name).toLowerCase()));
	if (lostKeys.length) lines.push(`Characters' picks in ${lostKeys.map(i => `"${i.name}"`).join(", ")} won't carry over: it's stored as a different insert now.`);
	if (json(a.lore ?? []) !== json(b.lore ?? [])) lines.push("The questions for character creation changed.");
	if (json(a.introductions ?? {}) !== json(b.introductions ?? {})) lines.push("The Introductions questions changed.");
	if (json(a.notes ?? "") !== json(b.notes ?? "")) lines.push("The notes changed.");
	return { lines, changedMoves };
}

/**
 * A NEWER VERSION of an imported playbook, over the GM's own work. Three versions of the playbook:
 *   base    what the last import READ (stored on the playbook when it was saved, `importBase`);
 *   mine    the playbook as saved, with whatever the GM fixed or added by hand;
 *   theirs  what this import read.
 * Piece by piece (a move, a background, an instinct, a possession by name; the looks, origins,
 * questions, introductions and inserts each as a whole; each of the playbook's own fields): where the
 * new PDF says what the old one said, the GM's version is kept; where it says something new, the new
 * words go in. A piece the GM added stays; one the GM deleted stays deleted unless the PDF changed it.
 * The publish switch, picture and slug are always the GM's.
 *
 * @returns {{ bundle: object, kept: string[], replaced: string[] }}
 *   `kept`: pieces the GM changed that the PDF didn't, kept as the GM had them; `replaced`: pieces the
 *   GM changed AND the PDF changed, where the PDF's new words went in over the GM's
 */
export function mergeReimport({ base, mine, theirs }) {
	const B = normalizeBundle(base).bundle ?? emptyBundle();
	const M = normalizeBundle(mine).bundle ?? emptyBundle();
	const T = normalizeBundle(theirs).bundle ?? emptyBundle();
	const same = (x, y) => canonicalJson(x ?? null) === canonicalJson(y ?? null);
	const kept = [];
	const replaced = [];
	const pick = (label, b, m, t) => {
		if (same(t, b)) { if (!same(m, b)) kept.push(label); return m; }
		if (!same(m, b) && !same(m, t)) replaced.push(label);
		return t;
	};
	const keyed = (what, bList = [], mList = [], tList = [], keyOf) => {
		const map = list => new Map(list.map(x => [looseName(keyOf(x)), x]));
		const bm = map(bList), mm = map(mList), tm = map(tList);
		const out = [];
		for (const t of tList) {
			const k = looseName(keyOf(t));
			const label = `${what} "${keyOf(t)}"`;
			if (!bm.has(k)) { out.push(mm.has(k) ? pick(label, null, mm.get(k), t) : t); continue; }
			if (same(t, bm.get(k))) {
				// Unchanged in the PDF: the GM's, or gone if the GM deleted it.
				if (mm.has(k)) { const m = mm.get(k); if (!same(m, t)) kept.push(label); out.push(m); }
				continue;
			}
			if (mm.has(k) && !same(mm.get(k), bm.get(k)) && !same(mm.get(k), t)) replaced.push(label);
			out.push(t);
		}
		// What the GM added: in theirs neither as read before nor now.
		for (const m of mList) {
			const k = looseName(keyOf(m));
			if (!tm.has(k) && !bm.has(k)) out.push(m);
		}
		return out;
	};

	const out = structuredClone(T);
	const pb = out.playbook;
	for (const key of ["name", "description", "summary", "author", "complexity", "statsNote", "hp", "damage", "instinctLabel", "startingMovesNote", "notes"]) {
		pb[key] = pick(key === "notes" ? "the notes" : `the playbook's ${key}`, B.playbook[key], M.playbook[key], T.playbook[key]);
	}
	for (const key of ["appearance", "origin", "lore", "introductions", "moveChoices", "moveGroups", "inserts"]) {
		pb[key] = structuredClone(pick(`the ${key === "lore" ? "questions" : key}`, B.playbook[key], M.playbook[key], T.playbook[key]));
	}
	pb.possessions = {
		pickCount: pick("the special possessions count", B.playbook.possessions.pickCount, M.playbook.possessions.pickCount, T.playbook.possessions.pickCount),
		pickNote: pick("the special possessions note", B.playbook.possessions.pickNote, M.playbook.possessions.pickNote, T.playbook.possessions.pickNote),
		options: keyed("special possession", B.playbook.possessions.options, M.playbook.possessions.options, T.playbook.possessions.options, o => o.label),
	};
	pb.backgrounds = keyed("background", B.playbook.backgrounds, M.playbook.backgrounds, T.playbook.backgrounds, b => b.label);
	pb.instincts = keyed(pb.instinctLabel === "Drive" ? "drive" : "instinct", B.playbook.instincts, M.playbook.instincts, T.playbook.instincts, i => i.word);
	out.moves = keyed("move", B.moves, M.moves, T.moves, m => m.name);
	for (const key of ["published", "img", "slug"]) pb[key] = M.playbook[key];
	return { bundle: normalizeBundle(out).bundle ?? out, kept, replaced };
}

/**
 * A value as one comparable string: object keys in order, text with its whitespace run together.
 * Two versions of a playbook that differ only in how they were stored compare equal.
 */
export function canonicalJson(value) {
	const canon = v => {
		if (typeof v === "string") return v.replace(/\s+/g, " ").trim();
		if (Array.isArray(v)) return v.map(canon);
		if (v && typeof v === "object") return Object.fromEntries(Object.keys(v).sort().filter(k => v[k] !== undefined).map(k => [k, canon(v[k])]));
		return v;
	};
	return JSON.stringify(canon(value));
}

/** The JSON a GM saves and shares: a normalized bundle plus where it came from. */
export function bundleForExport(bundle, { systemVersion = "" } = {}) {
	return {
		format: BUNDLE_FORMAT,
		version: BUNDLE_VERSION,
		exportedFrom: { system: SYSTEM_ID, systemVersion },
		playbook: bundle.playbook,
		moves: bundle.moves,
	};
}
