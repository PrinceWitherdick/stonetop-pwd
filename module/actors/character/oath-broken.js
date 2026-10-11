/**
 * A stored oath's `broken`, as a hard boolean. Only an explicit yes reads as broken: this drives an
 * advantage claim, and a hand-edited world holding the string "false" must not read as "they broke
 * it" (a plain `!!raw` called that string true).
 *
 * A file of its own so the timeline's milestone reader (timeline-milestones.js), which is pure, reads
 * an oath as broken by the same rule the sheet does without loading the oath moves (oaths.js).
 */
export function coerceBroken(raw) {
	return raw === true || raw === 1 || String(raw ?? "").trim().toLowerCase() === "true";
}
