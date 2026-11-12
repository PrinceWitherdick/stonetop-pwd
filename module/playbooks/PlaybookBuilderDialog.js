import { StonetopDialog } from "../utils/stonetop-dialog.js";
import { applyGuideRail, guideRailStep } from "../utils/guide-rail.js";
import { askWithButtons } from "../utils/ask-with-buttons.js";
import { escHtml } from "../utils/strings.js";
import { filePicker } from "../utils/foundry-compat.js";
import { hasUnsavedWork } from "../utils/close-guard.js";
import { STAT_KEYS } from "../utils/roll-types.js";
import { parseStatArray, statScoreLabel, DEFAULT_STAT_ARRAY } from "../actors/character/stat-rules.js";
import { lorePickMin, lorePickMax } from "../actors/character/lore-pick-count.js";
import { emptyBundle, normalizeBundle, normalizeMove, backgroundGaps, diffBundles, DAMAGE_DICE, HP_LIMITS } from "./homebrew-bundle.js";
import {
	saveHomebrewPlaybook, readHomebrewBundle, deleteHomebrewPlaybook, holdersOfHomebrew,
	readBundleFile, importCollision, saveProblem, offerToRefreshCopies, downloadBundle,
} from "./homebrew-store.js";
import { isHomebrewPlaybookItem, playbookAvatar, homebrewPlaybookByName } from "./playbook-catalog.js";
import { droppedFileKind } from "./dropped-file.js";
import * as L from "./builder-lines.js";

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
};

/** A rail section's title: the instincts panel is "Drives" for a playbook that calls them that. */
const _sectionTitle = (section, pb) => section.key === "instincts" && pb.instinctLabel === "Drive" ? "Drives" : section.title;

/** What a lore section's prompt holds a player to, read the way onboarding reads it (lore-pick-count.js). */
function _lorePickNote(section) {
	const shaped = { description: section.description, options: section.options.map(o => o.freeText ? { type: "text" } : { max: o.max }) };
	const min = lorePickMin(shaped);
	const max = lorePickMax(shaped);
	if (max === Infinity) return min ? `Players tick at least ${min}, as many as they like.` : "Players may tick any number. Add \"(choose 2)\" to the prompt to set a count.";
	return min === max ? `Players pick ${max}.` : `Players pick ${min} to ${max}.`;
}


const blankBackground = () => ({ label: "", description: "", moves: [], moveChoice: [], possessions: [], track: null });
const blankPossession = () => ({ label: "", description: "", preselected: false });
const blankLore = () => ({ title: "", description: "", options: [] });

export class PlaybookBuilderDialog extends StonetopDialog {
	/**
	 * @param {object} [opts]
	 * @param {Item}   [opts.item]    a homebrew playbook Item to edit; none starts a new one
	 * @param {object} [opts.bundle]  a bundle to start from (an import), instead of the Item's
	 * @param {Array}  [opts.issues]  what that bundle's reading reported, shown on the first panel
	 * @param {string} [opts.source]  "builder" | "json" | "pdf", recorded on a NEW playbook
	 */
	constructor({ item = null, bundle = null, issues = [], source = "builder" } = {}, options = {}) {
		super(options);
		this._item = isHomebrewPlaybookItem(item) ? item : null;
		this._bundle = bundle
			? (normalizeBundle(bundle).bundle ?? emptyBundle())
			: (this._item ? readHomebrewBundle(this._item) : emptyBundle());
		this._issues = issues;
		this._readReport = null;
		this._source = source;
		this._activeTab = SECTIONS[0].key;
		this._openMoves = new Set();
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
		const pb = this._bundle.playbook;
		const activeIndex = Math.max(0, SECTIONS.findIndex(s => s.key === this._activeTab));
		const sectionTitle = s => _sectionTitle(s, pb);
		const gaps = backgroundGaps(this._bundle);
		const holders = this._item ? holdersOfHomebrew(this._item.system.slug, this._item.name) : [];

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
			possessions: pb.possessions.options.map((o, i) => ({ index: i, ...o })),
			choicesText: L.choiceLines(pb.moveChoices),
			groupsText: L.groupLines(pb.moveGroups),

			moves: this._bundle.moves.map((m, i) => ({
				index: i,
				...m,
				open: this._openMoves.has(i),
				summaryTags: [m.starting ? "starting" : "", m.level > 1 ? `level ${m.level}+` : "", m.repeatMax > 1 ? `up to ${m.repeatMax} times` : "", m.rollType ? `roll +${m.rollType.toUpperCase()}` : "", m.resource ? `${m.resource.title || "track"} ×${m.resource.max}` : ""].filter(Boolean).join(" · "),
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
			})),
			moveCount: this._bundle.moves.length,
			startingCount: this._bundle.moves.filter(m => m.starting).length,

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

	/** Read every field back into the bundle. Safe before the first render (does nothing). */
	_readForm() {
		const root = this.element?.[0];
		if (!root) return;
		for (const el of root.querySelectorAll("[data-field]")) {
			let value;
			if (el.type === "checkbox") value = el.checked;
			else if (el.dataset.kind === "int") value = Math.trunc(Number(el.value) || 0);
			else value = el.value;
			foundry.utils.setProperty(this._bundle, el.dataset.field, value);
		}
		for (const el of root.querySelectorAll("[data-list]")) {
			foundry.utils.setProperty(this._bundle, el.dataset.list, L.parseNameList(el.value));
		}
		for (const el of root.querySelectorAll("[data-lines]")) {
			const parse = LINE_PARSERS[el.dataset.parse];
			if (parse) foundry.utils.setProperty(this._bundle, el.dataset.lines, parse(el.value));
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
			callback: path => { this._bundle.playbook.img = path; this.render(false); },
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
				});
				this._librarySlug = null;
			this._item = item;
			this._bundle = readHomebrewBundle(item);
			this._issues = [];
			this._readReport = null;
			// What is saved is the new untouched state.
			this._pristineWork = JSON.stringify(this._bundle);
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
	 * @returns {Promise<{changes: object[]}|null>}  null when the GM backed out
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
			return { changes: [] };
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
				return { changes: [] };
			}
		}
		this._item = same;
		bundle.playbook.slug = same.system.slug;
		const saved = readHomebrewBundle(same);
		bundle.playbook.published = !!saved?.playbook?.published;
		const { lines } = diffBundles(saved, bundle);
		const changes = lines.length
			? lines.map(message => ({ severity: "info", message: `Since the saved version: ${message}` }))
			: [{ severity: "info", message: "Nothing has changed since the saved version." }];
		return { changes };
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
		this._bundle = bundle;
		this._issues = [...link.changes, ...issues];
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
	 */
	async _readPdf(input) {
		const file = input?.files?.[0];
		if (input) input.value = "";
		if (!file) return;
		if (!(await this._mayReplace("Reading a PDF"))) return;
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
			return;
		}
		if (result.report.noText) {
			await explainNoTextPdf(file.name);
			return;
		}
		if (result.report.tooLong) {
			await askWithButtons({
				title: "That looks like a book, not a playbook",
				content: `<p><strong>${escHtml(file.name)}</strong> has ${result.report.pageCount} pages. A playbook is a few pages long, so this is probably a rulebook or a collection of playbooks, and reading it here would only fill the builder with the wrong things.</p>`
					+ `<p>Pick the PDF of the one playbook you want. If several playbooks share one PDF, save the pages of the one you want as a PDF of their own and read that.</p>`,
				buttons: [{ key: "ok", label: "Pick another PDF", icon: "fa-file-pdf", value: true }],
				defaultKey: "ok",
			});
			return;
		}
		if (!result.draft) {
			ui.notifications.error("That PDF couldn't be read. Fill the builder in by hand instead.");
			return;
		}
		// The GM checks the read first: confirms what the PDF can't settle, moves what landed wrong.
		const { PlaybookImportReview } = await import("./PlaybookImportReview.js");
		const reviewed = await new PlaybookImportReview({ draft: result.draft, fileName: file.name, issues: result.report.issues }).promise();
		if (!reviewed) return;
		const { bundle, issues } = normalizeBundle(reviewed.bundle);
		if (!bundle) return;
		bundle.playbook.published = false;
		// What was confirmed in the review is settled; what is left is worth a second look here.
		const adopted = await this._adopt(bundle, {
			source: "pdf",
			issues: [...result.report.issues.filter(i => i.severity === "missing"), ...reviewed.issues, ...issues],
			readReport: { file: file.name, pages: result.report.pages, sections: result.report.sections },
		});
		if (!adopted) return;
		this._activeTab = "playbook";
		ui.notifications.info(`Read ${bundle.playbook.name || file.name}: ${bundle.moves.length} moves, ${bundle.playbook.backgrounds.length} backgrounds. Check each panel before you save.`);
		this.render(false);
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
		buttons: [{ key: "ok", label: "Fill it in by hand", icon: "fa-pen", value: true }],
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
