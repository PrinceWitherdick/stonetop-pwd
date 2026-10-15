// How many of a monster join a fight, when its stat block says it comes in numbers.
//
// Book I "Dangers" gives every monster an organization, and two of them are numbers: a GROUP is found
// "in small groups (2-5)", a HORDE "in large groups (6 or more)" (data/monster-builder.js). A GM adding
// one crinwin to a fight almost always means a horde of them, so when a group or horde monster joins,
// the GM is asked how many, with a button for each likely size and "Just one" beside them, and at
// which scale: that many TOKENS, each a creature with its own HP, or ONE token fighting as a group of
// that many (p.416's "Abstracting groups", group-scale.js), for a fight against another group. A
// monster already set to fight as a group is not asked about.
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
 * @returns {null|{organization: "group"|"horde", sizes: number[], usual: number}}
 *   `sizes` ascending, always including `usual`: the stat block's count, else the smallest size
 */
export function groupSizeQuestion({ organization = "", count = 0, fightAsGroup = false } = {}) {
	const org = String(organization ?? "").trim().toLowerCase();
	const offered = GROUP_SIZES[org];
	if (!offered || fightAsGroup) return null;
	const recorded = Math.trunc(Number(count) || 0);
	if (recorded === 1) return null;
	const usual = recorded > 1 ? recorded : offered[0];
	const sizes = [...new Set([...offered, usual])].sort((a, b) => a - b);
	return { organization: org, sizes, usual };
}

/**
 * The questions for a set of picks: one per monster, in the order the monsters were first picked.
 *
 * @param {Array<{id: string, name: string}>} picks
 * @param {(pick) => null|{kind: string, organization?: string, count?: number, fightAsGroup?: boolean}} infoFor
 *   what a pick is: `kind` is the same for every pick of one monster (its actor), whether it is a
 *   token already on the map or an actor still to be placed
 * @returns {Array<{kind: string, name: string, pickId: string, organization: string, sizes: number[], usual: number}>}
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

/**
 * The window's words and choices: a line on the monster, the two scales as a radio pair (separate
 * tokens first, and chosen), and the buttons, "Just one" then each size, the usual size the default.
 * PURE, so the markup is tested as it is shown.
 *
 * @param {{name: string, organization: string, sizes: number[], usual: number}} question
 */
export function groupSizeWindow({ name, organization, sizes, usual }) {
	const choice = (value, key, checked) => `<label class="stonetop-fight-group-size-scale">
			<input type="radio" name="${SCALE_FIELD}" value="${value}"${checked ? " checked" : ""}>
			<span>${escHtml(localize(`${KEY}.scale.${key}`))}</span>
		</label>`;
	return {
		title: format(`${KEY}.title`, { name }),
		content: `<div class="stonetop-fight-group-size">
		<p>${escHtml(format(`${KEY}.body.${organization}`, { name }))} ${escHtml(format(`${KEY}.usual`, { count: usual }))}</p>
		<fieldset class="stonetop-fight-group-size-scales">
			<legend>${escHtml(localize(`${KEY}.scale.legend`))}</legend>
			${choice("tokens", "tokens", true)}
			${choice("group", "group", false)}
		</fieldset>
	</div>`,
		buttons: [
			{ size: 1, label: localize(`${KEY}.justOne`), default: false },
			...sizes.map(size => ({ size, label: String(size), default: size === usual })),
		],
	};
}

/**
 * Ask the GM how many of one monster join the fight, and at which scale. Resolves to
 * `{size, asGroup}`, or null when the window is closed without an answer (which leaves the fight as it
 * was ticked). "Just one" is one creature whichever scale is chosen.
 *
 * @param {{name: string, organization: string, sizes: number[], usual: number}} question
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
			action: `size-${button.size}`,
			label: button.label,
			default: button.default,
			callback: (_event, pressed) => {
				const scale = pressed?.form?.elements?.namedItem?.(SCALE_FIELD);
				const value = scale?.value ?? [...(scale ?? [])].find(input => input.checked)?.value;
				return { size: button.size, asGroup: button.size > 1 && value === "group" };
			},
		})),
		// Enter on a radio would submit through the FIRST button, "Just one", not the default size.
		render: (_event, dialog) => {
			(dialog?.element ?? dialog)?.addEventListener?.("keydown", event => {
				if (event.key === "Enter" && !event.target?.closest?.("button")) event.preventDefault();
			});
		},
		rejectClose: false,
	}).catch(() => null).then(answer => (answer && typeof answer === "object" ? answer : null));
}
