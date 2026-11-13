import { StonetopDialog } from "../utils/stonetop-dialog.js";
import { applyGuideRail } from "../utils/guide-rail.js";
import { notePristineWork } from "../utils/close-guard.js";
import { persistOpenWindowsSoon } from "../utils/window-restore.js";
import { IMPORT_REVIEW_RESTORE_KIND, reopenPlaybookBuilder } from "./playbook-builder-restore.js";
import { BLOCK_KINDS, assemblePlaybook, blockOptionLines, INSERT_ALWAYS, INSERT_NONE } from "./pdf/read-playbook.js";
import { homebrewPlaybookByName } from "./playbook-catalog.js";

/**
 * "This world already has The Familiar Face": said on Start here, before the GM answers anything, so
 * a re-import of the same PDF is known for one from the start. Finishing offers to update it.
 */
function _existingNote(name) {
	let doc = null;
	try { doc = name ? homebrewPlaybookByName(name) : null; } catch { doc = null; }
	if (!doc) return "";
	const players = (globalThis.game?.actors ?? []).filter?.(a => a.type === "character" && a.system?.playbook?.slug === doc.system?.slug).length ?? 0;
	const who = players === 1 ? "one character plays it" : players > 1 ? `${players} characters play it` : "no character plays it yet";
	return `This world already has ${doc.name} (${who}). When you finish, you can update it from this PDF, keeping what you changed by hand, or keep this as a separate playbook.`;
}

/**
 * CHECK A PDF IMPORT BEFORE IT REACHES THE BUILDER. The reader (pdf/read-playbook.js) hands over
 * a DRAFT: the playbook's fields, what it needs the GM to confirm (an HP printed twice, a damage
 * die printed as "d6/d8"), and every piece of text it found as a movable BLOCK. This window
 * shows the playbook laid out by section as it will be built, lets the GM move any piece to
 * another section ("Belongs in"), asks the questions, and resolves to the assembled bundle.
 *
 * Nothing is saved here: "Finish in the builder" fills the Playbook Builder, where the GM can
 * still edit every word before pressing Save.
 *
 * Resolves (promise()) to { bundle, issues } or null when cancelled.
 */

const KIND_LABEL = Object.fromEntries(BLOCK_KINDS.map(k => [k.kind, k.label]));

/** A block's text cut at its blank lines. */
export function splitParagraphs(text) {
	return String(text ?? "").split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
}

/** A name for a piece split off another: its opening words, up to the first comma or stop. */
export function openingWords(text) {
	const plain = String(text ?? "").replace(/\*/g, "").replace(/^-\s*/, "").trim();
	const clause = plain.split(/[,.:;!?\n]/)[0].trim();
	const words = clause.split(/\s+/).slice(0, 6).join(" ");
	return words.length < clause.length ? `${words}…` : (words || "New piece");
}
const GROUP_TITLE = {
	background: "Backgrounds", instinct: "Instincts", possession: "Special possessions", startingMove: "Starting moves",
	move: "Moves", question: "Questions for character creation", note: "Notes for the table", skip: "Left out",
};
/** A rail entry's name where the page heading's is too long for the rail. */
const GROUP_TAB = { question: "Questions", note: "Notes" };
/** What the preview shows for a number still to be confirmed at the top of the page. */
const NOT_ANSWERED = "Not answered yet (see Please confirm, above)";
/** Each section's rail glyph (Font Awesome 6). */
const GROUP_ICON = {
	background: "fa-scroll", instinct: "fa-fire", possession: "fa-gem", startingMove: "fa-play",
	move: "fa-bolt", question: "fa-circle-question", note: "fa-note-sticky", skip: "fa-ban",
};
/** The landing tab: the questions, the hard-to-place summary and the stats. */
const OVERVIEW = { key: "overview", title: "Start here", icon: "fa-clipboard-check" };

/** What a piece can be inside an insert, and what each is called there. */
const INSERT_KINDS = Object.freeze([
	{ kind: "question", label: "A list to pick from" },
	{ kind: "move", label: "One of its moves" },
	{ kind: "startingMove", label: "A move it always gives" },
	{ kind: "note", label: "Its description" },
]);
const INSERT_KIND_LABEL = Object.fromEntries(INSERT_KINDS.map(k => [k.kind, k.label]));
const INSERT_KIND_SET = new Set(INSERT_KINDS.map(k => k.kind));
const INSERT_ICON = "fa-puzzle-piece";

export class PlaybookImportReview extends StonetopDialog {
	/**
	 * @param {object} opts
	 * @param {object} opts.draft   readPlaybook's draft (changed in place as the GM answers)
	 * @param {string} [opts.fileName]
	 * @param {Array}  [opts.issues]  what the reader reported, shown at the top
	 * @param {object} [opts.report]  the reader's whole report, for the builder after a reload
	 * @param {string} [opts.builderKey] the restoreKey of the builder this review fills
	 * @param {string} [opts.reviewId] a reload's: the id this window was saved under (its draft
	 *   comes back in the saved view, at the first draw)
	 */
	constructor({ draft = null, fileName = "", issues = [], report = null, builderKey = null, reviewId = null } = {}, options = {}) {
		super(options);
		this._draft = draft;
		this._fileName = fileName;
		this._issues = issues;
		this._report = report;
		this._builderKey = builderKey;
		this._reviewId = reviewId || foundry.utils.randomID(8);
		this._open = new Set();
		// Which rail page is showing. Kept here because every move, split and join re-renders;
		// getData checks it against the pages that still exist.
		this._activeTab = OVERVIEW.key;
		// As read, for "Start over": every split, join, move and answer undone at once.
		this._original = draft ? structuredClone({ blocks: draft.blocks, confirm: draft.confirm }) : null;
	}

	// ---- Reload --------------------------------------------------------------------------
	// utils/window-restore.js reopens this window after a reload (playbook-builder-restore.js): the
	// draft as the GM has left it, the draft as read (for Start over), and the page it was on.

	/** What a reload saves this window under. */
	get restoreKey() {
		return `${IMPORT_REVIEW_RESTORE_KIND}:${this._reviewId}`;
	}

	/**
	 * Read as the page unloads too. The draft is kept current as the GM types (activateListeners), so
	 * this never reads the form: a window mid-close would read its answers back as blank.
	 *
	 * Rewritten on every pause in typing, so the reader's report goes in ONCE: the draft's report is the
	 * same object (readPlaybook hands back both), and the issues shown are that report's own unless a
	 * caller gave others. _takeRestoredView joins them up again.
	 */
	get restoreView() {
		if (!this._draft) return null;
		const d = this._draft;
		const report = this._report ?? d.report ?? null;
		const ownIssues = this._issues !== report?.issues;
		return {
			draft: { fields: d.fields, confirm: d.confirm, blocks: d.blocks, inserts: d.inserts ?? [], ...(d.report && d.report !== report ? { report: d.report } : {}) },
			original: this._original,
			fileName: this._fileName,
			...(ownIssues ? { issues: (this._issues ?? []).filter(i => typeof i?.message === "string").map(i => ({ message: i.message, severity: i.severity })) } : {}),
			report,
			builderKey: this._builderKey,
			tab: this._activeTab,
			open: [...this._open],
		};
	}

	/** A reload's reopening draw carries the view back; with no draft in it, the window stays shut. */
	async _render(force, options = {}) {
		if (options?.view && !this.rendered) this._takeRestoredView(options.view);
		if (!this._draft) return;
		return super._render(force, options);
	}

	_takeRestoredView(view) {
		if (this._reloaded) return;
		const d = view?.draft;
		if (!d || !Array.isArray(d.blocks) || !Array.isArray(d.confirm) || typeof d.fields !== "object") return;
		this._reloaded = true;
		const report = view.report && typeof view.report === "object" ? structuredClone(view.report) : null;
		// One report, shared by the draft and the window as it was before the reload (restoreView).
		this._draft = structuredClone({ fields: d.fields, confirm: d.confirm, blocks: d.blocks, inserts: Array.isArray(d.inserts) ? d.inserts : [], report: d.report ?? null });
		if (report && !d.report) this._draft.report = report;
		this._original = view.original?.blocks && view.original?.confirm
			? structuredClone(view.original)
			: structuredClone({ blocks: d.blocks, confirm: d.confirm });
		if (typeof view.fileName === "string") this._fileName = view.fileName;
		if (report) this._report = report;
		if (Array.isArray(view.issues)) this._issues = view.issues;
		else if (Array.isArray(report?.issues)) this._issues = report.issues;
		if (typeof view.builderKey === "string") this._builderKey = view.builderKey;
		if (typeof view.tab === "string") this._activeTab = view.tab;
		if (Array.isArray(view.open)) this._open = new Set(view.open.filter(id => typeof id === "string"));
	}

	/**
	 * After a reload nobody is awaiting this window, so it fills the builder itself: the one it came
	 * from if that is open, else that builder reopened (a saved playbook's, or a new one), asking
	 * first before replacing work in it. @returns {Promise<boolean>} false when the GM backed out
	 */
	async _handToBuilder(result) {
		const open = Object.values(ui.windows ?? {}).find(w => w?.rendered && this._builderKey && w.restoreKey === this._builderKey);
		let builder = open;
		if (!builder && this._builderKey) builder = await reopenPlaybookBuilder(this._builderKey);
		if (!builder) {
			const { PlaybookBuilderDialog } = await import("./PlaybookBuilderDialog.js");
			builder = new PlaybookBuilderDialog({});
		}
		// What it opens as (blank, or the playbook as saved) is the baseline the close guard compares.
		if (!open) notePristineWork(builder);
		if (!(await builder._mayReplace("Opening the checked playbook"))) return false;
		const outcome = await builder._takeReviewed(result, { fileName: this._fileName, report: this._report });
		if (!outcome) return false;
		if (builder.rendered) builder.bringToTop?.(); else builder.render(true);
		return true;
	}

	/** Whether anything has been moved, split, joined or answered since the PDF was read. */
	hasChanges() {
		if (!this._original || !this._draft) return false;
		return JSON.stringify({ blocks: this._draft.blocks, confirm: this._draft.confirm }) !== JSON.stringify(this._original);
	}

	/** Put every piece back as it was read, and clear the answers. */
	startOver() {
		const copy = structuredClone(this._original);
		this._draft.blocks.splice(0, this._draft.blocks.length, ...copy.blocks);
		this._draft.confirm.splice(0, this._draft.confirm.length, ...copy.confirm);
		this._open.clear();
	}

	/**
	 * Cut a piece at its paragraphs, one piece each: a block that holds several things (three
	 * possessions written as three paragraphs). The first keeps the title; each other is named by
	 * its own opening words, for the GM to correct in the builder.
	 */
	splitBlock(id) {
		const i = this._draft.blocks.findIndex(b => b.id === id);
		const b = this._draft.blocks[i];
		const parts = splitParagraphs(b?.text);
		if (!b || parts.length < 2) return;
		b.text = parts[0];
		// Ids that are free: a piece split off before (and since moved away, or joined back) may
		// already hold "<id>-2", and every Split, Join and open fold is keyed by id.
		const taken = new Set(this._draft.blocks.map(x => x.id));
		let next = 2;
		const freeId = () => {
			while (taken.has(`${b.id}-${next}`)) next++;
			const id = `${b.id}-${next++}`;
			taken.add(id);
			return id;
		};
		const pieces = parts.slice(1).map(text => ({
			...structuredClone(b), id: freeId(), title: openingWords(text), text, options: null, extra: {},
			why: `Split from "${b.title}" by you.`, unsure: false,
		}));
		this._draft.blocks.splice(i + 1, 0, ...pieces);
	}

	/** Fold a piece into the one above it in the same section: a move the PDF cut in two. */
	joinUp(id) {
		const b = this._draft.blocks.find(x => x.id === id);
		if (!b) return;
		const where = this._insertOf(b);
		const same = this._draft.blocks.filter(x => x.kind === b.kind && this._insertOf(x) === where);
		const prev = same[same.indexOf(b) - 1];
		if (!prev) return;
		const lead = b.title && b.title !== prev.title ? `${b.title}: ` : "";
		prev.text = [prev.text, `${lead}${b.text}`.trim()].filter(Boolean).join("\n\n");
		if (b.options?.length) prev.options = [...(prev.options ?? []), ...b.options];
		this._draft.blocks.splice(this._draft.blocks.indexOf(b), 1);
	}

	// ---- Inserts -----------------------------------------------------------------------------

	/** The draft's inserts the GM hasn't said aren't one ("It's not an insert" takes it apart). */
	_liveInserts() {
		const d = this._draft;
		return (d.inserts ?? []).filter(i => d.confirm.find(c => c.insert === i.id)?.value !== INSERT_NONE);
	}

	/** The live insert a block sits in, or "" for one of the playbook's own sections. */
	_insertOf(b) {
		if (!b?.insert || !INSERT_KIND_SET.has(b.kind)) return "";
		return this._liveInserts().some(i => i.id === b.insert) ? b.insert : "";
	}

	/** Where a block was read, in the same terms: its insert only while that is still one. */
	_readInsertOf(b) {
		if (!b?.readInsert) return "";
		return this._liveInserts().some(i => i.id === b.readInsert) ? b.readInsert : "";
	}

	/** Put a block in a section: "move", or "move@i1" for an insert's. */
	_place(b, value) {
		const [kind, insert = ""] = String(value).split("@");
		if (!BLOCK_KINDS.some(k => k.kind === kind)) return;
		b.kind = kind;
		b.insert = insert && INSERT_KIND_SET.has(kind) && this._liveInserts().some(i => i.id === insert) ? insert : "";
	}

	/** The "Belongs in" choices for the inserts, one group each. */
	_insertOptions(b = null) {
		const here = b ? this._insertOf(b) : "";
		return this._liveInserts().map(i => ({
			label: `In the insert "${i.name}"`,
			options: INSERT_KINDS.map(k => ({ value: `${k.kind}@${i.id}`, label: k.label, selected: !!b && here === i.id && b.kind === k.kind })),
		}));
	}

	static get defaultOptions() {
		return foundry.utils.mergeObject(super.defaultOptions, {
			template: "systems/stonetop-pwd/templates/dialogs/playbook-import-review.hbs",
			title: "Check the imported playbook",
			width: 820,
			height: 680,
			resizable: true,
			classes: ["stonetop", "stonetop-pb-review"],
			scrollY: [".stonetop-pb-review-body"],
		});
	}

	getData() {
		const d = this._draft;
		const f = d.fields;
		const answered = new Set(d.confirm.filter(c => c.value !== null && c.value !== "").map(c => c.key));
		const groups = BLOCK_KINDS.map(({ kind }) => {
			const blocks = d.blocks.filter(b => b.kind === kind && !this._insertOf(b)).map((b, i) => ({ ...this._blockView(b), canJoin: i > 0 }));
			return {
				kind, title: kind === "instinct" && f.instinctLabel === "Drive" ? "Drives" : GROUP_TITLE[kind],
				icon: GROUP_ICON[kind], blocks, count: blocks.length, unsure: blocks.some(b => b.unsure),
			};
		}).filter(g => g.count);
		// An insert's pieces have a page of their own, in page order, whatever each one is.
		for (const ins of this._liveInserts()) {
			const seenKinds = new Map();
			const blocks = d.blocks.filter(b => this._insertOf(b) === ins.id).map(b => {
				const i = seenKinds.get(b.kind) ?? 0;
				seenKinds.set(b.kind, i + 1);
				return { ...this._blockView(b), canJoin: i > 0 };
			});
			groups.push({
				kind: `insert-${ins.id}`, title: ins.name, tabTitle: ins.name,
				lead: "An insert: a page of its own that a move opens. Its lists and moves stay apart from the playbook's own: Level Up never offers its moves, and character creation never asks its lists.",
				icon: INSERT_ICON, blocks, count: blocks.length, unsure: blocks.some(b => b.unsure),
			});
		}

		// The rail: Start here, then one page per section that holds anything. A page that emptied
		// under a move (its last piece sent elsewhere) falls back to Start here.
		const keys = [OVERVIEW.key, ...groups.map(g => g.kind)];
		if (!keys.includes(this._activeTab)) this._activeTab = OVERVIEW.key;
		const activeTab = this._activeTab;
		const unanswered = d.confirm.length - answered.size;
		const tabs = [
			{ ...OVERVIEW, count: unanswered || null, unsure: unanswered > 0, selected: activeTab === OVERVIEW.key },
			...groups.map(g => ({ key: g.kind, title: g.tabTitle ?? GROUP_TAB[g.kind] ?? g.title, icon: g.icon, count: g.count, unsure: g.unsure, selected: activeTab === g.kind })),
		];
		for (const g of groups) g.selected = activeTab === g.kind;

		// Pieces the reader was unsure of, by where they came from, for moving a whole insert at once.
		const sources = new Map();
		for (const b of d.blocks.filter(x => x.unsure)) {
			const s = sources.get(b.from) ?? { from: b.from, count: 0 };
			s.count++;
			sources.set(b.from, s);
		}
		return {
			fileName: this._fileName,
			name: f.name || "Unnamed playbook",
			description: f.description,
			statsNote: f.statsNote,
			// A number still to be confirmed is shown as that, not as the reader's first guess: the
			// Stranger's HP box reads 16 and 18 printed over each other, and showed "16" before the answer.
			hp: this._previewOf("hp", f.hp, answered),
			damage: this._previewOf("damage", f.damage, answered),
			looks: f.appearance.length ? `${f.appearance.length} rows of appearance choices` : "",
			origins: f.origin.length ? f.origin.map(o => o.region).join(", ") : "",
			originQuestions: f.origin.filter(o => o.question).length,
			introCount: f.introductions.step4.length + f.introductions.step6.length,
			// The playbook's own Level Up, when it has one ("mark one of the following instead").
			advancement: f.advancement?.switchPlaybook ? "Switches to a different playbook (no move, then the playbook picker)"
				: f.advancement?.options?.length
				? `${f.advancement.options.length} advances of its own${f.advancement.replacesUsual ? ", marked instead of the usual new move" : ""}` : "",
			possessionsGiven: f.possessions?.allGiven ? "Every character starts with all of them" : "",
			// A playbook this world already has (by name): finishing offers to update it, so say so now.
			existing: _existingNote(f.name),
			issues: this._issues.map(i => i.message),
			confirm: d.confirm.map(c => this._confirmView(c, answered.has(c.key))),
			unsureCount: d.blocks.filter(b => b.unsure && !this._moved(b)).length,
			sources: [...sources.values()].filter(s => s.count > 1).map(s => ({
				...s,
				kindOptions: [{ value: "", label: "Leave each where it is" }, ...BLOCK_KINDS.map(k => ({ value: k.kind, label: k.label }))],
				insertOptions: this._insertOptions(),
			})),
			groups,
			tabs,
			overviewSelected: activeTab === OVERVIEW.key,
			// Start over is offered only once there is something to undo.
			changed: this.hasChanges(),
		};
	}

	/** Show one rail page without re-rendering, so a half-typed answer survives the switch. */
	_selectTab(key) {
		const root = this.element?.[0];
		if (!root?.querySelector(`.stonetop-pb-review-panel[data-tab="${key}"]`)) return;
		this._activeTab = key;
		applyGuideRail(root, {
			key, dataKey: "tab",
			tabSelector: ".stonetop-pb-review-tab",
			sectionSelector: ".stonetop-pb-review-panel",
			mainSelector: ".stonetop-pb-review-body",
		});
	}

	/** Has the GM put this block somewhere other than where it was read? */
	_moved(b) {
		return b.kind !== b.readAs || this._insertOf(b) !== this._readInsertOf(b);
	}

	_blockView(b) {
		const full = [b.text, ...blockOptionLines(b)].filter(Boolean).join("\n").replace(/\*/g, "");
		const tags = [];
		const inInsert = this._insertOf(b);
		if (inInsert) tags.push(INSERT_KIND_LABEL[b.kind]);
		if (b.extra?.boxes > 1) tags.push(`up to ${b.extra.boxes} times`);
		const pips = (b.extra?.pips ?? []).reduce((n, p) => n + p.count, 0);
		const readIn = this._readInsertOf(b);
		const readInsertName = readIn ? (this._draft.inserts ?? []).find(i => i.id === readIn)?.name : "";
		if (pips && ["move", "startingMove"].includes(b.kind)) tags.push(`a track of ${pips}`);
		if (b.kind === "possession" && b.extra?.ticked) tags.push("everyone starts with it");
		return {
			id: b.id,
			title: b.title || "(untitled)",
			excerpt: full.length > 180 ? `${full.slice(0, 180).trimEnd()}…` : full,
			full,
			long: full.length > 180,
			open: this._open.has(b.id),
			tags: tags.join(" · "),
			from: b.from,
			unsure: b.unsure && !this._moved(b),
			moved: this._moved(b),
			readAsLabel: readInsertName ? `${INSERT_KIND_LABEL[b.readAs] ?? KIND_LABEL[b.readAs]} in "${readInsertName}"` : KIND_LABEL[b.readAs],
			why: b.why,
			splitCount: splitParagraphs(b.text).length,
			canSplit: splitParagraphs(b.text).length > 1,
			kindOptions: BLOCK_KINDS.map(k => ({ value: k.kind, label: k.label, selected: !inInsert && k.kind === b.kind })),
			insertOptions: this._insertOptions(b),
		};
	}

	/**
	 * An insert's question: which move opens it. The playbook's moves as they stand now (a piece moved
	 * into Moves is offered at once), then "always", then "not an insert".
	 */
	_insertChoices(c) {
		const names = [...new Set(this._draft.blocks.filter(b => ["move", "startingMove"].includes(b.kind) && !this._insertOf(b)).map(b => b.title).filter(Boolean))];
		if (c.value && ![INSERT_ALWAYS, INSERT_NONE].includes(c.value) && !names.includes(c.value)) names.unshift(c.value);
		return [
			...names.map(n => ({ value: n, label: n })),
			{ value: INSERT_ALWAYS, label: "No move: every character has it" },
			{ value: INSERT_NONE, label: "It's not an insert: keep its pieces in the playbook" },
		].map(o => ({ ...o, selected: o.value === c.value }));
	}

	/** A preview fact the GM is asked to confirm: their answer once given, else a pointer to the question. */
	_previewOf(key, guess, answered) {
		const q = this._draft.confirm.find(c => c.key === key);
		if (!q) return guess;
		return answered.has(key) ? q.value : NOT_ANSWERED;
	}

	_confirmView(c, answered) {
		const value = c.value;
		if (c.insert) {
			return { key: c.key, label: c.label, why: c.why, answered, isSelect: true, value: value ?? "", options: this._insertChoices(c), choices: [] };
		}
		const choices = (c.choices ?? []).map(v => ({ value: String(v), label: String(v), checked: String(v) === String(value) }));
		const isOther = c.type === "number" && value !== null && value !== "" && !choices.some(x => x.checked);
		return {
			key: c.key, label: c.label, why: c.why, answered,
			isText: c.type === "text", isNumber: c.type === "number", isChoice: c.type === "choice",
			value: value ?? "", choices, isOther,
		};
	}

	activateListeners(html) {
		super.activateListeners(html);
		const root = html[0];
		root.querySelectorAll(".stonetop-pb-review-tab").forEach(btn => btn.addEventListener("click", () => this._selectTab(btn.dataset.tab)));
		root.querySelectorAll("select[data-block]").forEach(sel => sel.addEventListener("change", () => {
			const block = this._draft.blocks.find(b => b.id === sel.dataset.block);
			if (block) { this._place(block, sel.value); this.render(false); }
		}));
		root.querySelectorAll("select[data-source]").forEach(sel => sel.addEventListener("change", () => {
			if (!sel.value) return;
			for (const b of this._draft.blocks) if (b.unsure && b.from === sel.dataset.source) this._place(b, sel.value);
			this.render(false);
		}));
		root.querySelectorAll(".stonetop-pb-review-block-text").forEach(d => d.addEventListener("toggle", () => {
			const id = d.closest("[data-id]")?.dataset.id;
			if (!id) return;
			if (d.open) this._open.add(id); else this._open.delete(id);
		}));
		// Answers: a choice, or "another number", or typed text. Kept in the draft as they change.
		root.querySelectorAll("[data-confirm]").forEach(el => el.addEventListener("change", () => this._readConfirm(root, el.dataset.confirm)));
		// A typed name is taken as it is typed, so a reload keeps it (restoreView reads the draft).
		root.querySelectorAll("input[type=text][data-confirm]").forEach(el => el.addEventListener("input", () => this._readConfirm(root, el.dataset.confirm)));
		// Answering never re-renders, so it saves the window for a reload itself.
		root.addEventListener("input", () => persistOpenWindowsSoon());
		root.addEventListener("change", () => persistOpenWindowsSoon());
		root.querySelectorAll("input[data-confirm-other]").forEach(el => el.addEventListener("input", () => {
			const radio = root.querySelector(`input[type=radio][data-confirm="${el.dataset.confirmOther}"][value="__other"]`);
			if (radio) radio.checked = true;
			this._readConfirm(root, el.dataset.confirmOther);
		}));
		root.querySelectorAll("[data-split]").forEach(btn => btn.addEventListener("click", () => { this.splitBlock(btn.dataset.split); this.render(false); }));
		root.querySelectorAll("[data-join]").forEach(btn => btn.addEventListener("click", () => { this.joinUp(btn.dataset.join); this.render(false); }));
		root.querySelector(".stonetop-pb-review-reset")?.addEventListener("click", () => {
			if (!this.hasChanges()) return;
			this.startOver();
			this.render(false);
			ui.notifications?.info("Everything is back as it was read from the PDF.");
		});
		root.querySelector(".stonetop-pb-review-cancel")?.addEventListener("click", () => this.close());
		root.querySelector(".stonetop-pb-review-go")?.addEventListener("click", () => this._finish(root));
	}

	_readConfirm(root, key) {
		const c = this._draft.confirm.find(x => x.key === key);
		if (!c) return;
		const readNumber = () => {
			const n = Math.trunc(Number(root.querySelector(`input[data-confirm-other="${key}"]`)?.value));
			return Number.isFinite(n) && n > 0 ? n : null;
		};
		const wasApart = c.value === INSERT_NONE;
		if (c.insert) {
			c.value = root.querySelector(`select[data-confirm="${key}"]`)?.value || null;
		} else if (c.type === "text") {
			c.value = root.querySelector(`input[type=text][data-confirm="${key}"]`)?.value.trim() ?? "";
		} else if (c.type === "number" && !c.choices?.length) {
			c.value = readNumber(); // nothing to choose between: just the number box
		} else {
			const picked = root.querySelector(`input[type=radio][data-confirm="${key}"]:checked`)?.value ?? null;
			if (picked === "__other") {
				c.value = readNumber();
			} else {
				c.value = picked === null ? null : (c.type === "number" ? Number(picked) : picked);
			}
		}
		// Taking an insert apart (or putting it back) moves its pieces: draw them where they now are.
		if (c.insert && wasApart !== (c.value === INSERT_NONE)) { this.render(false); return; }
		const row = root.querySelector(`.stonetop-pb-review-question[data-key="${key}"]`);
		row?.classList.toggle("is-answered", c.value !== null && c.value !== "");
		// The preview's line for it follows the answer (no redraw: the GM may be typing a number).
		const fact = root.querySelector(`[data-fact="${key}"]`);
		if (fact) fact.textContent = c.value !== null && c.value !== "" ? String(c.value) : NOT_ANSWERED;
		// An answer doesn't re-render, so it wakes Start over itself.
		const reset = root.querySelector(".stonetop-pb-review-reset");
		if (reset) reset.disabled = !this.hasChanges();
		// Start here's rail count is the questions still open; answering doesn't re-render.
		const open = this._draft.confirm.filter(x => x.value === null || x.value === "").length;
		const tab = root.querySelector(`.stonetop-pb-review-tab[data-tab="${OVERVIEW.key}"]`);
		if (tab) {
			tab.closest(".stonetop-guide-toc-item")?.classList.toggle("is-unsure", open > 0);
			let count = tab.querySelector(".stonetop-guide-toc-count");
			if (open && !count) {
				count = tab.ownerDocument.createElement("span");
				count.className = "stonetop-guide-toc-count";
				tab.append(count);
			}
			if (count) { if (open) count.textContent = String(open); else count.remove(); }
		}
	}

	_finish(root) {
		for (const c of this._draft.confirm) this._readConfirm(root, c.key);
		const open = this._draft.confirm.find(c => c.value === null || c.value === "");
		if (open) {
			ui.notifications.warn(`Answer "${open.label}" on Start here before the playbook goes into the builder.`);
			// The questions live on Start here: show that page before pointing at the row.
			if (this._activeTab !== OVERVIEW.key) {
				this._activeTab = OVERVIEW.key;
				applyGuideRail(root, {
					key: OVERVIEW.key, dataKey: "tab",
					tabSelector: ".stonetop-pb-review-tab", sectionSelector: ".stonetop-pb-review-panel",
				});
			}
			const row = root.querySelector(`.stonetop-pb-review-question[data-key="${open.key}"]`);
			row?.scrollIntoView({ block: "center" });
			row?.querySelector("input")?.focus();
			return;
		}
		for (const c of this._draft.confirm) if (!c.insert) this._draft.fields[c.key] = c.value;
		const result = assemblePlaybook(this._draft);
		if (!this._reloaded) return this._resolveWith(result);
		// Brought back by a reload: the builder that awaited this is gone, so hand it over here. The
		// latch stops a second press filling the builder twice while the first is still asking.
		if (this._handing) return;
		this._handing = true;
		return this._handToBuilder(result)
			.then(done => { if (done) this._resolveWith(result); })
			.catch(err => {
				console.error("Stonetop | couldn't open the checked playbook in the builder", err);
				ui.notifications.error("The playbook couldn't be opened in the builder. Try Finish in the builder again.");
			})
			.finally(() => { this._handing = false; });
	}
}
