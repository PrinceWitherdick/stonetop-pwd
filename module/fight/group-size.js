// How many of a monster join a fight, when its stat block says it comes in numbers.
//
// Book I "Dangers" gives every monster an organization, and two of them are numbers: a GROUP is found
// "in small groups (2-5)", a HORDE "in large groups (6 or more)" (data/monster-builder.js). A GM adding
// one crinwin to a fight almost always means a horde of them, so when a group or horde monster joins,
// the GM is asked how many: a strip of the likely sizes, a box for any other (a horde has no top end,
// and p.416's own example is 20 crinwin), and one button that says what it will do ("6 tokens"), with
// "Just one" beside it. A monster already set to fight as a group is not asked about.
//
// THE SCALE IS ONLY ASKED WHEN IT CAN APPLY. p.416's "Abstracting groups" is for "if the PCs have a group
// of followers": damage rolled once per side when a group fights another group. So the choice between
// that many TOKENS and ONE token fighting as a group of that many (group-scale.js) is shown only when the
// heroes bring a group (`offerGroup`); against the PCs alone, "foes that are engaged by individual PCs
// aren't really part of a group", and every crinwin is a token. The Fight tab's Merge still turns them
// into one group later, if a crew joins.
//
// NOT ASKED when the stat block's own count is 1 (a bandit chief is tagged "group" and comes alone), or
// when the GM has already ticked two or more of the same monster: they have said how many already.
//
// PURE apart from `askGroupSize`, which opens the question.

import { escHtml, escapeRegExp } from "../utils/strings.js";
import { format, localize } from "../utils/i18n.js";
import { themedDialogClasses } from "../utils/window-theme.js";
import { contentElement } from "../utils/dialogv2-content.js";
import { overlapShare } from "./overlay-geometry.js";
import { insideRect } from "./fight-state.js";

const KEY = "stonetop.fight.groupSize";

/** The sizes offered for each organization that comes in numbers, before the stat block's own count. */
const GROUP_SIZES = Object.freeze({
	group: Object.freeze([2, 3, 4, 5]),
	horde: Object.freeze([6, 8, 10, 12]),
});

/**
 * What to ask about one monster, or null when there is nothing to ask.
 *
 * @param {{organization?: string, count?: number, fightAsGroup?: boolean}} info  the stat block's
 * @returns {null|{organization: "group"|"horde", sizes: number[], usual: number, fromSheet: boolean}}
 *   `sizes` ascending, always including `usual`: the stat block's count (`fromSheet`), else the smallest size
 */
export function groupSizeQuestion({ organization = "", count = 0, fightAsGroup = false } = {}) {
	const org = String(organization ?? "").trim().toLowerCase();
	const offered = GROUP_SIZES[org];
	if (!offered || fightAsGroup) return null;
	const recorded = Math.trunc(Number(count) || 0);
	if (recorded === 1) return null;
	const usual = recorded > 1 ? recorded : offered[0];
	const sizes = [...new Set([...offered, usual])].sort((a, b) => a - b);
	return { organization: org, sizes, usual, fromSheet: recorded > 1 };
}

/**
 * The questions for a set of picks: one per monster, in the order the monsters were first picked.
 *
 * @param {Array<{id: string, name: string}>} picks
 * @param {(pick) => null|{kind: string, organization?: string, count?: number, fightAsGroup?: boolean}} infoFor
 *   what a pick is: `kind` is the same for every pick of one monster (its actor), whether it is a
 *   token already on the map or an actor still to be placed
 * @returns {Array<{kind: string, name: string, pickId: string, organization: string, sizes: number[], usual: number, fromSheet: boolean}>}
 *   `pickId` is the first pick of that monster, which the extra ones are copies of
 */
export function groupSizeQuestions(picks = [], infoFor = () => null) {
	const kinds = new Map();
	for (const pick of picks) {
		const info = infoFor(pick);
		if (!info?.kind) continue;
		const seen = kinds.get(info.kind);
		if (seen) { seen.picked += 1; continue; }
		kinds.set(info.kind, { pick, info, picked: 1 });
	}
	const questions = [];
	for (const [kind, { pick, info, picked }] of kinds) {
		if (picked > 1) continue;
		const question = groupSizeQuestion(info);
		if (question) questions.push({ kind, name: pick.name ?? "", pickId: pick.id, ...question });
	}
	return questions;
}

/**
 * Free spots for `count` more tokens around one already on the map, nearest first: ring by ring
 * outward from it, each ring taken in order of distance, never on another token or off the scene.
 *
 * @param {object} p
 * @param {{x: number, y: number, w: number, h: number}} p.anchor  the token they gather around
 * @param {number} p.count
 * @param {{w: number, h: number}} [p.footprint]  each new token's size, in scene pixels (the anchor's)
 * @param {number} [p.size]  the grid size
 * @param {Array<{x: number, y: number, w: number, h: number}>} [p.others]  every token already there
 * @param {{x: number, y: number, w: number, h: number}|null} [p.sceneRect]
 * @param {number} [p.reach]  how many rings out to look
 * @param {((at: {x: number, y: number, w: number, h: number}) => boolean)|null} [p.prefer]  spots it answers
 *   true for are taken first, from any ring (a split group keeps its members on the foe it was fighting)
 * @returns {Array<{x: number, y: number}>}  top-left corners; fewer than `count` when the rings are full
 */
export function spotsAround({ anchor, count, footprint = null, size = 100, others = [], sceneRect = null, reach = 6, prefer = null }) {
	const spots = [];
	if (!anchor || !(count > 0)) return spots;
	const grid = Number(size) > 0 ? Number(size) : 100;
	const w = footprint?.w ?? anchor.w;
	const h = footprint?.h ?? anchor.h;
	const taken = [anchor, ...others];
	const cx = anchor.x + anchor.w / 2;
	const cy = anchor.y + anchor.h / 2;
	const stepX = Math.max(1, Math.round(w / grid)) * grid;
	const stepY = Math.max(1, Math.round(h / grid)) * grid;
	const candidates = [];
	for (let ring = 1; ring <= reach; ring += 1) {
		for (let row = -ring; row <= ring; row += 1) {
			for (let col = -ring; col <= ring; col += 1) {
				if (Math.max(Math.abs(row), Math.abs(col)) !== ring) continue;
				const at = { x: anchor.x + col * stepX, y: anchor.y + row * stepY, w, h };
				candidates.push({ at, ring, preferred: prefer?.(at) ? 1 : 0, distance: Math.hypot(at.x + w / 2 - cx, at.y + h / 2 - cy), order: candidates.length });
			}
		}
	}
	candidates.sort((a, b) => (b.preferred - a.preferred) || (a.ring - b.ring) || (a.distance - b.distance) || (a.order - b.order));
	for (const { at } of candidates) {
		if (spots.length >= count) break;
		if (!insideRect(at, sceneRect)) continue;
		if (taken.some(other => overlapShare(at, other) > 0)) continue;
		taken.push(at);
		spots.push({ x: at.x, y: at.y });
	}
	return spots;
}

/**
 * Names for `count` new tokens of one monster, numbered the way core numbers them ("Crinwin (2)"),
 * taking the lowest numbers no token of it uses yet. An un-numbered token already there counts as 1,
 * so the first new one beside it is (2).
 *
 * @param {string} base
 * @param {string[]} existing  the names of that monster's tokens already on the map
 * @param {number} count
 */
export function numberedNames(base, existing = [], count = 0) {
	const escaped = escapeRegExp(base);
	const pattern = new RegExp(`^${escaped} \\((\\d+)\\)$`);
	const used = new Set();
	for (const name of existing) {
		if (name === base) used.add(1);
		const n = Number(pattern.exec(name ?? "")?.[1]);
		if (n > 0) used.add(n);
	}
	const names = [];
	for (let n = 1; names.length < count; n += 1) {
		if (used.has(n)) continue;
		used.add(n);
		names.push(`${base} (${n})`);
	}
	return names;
}

export const SCALE_FIELD = "stonetopGroupScale";
export const COUNT_FIELD = "stonetopGroupCount";
export const OTHER_FIELD = "stonetopGroupOther";

/** The most the box takes: a slip of 60 for 6 would put sixty tokens on the map. */
const MOST = 99;

/** The main button's words for an answer, the outcome it commits: "6 tokens", "1 group token of 6". */
export function countLabel({ size, asGroup = false }) {
	return format(`${KEY}.confirm.${asGroup ? "group" : "tokens"}`, { count: size });
}

/** A size as the window takes one: a whole number from 2 to MOST, else null (1 is "Just one"). */
export function typedSize(value) {
	const text = String(value ?? "").trim();
	if (!/^\d+$/.test(text)) return null;
	const n = Number(text);
	return n >= 2 && n <= MOST ? n : null;
}

/**
 * The answer the window's fields hold. ONE READING for the button's press and for its label following
 * the choice, so the button never says one number and commits another. A size typed in the box wins
 * over the strip; with neither, the usual size. The group scale only counts where it was offered.
 *
 * @param {(name: string) => string|null} valueOf  a field's value (a radio group's checked one), or null
 * @param {{usual: number, offerGroup?: boolean}} question
 */
export function answerFrom(valueOf, { usual, offerGroup = false }) {
	const size = typedSize(valueOf(OTHER_FIELD)) ?? typedSize(valueOf(COUNT_FIELD)) ?? usual;
	return { size, asGroup: !!offerGroup && valueOf(SCALE_FIELD) === "group" };
}

/** A form's field values by name, as answerFrom reads them; a radio group gives its checked value. */
function fieldsOf(form) {
	return name => {
		const field = form?.elements?.namedItem?.(name);
		if (!field) return null;
		if (typeof field.value === "string") return field.value;
		return [...field].find(input => input.checked)?.value ?? null;
	};
}

/**
 * The window's words and choices: a line on the monster; how many, as a strip of the likely sizes (the
 * usual one chosen) and a box for any other; the two scales where `offerGroup` (see the note at the top),
 * else a line saying why there is no choice; and two buttons, the count's own label first (the
 * affirmative, on the left, and what Enter presses) then "Just one". PURE, so the markup is tested as
 * it is shown.
 *
 * @param {{name: string, organization: string, sizes: number[], usual: number, fromSheet?: boolean, offerGroup?: boolean}} question
 */
export function groupSizeWindow({ name, organization, sizes, usual, fromSheet = false, offerGroup = false }) {
	const say = (key, data) => escHtml(data ? format(`${KEY}.${key}`, data) : localize(`${KEY}.${key}`));
	const size = n => `<label class="stonetop-segmented-picker-option stonetop-fight-group-size-option">
					<input type="radio" name="${COUNT_FIELD}" value="${n}"${n === usual ? " checked" : ""}>
					<span>${n}</span>
				</label>`;
	const scale = (value, checked) => `<label class="stonetop-fight-group-size-scale">
				<input type="radio" name="${SCALE_FIELD}" value="${value}"${checked ? " checked" : ""}>
				<span>${say(`scale.${value}`)}</span>
			</label>`;
	const lead = [say(`body.${organization}`, { name }), fromSheet ? say("usual", { count: usual }) : ""].filter(Boolean).join(" ");
	const scales = offerGroup
		? `<fieldset class="stonetop-fight-group-size-scales">
			<legend>${say("scale.legend")}</legend>
			${scale("tokens", true)}
			${scale("group", false)}
		</fieldset>`
		: `<p class="stonetop-fight-group-size-hint">${say("scale.only")}</p>`;
	return {
		title: format(`${KEY}.title`, { name }),
		content: `<div class="stonetop-fight-group-size">
		<p>${lead}</p>
		<fieldset class="stonetop-fight-group-size-counts">
			<legend>${say("count.legend")}</legend>
			<div class="stonetop-fight-group-size-count-row">
				<div class="stonetop-segmented-picker stonetop-fight-group-size-picker">
				${sizes.map(size).join("")}
				</div>
				<label class="stonetop-fight-group-size-other">
					<span>${say("count.other")}</span>
					<input class="stonetop-cf-input" type="number" name="${OTHER_FIELD}" min="2" max="${MOST}" step="1" inputmode="numeric" aria-label="${say("count.otherLabel")}">
				</label>
			</div>
		</fieldset>
		${scales}
	</div>`,
		buttons: [
			{ action: "count", label: countLabel({ size: usual }), default: true },
			{ action: "one", label: localize(`${KEY}.justOne`), default: false },
		],
	};
}

/**
 * Keep the window's fields and its count button agreeing as the GM chooses: a size typed in the box
 * clears the strip, a size picked on the strip clears the box, a box left holding no size (blank, 1,
 * 500) is emptied and the usual size picked again, and the button says what it will now do.
 */
function followChoice(root, question) {
	const form = root?.matches?.("form") ? root : root?.querySelector?.("form");
	const button = root?.querySelector?.('button[data-action="count"]');
	const other = form?.elements?.namedItem?.(OTHER_FIELD);
	if (!form || !button || !other) return;
	const strip = [...form.querySelectorAll(`input[name="${COUNT_FIELD}"]`)];
	const relabel = () => {
		const label = countLabel(answerFrom(fieldsOf(form), question));
		(button.querySelector("span") ?? button).textContent = label;
	};
	form.addEventListener("input", event => {
		if (event.target === other) {
			if (typedSize(other.value)) for (const input of strip) input.checked = false;
		} else if (event.target?.name === COUNT_FIELD) {
			other.value = "";
		}
		relabel();
	});
	other.addEventListener("change", () => {
		if (typedSize(other.value)) return;
		other.value = "";
		if (!strip.some(input => input.checked)) {
			const usual = strip.find(input => Number(input.value) === question.usual);
			if (usual) usual.checked = true;
		}
		relabel();
	});
}

/**
 * Ask the GM how many of one monster join the fight, and at which scale where that is asked. Resolves to
 * `{size, asGroup}`, or null when the window is closed without an answer (which leaves the fight as it
 * was ticked). "Just one" is one creature, never a group.
 *
 * @param {{name: string, organization: string, sizes: number[], usual: number, fromSheet?: boolean, offerGroup?: boolean}} question
 */
export async function askGroupSize(question, { DialogV2 = globalThis.foundry?.applications?.api?.DialogV2, document = globalThis.document } = {}) {
	if (!DialogV2 || !question || !document) return null;
	const view = groupSizeWindow(question);
	// An element, not a string: core runs a string through its sanitizer, and the element's own markup is ours.
	const content = contentElement(view.content, document);
	return DialogV2.wait({
		classes: themedDialogClasses("stonetop-fight-group-size-app"),
		window: { title: view.title },
		content,
		buttons: view.buttons.map(button => ({
			action: button.action,
			label: button.label,
			default: button.default,
			callback: (_event, pressed) => (button.action === "one"
				? { size: 1, asGroup: false }
				: answerFrom(fieldsOf(pressed?.form), question)),
		})),
		render: (_event, dialog) => followChoice(dialog?.element ?? dialog, question),
		rejectClose: false,
	}).catch(() => null).then(answer => (answer && typeof answer === "object" ? answer : null));
}
