import { StonetopDialog } from "../utils/stonetop-dialog.js";
import { BLOCK_KINDS, assemblePlaybook, blockOptionLines } from "./pdf/read-playbook.js";

/**
 * CHECK A PDF IMPORT BEFORE IT REACHES THE BUILDER. The reader (pdf/read-playbook.js) hands over
 * a DRAFT: the playbook's fields, what it needs the GM to confirm (an HP printed twice, a damage
 * die printed as "d6/d8"), and every piece of text it found as a movable BLOCK. This window
 * shows the playbook laid out by section as it will be built, lets the GM move any piece to
 * another section ("Belongs in"), asks the questions, and resolves to the assembled bundle.
 *
 * Nothing is saved here: "Open in the builder" fills the Playbook Builder, where the GM can
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

export class PlaybookImportReview extends StonetopDialog {
	/**
	 * @param {object} opts
	 * @param {object} opts.draft   readPlaybook's draft (changed in place as the GM answers)
	 * @param {string} [opts.fileName]
	 * @param {Array}  [opts.issues]  what the reader reported, shown at the top
	 */
	constructor({ draft, fileName = "", issues = [] }, options = {}) {
		super(options);
		this._draft = draft;
		this._fileName = fileName;
		this._issues = issues;
		this._open = new Set();
		// As read, for "Start over": every split, join, move and answer undone at once.
		this._original = structuredClone({ blocks: draft.blocks, confirm: draft.confirm });
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
		const same = this._draft.blocks.filter(x => x.kind === b.kind);
		const prev = same[same.indexOf(b) - 1];
		if (!prev) return;
		const lead = b.title && b.title !== prev.title ? `${b.title}: ` : "";
		prev.text = [prev.text, `${lead}${b.text}`.trim()].filter(Boolean).join("\n\n");
		if (b.options?.length) prev.options = [...(prev.options ?? []), ...b.options];
		this._draft.blocks.splice(this._draft.blocks.indexOf(b), 1);
	}

	static get defaultOptions() {
		return foundry.utils.mergeObject(super.defaultOptions, {
			template: "systems/stonetop-pwd/templates/dialogs/playbook-import-review.hbs",
			title: "Check the imported playbook",
			width: 820,
			height: 760,
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
			const blocks = d.blocks.filter(b => b.kind === kind).map((b, i) => ({ ...this._blockView(b), canJoin: i > 0 }));
			return { kind, title: kind === "instinct" && f.instinctLabel === "Drive" ? "Drives" : GROUP_TITLE[kind], blocks, count: blocks.length };
		}).filter(g => g.count);

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
			hp: f.hp,
			damage: f.damage,
			looks: f.appearance.length ? `${f.appearance.length} rows of appearance choices` : "",
			origins: f.origin.length ? f.origin.map(o => o.region).join(", ") : "",
			introCount: f.introductions.step4.length + f.introductions.step6.length,
			issues: this._issues.map(i => i.message),
			confirm: d.confirm.map(c => this._confirmView(c, answered.has(c.key))),
			unsureCount: d.blocks.filter(b => b.unsure && b.kind === b.readAs).length,
			sources: [...sources.values()].filter(s => s.count > 1).map(s => ({
				...s,
				kindOptions: [{ value: "", label: "Leave each where it is" }, ...BLOCK_KINDS.map(k => ({ value: k.kind, label: k.label }))],
			})),
			groups,
		};
	}

	_blockView(b) {
		const full = [b.text, ...blockOptionLines(b)].filter(Boolean).join("\n").replace(/\*/g, "");
		const tags = [];
		if (b.extra?.boxes > 1) tags.push(`up to ${b.extra.boxes} times`);
		const pips = (b.extra?.pips ?? []).reduce((n, p) => n + p.count, 0);
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
			unsure: b.unsure && b.kind === b.readAs,
			moved: b.kind !== b.readAs,
			readAsLabel: KIND_LABEL[b.readAs],
			why: b.why,
			splitCount: splitParagraphs(b.text).length,
			canSplit: splitParagraphs(b.text).length > 1,
			kindOptions: BLOCK_KINDS.map(k => ({ value: k.kind, label: k.label, selected: k.kind === b.kind })),
		};
	}

	_confirmView(c, answered) {
		const value = c.value;
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
		root.querySelectorAll("select[data-block]").forEach(sel => sel.addEventListener("change", () => {
			const block = this._draft.blocks.find(b => b.id === sel.dataset.block);
			if (block) { block.kind = sel.value; this.render(false); }
		}));
		root.querySelectorAll("select[data-source]").forEach(sel => sel.addEventListener("change", () => {
			if (!sel.value) return;
			for (const b of this._draft.blocks) if (b.unsure && b.from === sel.dataset.source) b.kind = sel.value;
			this.render(false);
		}));
		root.querySelectorAll(".stonetop-pb-review-block-text").forEach(d => d.addEventListener("toggle", () => {
			const id = d.closest("[data-id]")?.dataset.id;
			if (!id) return;
			if (d.open) this._open.add(id); else this._open.delete(id);
		}));
		// Answers: a choice, or "another number", or typed text. Kept in the draft as they change.
		root.querySelectorAll("[data-confirm]").forEach(el => el.addEventListener("change", () => this._readConfirm(root, el.dataset.confirm)));
		root.querySelectorAll("input[data-confirm-other]").forEach(el => el.addEventListener("input", () => {
			const radio = root.querySelector(`input[type=radio][data-confirm="${el.dataset.confirmOther}"][value="__other"]`);
			if (radio) radio.checked = true;
			this._readConfirm(root, el.dataset.confirmOther);
		}));
		root.querySelectorAll("[data-split]").forEach(btn => btn.addEventListener("click", () => { this.splitBlock(btn.dataset.split); this.render(false); }));
		root.querySelectorAll("[data-join]").forEach(btn => btn.addEventListener("click", () => { this.joinUp(btn.dataset.join); this.render(false); }));
		root.querySelector(".stonetop-pb-review-reset")?.addEventListener("click", () => { this.startOver(); this.render(false); });
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
		if (c.type === "text") {
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
		const row = root.querySelector(`.stonetop-pb-review-question[data-key="${key}"]`);
		row?.classList.toggle("is-answered", c.value !== null && c.value !== "");
	}

	_finish(root) {
		for (const c of this._draft.confirm) this._readConfirm(root, c.key);
		const open = this._draft.confirm.find(c => c.value === null || c.value === "");
		if (open) {
			ui.notifications.warn(`Answer "${open.label}" at the top before the playbook goes into the builder.`);
			const row = root.querySelector(`.stonetop-pb-review-question[data-key="${open.key}"]`);
			row?.scrollIntoView({ block: "center" });
			row?.querySelector("input")?.focus();
			return;
		}
		for (const c of this._draft.confirm) this._draft.fields[c.key] = c.value;
		this._resolveWith(assemblePlaybook(this._draft));
	}
}
