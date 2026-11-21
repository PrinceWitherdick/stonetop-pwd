// A Seeker's starting major arcanum from outside the background's three: the GM's grant (stored as
// arcana.majorGrant, read through seekerOfferedMajors), and the picker that a GM gives it from and a
// player picks from while the world's "any major" switch is on. The pack and world arcana come from
// ArcanaSource, which already skips unfinished drafts. Guarded by seeker-major-grant.test.js.

import { pickContentOption } from "../../dialogs/content-picker.js";
import { ArcanaSource } from "../../dialogs/catalog/ArcanaSource.js";
import { truncateValue } from "../../utils/ledger-core.js";
import { format, localize } from "../../utils/i18n.js";
import { getBooleanSetting } from "../../settings.js";
import { SeekerMajorArcanumDialog } from "./dialogs/SeekerMajorArcanumDialog.js";

/** The picker's "no grant" row id. Not a slug any arcanum can have. */
export const NO_GRANT = "__none__";

const ROW_ICON = "fa-wand-sparkles";
const HINT_MAX = 110;

/**
 * Whether the players' picker lists homebrew majors: only with both world switches on. The one
 * reading of the pair, so onboarding's picker and the Details-tab ask cannot disagree.
 */
export function playersSeeHomebrewMajors() {
	return getBooleanSetting("seekerAnyMajorArcanum") && getBooleanSetting("seekerAnyMajorHomebrew");
}

/**
 * The picker's rows: an optional "no grant" row first, then the background's own majors (in the
 * background's order), the other shipped majors, and the homebrew ones, each under a heading that is
 * left out when its group is empty. `majors` are `{ slug, name, summary, homebrew }`.
 */
export function majorArcanumRows({ majors = [], listed = [], clearLabel = null, clearHint = "" } = {}) {
	const row = m => ({ id: m.slug, label: m.name || m.slug, icon: ROW_ICON, hint: truncateValue(m.summary ?? "", HINT_MAX) });
	const bySlug = new Map(majors.filter(m => m?.slug).map(m => [m.slug, m]));
	const listedSet = new Set(listed);
	const byName = (a, b) => String(a.name).localeCompare(String(b.name));
	const groups = [
		["stonetop.seekerMajor.groups.listed",   listed.map(slug => bySlug.get(slug)).filter(Boolean)],
		["stonetop.seekerMajor.groups.other",    [...bySlug.values()].filter(m => !listedSet.has(m.slug) && !m.homebrew).sort(byName)],
		["stonetop.seekerMajor.groups.homebrew", [...bySlug.values()].filter(m => !listedSet.has(m.slug) && m.homebrew).sort(byName)],
	];
	const rows = clearLabel ? [{ id: NO_GRANT, label: clearLabel, icon: "fa-rotate-left", hint: clearHint }] : [];
	for (const [heading, members] of groups) {
		if (members.length) rows.push({ heading: localize(heading) }, ...members.map(row));
	}
	return rows;
}

/**
 * Ask for one major arcanum. Resolves to its slug, `""` for the "no grant" row (offered only with
 * `clearLabel`), or null when dismissed. pickContentOption escapes labels and hints itself.
 */
export async function pickMajorArcanum({ majors, listed = [], selected = "", title, buttonLabel, clearLabel = null, clearHint = "" }) {
	const options = majorArcanumRows({ majors, listed, clearLabel, clearHint });
	if (!options.some(o => !o.heading)) return null;
	const picked = await pickContentOption({ title, options, buttonLabel, selected: selected || (clearLabel ? NO_GRANT : null) });
	if (picked == null) return null;
	return picked === NO_GRANT ? "" : picked;
}

/**
 * Every finished major arcanum, shipped and (unless `homebrew` is false) the world's own, in the
 * picker's shape. A shipped card is one whose uuid is the compendium's.
 */
export async function loadMajorArcana({ homebrew = true } = {}) {
	const rows = await new ArcanaSource().loadRows();
	return rows
		.filter(row => row.isMajor)
		.map(row => ({ slug: row.key, name: row.title, summary: row.summary, homebrew: !String(row.uuid ?? "").startsWith("Compendium.") }))
		.filter(major => homebrew || !major.homebrew);
}

/**
 * The players' "Choose a different arcanum", from onboarding's step and the Details tab's ask alike:
 * any major, the background's own first, homebrew ones only with both world switches on. `majors`
 * defaults to loadMajorArcana(); onboarding passes the ones it has already loaded.
 * @returns {Promise<string|null>}  The picked slug, or null when dismissed.
 */
export async function pickOtherSeekerMajor({ majors = null, background = null, selected = "" } = {}) {
	const homebrew = playersSeeHomebrewMajors();
	const pool = majors ?? await loadMajorArcana({ homebrew });
	return pickMajorArcanum({
		majors:      pool.filter(m => homebrew || !m.homebrew),
		listed:      background?.majorArcana ?? [],
		selected,
		title:       localize("stonetop.seekerMajor.otherTitle"),
		buttonLabel: localize("stonetop.seekerMajor.otherButton"),
	});
}

/**
 * The GM's "Give a major arcanum": pick any major (shipped or homebrew) for this Seeker, or the
 * background's own three again. Before creation the grant alone is enough (onboarding reads it).
 * After creation the card is given now, with its 1 mark asked for (SeekerMajorArcanumDialog), and
 * the old creation major goes only while it is as granted (settleSeekerArcana); "Choose later" leaves
 * the Arcana tab's owed cue. Taking the grant back keeps the card held (the GM removes it by hand).
 * Writes nothing for a player.
 *
 * @param {StonetopCharacter} character
 * @param {{background?: object, name?: string}} [options]  The selected background (for its list and
 *        the mark dialog's title) and the character's name (for the picker's title).
 * @returns {Promise<boolean>}  Whether anything was written.
 */
export async function giveSeekerMajor(character, { background = null, name = "" } = {}) {
	if (!game.user?.isGM) return false;
	const current = character.seekerMajorGrant();
	const slug = await pickMajorArcanum({
		majors:      await loadMajorArcana(),
		listed:      background?.majorArcana ?? [],
		selected:    current,
		title:       format("stonetop.seekerMajor.grant.pickTitle", { name }),
		buttonLabel: localize("stonetop.seekerMajor.grant.pickButton"),
		clearLabel:  localize("stonetop.seekerMajor.grant.clear"),
		clearHint:   localize("stonetop.seekerMajor.grant.clearHint"),
	});
	if (slug === null) return false;
	if (slug === current) return false;
	await character.setSeekerMajorGrant(slug);
	if (!slug) return true;

	const state = character.seekerCreationState();
	const created = !!state.major || state.minorDraw.length > 0;
	if (!created || state.major === slug) return true;
	const card = await character.getArcanum(slug);
	const answer = card ? await SeekerMajorArcanumDialog.ask(background, [card]) : null;
	if (!answer?.major) return true;
	const old = state.major;
	await character.chooseSeekerMajor(answer.major, answer.marks);
	if (old && old !== answer.major && character.ownedArcanaSlugs.has(old)) {
		const oldName = (await character.getArcanum(old))?.front?.title ?? old;
		ui.notifications?.info?.(format("stonetop.seekerMajor.grant.stays", { major: oldName, given: card.front?.title ?? slug }));
	}
	return true;
}
