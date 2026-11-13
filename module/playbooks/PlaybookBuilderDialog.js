import { StonetopDialog } from "../utils/stonetop-dialog.js";
import { applyGuideRail, guideRailStep } from "../utils/guide-rail.js";
import { askWithButtons } from "../utils/ask-with-buttons.js";
import { escHtml } from "../utils/strings.js";
import { filePicker } from "../utils/foundry-compat.js";
import { hasUnsavedWork, notePristineWork } from "../utils/close-guard.js";
import { persistOpenWindowsSoon } from "../utils/window-restore.js";
import { PLAYBOOK_BUILDER_RESTORE_KIND, NEW_PLAYBOOK_PREFIX } from "./playbook-builder-restore.js";
import { STAT_KEYS } from "../utils/roll-types.js";
import { parseStatArray, statScoreLabel, DEFAULT_STAT_ARRAY } from "../actors/character/stat-rules.js";
import { lorePickMin, lorePickMax } from "../actors/character/lore-pick-count.js";
import { emptyBundle, normalizeBundle, normalizeMove, backgroundGaps, diffBundles, mergeReimport, advanceFrom, DAMAGE_DICE, HP_LIMITS } from "./homebrew-bundle.js";
import {
	saveHomebrewPlaybook, readHomebrewBundle, readImportBase, deleteHomebrewPlaybook, holdersOfHomebrew,
	readBundleFile, importCollision, saveProblem, offerToRefreshCopies, downloadBundle, writeInsChangedOnSave,
} from "./homebrew-store.js";
import { isHomebrewPlaybookItem, playbookAvatar, homebrewPlaybookByName } from "./playbook-catalog.js";
import { droppedFileKind } from "./dropped-file.js";
import * as L from "./builder-lines.js";
import { playbookNameFromFileName } from "./playbook-text.js";

/**
 * THE PLAYBOOK BUILDER: the GM's window for making, importing, fixing and sharing a HOMEBREW
 * playbook (playbooks/playbook-catalog.js). It edits one in-memory BUNDLE (homebrew-bundle.js),
 * the same object a shared JSON file and the PDF reader produce, and Save writes it into the
 * world as a playbook Item and its moves (homebrew-store.js).
 *
 * Laid out as a left-rail stepped sheet like the custom-move editor. Typing never re-renders:
 * every field names the bundle path it writes (`data-field`, `data-list` for a comma list,
 * `data-lines` for a one-per-line box, builder-lines.js), and the form is read back into the
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

// The one-per-line boxes: `data-parse` -> how the box's text is read back into the bundle.
const LINE_PARSERS = {
	instincts:  L.parseInstinctLines,
	appearance: L.parseAppearanceLines,
	origin:     L.parseOriginLines,
	choices:    L.parseChoiceLines,
	groups:     L.parseGroupLines,
	list:       L.parseLineList,
	lore:       L.parseLoreOptionLines,
	insertOptions: L.parseInsertOptionLines,
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


const blankBackground = () => ({ label: "", description: "", moves: [], moveChoice: [], possessions: [], track: null });
const blankPossession = () => ({ label: "", description: "", preselected: false });
const blankLore = () => ({ title: "", description: "", options: [] });
const blankInsert = key => ({ key, name: "", description: "", unlockedBy: "", form: { enabled: false, on: "Transform", off: "Revert" }, lists: [] });
const blankInsertList = key => ({ key, title: "", prompt: "", kind: "pick", pick: 1, min: 0, perUnlock: 0, bonusPicks: [], options: [] });
/** A key not yet in `taken`: `<base>-1`, `<base>-2`… Minted once, so a character's ticks keep their place. */
const freshKey = (base, taken) => { let n = 1; while (taken.includes(`${base}-${n}`)) n++; return `${base}-${n}`; };

/** "insertKey::listKey" for a move's "Part of" choice, and back. */
const partOf = m => (m.insert ? `${m.insert}::${m.insertList || ""}` : "");
const readPartOf = value => {
	const [insert = "", insertList = ""] = String(value ?? "").split("::");
	return { insert, insertList: insert ? insertList : "" };
};

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
			: (this._item ? readHomebrewBundle(this._item) : emptyBundle());
		this._issues = [...issues, ...this._writeInNotice()];
		this._readReport = null;
		this._source = source;
		this._activeTab = SECTIONS[0].key;
		this._openMoves = new Set();
		// The form is read back by index ("moves.3.name"), so it is read only while it shows the
		// bundle as it is now: every render() marks the bundle changed, and a draw that began after
		// the last change marks the form current (_formIsCurrent).
		this._bundleRev = 0;
		this._drawingRev = -1;
		this._formRev = -1;
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
		return `${PLAYBOOK_BUILDER_RESTORE_KIND}:${this._item?.uuid ?? NEW_PLAYBOOK_PREFIX + this._draftId}`;
	}

	/** The panel and the whole playbook as typed. Read live, as the page unloads too. */
	get restoreView() {
		try { this._readForm(); }
		catch (_err) { /* a window mid-close keeps what it last had */ }
		return {
			tab: this._activeTab,
			bundle: this._bundle,
			source: this._source,
			librarySlug: this._librarySlug ?? null,
			issues: this._issues.filter(i => typeof i?.message === "string").map(i => ({ message: i.message, severity: i.severity })),
			openMoves: [...this._openMoves],
			importBase: this._importBase ?? null,
		};
	}

	/** A reload's reopening draw carries that back (`options.view`); it goes on before the first draw. */
	/**
	 * Every render follows a change to the bundle (an added card, an import, a save's re-read), so
	 * until it has drawn, the form on screen is out of date and must not be read back over the
	 * bundle (_readForm). Anything typed and not yet read is read BEFORE the change that renders.
	 */
	render(force, options) {
		this._bundleRev++;
		return super.render(force, options);
	}

	/** Whether the form on screen was drawn from the bundle as it is now. */
	get _formIsCurrent() {
		return this._formRev === this._bundleRev;
	}

	async _render(force, options = {}) {
		if (options?.view && !this.rendered) this._takeRestoredView(options.view);
		const out = await super._render(force, options);
		// A render asked for while this one was drawing is dropped by core, so the form can still be
		// behind the bundle: draw once more, or the window shows (and never reads) the old form.
		if (this.rendered && !this._formIsCurrent) this.render(false);
		// A PDF with no text, to be typed in by hand: open it beside the window once the window is up
		// (a new playbook reads its PDF before its first draw, so it waits for that).
		if (this._handTypePdf && this.rendered) {
			const file = this._handTypePdf;
			this._handTypePdf = null;
			const { openPdfBeside } = await import("./PlaybookPdfWindow.js");
			this._pdfWindow = openPdfBeside(file, this);
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
		if (Array.isArray(view?.openMoves)) this._openMoves = new Set(view.openMoves.filter(Number.isInteger));
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
		this._drawingRev = this._bundleRev;
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

		return {
			uid: this.appId,
			activeTab: this._activeTab,
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
			damageOptions: DAMAGE_DICE.map(d => ({ value: d, selected: d === pb.damage })),
			statFlag: statArray ? "" : `This note doesn't hand out exactly six scores, so characters will get the book's ${DEFAULT_STAT_ARRAY.map(statScoreLabel).join(", ")} instead.`,
			statPreview: statArray ? statArray.map(statScoreLabel).join(", ") : "",
			hpFlag: hpUnusual ? `Most playbooks start between ${HP_LIMITS.usualMin} and ${HP_LIMITS.usualMax} HP.` : "",

			backgrounds: pb.backgrounds.map((b, i) => ({
				index: i, label: b.label, description: b.description,
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
			possessions: pb.possessions.options.map((o, i) => ({ index: i, ...o })),
			choicesText: L.choiceLines(pb.moveChoices),
			groupsText: L.groupLines(pb.moveGroups),

			moves: this._bundle.moves.map((m, i) => ({
				index: i,
				...m,
				open: this._openMoves.has(i),
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

			inserts: inserts.map((ins, i) => {
				const opener = this._bundle.moves.find(m => m.name && m.name === ins.unlockedBy);
				const flags = [];
				if (opener?.insert) flags.push(`"${ins.unlockedBy}" is one of this insert's own moves, so no character could ever open it. Pick one of the playbook's moves.`);
				else if (ins.unlockedBy && !opener) flags.push(`No move here is called "${ins.unlockedBy}", so no character will see this insert until one is.`);
				if (!ins.lists.length) flags.push("It has no lists yet.");
				return {
					index: i, key: ins.key, name: ins.name, description: ins.description,
					formEnabled: !!ins.form?.enabled, formOn: ins.form?.on ?? "Transform", formOff: ins.form?.off ?? "Revert",
					flags,
					openerOptions: [
						{ value: "", label: "No move: every character has it", selected: !ins.unlockedBy },
						// A name that isn't a move (yet) stays offered, so reading the form back keeps it.
						...(ins.unlockedBy && !ownMoveNames.includes(ins.unlockedBy) ? [{ value: ins.unlockedBy, label: `${ins.unlockedBy} (no such move)`, selected: true }] : []),
						...ownMoveNames.map(n => ({ value: n, label: n, selected: n === ins.unlockedBy })),
					],
					lists: ins.lists.map((l, j) => ({
						insertIndex: i, index: j, key: l.key, title: l.title, prompt: l.prompt,
						isMoves: l.kind === "moves",
						kindOptions: [
							{ value: "pick", label: "Options to tick", selected: l.kind !== "moves" },
							{ value: "moves", label: "Moves to pick from", selected: l.kind === "moves" },
						],
						pick: l.pick, min: l.min, perUnlock: l.perUnlock,
						bonusText: L.bonusPickList(l.bonusPicks),
						optionsText: L.insertOptionLines(l.options),
						moveNames: this._bundle.moves.filter(m => m.insert === ins.key && m.insertList === l.key).map(m => m.name).join(", "),
						pickFlag: l.pick > 0 ? "" : "Pick 0: nobody can take anything from it.",
					})),
					looseMoves: this._bundle.moves.filter(m => m.insert === ins.key && !m.insertList).map(m => `${m.name}${m.starting ? " (always held)" : ""}`).join(", "),
				};
			}),

			lore: pb.lore.map((s, i) => ({
				index: i, title: s.title, description: s.description,
				optionsText: L.loreOptionLines(s.options),
				pickNote: _lorePickNote(s),
			})),
			step4Text: L.lineList(pb.introductions.step4),
			step6Text: L.lineList(pb.introductions.step6),
		};
	}

	activateListeners(html) {
		super.activateListeners(html);
		// The form now on screen is the bundle as getData read it.
		this._formRev = this._drawingRev;
		const root = html[0];
		root.querySelectorAll(".stonetop-pb-builder-tab").forEach(btn =>
			btn.addEventListener("click", () => this._selectTab(root, btn.dataset.tab)));
		root.querySelector(".stonetop-pb-builder-back")?.addEventListener("click", () => this._step(root, -1));
		root.querySelector(".stonetop-pb-builder-next")?.addEventListener("click", () => this._step(root, 1));

		// Remember which move cards are open, so a re-render (adding a card) keeps them.
		root.querySelectorAll(".stonetop-pb-builder-move").forEach(d => d.addEventListener("toggle", () => {
			const i = Number(d.dataset.index);
			if (d.open) this._openMoves.add(i); else this._openMoves.delete(i);
		}));
		// A move's name is its summary line: keep it current as it is typed, without a render.
		root.querySelectorAll(".stonetop-pb-builder-move [data-field$='.name']").forEach(input => input.addEventListener("input", () => {
			const label = input.closest(".stonetop-pb-builder-move")?.querySelector(".stonetop-pb-builder-move-name");
			if (label) label.textContent = input.value.trim() || "New move";
		}));

		root.querySelectorAll("[data-action]").forEach(el => el.addEventListener("click", ev => this._onAction(ev, el.dataset.action, el.dataset)));
		// Typing never re-renders, so it saves the window for a reload itself (`restoreView`).
		root.addEventListener("input", () => persistOpenWindowsSoon());
		root.addEventListener("change", () => persistOpenWindowsSoon());
		root.querySelector(".stonetop-pb-builder-import-file")?.addEventListener("change", ev => this._importJson(ev.currentTarget));
		root.querySelector(".stonetop-pb-builder-pdf-file")?.addEventListener("change", ev => this._readPdf(ev.currentTarget));
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
	 * Read every field back into the bundle. Does nothing before the first render, nor while a
	 * redraw is owed (_formIsCurrent): the fields name bundle paths by index, so a form drawn from
	 * the bundle before a save re-sorted its moves (or an import replaced it) would write each move's
	 * words onto another move.
	 */
	_readForm() {
		const root = this.element?.[0];
		if (!root || !this._formIsCurrent) return;
		for (const el of root.querySelectorAll("[data-field]")) {
			let value;
			if (el.type === "checkbox") value = el.checked;
			else if (el.dataset.kind === "int") value = Math.trunc(Number(el.value) || 0);
			else value = el.value;
			L.setBundlePath(this._bundle, el.dataset.field, value);
		}
		for (const el of root.querySelectorAll("[data-list]")) {
			L.setBundlePath(this._bundle, el.dataset.list, L.parseNameList(el.value));
		}
		for (const el of root.querySelectorAll("[data-lines]")) {
			const parse = LINE_PARSERS[el.dataset.parse];
			if (parse) L.setBundlePath(this._bundle, el.dataset.lines, parse(el.value));
		}
		// Which insert (and moves list) a move is part of.
		for (const el of root.querySelectorAll("[data-insert-ref]")) {
			const move = this._bundle.moves[Number(el.dataset.insertRef)];
			if (move) Object.assign(move, readPartOf(el.value));
		}
		for (const el of root.querySelectorAll("[data-bonus]")) {
			L.setBundlePath(this._bundle, el.dataset.bonus, L.parseBonusPicks(el.value));
		}
		// A move's resource track: a max of 0 is no track at all.
		for (const el of root.querySelectorAll("[data-resource]")) {
			const i = Number(el.dataset.resource);
			const max = Math.trunc(Number(el.querySelector("[name=resourceMax]")?.value) || 0);
			const move = this._bundle.moves[i];
			if (!move) continue;
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
		const i = Number(data.index);
		switch (action) {
			case "add-background": pb.backgrounds.push(blankBackground()); break;
			case "remove-background": pb.backgrounds.splice(i, 1); break;
			case "add-possession": pb.possessions.options.push(blankPossession()); break;
			case "remove-possession": pb.possessions.options.splice(i, 1); break;
			case "add-lore": pb.lore.push(blankLore()); break;
			case "add-insert": {
				pb.inserts ??= [];
				pb.inserts.push(blankInsert(freshKey("insert", pb.inserts.map(x => x.key))));
				break;
			}
			case "remove-insert": {
				const gone = pb.inserts?.[i];
				if (!gone) break;
				// Its moves stay, as the playbook's own: removing the insert never loses a move.
				for (const m of this._bundle.moves) if (m.insert === gone.key) { m.insert = ""; m.insertList = ""; }
				pb.inserts.splice(i, 1);
				break;
			}
			case "add-insert-list": {
				const ins = pb.inserts?.[i];
				if (ins) ins.lists.push(blankInsertList(freshKey("list", ins.lists.map(x => x.key))));
				break;
			}
			case "remove-insert-list": {
				const ins = pb.inserts?.[i];
				const j = Number(data.listIndex);
				const gone = ins?.lists?.[j];
				if (!gone) break;
				for (const m of this._bundle.moves) if (m.insert === ins.key && m.insertList === gone.key) m.insertList = "";
				ins.lists.splice(j, 1);
				break;
			}
			case "remove-lore": pb.lore.splice(i, 1); break;
			case "add-move": {
				this._bundle.moves.push(normalizeMove({ name: "" }));
				this._openMoves.add(this._bundle.moves.length - 1);
				break;
			}
			case "remove-move": {
				this._bundle.moves.splice(i, 1);
				this._openMoves = new Set([...this._openMoves].filter(n => n !== i).map(n => (n > i ? n - 1 : n)));
				break;
			}
			case "pick-image": return this._pickImage();
			case "import-json": return this.element?.[0]?.querySelector(".stonetop-pb-builder-import-file")?.click();
			case "from-library": return this._guardBusy(ev, () => this._fromLibrary());
			case "read-pdf": return this.element?.[0]?.querySelector(".stonetop-pb-builder-pdf-file")?.click();
			case "export-json": return this._exportJson();
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

	/** @returns {Promise<boolean>} whether it saved */
	async _save() {
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
			this._bundle = readHomebrewBundle(item);
			this._issues = [];
			this._readReport = null;
			// What is saved is the new untouched state, taken as the window first opened with it: after
			// the redraw, read back through the form (StonetopDialog#_render). Taken from the bundle
			// itself, a box that reads back a little differently (an empty stat cap's null is 0 in its
			// box) made a window that had just saved count as unsaved.
			this._pristineWork = null;
			const shown = this._bundle.playbook.published ? "Players can pick it now." : "Players can't see it until you tick \"Show to players\".";
			ui.notifications.info(`Saved ${item.name}. ${shown}`);
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
				content: "<p>Character creation reads the saved playbook, so your changes need saving first. Saving doesn't show it to players unless \"Show to players\" is ticked.</p>",
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
			content: `<p>This deletes the playbook and its moves from this world. Your other worlds keep theirs, and this world won't get it back from your playbook library unless you add it again (Add from my library in the Playbook Builder).</p>${warn}`,
			buttons: [{ key: "delete", label: "Delete the playbook", icon: "fa-trash", className: "stonetop-dialog-btn--danger", value: true }],
			defaultKey: false,
		});
		if (answer !== true) return;
		await deleteHomebrewPlaybook(this._item);
		ui.notifications.info(`Deleted ${this._item.name}.`);
		this.close({ discard: true });
	}

	// ---- JSON -----------------------------------------------------------------------------

	_exportJson() {
		const { bundle } = normalizeBundle(this._bundle);
		if (bundle) downloadBundle(bundle);
	}

	/**
	 * An imported playbook that this world already has (same name, or the window is editing it):
	 * offer to UPDATE that one, so every character who plays it stays linked, and say what changed
	 * since the saved version. Otherwise it becomes a playbook of its own. Changes `bundle` (its
	 * slug, and keeps the saved one's "Show to players") and `this._item`.
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
		if (!hasUnsavedWork(this) || JSON.stringify(this._bundle) === JSON.stringify(emptyBundle())) return true;
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
		this._issues = [...changes, ...issues];
		this._readReport = readReport;
		this._source = source;
		this._openMoves.clear();
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

	/** Read a file dropped on the window (or on the Items sidebar): a PDF, or a shared playbook file. */
	readDroppedFile(file, kind) {
		const input = { files: [file] };
		return kind === "pdf" ? this._readPdf(input) : this._importJson(input);
	}

	// ---- PDF ------------------------------------------------------------------------------

	/**
	 * Fill the builder from a playbook PDF the GM picked (pdf/read-playbook.js). The file is read
	 * in memory and dropped; nothing is uploaded, and nothing is saved until the GM presses Save.
	 * A draft from a PDF is never shown to players until the GM ticks "Show to players".
	 *
	 * @returns {Promise<"read"|"by-hand"|null>} "read" once the window holds the playbook; "by-hand"
	 *   when the PDF had no text and the GM chose to type it in; null for anything else (no file, a
	 *   file that wouldn't read, a review backed out of). New playbooks (startNewPlaybook) go on that.
	 */
	async _readPdf(input) {
		const file = input?.files?.[0];
		if (input) input.value = "";
		if (!file) return null;
		if (!(await this._mayReplace("Reading a PDF"))) return null;
		let result;
		try {
			ui.notifications.info(`Reading ${file.name}…`);
			const [{ loadPdfjs }, { readPageRuns }, { readPlaybook }] = await Promise.all([
				import("../utils/pdfjs-loader.js"),
				import("./pdf/pdf-text-source.js"),
				import("./pdf/read-playbook.js"),
			]);
			const runs = await readPageRuns(await loadPdfjs(), await file.arrayBuffer());
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
	 * Fill the window from a finished import review: what was confirmed there is settled, and what is
	 * left is worth a second look here. Shared by the review this window awaited and one a reload
	 * brought back. The caller has already asked _mayReplace.
	 * @returns {Promise<"read"|null>} null when the bundle didn't read or the GM backed out
	 */
	async _takeReviewed(reviewed, { fileName = "", report = null } = {}) {
		const { bundle, issues } = normalizeBundle(reviewed?.bundle);
		if (!bundle) return null;
		bundle.playbook.published = false;
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
		const parts = [`${own} ${own === 1 ? "move" : "moves"}`, `${bundle.playbook.backgrounds.length} backgrounds`, ...inserts];
		ui.notifications.info(`Read ${bundle.playbook.name || fileName}: ${parts.slice(0, -1).join(", ")}${parts.length > 1 ? " and " : ""}${parts.at(-1)}. Check each panel before you save.`);
		this.render(false);
		return "read";
	}
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
		buttons: [{ key: "ok", label: "Fill it in by hand, with the PDF beside it", icon: "fa-pen", value: true }],
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
				{ key: "hand", label: "Fill it in by hand", icon: "fa-pen", value: "hand" },
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
	}
}
