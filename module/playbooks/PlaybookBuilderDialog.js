import { StonetopDialog } from "../utils/stonetop-dialog.js";
import { applyGuideRail, guideRailStep } from "../utils/guide-rail.js";
import { askWithButtons } from "../utils/ask-with-buttons.js";
import { escHtml, looseName, slugify } from "../utils/strings.js";
import { filePicker } from "../utils/foundry-compat.js";
import { hasUnsavedWork, notePristineWork } from "../utils/close-guard.js";
import { docOrNewKey, persistOnTyping, persistOpenWindowsSoon } from "../utils/window-restore.js";
import { PLAYBOOK_BUILDER_RESTORE_KIND } from "./playbook-builder-restore.js";
import { STAT_KEYS } from "../utils/roll-types.js";
import { parseStatArray, statScoreLabel, DEFAULT_STAT_ARRAY } from "../actors/character/stat-rules.js";
import { lorePickMin, lorePickMax } from "../actors/character/lore-pick-count.js";
import { INSERT_FORM_DEFAULTS, emptyBundle, normalizeBundle, normalizeMove, backgroundGaps, diffBundles, mergeReimport, advanceFrom, DAMAGE_DICE, HP_LIMITS } from "./homebrew-bundle.js";
import {
	saveHomebrewPlaybook, readHomebrewBundle, readImportBase, deleteHomebrewPlaybook, holdersOfHomebrew,
	readBundleFile, importCollision, saveProblem, offerToRefreshCopies, writeInsChangedOnSave,
} from "./homebrew-store.js";
import { isHomebrewPlaybookItem, playbookAvatar, homebrewPlaybookByName } from "./playbook-catalog.js";
import { droppedFileKind, fileKindOf } from "./dropped-file.js";
import { rollFromWords, trackFromWords } from "./move-words.js";
import * as L from "./builder-lines.js";
import { playbookNameFromFileName, formatPlaybookText, formatPlaybookInline } from "./playbook-text.js";
import { ITEM_FLAG_SCOPE } from "../system-id.js";

/**
 * A background's words for its read view, with a move the import lifted out of them put back where the
 * PDF prints it. A roll printed inside a background (the Stranger's Moon Blessed) becomes a move of its
 * own, and its place in the words says "You get the ***Moon Blessed*** move." (homebrew-bundle.js): the
 * read view shows that move's words there instead, as the playbook does. The text boxes keep the line.
 * @param {string} text
 * @param {function(string): object|undefined} findMove  this playbook's move of that name
 */
export function backgroundWordsInPlace(text, findMove) {
	return String(text ?? "").replace(/^[ \t]*You get the \*\*\*(.+?)\*\*\* move\.[ \t]*$/gm, (line, name) => {
		const words = String(findMove(name)?.description ?? "").trim();
		return words || line;
	});
}

/** A blank playbook for a new window: shown to players unless the GM closes the header's eye. */
function shownBundle() {
	const bundle = emptyBundle();
	bundle.playbook.published = true;
	return bundle;
}

/** Whether `bundle` is a blank one, a new window's (shown) or emptyBundle()'s (hidden): nothing to lose. */
function isBlankBundle(bundle) {
	const json = JSON.stringify(bundle);
	return json === JSON.stringify(shownBundle()) || json === JSON.stringify(emptyBundle());
}

/**
 * THE PLAYBOOK BUILDER: the GM's window for making, importing, fixing and sharing a HOMEBREW
 * playbook (playbooks/playbook-catalog.js). It edits one in-memory BUNDLE (homebrew-bundle.js),
 * the same object a shared JSON file and the PDF reader produce, and Save writes it into the
 * world as a playbook Item and its moves (homebrew-store.js).
 *
 * Laid out as a left-rail stepped sheet like the custom-move editor. Typing never re-renders:
 * every field names the bundle path it writes (`data-field`, its cards by ref, cardRef; with
 * `data-parse` for a box typed as a list, builder-lines.js), and the form is read back into the
 * bundle before anything that re-renders (adding or removing a card, an import, a save).
 */

const SECTIONS = [
	{ key: "playbook",    title: "Playbook",            icon: "fa-book" },
	{ key: "stats",       title: "Stats & HP",          icon: "fa-heart-pulse" },
	{ key: "backgrounds", title: "Backgrounds",         icon: "fa-signs-post" },
	{ key: "instincts",   title: "Instincts",           icon: "fa-compass" },
	{ key: "looks",       title: "Looks & Origins",     icon: "fa-user" },
	{ key: "possessions", title: "Special Possessions", icon: "fa-sack-xmark" },
	{ key: "moves",       title: "Moves",               icon: "fa-scroll" },
	{ key: "advancement", title: "Level Up",            icon: "fa-arrow-up-right-dots" },
	{ key: "inserts",     title: "Inserts",             icon: "fa-puzzle-piece" },
	{ key: "lore",        title: "Questions",           icon: "fa-circle-question" },
	{ key: "intro",       title: "Introductions",       icon: "fa-people-group" },
	{ key: "notes",       title: "Notes",               icon: "fa-note-sticky" },
];

// The boxes typed as a list (one entry per line, or separated by commas): `data-parse` -> how the
// box's text is read back into the bundle.
const FIELD_PARSERS = {
	instincts:  L.parseInstinctLines,
	appearance: L.parseAppearanceLines,
	origin:     L.parseOriginLines,
	choices:    L.parseChoiceLines,
	groups:     L.parseGroupLines,
	list:       L.parseLineList,
	lore:       L.parseLoreOptionLines,
	insertOptions: L.parseInsertOptionLines,
	names:      L.parseNameList,
	bonus:      L.parseBonusPicks,
};

/** What an advance of the playbook's own Level Up does, in words, as Level Up will act on it. */
function _advanceDoes(a) {
	switch (a.kind) {
		case "stat": return `raises a stat by 1, to +${a.max} at most`;
		case "hp": return a.to ? `sets max HP to ${a.to}` : `adds ${a.by} max HP`;
		case "damage": return `makes the damage die a ${a.die}`;
		case "move": return "takes a new move from this playbook";
		case "otherMove": return "takes a move from another playbook, agreed with the table";
		default: return "is marked; the table works out what it does";
	}
}

/** A rail section's title: the instincts panel is "Drives" for a playbook that calls them that. */
const _sectionTitle = (section, pb) => section.key === "instincts" && pb.instinctLabel === "Drive" ? "Drives" : section.title;

/** What a lore section's prompt holds a player to, read the way onboarding reads it (lore-pick-count.js). */
function _lorePickNote(section) {
	// No options: a heading the questions after it stand under in character creation ("Belonging").
	if (!section.options.length) return "With no options, this is a heading: character creation shows it over the questions after it.";
	if (section.options.every(o => o.freeText)) return "Players write their answers.";
	const shaped = { description: section.description, options: section.options.map(o => o.freeText ? { type: "text" } : { max: o.max }) };
	const min = lorePickMin(shaped);
	const max = lorePickMax(shaped);
	if (max === Infinity) return min ? `Players tick at least ${min}, as many as they like.` : "Players may tick any number. Add \"(choose 2)\" to the prompt to set a count.";
	return min === max ? `Players pick ${max}.` : `Players pick ${min} to ${max}.`;
}

/**
 * Where lore section `i` sits among headings, as character creation groups them: a section with no
 * options heads every question after it up to the next heading. `groupStart` opens the frame (on the
 * heading), `groupEnd` closes it (on its last question, or the heading itself when none follow).
 */
export function loreGroupShape(lore, i) {
	const isHeading = s => !(s?.options?.length);
	let open = false;
	for (let j = 0; j <= i; j++) if (isHeading(lore[j])) open = true;
	const groupStart = isHeading(lore[i]);
	const groupEnd = open && (i === lore.length - 1 || isHeading(lore[i + 1]));
	return { groupStart, groupEnd };
}


const blankBackground = () => ({ label: "", description: "", moves: [], moveChoice: [], possessions: [], track: null });
const blankPossession = () => ({ label: "", description: "", preselected: false });
const blankLore = () => ({ title: "", description: "", options: [] });
const blankInsert = key => ({ key, name: "", description: "", unlockedBy: "", form: { enabled: false, ...INSERT_FORM_DEFAULTS }, lists: [] });
const blankInsertList = key => ({ key, title: "", prompt: "", kind: "pick", pick: 1, min: 0, perUnlock: 0, bonusPicks: [], options: [] });
/** A key not yet in `taken`: `<base>-1`, `<base>-2`… Minted once, so a character's ticks keep their place. */
const freshKey = (base, taken) => { let n = 1; while (taken.includes(`${base}-${n}`)) n++; return `${base}-${n}`; };

/** "insertKey::listKey" for a move's "Part of" choice, and back. */
const partOf = m => (m.insert ? `${m.insert}::${m.insertList || ""}` : "");
const readPartOf = value => {
	const [insert = "", insertList = ""] = String(value ?? "").split("::");
	return { insert, insertList: insert ? insertList : "" };
};

// Each card the builder draws (a move, a background, a possession, a question section, an insert, an
// insert's list) and the playbook as a whole get a ref of their own ("@7") for as long as the object
// lives. Refs are held here, never written into the bundle. A field names its card by ref
// ("moves.@7.name"), and the form names the playbook it was drawn from (`data-bundle`), so a form drawn
// before a card was removed or the playbook was replaced (an import, a save's re-read) can only write
// onto the card it was drawn from: a card or a playbook no longer in the window takes nothing.
const REFS = new WeakMap();
let lastRef = 0;

/** The ref of a card (or of the playbook), minted the first time it is asked for. */
export function cardRef(obj) {
	if (!obj || typeof obj !== "object") return "";
	let ref = REFS.get(obj);
	if (!ref) { ref = `@${++lastRef}`; REFS.set(obj, ref); }
	return ref;
}

/** The card in `list` whose ref is `ref`, and where it is: -1 when it isn't there (any more). */
const indexOfRef = (list, ref) => (Array.isArray(list) && ref ? list.findIndex(card => card && REFS.get(card) === ref) : -1);

/**
 * A field's path ("moves.@7.name") as the bundle holds it now ("moves.3.name"), or null when a card it
 * names has gone from the bundle.
 */
function resolveRefPath(bundle, path) {
	const out = [];
	let at = bundle;
	for (const step of String(path ?? "").split(".")) {
		if (step.startsWith("@")) {
			const i = indexOfRef(at, step);
			if (i < 0) return null;
			out.push(String(i));
			at = at[i];
		} else {
			out.push(step);
			at = at?.[step];
		}
	}
	return out.join(".");
}

/**
 * A save's re-read of the playbook (`to`) takes over the cards' refs from the playbook as it was
 * (`from`), so what was open for editing stays open: moves by name, as a save re-sorts them, the rest
 * by place. The playbook itself keeps the new ref it gets, so the form drawn before the save isn't
 * read again until it is redrawn (`_readForm`).
 */
export function carryRefs(from, to) {
	const carry = (a, b) => { if (a && b && REFS.has(a)) REFS.set(b, REFS.get(a)); };
	const byPlace = (a = [], b = []) => a.forEach((card, i) => carry(card, b[i]));
	const pa = from?.playbook ?? {};
	const pb = to?.playbook ?? {};
	byPlace(pa.backgrounds, pb.backgrounds);
	byPlace(pa.possessions?.options, pb.possessions?.options);
	byPlace(pa.lore, pb.lore);
	byPlace(pa.inserts, pb.inserts);
	(pa.inserts ?? []).forEach((ins, i) => byPlace(ins?.lists, pb.inserts?.[i]?.lists));
	const left = [...(to?.moves ?? [])];
	for (const move of from?.moves ?? []) {
		const at = left.findIndex(m => m.name === move.name);
		if (at >= 0) carry(move, left.splice(at, 1)[0]);
	}
}

export class PlaybookBuilderDialog extends StonetopDialog {
	/**
	 * @param {object} [opts]
	 * @param {Item}   [opts.item]    a homebrew playbook Item to edit; none starts a new one
	 * @param {object} [opts.bundle]  a bundle to start from (an import), instead of the Item's
	 * @param {Array}  [opts.issues]  what that bundle's reading reported, shown on the first panel
	 * @param {string} [opts.source]  "builder" | "json" | "pdf", recorded on a NEW playbook
	 * @param {string} [opts.draftId] a reload's: the id a new playbook's window was saved under
	 */
	constructor({ item = null, bundle = null, issues = [], source = "builder", draftId = null } = {}, options = {}) {
		super(options);
		// Keeps a new playbook's window apart from any other new one for a reload (`restoreKey`).
		this._draftId = draftId || foundry.utils.randomID(8);
		this._item = isHomebrewPlaybookItem(item) ? item : null;
		this._bundle = bundle
			? (normalizeBundle(bundle).bundle ?? emptyBundle())
			: (this._item ? readHomebrewBundle(this._item) : shownBundle());
		this._issues = [...issues, ...this._writeInNotice()];
		this._readReport = null;
		this._source = source;
		this._activeTab = SECTIONS[0].key;
		// The refs (cardRef) of the moves open for editing.
		this._openMoves = new Set();
		// What is open for editing (its pencil pressed): a whole page ("page:stats") or one card on it,
		// by its ref ("bg:@4", "pos:@9", "lore:@12", "ins:@15"). Everything else is drawn as the playbook
		// PDF prints it. A move's card is open while it's in _openMoves.
		this._editing = new Set();
	}

	static get defaultOptions() {
		return foundry.utils.mergeObject(super.defaultOptions, {
			template: "systems/stonetop-pwd/templates/dialogs/playbook-builder.hbs",
			width: 760,
			height: 640,
			resizable: true,
			// The custom-move editor's frame (a full-bleed rail + panel above a pinned footer) is the
			// whole look; stonetop-pb-builder is this window's own hook.
			classes: ["stonetop", "stonetop-custom-move-dialog", "stonetop-pb-builder"],
			scrollY: [".stonetop-pb-builder-main"],
		});
	}

	get title() {
		const name = this._bundle?.playbook?.name?.trim();
		return name ? `Playbook Builder: ${name}` : "Playbook Builder";
	}

	// ---- Reload --------------------------------------------------------------------------
	// utils/window-restore.js reopens this window after a reload (playbook-builder-restore.js), with
	// every field as it was: what is typed lives only here until Save, so it rides in `restoreView`.

	/** What a reload saves this window under: its Item's uuid once saved, else its draft id. */
	get restoreKey() {
		return docOrNewKey(PLAYBOOK_BUILDER_RESTORE_KIND, this._item, this._draftId);
	}

	/**
	 * The panel and the whole playbook as typed: the playbook is what the close guard compares
	 * (_workState), so the two can't drift. Read live, as the page unloads too.
	 */
	get restoreView() {
		let bundle = this._bundle;
		try { bundle = JSON.parse(this._workState()); }
		catch (_err) { /* a window mid-close keeps what it last had */ }
		return {
			tab: this._activeTab,
			bundle,
			source: this._source,
			librarySlug: this._librarySlug ?? null,
			issues: this._issues.filter(i => typeof i?.message === "string").map(i => ({ message: i.message, severity: i.severity })),
			// Open moves by place: refs live only as long as this window.
			openMoves: this._bundle.moves.flatMap((m, i) => (this._openMoves.has(cardRef(m)) ? [i] : [])),
			importBase: this._importBase ?? null,
		};
	}

	/**
	 * Every render follows a change to the bundle (an added card, an import, a save's re-read). Anything
	 * typed and not yet read is read BEFORE the change that renders. A render asked for while a draw is
	 * under way is dropped by core, so until the next draw reads the bundle (getData) one is owed.
	 */
	render(force, options) {
		this._redrawOwed = true;
		return super.render(force, options);
	}

	async _render(force, options = {}) {
		const out = await super._render(force, options);
		// A render asked for while this one was drawing was dropped by core: draw once more, or the
		// window shows the playbook as it was (and a form drawn from a playbook since replaced reads
		// nothing back, _readForm).
		if (this.rendered && this._redrawOwed) this.render(false);
		// A PDF with no text, to be typed in by hand: open it beside the window once the window is up
		// (a new playbook reads its PDF before its first draw, so it waits for that).
		if (this._handTypePdf && this.rendered) {
			const file = this._handTypePdf;
			this._handTypePdf = null;
			const { openPdfBeside } = await import("./PlaybookPdfWindow.js");
			this._pdfWindow = openPdfBeside(file, this, { landscape: this._handTypeLandscape });
		}
		return out;
	}

	async close(options = {}) {
		const out = await super.close(options);
		// The PDF it was typed in from goes with it; a close the GM backed out of keeps both.
		if (!this.rendered) this._pdfWindow?.close();
		return out;
	}

	/**
	 * Put a reload's work back. The close guard is told what the window would have opened with FIRST
	 * (blank, or the playbook as saved), so the work that came back through the reload still counts
	 * as unsaved and closing asks before losing it. A bundle that doesn't read leaves the window as
	 * it opened.
	 */
	_takeRestoredView(view) {
		if (this._restoredView) return;
		this._restoredView = true;
		notePristineWork(this);
		const bundle = view?.bundle ? normalizeBundle(view.bundle).bundle : null;
		if (bundle) this._bundle = bundle;
		if (["builder", "json", "pdf", "library"].includes(view?.source)) this._source = view.source;
		if (typeof view?.librarySlug === "string" && !this._item) this._librarySlug = view.librarySlug;
		if (Array.isArray(view?.issues)) this._issues = view.issues.filter(i => typeof i?.message === "string");
		if (Array.isArray(view?.openMoves)) {
			const moves = this._bundle.moves;
			this._openMoves = new Set(view.openMoves.filter(i => Number.isInteger(i) && moves[i]).map(i => cardRef(moves[i])));
		}
		if (SECTIONS.some(sec => sec.key === view?.tab)) this._activeTab = view.tab;
		if (view?.importBase) this._importBase = normalizeBundle(view.importBase).bundle;
	}

	/**
	 * A playbook saved before write-ins among options to tick became ticks with a blank changes on its
	 * next save, though the diff can't show it (both sides read the same): say so on the first panel.
	 */
	_writeInNotice() {
		if (!this._item) return [];
		let labels;
		try { labels = writeInsChangedOnSave(this._item); }
		catch (err) { console.warn("Stonetop | couldn't check this playbook's write-ins", err); return []; }
		if (!labels.length) return [];
		const list = labels.map(l => `"${l}"`).join(", ");
		return [{ severity: "info", message: `Saving turns the write-in${labels.length === 1 ? "" : "s"} ${list} into ${labels.length === 1 ? "a tick" : "ticks"} with a blank, so ${labels.length === 1 ? "it counts" : "they count"} as a pick. A character who already wrote an answer there keeps it, ticked.` }];
	}

	// ---- What the close guard compares ------------------------------------------------------

	/** The playbook as typed. Also what a reload keeps (`restoreView`). Throws when the form won't read. */
	_workState() {
		this._readForm();
		return JSON.stringify(this._bundle);
	}

	_discardCopy() {
		return {
			title: "Close without saving?",
			body: "This playbook has changes that haven't been saved. Closing now loses them.",
			saveLabel: "Save the playbook",
		};
	}

	async _saveForNow() {
		const saved = await this._save();
		if (saved) this.close({ discard: true });
	}

	// ---- Render ---------------------------------------------------------------------------

	getData() {
		// This draw reads the bundle as it is now: no redraw is owed until it changes again (render).
		this._redrawOwed = false;
		const pb = this._bundle.playbook;
		const activeIndex = Math.max(0, SECTIONS.findIndex(s => s.key === this._activeTab));
		const sectionTitle = s => _sectionTitle(s, pb);
		const gaps = backgroundGaps(this._bundle);
		const holders = this._item ? holdersOfHomebrew(this._item.system.slug, this._item.name) : [];

		const inserts = pb.inserts ?? [];
		const insertByKey = new Map(inserts.map(i => [i.key, i]));
		const ownMoveNames = this._bundle.moves.filter(m => !m.insert).map(m => m.name).filter(Boolean);
		// Where a move can sit: the playbook, an insert (outside its lists), or one of its moves lists.
		const partOptions = [
			{ value: "", label: "The playbook" },
			...inserts.flatMap(i => [
				{ value: `${i.key}::`, label: i.name || "Unnamed insert" },
				...i.lists.filter(l => l.kind === "moves").map(l => ({ value: `${i.key}::${l.key}`, label: `${i.name || "Unnamed insert"}: ${l.title || "unnamed list"}` })),
			]),
		];

		const statArray = parseStatArray(pb.statsNote);
		const hpUnusual = pb.hp < HP_LIMITS.usualMin || pb.hp > HP_LIMITS.usualMax;
		// Open for editing: its pencil was pressed, or it's blank (nothing to show but the text boxes).
		const ed = key => !!this._editing?.has(key);
		const blank = v => !String(v ?? "").trim();
		const boxes = n => Array.from({ length: Math.max(0, Math.min(Number(n) || 0, 20)) }, () => ({}));
		const ownMove = name => this._bundle.moves.find(m => String(m.name ?? "").toLowerCase() === String(name).toLowerCase());
		const adv = pb.advancement ?? {};

		return {
			uid: this.appId,
			// The playbook this form is drawn from (cardRef): a form drawn from another isn't read back.
			bundleRef: cardRef(this._bundle),
			activeTab: this._activeTab,
			// Library playbooks this world doesn't have: Add from my library shows only for some (activateListeners asks).
			libraryCount: this._libraryCount ?? 0,
			sections: SECTIONS.map((s, i) => ({ key: s.key, icon: s.icon, title: sectionTitle(s), selected: i === activeIndex })),
			active: { icon: SECTIONS[activeIndex].icon, title: sectionTitle(SECTIONS[activeIndex]), count: `${activeIndex + 1} / ${SECTIONS.length}` },
			atFirst: activeIndex === 0,
			atLast: activeIndex === SECTIONS.length - 1,

			isSaved: !!this._item,
			holderNames: holders.map(a => a.name).join(", "),
			img: playbookAvatar(this._item?.system?.slug ?? "homebrew-new", { img: pb.img }),
			issues: this._issues.map(i => ({ message: i.message, isError: i.severity === "error" })),
			readReport: this._readReport ?? null,
			pb,
			isDrive: pb.instinctLabel === "Drive",
			// Each page's own pencil: open, or drawn as the playbook prints it. A page with nothing on it
			// opens for typing, except those that may well stay empty (they say so instead).
			pages: {
				playbook: ed("page:playbook") || blank(pb.name),
				stats: ed("page:stats"),
				instincts: ed("page:instincts") || !pb.instincts.length,
				looks: ed("page:looks") || (!pb.appearance.length && !pb.origin.length && blank(pb.originNote)),
				possessions: ed("page:possessions"),
				moves: ed("page:moves"),
				advancement: ed("page:advancement"),
				intro: ed("page:intro"),
				notes: ed("page:notes"),
			},
			read: {
				descriptionHtml: formatPlaybookText(pb.description),
				instincts: pb.instincts.map(x => ({ word: x.word, html: formatPlaybookInline(x.description) })),
				appearance: pb.appearance.map(row => ({ options: row.map(text => ({ text })) })),
				originNoteHtml: formatPlaybookInline(pb.originNote),
				origin: pb.origin.map(o => ({ region: o.region, names: o.writeIn ? "___" : (o.names ?? []).join(", "), question: o.question ?? "" })),
				startingNoteHtml: formatPlaybookInline(pb.startingMovesNote),
				choices: pb.moveChoices.map(c => c.options.join(" or ")),
				groups: pb.moveGroups.map(g => ({ label: g.label, moves: g.moves.join(", ") })),
				hasMovesHead: !blank(pb.startingMovesNote) || pb.moveChoices.length > 0 || pb.moveGroups.length > 0,
				advance: (adv.options ?? []).map(label => ({ html: formatPlaybookInline(label) })),
				advanceIntro: adv.replacesUsual ? "When you Level Up, mark one of these instead of taking a new move:" : "When you Level Up, take a new move and mark one of these as well:",
				advanceNoteHtml: formatPlaybookInline(adv.note),
				advanceUsual: !adv.switchPlaybook && !(adv.options ?? []).length && !adv.switchFromLevel && blank(adv.note),
				step3Html: formatPlaybookInline(pb.introductions.step3),
				step4: pb.introductions.step4 ?? [],
				step6: pb.introductions.step6 ?? [],
				introEmpty: blank(pb.introductions.step3) && !(pb.introductions.step4 ?? []).length && !(pb.introductions.step6 ?? []).length,
				notesHtml: formatPlaybookText(pb.notes),
			},
			damageOptions: DAMAGE_DICE.map(d => ({ value: d, selected: d === pb.damage })),
			statFlag: statArray ? "" : `This note doesn't hand out exactly six scores, so characters will get the book's ${DEFAULT_STAT_ARRAY.map(statScoreLabel).join(", ")} instead.`,
			statPreview: statArray ? statArray.map(statScoreLabel).join(", ") : "",
			hpFlag: hpUnusual ? `Most playbooks start between ${HP_LIMITS.usualMin} and ${HP_LIMITS.usualMax} HP.` : "",

			backgrounds: pb.backgrounds.map((b, i) => ({
				ref: cardRef(b), label: b.label, description: b.description,
				// Its text boxes, or as the PDF prints it. A blank one (just added) opens for typing.
				editing: ed(`bg:${cardRef(b)}`) || (blank(b.label) && blank(b.description)),
				descriptionHtml: formatPlaybookText(backgroundWordsInPlace(b.description, ownMove)),
				trackBoxes: boxes(b.track?.max),
				movesText: L.nameList(b.moves), moveChoiceText: L.nameList(b.moveChoice),
				foreign: gaps[i].foreign.join(", "),
				possessionsText: L.nameList(b.possessions ?? []),
				unknownPossessions: gaps[i].unknownPossessions.join(", "),
				trackLabel: b.track?.label ?? "",
				trackMax: b.track?.max ?? "",
			})),
			instinctsText: L.instinctLines(pb.instincts),
			appearanceText: L.appearanceLines(pb.appearance),
			originText: L.originLines(pb.origin),
			// The playbook's own Level Up: one advance per line, and what each was read as doing.
			advancementText: L.lineList(pb.advancement?.options ?? []),
			advancementRead: (pb.advancement?.options ?? []).map(label => ({ label, does: _advanceDoes(advanceFrom(label)) })),
			possessions: pb.possessions.options.map(o => ({
				...o, ref: cardRef(o),
				editing: ed(`pos:${cardRef(o)}`) || (blank(o.label) && blank(o.description)),
				descriptionHtml: formatPlaybookText(o.description),
			})),
			choicesText: L.choiceLines(pb.moveChoices),
			groupsText: L.groupLines(pb.moveGroups),

			moves: this._bundle.moves.map(m => ({
				...m,
				ref: cardRef(m),
				// Its text boxes while open (its pencil pressed, or a new one with no name yet), else as printed.
				open: this._openMoves.has(cardRef(m)) || blank(m.name),
				descriptionHtml: formatPlaybookText(m.description),
				trackBoxes: boxes(m.resource?.max),
				summaryTags: [m.insert ? `in ${insertByKey.get(m.insert)?.name || "an insert"}` : "", m.starting ? (m.insert ? "always held" : "starting") : "", m.level > 1 ? `level ${m.level}+` : "", m.repeatMax > 1 ? `up to ${m.repeatMax} times` : "", m.rollType ? `roll +${m.rollType.toUpperCase()}` : "", m.resource ? `${m.resource.title || "track"} ×${m.resource.max}` : ""].filter(Boolean).join(" · "),
				requiresMovesText: L.nameList(m.requiresMoves),
				rollOptions: [
					{ value: "", label: "No roll", selected: !m.rollType },
					...STAT_KEYS.map(k => ({ value: k, label: `+${k.toUpperCase()}`, selected: m.rollType === k })),
					{ value: "ask", label: "Player chooses the stat", selected: m.rollType === "ask" },
				],
				cap: m.cap || "",
				marksText: L.lineList(m.marks ?? []),
				markCount: m.markCount ?? 1,
				resourceMax: m.resource?.max ?? "",
				resourceTitle: m.resource?.title ?? "",
				resourceLabels: L.nameList(m.resource?.labels ?? []),
				holdSuccess: m.resource?.holdOnRoll?.success ?? "",
				holdPartial: m.resource?.holdOnRoll?.partial ?? "",
				holdFailure: m.resource?.holdOnRoll?.failure ?? "",
				partOptions: partOptions.map(o => ({ ...o, selected: o.value === partOf(m) })),
				showPartOf: inserts.length > 0,
			})),
			moveCount: this._bundle.moves.length,
			startingCount: this._bundle.moves.filter(m => m.starting && !m.insert).length,
			insertMoveCount: this._bundle.moves.filter(m => m.insert).length,

			inserts: inserts.map(ins => {
				const opener = this._bundle.moves.find(m => m.name && m.name === ins.unlockedBy);
				const flags = [];
				if (opener?.insert) flags.push(`"${ins.unlockedBy}" is one of this insert's own moves, so no character could ever open it. Pick one of the playbook's moves.`);
				else if (ins.unlockedBy && !opener) flags.push(`No move here is called "${ins.unlockedBy}", so no character will see this insert until one is.`);
				if (!ins.lists.length) flags.push("It has no lists yet.");
				return {
					ref: cardRef(ins), key: ins.key, name: ins.name, description: ins.description,
					editing: ed(`ins:${cardRef(ins)}`) || blank(ins.name),
					descriptionHtml: formatPlaybookText(ins.description),
					openedBy: ins.unlockedBy || "",
					formEnabled: !!ins.form?.enabled, formOn: ins.form?.on ?? INSERT_FORM_DEFAULTS.on, formOff: ins.form?.off ?? INSERT_FORM_DEFAULTS.off,
					flags,
					openerOptions: [
						{ value: "", label: "No move: every character has it", selected: !ins.unlockedBy },
						// A name that isn't a move (yet) stays offered, so reading the form back keeps it.
						...(ins.unlockedBy && !ownMoveNames.includes(ins.unlockedBy) ? [{ value: ins.unlockedBy, label: `${ins.unlockedBy} (no such move)`, selected: true }] : []),
						...ownMoveNames.map(n => ({ value: n, label: n, selected: n === ins.unlockedBy })),
					],
					lists: ins.lists.map(l => ({
						insertRef: cardRef(ins), ref: cardRef(l), key: l.key, title: l.title, prompt: l.prompt,
						isMoves: l.kind === "moves",
						kindOptions: [
							{ value: "pick", label: "Options to tick", selected: l.kind !== "moves" },
							{ value: "moves", label: "Moves to pick from", selected: l.kind === "moves" },
						],
						pick: l.pick, min: l.min, perUnlock: l.perUnlock,
						bonusText: L.bonusPickList(l.bonusPicks),
						optionsText: L.insertOptionLines(l.options),
						promptHtml: formatPlaybookInline(l.prompt),
						optionsRead: (l.options ?? []).map(o => ({ html: formatPlaybookInline(o.description), ticked: !!o.preselected, boxes: boxes(Math.max(1, o.max || 1)) })),
						moveNames: this._bundle.moves.filter(m => m.insert === ins.key && m.insertList === l.key).map(m => m.name).join(", "),
						pickFlag: l.pick > 0 ? "" : "Pick 0: nobody can take anything from it.",
					})),
					looseMoves: this._bundle.moves.filter(m => m.insert === ins.key && !m.insertList).map(m => `${m.name}${m.starting ? " (always held)" : ""}`).join(", "),
				};
			}),

			lore: pb.lore.map((s, i, all) => ({
				ref: cardRef(s), title: s.title, description: s.description,
				// A section with no options is a heading over every question after it, up to the next
				// heading (onboarding's _nearestFoldedHeaderIndex): the Builder frames them together.
				...loreGroupShape(all, i),
				editing: ed(`lore:${cardRef(s)}`) || (blank(s.title) && blank(s.description) && !s.options.length),
				descriptionHtml: formatPlaybookInline(s.description),
				optionsRead: s.options.map(o => ({ html: formatPlaybookInline(o.description), writeIn: !!o.freeText, boxes: boxes(Math.max(1, o.max || 1)) })),
				optionsText: L.loreOptionLines(s.options),
				pickNote: _lorePickNote(s),
			})),
			step4Text: L.lineList(pb.introductions.step4),
			step6Text: L.lineList(pb.introductions.step6),
		};
	}

	/**
	 * Shown to players or not, as an eye in the window's header left of Close (it was a checkbox on the
	 * Playbook panel). Open: players see the playbook in their picker; closed: only the GM does. On a
	 * saved playbook it takes effect at once (players' pickers read the saved Item); on a new one it is
	 * kept with the rest of the window and saved with it.
	 */
	_getHeaderButtons() {
		const buttons = super._getHeaderButtons();
		buttons.unshift({ label: "", class: "stonetop-pb-builder-shown", icon: "fas fa-eye", onclick: ev => this._toggleShown(ev) });
		return buttons;
	}

	/** The eye drawn as the playbook stands: its glyph, words for its tooltip and a screen reader, its state. */
	_drawShown() {
		const eye = this.element?.[0]?.querySelector(".window-header .stonetop-pb-builder-shown");
		if (!eye) return;
		const shown = !!this._bundle.playbook.published;
		const icon = eye.querySelector("i");
		if (icon) icon.className = `fas ${shown ? "fa-eye" : "fa-eye-slash"}`;
		const words = shown
			? "Shown to players: they can pick it in the playbook picker. Click to hide it from them."
			: "Hidden from players: only you see it in the playbook picker. Click to show it to them.";
		eye.dataset.tooltip = words;
		eye.setAttribute("aria-label", words);
		eye.setAttribute("role", "button");
		eye.setAttribute("aria-pressed", String(shown));
		eye.classList.toggle("is-hidden", !shown);
	}

	async _toggleShown(ev) {
		ev?.preventDefault?.();
		this._readForm();
		const shown = !this._bundle.playbook.published;
		this._bundle.playbook.published = shown;
		this._drawShown();
		persistOpenWindowsSoon();
		if (!this._item) return;
		// A saved playbook: straight onto it, and onto what the close guard counts as saved, so the
		// eye alone never reads as unsaved work.
		try {
			// A plain update, not setFlag: "stonetop" is the shipped content's scope, not this system's
			// id, and setFlag refuses any scope that isn't the system's or an active module's.
			await this._item.update({ [`flags.${ITEM_FLAG_SCOPE}.homebrew.published`]: shown });
			if (typeof this._pristineWork === "string") {
				const was = JSON.parse(this._pristineWork);
				if (was?.playbook) { was.playbook.published = shown; this._pristineWork = JSON.stringify(was); }
			}
			ui.notifications.info(shown ? `Players can pick ${this._item.name} now.` : `${this._item.name} is hidden from players.`);
		} catch (err) {
			console.error("Stonetop | couldn't change whether players see this playbook", err);
			ui.notifications.error("Couldn't change whether players see this playbook. Try again, or press Save.");
			this._bundle.playbook.published = !shown;
			this._drawShown();
		}
	}

	activateListeners(html) {
		super.activateListeners(html);
		this._drawShown();
		const root = html[0];
		root.querySelectorAll(".stonetop-pb-builder-tab").forEach(btn =>
			btn.addEventListener("click", () => this._selectTab(root, btn.dataset.tab)));
		root.querySelector(".stonetop-pb-builder-back")?.addEventListener("click", () => this._step(root, -1));
		root.querySelector(".stonetop-pb-builder-next")?.addEventListener("click", () => this._step(root, 1));

		// A move's name is its summary line: keep it current as it is typed, without a render.
		root.querySelectorAll(".stonetop-pb-builder-move [data-field$='.name']").forEach(input => input.addEventListener("input", () => {
			const label = input.closest(".stonetop-pb-builder-move")?.querySelector(".stonetop-pb-builder-move-name");
			if (label) label.textContent = input.value.trim() || "New move";
		}));

		// A move's words, once written, fill in its roll, results and track where those are still empty,
		// as an imported move's are: a playbook typed in by hand (one with no text in its PDF) needn't
		// split every "on a 10+ … on a 7-9 …" into its boxes by hand.
		root.querySelectorAll(".stonetop-pb-builder-move textarea[data-field$='.description']").forEach(area => area.addEventListener("change", () => {
			fillMoveFromWords(area.closest(".stonetop-pb-builder-move"), area.value);
		}));

		root.querySelectorAll("[data-action]").forEach(el => el.addEventListener("click", ev => this._onAction(ev, el.dataset.action, el.dataset)));
		// A pencil or check is an <a role=button> (the sheets' own): Enter and Space press it, as a button's would.
		root.querySelectorAll("a[role=button][data-action]").forEach(el => el.addEventListener("keydown", ev => {
			if (ev.key !== "Enter" && ev.key !== " ") return;
			ev.preventDefault();
			el.click();
		}));
		// Typing never re-renders, so it saves the window for a reload itself (`restoreView`).
		persistOnTyping(root);
		// Read a PDF or playbook file: one picker for both, the file says which.
		root.querySelector(".stonetop-pb-builder-pdf-file")?.addEventListener("change", ev => this._readPicked(ev.currentTarget));
		// Add from my library shows only when the library holds a playbook this world doesn't. Asked once
		// per window (and again after a save): it reads the server's library folder.
		if (!this._libraryAsked) {
			this._libraryAsked = true;
			import("./playbook-library.js").then(({ libraryPlaybooksNotHere }) => libraryPlaybooksNotHere()).then(list => {
				const n = list?.length ?? 0;
				if (n === (this._libraryCount ?? 0)) return;
				this._libraryCount = n;
				if (this.rendered) this.render(false);
			}).catch(err => console.warn("Stonetop | couldn't read the playbook library", err));
		}
		// A PDF or a shared playbook file dropped anywhere on the window is read as if it were picked.
		root.addEventListener("dragover", ev => { if (droppedFileKind(ev.dataTransfer, { peek: true })) ev.preventDefault(); });
		root.addEventListener("drop", ev => {
			const kind = droppedFileKind(ev.dataTransfer);
			if (!kind) return;
			ev.preventDefault();
			ev.stopPropagation();
			this.readDroppedFile(ev.dataTransfer.files[0], kind);
		});
	}

	_step(root, delta) {
		const next = guideRailStep(SECTIONS, this._activeTab, delta);
		if (next) this._selectTab(root, next.key);
	}

	_selectTab(root, key) {
		const index = SECTIONS.findIndex(s => s.key === key);
		if (index < 0) return;
		this._activeTab = key;
		const active = SECTIONS[index];
		const title = _sectionTitle(active, this._bundle.playbook);
		applyGuideRail(root, {
			key, dataKey: "tab",
			tabSelector: ".stonetop-pb-builder-tab",
			sectionSelector: ".stonetop-pb-builder-section",
			iconSelector: ".stonetop-pb-builder-banner-icon",
			icon: active.icon,
			iconExtraClass: "stonetop-pb-builder-banner-icon",
			mainSelector: ".stonetop-pb-builder-main",
			titleSelector: ".stonetop-pb-builder-banner-title", title,
			countSelector: ".stonetop-pb-builder-banner-count",
			backSelector: ".stonetop-pb-builder-back", nextSelector: ".stonetop-pb-builder-next",
			index, total: SECTIONS.length,
		});
	}

	// ---- Form -> bundle -------------------------------------------------------------------

	/**
	 * Read every field back into the bundle. Does nothing before the first render, nor for a form drawn
	 * from a playbook since replaced (an import, a save's re-read; `data-bundle`): its fields are another
	 * playbook's. A field names its card by ref (cardRef), so one whose card has gone writes nothing.
	 */
	_readForm() {
		const root = this.element?.[0];
		const form = root?.querySelector?.("[data-bundle]");
		if (!form || form.dataset.bundle !== cardRef(this._bundle)) return;
		const write = (path, value) => {
			const at = resolveRefPath(this._bundle, path);
			if (at) L.setBundlePath(this._bundle, at, value);
		};
		for (const el of form.querySelectorAll("[data-field]")) {
			let value;
			if (el.dataset.parse) {
				const parse = FIELD_PARSERS[el.dataset.parse];
				if (!parse) continue;
				value = parse(el.value);
			} else if (el.type === "checkbox") value = el.checked;
			else if (el.dataset.kind === "int") value = Math.trunc(Number(el.value) || 0);
			else value = el.value;
			write(el.dataset.field, value);
		}
		const moveOf = ref => this._bundle.moves[indexOfRef(this._bundle.moves, ref)];
		// Which insert (and moves list) a move is part of.
		for (const el of form.querySelectorAll("[data-insert-ref]")) {
			const move = moveOf(el.dataset.insertRef);
			if (move) Object.assign(move, readPartOf(el.value));
		}
		// A move's resource track: a max of 0 is no track at all.
		for (const el of form.querySelectorAll("[data-resource]")) {
			const move = moveOf(el.dataset.resource);
			if (!move) continue;
			const max = Math.trunc(Number(el.querySelector("[name=resourceMax]")?.value) || 0);
			move.resource = max > 0 ? {
				max: Math.min(max, 20),
				title: el.querySelector("[name=resourceTitle]")?.value?.trim() ?? "",
				labels: L.parseNameList(el.querySelector("[name=resourceLabels]")?.value),
				// Empty boxes leave it to the move's words (homebrew-bundle.js#holdOnRollFrom).
				holdOnRoll: {
					success: Math.trunc(Number(el.querySelector("[name=holdSuccess]")?.value) || 0),
					partial: Math.trunc(Number(el.querySelector("[name=holdPartial]")?.value) || 0),
					// All three results, or a save drops what a miss holds ("on a miss, hold 1").
					failure: Math.trunc(Number(el.querySelector("[name=holdFailure]")?.value) || 0),
				},
			} : null;
		}
	}

	async _onAction(ev, action, data) {
		ev.preventDefault();
		this._readForm();
		const pb = this._bundle.playbook;
		// The card pressed on, by its ref; and a card dropped from a list closes with it.
		const ref = data.ref;
		const drop = (list, kind) => {
			const at = indexOfRef(list, ref);
			if (at < 0) return null;
			this._editing.delete(`${kind}:${ref}`);
			return list.splice(at, 1)[0];
		};
		const insert = pb.inserts?.[indexOfRef(pb.inserts, data.insert ?? ref)];
		switch (action) {
			// A pencil, and its check: a page's or a card's text boxes, or back to how the PDF prints it.
			case "edit-part": if (data.part) this._editing.add(data.part); break;
			case "done-part": this._editing.delete(data.part); break;
			case "edit-move": if (ref) this._openMoves.add(ref); break;
			case "done-move": this._openMoves.delete(ref); break;
			case "add-background": { const bg = blankBackground(); pb.backgrounds.push(bg); this._editing.add(`bg:${cardRef(bg)}`); break; }
			case "remove-background": drop(pb.backgrounds, "bg"); break;
			case "add-possession": { const pos = blankPossession(); pb.possessions.options.push(pos); this._editing.add(`pos:${cardRef(pos)}`); break; }
			case "remove-possession": drop(pb.possessions.options, "pos"); break;
			case "add-lore": { const lore = blankLore(); pb.lore.push(lore); this._editing.add(`lore:${cardRef(lore)}`); break; }
			case "remove-lore": drop(pb.lore, "lore"); break;
			case "add-insert": {
				pb.inserts ??= [];
				const ins = blankInsert(freshKey("insert", pb.inserts.map(x => x.key)));
				pb.inserts.push(ins);
				this._editing.add(`ins:${cardRef(ins)}`);
				break;
			}
			case "remove-insert": {
				const gone = drop(pb.inserts, "ins");
				// Its moves stay, as the playbook's own: removing the insert never loses a move.
				if (gone) for (const m of this._bundle.moves) if (m.insert === gone.key) { m.insert = ""; m.insertList = ""; }
				break;
			}
			case "add-insert-list": {
				if (insert) insert.lists.push(blankInsertList(freshKey("list", insert.lists.map(x => x.key))));
				break;
			}
			case "remove-insert-list": {
				const gone = insert ? drop(insert.lists, "list") : null;
				if (gone) for (const m of this._bundle.moves) if (m.insert === insert.key && m.insertList === gone.key) m.insertList = "";
				break;
			}
			case "add-move": {
				const move = normalizeMove({ name: "" });
				this._bundle.moves.push(move);
				this._openMoves.add(cardRef(move));
				break;
			}
			case "remove-move": {
				if (drop(this._bundle.moves, "move")) this._openMoves.delete(ref);
				break;
			}
			case "pick-image": return this._pickImage();
			// Not _guardBusy: that keeps the button greyed after it opens the cutter, until a redraw.
			case "cut-image": return this._cutImage();
			case "from-library": return this._guardBusy(ev, () => this._fromLibrary());
			case "read-pdf": return this.element?.[0]?.querySelector(".stonetop-pb-builder-pdf-file")?.click();
			case "save": return this._guardBusy(ev, () => this._save());
			case "delete": return this._delete();
			case "try": return this._guardBusy(ev, () => this._tryIt());
			case "close": return this.close();
			default: return;
		}
		this.render(false);
	}

	// ---- Picture --------------------------------------------------------------------------

	_pickImage() {
		const FP = filePicker();
		new FP({
			type: "image",
			current: this._bundle.playbook.img || "",
			callback: path => { this._readForm(); this._bundle.playbook.img = path; this.render(false); },
		}).render(true);
	}

	// ---- Save / delete --------------------------------------------------------------------

	/**
	 * @param {{quiet?: boolean}} [o]  `quiet` leaves out the "Saved" note, for a caller that says so itself
	 * @returns {Promise<boolean>} whether it saved
	 */
	async _save({ quiet = false } = {}) {
		this._readForm();
		const problem = saveProblem(normalizeBundle(this._bundle).bundle ?? this._bundle, this._item);
		if (problem) {
			ui.notifications.warn(problem.message);
			if (["empty", "shipped", "taken", "held"].includes(problem.code)) {
				const root = this.element?.[0];
				if (root) { this._selectTab(root, "playbook"); root.querySelector("[data-field='playbook.name']")?.focus(); }
			}
			return false;
		}
		try {
			// A playbook taken from the library keeps the slug it has there, so this world's copy and the
				// library's stay one playbook (and a character from the other world links to it).
				const { item } = await saveHomebrewPlaybook(this._bundle, {
					existing: this._item, source: this._source, slug: !this._item && this._source === "library" ? this._librarySlug : null,
					// The playbook as the PDF or file read, kept for the next import to merge over (mergeReimport).
					importBase: this._importBase ?? null,
				});
				this._librarySlug = null;
				this._importBase = null;
			this._item = item;
			const was = this._bundle;
			this._bundle = readHomebrewBundle(item);
			// The cards open for editing stay open (the form drawn before the save is not read again).
			carryRefs(was, this._bundle);
			this._issues = [];
			this._readReport = null;
			// What is saved is the new untouched state, taken as the window first opened with it: after
			// the redraw, read back through the form (StonetopDialog#_render). Taken from the bundle
			// itself, a box that reads back a little differently (an empty stat cap's null is 0 in its
			// box) made a window that had just saved count as unsaved.
			this._pristineWork = null;
			const shown = this._bundle.playbook.published ? "Players can pick it now." : "It's hidden from players: the eye at the top of this window shows it to them.";
			if (!quiet) ui.notifications.info(`Saved ${item.name}. ${shown}`);
			// One added from the library is here now: ask the library again on this draw.
			this._libraryAsked = false;
			this.render(false);
			await offerToRefreshCopies(item);
			return true;
		} catch (err) {
			console.error("Stonetop | couldn't save that homebrew playbook", err);
			ui.notifications.error(err?.message || "Couldn't save the playbook. See the console for details.");
			return false;
		}
	}

	/**
	 * Walk character creation with this playbook, the way a player will, without making anyone:
	 * the walkthrough is opened with no character behind it, and finishing it saves nothing. The
	 * playbook is read from the world (its moves are world Items), so unsaved changes are saved first.
	 */
	async _tryIt() {
		if (!this._item || hasUnsavedWork(this)) {
			const go = await askWithButtons({
				title: "Save before trying it?",
				content: "<p>Character creation reads the saved playbook, so your changes need saving first. Saving shows it to players unless the eye at the top of this window is closed.</p>",
				buttons: [{ key: "save", label: "Save and try it", icon: "fa-floppy-disk", value: true }],
				defaultKey: false,
			});
			if (go !== true || !(await this._save())) return;
		}
		const { CharacterOnboardingDialog } = await import("../actors/character/dialogs/CharacterOnboardingDialog.js");
		new CharacterOnboardingDialog(this._item, async () => {
			ui.notifications.info(`That's how a player builds a character with ${this._item.name}. Nothing was saved; it was a trial run.`);
		}, { title: `Trying ${this._item.name} (nothing is saved)` }).render(true);
	}

	async _delete() {
		if (!this._item) return;
		const holders = holdersOfHomebrew(this._item.system.slug, this._item.name);
		const warn = holders.length
			? `<p><strong>${escHtml(holders.map(a => a.name).join(", "))}</strong> play${holders.length === 1 ? "s" : ""} this playbook. Their sheets keep the moves they already took, but their playbook will no longer be found.</p>`
			: "";
		const answer = await askWithButtons({
			title: `Delete ${this._item.name}?`,
			content: `<p>This deletes the playbook and its moves from this world. Your other worlds keep theirs, and this world won't get it back from your playbook library unless you add it again (Add from my library, at the top of the Playbook Builder).</p>${warn}`,
			buttons: [{ key: "delete", label: "Delete the playbook", icon: "fa-trash", className: "stonetop-dialog-btn--danger", value: true }],
			defaultKey: false,
		});
		if (answer !== true) return;
		await deleteHomebrewPlaybook(this._item);
		ui.notifications.info(`Deleted ${this._item.name}.`);
		this.close({ discard: true });
	}

	// ---- JSON -----------------------------------------------------------------------------

	/**
	 * An imported playbook that this world already has (same name, or the window is editing it):
	 * offer to UPDATE that one, so every character who plays it stays linked, and say what changed
	 * since the saved version. Otherwise it becomes a playbook of its own. Changes `bundle` (its
	 * slug, and keeps the saved one's shown-to-players eye) and `this._item`.
	 *
	 * @returns {Promise<{saved: object|null}|null>}  the saved version it updates (null for a playbook
	 *   of its own), or null when the GM backed out
	 */
	async _linkToExisting(bundle) {
		const name = bundle.playbook.name.trim().toLowerCase();
		const slug = bundle.playbook.slug;
		const editing = this._item && (this._item.name.toLowerCase() === name || (slug && this._item.system.slug === slug)) ? this._item : null;
		// A shared file carries its slug, so it finds its own playbook even under a new name.
		const same = editing ?? importCollision(bundle) ?? homebrewPlaybookByName(bundle.playbook.name);
		if (!same) {
			this._item = null;
			bundle.playbook.slug = "";
			// A playbook of its own: shown to players, as a new one is (the eye in the header hides it).
			bundle.playbook.published = true;
			return { saved: null };
		}
		if (!editing) {
			const holders = holdersOfHomebrew(same.system.slug, same.name);
			const choice = await askWithButtons({
				title: `${same.name} is already in this world`,
				content: `<p>This looks like a version of <strong>${escHtml(same.name)}</strong>, which this world already has${holders.length ? ` and ${holders.length === 1 ? "one character plays" : `${holders.length} characters play`}` : ""}. Update that playbook, so ${holders.length ? "they stay" : "anyone who plays it stays"} linked to it? Or keep this as a separate playbook?</p>`,
				buttons: [
					{ key: "update", label: `Update ${same.name}`, icon: "fa-rotate", value: "update" },
					{ key: "copy", label: "Keep it separate", icon: "fa-copy", value: "copy" },
				],
				defaultKey: false,
			});
			if (!choice) return null;
			if (choice === "copy") {
				this._item = null;
				bundle.playbook.slug = "";
				bundle.playbook.name = `${bundle.playbook.name} (new version)`;
				return { saved: null };
			}
		}
		this._item = same;
		bundle.playbook.slug = same.system.slug;
		const saved = readHomebrewBundle(same);
		bundle.playbook.published = !!saved?.playbook?.published;
		return { saved };
	}

	/** Ask before an import or a PDF read throws away unsaved edits. @returns {Promise<boolean>} */
	async _mayReplace(what) {
		if (!hasUnsavedWork(this) || isBlankBundle(this._bundle)) return true;
		const go = await askWithButtons({
			title: "Replace what's in the builder?",
			content: `<p>${what} replaces everything in this window, and what you've changed here hasn't been saved.</p>`,
			buttons: [{ key: "replace", label: "Replace it", icon: "fa-file-import", value: true }],
			defaultKey: false,
		});
		return go === true;
	}

	async _importJson(input) {
		const file = input?.files?.[0];
		if (input) input.value = "";
		if (!file) return;
		const { bundle, issues } = await readBundleFile(file);
		if (!bundle) {
			ui.notifications.error(issues[0]?.message ?? "That file couldn't be read.");
			return;
		}
		if (!(await this._mayReplace("Importing that file"))) return;
		// The same playbook already in this world (its slug, else its name) is updated in place on
		// Save, so the characters who hold it stay linked; or the import becomes one of its own.
		if (await this._adopt(bundle, { source: "json", issues })) this.render(false);
	}

	/**
	 * `issues` without the notes about background moves borrowed from other playbooks ("Frosty from
	 * the Heavy") when every move a note names is found in this world, spelled loosely as character
	 * creation matches it (findOtherPlaybookMoves): those moves already work, so the note is noise.
	 */
	async _withoutFoundBorrowed(issues, ownName) {
		const borrowed = issues.filter(i => i?.borrowed?.length);
		if (!borrowed.length) return issues;
		try {
			const { FoundryMoveRepository, findOtherPlaybookMoves } = await import("../actors/character/repositories/FoundryMoveRepository.js");
			const names = [...new Set(borrowed.flatMap(i => i.borrowed))];
			const found = new Set((await findOtherPlaybookMoves(new FoundryMoveRepository(), names, { except: [ownName] })).map(e => looseName(e.name)));
			return issues.filter(i => !i?.borrowed?.length || !i.borrowed.every(n => found.has(looseName(n))));
		} catch (err) {
			console.warn("Stonetop | couldn't look up the borrowed background moves", err);
			return issues;
		}
	}

	/**
	 * Take an imported bundle into the window: link it to the same playbook already in this world
	 * (_linkToExisting), then show it with what its reading reported under what changed since the
	 * saved version. The caller renders. @returns {Promise<boolean>} false when the GM backed out
	 */
	async _adopt(bundle, { source, issues = [], readReport = null }) {
		const link = await this._linkToExisting(bundle);
		if (!link) return false;
		// An import is kept as it was READ, for the next one to merge over (mergeReimport); a library
		// copy is someone's finished playbook, not a reading.
		const read = ["pdf", "json"].includes(source) ? normalizeBundle(bundle).bundle : null;
		const changes = [];
		if (link.saved) {
			// Updating a playbook this world has, that an earlier import made: keep what the GM fixed by
			// hand wherever the new PDF says what the old one did.
			const base = read ? readImportBase(this._item) : null;
			if (base) {
				const merged = mergeReimport({ base, mine: link.saved, theirs: bundle });
				bundle = merged.bundle;
				if (merged.kept.length) changes.push({ severity: "info", message: `Kept your own changes to ${merged.kept.join(", ")}: the new version says what the old one did there.` });
				if (merged.replaced.length) changes.push({ severity: "check", message: `You had changed ${merged.replaced.join(", ")}, and the new version changes ${merged.replaced.length === 1 ? "it" : "them"} too: the new words are in. Check ${merged.replaced.length === 1 ? "it" : "them"} before you save.` });
			}
			const { lines } = diffBundles(link.saved, bundle);
			changes.unshift(...(lines.length
				? lines.map(message => ({ severity: "info", message: `Since the saved version: ${message}` }))
				: [{ severity: "info", message: "Nothing has changed since the saved version." }]));
		}
		// Only this reading: a library copy, or an import the GM then swapped for a library pick,
		// leaves nothing to merge a later import over (the saved playbook keeps any base it had).
		this._importBase = read;
		this._bundle = bundle;
		this._issues = [...changes, ...(await this._withoutFoundBorrowed(issues, bundle.playbook.name))];
		this._readReport = readReport;
		this._source = source;
		// What was open for editing was the last playbook's cards: the new one opens closed.
		this._openMoves.clear();
		this._editing.clear();
		return true;
	}

	/**
	 * Fill the window from the GM's playbook library (playbook-library.js): a playbook saved in
	 * another world that this one doesn't have, deleted ones included (that's the way back for one).
	 * Like an import, nothing is kept until Save; Save keeps the library's slug.
	 */
	async _fromLibrary() {
		const { libraryPlaybooksNotHere } = await import("./playbook-library.js");
		const entries = await libraryPlaybooksNotHere();
		if (!entries.length) {
			ui.notifications.info("Your playbook library has nothing this world doesn't already have. A homebrew playbook goes in the library when you save it in any of your worlds.");
			return;
		}
		const rows = entries.map((e, i) => {
			// The house radio list (Spend Loyalty's), skin and centring included.
			const by = e.bundle.playbook.author ? ` <em class="stonetop-spend-note">(by ${escHtml(e.bundle.playbook.author)})</em>` : "";
			return `<label class="stonetop-spend-choice"><input type="radio" class="stonetop-spend-radio" name="libraryPick" value="${i}"${i === 0 ? " checked" : ""}> <span>${escHtml(e.bundle.playbook.name)}${by}</span></label>`;
		}).join("");
		const pick = await askWithButtons({
			title: "Add from my library",
			content: `<p>Homebrew playbooks you saved in your other worlds that this world doesn't have:</p><div class="stonetop-spend-form">${rows}</div>`,
			buttons: [{
				key: "add", label: "Open it here", icon: "fa-book-open",
				value: form => {
					const checked = form?.querySelector?.("input[name='libraryPick']:checked");
					return checked ? Number(checked.value) : null;
				},
			}],
		});
		const entry = Number.isInteger(pick) ? entries[pick] : null;
		if (!entry) return;
		if (!(await this._mayReplace("Opening a playbook from your library"))) return;
		const bundle = structuredClone(entry.bundle);
		if (!(await this._adopt(bundle, { source: "library" }))) return;
		this._librarySlug = this._item ? null : entry.slug;
		this._issues.push({ severity: "info", message: `From your playbook library. Press Save to add ${bundle.playbook.name} to this world.` });
		this.render(false);
	}

	/** The file picked with Read a PDF or playbook file: read as the kind it is. */
	_readPicked(input) {
		const file = input?.files?.[0];
		if (input) input.value = "";
		if (!file) return null;
		const kind = fileKindOf(file);
		if (!kind) {
			ui.notifications.warn(`${file.name} isn't a PDF or a playbook file. Pick a playbook's PDF, or a .json playbook file someone shared.`);
			return null;
		}
		return this.readDroppedFile(file, kind);
	}

	/** Read a file dropped on the window (or on the Items sidebar): a PDF, or a shared playbook file. */
	readDroppedFile(file, kind) {
		const input = { files: [file] };
		return kind === "pdf" ? this._readPdf(input) : this._importJson(input);
	}

	// ---- PDF ------------------------------------------------------------------------------

	/**
	 * Fill the builder from a playbook PDF the GM picked (pdf/read-playbook.js). The file is read
	 * in memory and dropped; nothing is uploaded, and nothing is saved until the GM presses Save.
	 * Nothing reaches players until Save; then it shows in their picker unless the header's eye hides it.
	 *
	 * @returns {Promise<"read"|"by-hand"|"saved"|null>} "read" once the window holds the playbook;
	 *   "by-hand" when the PDF had no text and the GM chose to type it in; "saved" for a known playbook
	 *   read whole, saved and announced without the builder (_saveKnown); null for anything else (no
	 *   file, a file that wouldn't read, a review backed out of). New playbooks (startNewPlaybook) go on that.
	 */
	async _readPdf(input) {
		const file = input?.files?.[0];
		if (input) input.value = "";
		if (!file) return null;
		if (!(await this._mayReplace("Reading a PDF"))) return null;
		let result, runs, known = null, knownPlaybooks = null;
		try {
			ui.notifications.info(`Reading ${file.name}…`);
			const [{ loadPdfjs }, { readPageRuns }, { readPlaybook }, knownModule] = await Promise.all([
				import("../utils/pdfjs-loader.js"),
				import("./pdf/pdf-text-source.js"),
				import("./pdf/read-playbook.js"),
				import("./known/known-playbooks.js"),
			]);
			knownPlaybooks = knownModule;
			const bytes = new Uint8Array(await file.arrayBuffer());
			// A third-party playbook the system knows (known/known-playbooks.js), by its bytes: read as any
			// other, then settled as it should be. pdf.js takes the bytes it is handed, so it gets a copy.
			known = await knownPlaybooks.knownPlaybookFor(bytes);
			runs = await readPageRuns(await loadPdfjs(), bytes.slice(), { glyphTables: knownPlaybooks.glyphTablesFor(known) });
			result = readPlaybook(runs);
		} catch (err) {
			console.error("Stonetop | couldn't read that PDF", err);
			ui.notifications.error("That PDF couldn't be opened. Is it a PDF file, and not password-protected?");
			return null;
		}
		if (result.report.noText) {
			if ((await explainNoTextPdf(file.name)) !== true) return null;
			// Something to start from: the playbook's name, as its file name gives it, and the PDF open
			// beside the window to read from while typing.
			this._readForm();
			if (!this._bundle.playbook.name) this._bundle.playbook.name = playbookNameFromFileName(file.name);
			this._handTypePdf = file;
			// A landscape sheet of two columns is too small to read at the window's width: one column fills it.
			this._handTypeLandscape = (runs.pages?.[0]?.w ?? 0) > (runs.pages?.[0]?.h ?? 0);
			if (this.rendered) this.render(false);
			return "by-hand";
		}
		if (result.report.tooLong) {
			await askWithButtons({
				title: "That looks like a book, not a playbook",
				content: `<p><strong>${escHtml(file.name)}</strong> has ${result.report.pageCount} pages. A playbook is a few pages long, so this is probably a rulebook or a collection of playbooks, and reading it here would only fill the builder with the wrong things.</p>`
					+ `<p>Pick the PDF of the one playbook you want. If several playbooks share one PDF, save the pages of the one you want as a PDF of their own and read that.</p>`,
				buttons: [{ key: "ok", label: "Pick another PDF", icon: "fa-file-pdf", value: true }],
				defaultKey: "ok",
			});
			return null;
		}
		if (!result.draft) {
			ui.notifications.error("That PDF couldn't be read. Fill the builder in by hand instead.");
			return null;
		}
		// Its picture, the emblem printed beside its name, taken NOW while the PDF is in hand: the review
		// can finish after a reload, when the PDF is gone. The path rides in the report, which the review
		// keeps across a reload, and _takeReviewed puts it on the playbook. Skipped when this window
		// already has a picture (a re-import keeps the one chosen).
		// The PDF and where its emblem is are kept in memory for Cut from the PDF (a reload asks again).
		this._pdfFile = file;
		this._emblemHint = null;
		if (!this._bundle.playbook.img) {
			result.report.emblemImg = (await this._emblemFromPdf(file, result.report.emblem, result.draft.fields?.name ?? "")) ?? "";
		}
		// A known playbook with nothing left to ask skips the review, as the rulebook's playbooks need
		// none: its pieces are where they belong and its questions are answered. With nothing to check
		// either, it is saved without the builder (_takeReviewed -> _saveKnown).
		if (known && knownPlaybooks.settleKnownDraft(result.draft, known)) {
			const { assemblePlaybook } = await import("./pdf/read-playbook.js");
			const assembled = assemblePlaybook(result.draft);
			knownPlaybooks.finishKnownBundle(assembled.bundle, known);
			return this._takeReviewed(assembled, { fileName: file.name, report: result.report, known });
		}
		// The GM checks the read first: confirms what the PDF can't settle, moves what landed wrong.
		const { PlaybookImportReview } = await import("./PlaybookImportReview.js");
		// The review is told which builder it came from: after a reload nothing is awaiting it, and it
		// hands what it finishes with to this window itself (PlaybookImportReview#_handToBuilder).
		const reviewed = await new PlaybookImportReview({
			draft: result.draft, fileName: file.name, issues: result.report.issues, report: result.report, builderKey: this.restoreKey,
		}).promise();
		if (!reviewed) return null;
		return this._takeReviewed(reviewed, { fileName: file.name, report: result.report });
	}

	/**
	 * The playbook's emblem, cut from its PDF (pdf/pdf-emblem.js) and saved beside the playbook
	 * library (playbook-library.js), so the GM's other worlds that get the playbook get its picture
	 * too. The path, or null when there is none to take or it couldn't be saved; the GM can always
	 * choose a picture by hand.
	 */
	async _emblemFromPdf(file, region, name) {
		if (!region) return null;
		try {
			const [{ loadPdfjs }, { renderEmblem }] = await Promise.all([
				import("../utils/pdfjs-loader.js"),
				import("./pdf/pdf-emblem.js"),
			]);
			const blob = await renderEmblem(await loadPdfjs(), await file.arrayBuffer(), region, { onFound: hint => { this._emblemHint = hint; } });
			if (!blob) return null;
			return await this._savePicture(blob, name);
		} catch (err) {
			console.warn("Stonetop | couldn't take the playbook's emblem from its PDF", err);
			return null;
		}
	}

	/**
	 * A picture made here (the emblem taken from a PDF, or one cut by hand), saved beside the playbook
	 * library so the GM's other worlds that get the playbook get its picture too. A hand cut gets a
	 * name of its own each time: the same path again would show the old picture from the browser's cache.
	 * @returns {Promise<string|null>} its path
	 */
	async _savePicture(blob, name, { fresh = false } = {}) {
		const [{ LIBRARY_DIR }, { ensureDataDir, uploadFile }] = await Promise.all([
			import("./playbook-library.js"),
			import("../utils/foundry-compat.js"),
		]);
		const dir = `${LIBRARY_DIR}/art`;
		await ensureDataDir(LIBRARY_DIR);
		await ensureDataDir(dir);
		const stem = `${slugify(name) || "playbook"}-emblem${fresh ? `-${Date.now().toString(36)}` : ""}`;
		const picture = new File([blob], `${stem}.webp`, { type: "image/webp" });
		return await uploadFile("data", dir, picture);
	}

	/**
	 * Cut from the PDF: the PDF read this session, or one the GM picks now (after a reload, or for a
	 * playbook typed in or loaded from a file), opened in the cutter at the emblem the importer found.
	 */
	async _cutImage() {
		// One cutter at a time: a second press while the PDF is opening would open two.
		if (this._opening) return;
		this._readForm();
		const file = this._pdfFile ?? (await this._pickPdfFile());
		if (!file) return;
		this._opening = true;
		try { await this._openCutter(file); } finally { this._opening = false; }
	}

	async _openCutter(file) {
		if (file !== this._pdfFile) { this._pdfFile = file; this._emblemHint = null; }
		const [{ loadPdfjs }, { openEmblemCutter }] = await Promise.all([
			import("../utils/pdfjs-loader.js"),
			import("./PlaybookEmblemCut.js"),
		]);
		await openEmblemCutter({
			pdfjs: await loadPdfjs(), data: await file.arrayBuffer(), fileName: file.name, hint: this._emblemHint,
			onCut: async blob => {
				let path = null;
				try { path = await this._savePicture(blob, this._bundle.playbook.name || playbookNameFromFileName(file.name), { fresh: true }); }
				catch (err) { console.warn("Stonetop | couldn't save the cut picture", err); }
				if (!path) {
					ui.notifications.error("The picture couldn't be saved. You may not have permission to upload files.");
					return false;
				}
				this._readForm();
				this._bundle.playbook.img = path;
				if (this.rendered) this.render(false);
				return true;
			},
		});
	}

	/** Ask for a PDF with the browser's own file dialog. Resolves to the File, or null if none was picked. */
	_pickPdfFile() {
		return new Promise(resolve => {
			const input = document.createElement("input");
			input.type = "file";
			input.accept = ".pdf,application/pdf";
			input.addEventListener("change", () => resolve(input.files?.[0] ?? null), { once: true });
			input.addEventListener("cancel", () => resolve(null), { once: true });
			input.click();
		});
	}

	/**
	 * Fill the window from a finished import review: what was confirmed there is settled, and what is
	 * left is worth a second look here. Shared by the review this window awaited and one a reload
	 * brought back. The caller has already asked _mayReplace.
	 * @returns {Promise<"read"|null>} null when the bundle didn't read or the GM backed out
	 */
	async _takeReviewed(reviewed, { fileName = "", report = null, known = null } = {}) {
		// The emblem taken when the PDF was read (_readPdf), whichever way the review came back: to the
		// window that opened it, or after a reload to one reopened for it.
		const read = reviewed?.bundle?.playbook;
		if (read && !read.img && !this._bundle?.playbook?.img && typeof report?.emblemImg === "string" && report.emblemImg) read.img = report.emblemImg;
		const { bundle, issues } = normalizeBundle(reviewed?.bundle);
		if (!bundle) return null;
		// Shown to players unless the GM hides it (the eye in the header); one that updates a playbook
		// this world has keeps that one's choice (_linkToExisting).
		bundle.playbook.published = true;
		const adopted = await this._adopt(bundle, {
			source: "pdf",
			issues: [...(report?.issues ?? []).filter(i => i.severity === "missing"), ...(reviewed.issues ?? []), ...issues],
			readReport: { file: fileName, pages: report?.pages ?? [], sections: report?.sections ?? [] },
		});
		if (!adopted) return null;
		this._activeTab = "playbook";
		// The playbook's own moves, and each insert's apart: "33 moves" read as the playbook's own.
		const own = bundle.moves.filter(m => !m.insert).length;
		const inserts = (bundle.playbook.inserts ?? []).map(ins => {
			const n = bundle.moves.filter(m => m.insert === ins.key).length;
			return `the ${ins.name} insert${n ? ` (${n} ${n === 1 ? "move" : "moves"})` : ""}`;
		});
		const bgs = bundle.playbook.backgrounds.length;
		const parts = [`${own} ${own === 1 ? "move" : "moves"}`, `${bgs} ${bgs === 1 ? "background" : "backgrounds"}`, ...inserts];
		const counted = `${parts.slice(0, -1).join(", ")}${parts.length > 1 ? " and " : ""}${parts.at(-1)}`;
		// Asked before the draw below: while a window redraws it doesn't count as rendered.
		const wasOpen = this.rendered;
		// Drawn first: until then an open window's form is the one before the import, which a save
		// mustn't read back over it (nor does it: _readForm reads only a form drawn from this playbook).
		this.render(false);
		// A playbook the system knows (known/known-playbooks.js), read whole with nothing to check: no
		// builder to look over, it's saved and the GM told so.
		if (known && this._issues.every(i => i?.severity === "info")) return this._saveKnown(counted, { wasOpen });
		ui.notifications.info(known
			? `Read ${bundle.playbook.name || fileName}, a playbook the system knows: ${counted}. Check what's marked before you save.`
			: `Read ${bundle.playbook.name || fileName}: ${counted}. Check each panel before you save.`);
		return "read";
	}

	/**
	 * Save a known playbook that came in whole (_takeReviewed) and say so in a small window, rather
	 * than hand the GM the builder to look over and save. The builder stays a press away, to change
	 * anything in it; a save that doesn't go through (its warning says why) shows the builder instead.
	 *
	 * @param {string} counted  what was read, as "34 moves, 4 backgrounds and the Monster Compendium insert"
	 * @param {{wasOpen?: boolean}} [o]  whether the builder was on screen when the PDF was read
	 * @returns {Promise<"read"|"saved">} "read" when the window should show the playbook (the GM asked
	 *   to open it, or the save didn't go through); "saved" when there's nothing more to show
	 */
	async _saveKnown(counted, { wasOpen = false } = {}) {
		const updating = !!this._item;
		// Only notes are left by now ("Since the saved version: ..."), worth a line each.
		const notes = this._issues.map(i => i.message).filter(m => typeof m === "string" && m);
		if (!(await this._save({ quiet: true }))) {
			this.render(false);
			return "read";
		}
		const item = this._item;
		const pb = this._bundle.playbook;
		const by = pb.author ? ` by ${escHtml(pb.author)}` : "";
		const shown = pb.published
			? "your players can pick it now"
			: "it's hidden from players until you show it to them (the eye at the top of the Playbook Builder)";
		const change = wasOpen
			? "To change anything in it, it's open in the Playbook Builder behind this window."
			: "To change anything in it, open it in the Playbook Builder: with the button below, or later by right-clicking it in the Items sidebar.";
		const choice = await askWithButtons({
			title: `${item.name} is ready`,
			content: `<p><strong>${escHtml(item.name)}</strong>${by} is a playbook the system knows, and all of it was read: ${escHtml(counted)}, each where it belongs.</p>`
				+ `<p>It's saved${updating ? " over the one this world had" : ""}, and ${shown}.</p>`
				+ (notes.length ? `<ul>${notes.map(n => `<li>${escHtml(n)}</li>`).join("")}</ul>` : "")
				+ `<p>${change}</p>`,
			buttons: [
				{ key: "done", label: "Done", icon: "fa-check", value: "done" },
				{ key: "try", label: "Try character creation", icon: "fa-user-plus", value: "try" },
				// An open builder already shows it.
				...(wasOpen ? [] : [{ key: "open", label: "Open it in the Playbook Builder", icon: "fa-book-open", value: "open" }]),
			],
			defaultKey: "done",
		});
		if (choice === "open") return "read";
		if (choice === "try") await this._tryIt();
		return "saved";
	}
}

/**
 * Fill a move card's still-empty Roll, results and Track from its words (move-words.js), straight into
 * the fields, so nothing redraws under the GM's typing: what is read can be changed or cleared like
 * anything typed. A field the GM has filled is never touched.
 * @param {HTMLElement|null} card  the move's card in the builder
 * @param {string} words           its "What it does"
 * @returns {string[]} what was filled in, for a test or a note
 */
export function fillMoveFromWords(card, words) {
	if (!card) return [];
	const filled = [];
	const field = suffix => card.querySelector(`[data-field$=".${suffix}"]`);
	const roll = field("rollType");
	const results = ["success", "partial", "failure"].map(k => field(`results.${k}`));
	if (roll && !roll.value && results.every(r => r && !r.value.trim())) {
		const read = rollFromWords(words);
		if (read.rollType) {
			roll.value = read.rollType;
			["success", "partial", "failure"].forEach((k, i) => { results[i].value = read.results[k]; });
			filled.push("its roll");
		}
	}
	const track = card.querySelector("[data-resource]");
	const max = track?.querySelector("[name=resourceMax]");
	if (max && !(Number(max.value) > 0)) {
		const read = trackFromWords(words);
		if (read) {
			max.value = String(read.max);
			const title = track.querySelector("[name=resourceTitle]");
			if (title && !title.value.trim()) title.value = read.title;
			filled.push("its track");
		}
	}
	return filled;
}

/**
 * A PDF with no text in it (a scan, or a playbook "printed" to PDF as pictures): say what went
 * wrong, that the builder still works by hand, and how the playbook's creator can make it import
 * by itself next time.
 */
export async function explainNoTextPdf(fileName) {
	return askWithButtons({
		title: "This PDF has no text to read",
		content: `<p><strong>${escHtml(fileName)}</strong> has no text in it, only pictures of text. That happens when a playbook is scanned, or made with "Print to PDF" or a similar option that turns every page into an image. There's nothing in it the system can read, so the builder couldn't be filled in.</p>`
			+ `<p>You can still type the playbook into the builder by hand.</p>`
			+ `<p><strong>Want it to import by itself?</strong> Ask the playbook's creator to make it with the <em>community Stonetop playbook template</em>, and to save the PDF so its text stays text (exporting to PDF from their layout program does this; printing to PDF often doesn't). Playbooks made from that template can be read straight into the Playbook Builder.</p>`,
		buttons: [{ key: "ok", label: "Fill it in by hand, with the PDF beside it", icon: "fa-pencil", value: true }],
		defaultKey: "ok",
	});
}

/** Open the builder on a homebrew playbook Item, or on a new one. */
export function openPlaybookBuilder(item = null) {
	if (!game.user?.isGM) {
		ui.notifications.warn("Only the GM can build homebrew playbooks.");
		return null;
	}
	return new PlaybookBuilderDialog({ item }).render(true);
}

/**
 * A NEW homebrew playbook starts with a question: read it from a PDF, or fill it in by hand. The
 * builder opens after that answer, already holding the PDF's playbook when there was one, so a GM
 * with a PDF never has to find the button for it on a blank form first.
 *
 * A PDF that doesn't come through (the file picker shut, a file that won't read, a review backed out
 * of) comes back to the question rather than leaving nothing on screen; closing the question ends it.
 * A PDF with no text, whose explanation offers "Fill it in by hand", opens the builder blank.
 *
 * @returns {Promise<PlaybookBuilderDialog|null>} the builder it opened, or null
 */
export async function startNewPlaybook() {
	if (!game.user?.isGM) {
		ui.notifications.warn("Only the GM can build homebrew playbooks.");
		return null;
	}
	for (;;) {
		// The file picker opens from the press itself: a browser only shows one to a click.
		const input = document.createElement("input");
		input.type = "file";
		input.accept = ".pdf,application/pdf";
		const picked = new Promise(resolve => {
			input.addEventListener("change", () => resolve(input.files?.[0] ?? null), { once: true });
			input.addEventListener("cancel", () => resolve(null), { once: true });
		});
		const how = await askWithButtons({
			title: "New homebrew playbook",
			content: "<p>Do you have the playbook as a PDF? One made with the community Stonetop playbook template can be read in: you check what was read, then finish it in the builder.</p>"
				+ "<p>Otherwise, type it into the builder yourself.</p>",
			buttons: [
				{ key: "pdf", label: "Read it from a PDF…", icon: "fa-file-pdf", value: () => { input.click(); return "pdf"; } },
				{ key: "hand", label: "Fill it in by hand", icon: "fa-pencil", value: "hand" },
			],
		});
		if (how === "hand") return new PlaybookBuilderDialog({}).render(true);
		if (how !== "pdf") return null;
		const file = await picked;
		if (!file) continue;
		const builder = new PlaybookBuilderDialog({});
		// What it opened as is blank, so the PDF's playbook counts as unsaved and closing asks first.
		notePristineWork(builder);
		const outcome = await builder._readPdf({ files: [file] });
		if (outcome === "read" || outcome === "by-hand") return builder.render(true);
		// A known playbook read whole and saved (_saveKnown): the GM was told, and chose no builder.
		if (outcome === "saved") return null;
	}
}
