// The Crew insert's write-in lines (Book I p.144): three blank tag lines after the printed tags, and
// six blank inventory lines (3 ◇, 3 ◇◇) after the printed kit.
//
// TAGS. A write-in tag is stored where every tag is, in `crew.tags`: any tag there that is not one of
// the insert's printed tags (nor the background's, nor "group") is a write-in, in the order written.
// A crew from when the card had one write-in box reads the same way, its one write-in filling the
// first box, so nothing is migrated. Each write-in spends one of the "pick N" tag picks.
//
// INVENTORY. A written-in item is a row of its own at `crew.writtenGear` ({id, label, weight}), and
// its carried pips sit in the crew's pip map, `crew.gear[id]`, beside the printed kit's, so every
// reader of the crew's load (the card's load summary, the expedition's load rows) counts it with no
// second rule. Its id never collides with a printed row's slug.

/** How many tag write-ins the insert prints. */
export const CREW_WRITE_IN_TAGS = 3;

/** The id prefix of a written-in inventory row, so it never collides with a printed slug. */
export const CREW_WRITTEN_GEAR_PREFIX = "written-";

/** The stored tags that spend a pick: all but the background's and "group". */
function pickedTags(tags, bgTag) {
	return (Array.isArray(tags) ? tags : []).filter(t => t && t !== bgTag && t !== "group");
}

/** The stored tags that are write-ins (the picks the insert does not print), in the order stored. THE rule. */
function writtenTags(tags, crewDef, bgTag) {
	const known = new Set(crewDef?.availableTags ?? []);
	return pickedTags(tags, bgTag).filter(t => !known.has(t));
}

/**
 * The write-in tag boxes, filled from the stored tags: the tags the insert does not print, in the
 * order stored, padded with "" to CREW_WRITE_IN_TAGS. A write-in past the boxes is left out of them,
 * and kept by crewTagsWithWriteIns.
 * @param {string[]} tags        crew.tags as stored
 * @param {object}   crewDef     the Crew insert (its `availableTags`)
 * @param {?string}  bgTag       the background's tag, never a write-in
 * @returns {string[]}
 */
export function crewWriteInTags(tags, crewDef, bgTag = null) {
	const boxes = writtenTags(tags, crewDef, bgTag).slice(0, CREW_WRITE_IN_TAGS);
	while (boxes.length < CREW_WRITE_IN_TAGS) boxes.push("");
	return boxes;
}

/**
 * The tags to store from the picker: the printed tags ticked, then each write-in box typed in, once
 * each, while there is room under `limit` (a write-in spends a pick). A write-in past the boxes
 * (`overflow`, crewWriteInTags leaves it out) stays as it was.
 * @param {string[]} listed     the printed tags ticked
 * @param {string[]} writeIns   the boxes' text, in order
 * @param {number}   limit      how many tags the player picks
 * @param {string[]} [overflow] stored write-ins beyond the boxes
 * @returns {string[]}
 */
export function crewTagsWithWriteIns(listed, writeIns, limit, overflow = []) {
	const tags = [...(listed ?? [])];
	for (const raw of (writeIns ?? [])) {
		const typed = String(raw ?? "").trim();
		if (!typed || tags.includes(typed)) continue;
		if (tags.length >= limit) break;
		tags.push(typed);
	}
	for (const t of (overflow ?? [])) if (t && !tags.includes(t)) tags.push(t);
	return tags;
}

/**
 * The write-in boxes as the picker draws them: each box's text, and an empty box disabled once the
 * picks are spent.
 * @returns {{index: number, value: string, disabled: boolean}[]}
 */
export function crewWriteInTagBoxes(tags, crewDef, bgTag, limit) {
	const boxes = crewWriteInTags(tags, crewDef, bgTag);
	const atLimit = pickedTags(tags, bgTag).length >= limit;
	return boxes.map((value, index) => ({ index, value, disabled: !value && atLimit }));
}

/** Stored write-ins past the boxes (crewWriteInTags), which the picker leaves as they are. */
export function crewWriteInOverflow(tags, crewDef, bgTag = null) {
	return writtenTags(tags, crewDef, bgTag).slice(CREW_WRITE_IN_TAGS);
}

/**
 * The written-in inventory rows, cleaned: each with an id, a label and a weight of 1 or 2.
 * @param {unknown} stored  crew.writtenGear
 * @returns {{id: string, label: string, weight: number}[]}
 */
export function crewWrittenGear(stored) {
	return (Array.isArray(stored) ? stored : [])
		.filter(row => row && typeof row === "object" && typeof row.id === "string" && row.id && String(row.label ?? "").trim())
		.map(row => ({ id: row.id, label: String(row.label).trim(), weight: Number(row.weight) === 2 ? 2 : 1 }));
}

/**
 * The rows with one more written in, or null when the name is blank. `id` is the new row's (the
 * caller's random id, prefixed here).
 */
export function addCrewWrittenGear(stored, { label, weight } = {}, id) {
	const name = String(label ?? "").trim();
	if (!name || !id) return null;
	return [...crewWrittenGear(stored), { id: `${CREW_WRITTEN_GEAR_PREFIX}${id}`, label: name, weight: Number(weight) === 2 ? 2 : 1 }];
}

/**
 * The actor update that strikes one written-in row: the row goes, and its pips leave the crew's pip
 * map (a `-=` key, since a merge cannot drop one), so the load stops counting it.
 */
export function removeCrewWrittenGearUpdate(stored, id, scope) {
	const base = `flags.${scope}.crew`;
	return {
		[`${base}.writtenGear`]: crewWrittenGear(stored).filter(row => row.id !== id),
		[`${base}.gear.-=${id}`]: null,
	};
}
