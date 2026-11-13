// The Playbook Builder's line-per-entry text boxes, read and written. A playbook's short lists
// (instincts, looks, origins, the either/or starting picks, intro questions, a lore section's
// options) are typed one entry per line rather than built from add-a-row controls: a GM reviewing
// a PDF import can fix twenty lines in one box, and typing never re-renders the window.
//
// Each pair below is (text -> data, data -> text), and data -> text -> data is the identity on
// anything the builder wrote. PURE.

const lines = text => String(text ?? "").replace(/\r\n?/g, "\n").split("\n").map(l => l.trim()).filter(Boolean);
const commaList = text => String(text ?? "").split(",").map(s => s.trim()).filter(Boolean);

/** "Word: what it means" per line. A line with no colon is a word alone. */
export function parseInstinctLines(text) {
	return lines(text).map(line => {
		const i = line.indexOf(":");
		return i < 0
			? { word: line, description: "" }
			: { word: line.slice(0, i).trim(), description: line.slice(i + 1).trim() };
	}).filter(e => e.word);
}
export function instinctLines(list = []) {
	return list.map(i => i.description ? `${i.word}: ${i.description}` : i.word).join("\n");
}

/** One appearance row per line, its choices split by commas. */
export function parseAppearanceLines(text) {
	return lines(text).map(commaList).filter(row => row.length);
}
export function appearanceLines(rows = []) {
	return rows.map(row => row.join(", ")).join("\n");
}

/** "Region: Name, Name" per line. A region with no names ("Gordin's Delve: ") keeps an empty list. */
export function parseOriginLines(text) {
	return lines(text).map(line => {
		const i = line.indexOf(":");
		return i < 0
			? { region: line, names: [] }
			: { region: line.slice(0, i).trim(), names: commaList(line.slice(i + 1)) };
	}).filter(o => o.region);
}
export function originLines(list = []) {
	return list.map(o => `${o.region}: ${o.names.join(", ")}`.trimEnd()).join("\n");
}

/**
 * One either/or starting pick per line: "Ambush / Skill at Arms", or the book's own capital OR
 * ("Ambush OR Skill at Arms"). Never a lowercase "or", which a move's name may hold.
 */
export function parseChoiceLines(text) {
	return lines(text).map(line => ({
		label: "Choose one",
		options: line.split(/\s*\/\s*|\s+OR\s+/).map(s => s.trim()).filter(Boolean),
	})).filter(c => c.options.length >= 2);
}
export function choiceLines(list = []) {
	return list.map(c => c.options.join(" / ")).join("\n");
}

/** "Group label: Move, Move" per line. */
export function parseGroupLines(text) {
	return lines(text).map(line => {
		const i = line.indexOf(":");
		if (i < 0) return null;
		return { label: line.slice(0, i).trim(), moves: commaList(line.slice(i + 1)) };
	}).filter(g => g && g.label && g.moves.length);
}
export function groupLines(list = []) {
	return list.map(g => `${g.label}: ${g.moves.join(", ")}`).join("\n");
}

/** Plain one-per-line list (intro questions). */
export function parseLineList(text) { return lines(text); }
export function lineList(list = []) { return list.join("\n"); }

/**
 * A lore section's options, one per line. "write: Who taught you?" is a write-in (a text box in
 * onboarding); a trailing "(x2)" lets the option be ticked twice (the Fox's tall tales).
 */
const WRITE_IN = /^write\s*:\s*/i;
const REPEAT = /\s*\(x\s*(\d)\)\s*$/i;
export function parseLoreOptionLines(text) {
	return lines(text).map(line => {
		if (WRITE_IN.test(line)) return { description: line.replace(WRITE_IN, "").trim(), max: 1, freeText: true };
		const m = line.match(REPEAT);
		return { description: line.replace(REPEAT, "").trim(), max: m ? Math.max(1, Math.min(9, Number(m[1]))) : 1, freeText: false };
	}).filter(o => o.description);
}
export function loreOptionLines(list = []) {
	return list.map(o => o.freeText ? `write: ${o.description}` : (o.max > 1 ? `${o.description} (x${o.max})` : o.description)).join("\n");
}

/**
 * An insert list's options: a lore section's lines, plus "ticked: terrifying" for an option every
 * character starts with ticked (printed ticked on the page).
 */
const TICKED = /^ticked\s*:\s*/i;
export function parseInsertOptionLines(text) {
	return lines(text).map(line => {
		const preselected = TICKED.test(line);
		const [o] = parseLoreOptionLines(line.replace(TICKED, ""));
		return o ? { ...o, preselected: preselected && !o.freeText } : null;
	}).filter(Boolean);
}
export function insertOptionLines(list = []) {
	return list.map(o => `${o.preselected ? "ticked: " : ""}${loreOptionLines([o])}`).join("\n");
}

/** Bonus picks a move gives a list, both ways: "Implements of Evil +2, Extra Gear +1". */
export function parseBonusPicks(text) {
	return commaList(text).map(part => {
		const m = part.match(/^(.*?)\s*\+\s*(\d+)\s*$/);
		return m ? { move: m[1].trim(), count: Math.max(1, Math.min(10, Number(m[2]))) } : { move: part.trim(), count: 1 };
	}).filter(b => b.move);
}
export function bonusPickList(list = []) {
	return list.map(b => `${b.move} +${b.count}`).join(", ");
}

/** A comma list of names, both ways (a background's moves, a requirement's moves, track labels). */
export function parseNameList(text) { return commaList(text); }
export function nameList(list = []) { return list.join(", "); }

/**
 * Write `value` at a dotted bundle path ("playbook.backgrounds.0.track.label"), making any object
 * on the way that is missing OR null. A background with no track holds `track: null`, and core's
 * setProperty walks into the null and throws, which took every builder button down with it.
 * Numeric steps index the arrays already there. Returns the object written into.
 */
export function setBundlePath(target, path, value) {
	const keys = String(path ?? "").split(".").filter(Boolean);
	if (!keys.length || !target || typeof target !== "object") return target;
	// A blank field under nothing (an empty "Its own track" box) leaves the nothing as it is: making
	// `{ label: "", max: 0 }` of it changed the playbook as the builder holds it, so a window just
	// saved counted as unsaved.
	const blank = value === "" || value === 0 || value === false || value === null || value === undefined;
	let obj = target;
	for (const key of keys.slice(0, -1)) {
		if (obj[key] === null || typeof obj[key] !== "object") {
			if (blank) return target;
			obj[key] = {};
		}
		obj = obj[key];
	}
	obj[keys.at(-1)] = value;
	return target;
}
