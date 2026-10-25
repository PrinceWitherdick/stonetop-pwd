import { describe, it, expect } from "vitest";
import { normaliseEditorText, decodeEntities } from "../../module/utils/strings.js";
import { normaliseChronicleHtml } from "../../module/utils/chronicle-core.js";
import { hashString } from "../../module/hooks/journal-sync-core.js";

// One normaliser behind two stored hashes: the Chronicle's prose hashes and the timeline's season
// rows. Both hashes already sit on pages in running worlds, so the shared helper has to give the
// exact strings the two spelled out before; a different string would read every row and section
// as edited by the GM and freeze it.

const samples = [
	"",
	"  plain  words  ",
	"<p>Tor&#x27;s blessing&nbsp;&mdash; a  good\n\tyear</p>",
	"<p>one</p>\n  <p>two<br/>three<BR >four</p>",
	"&amp;mdash; stays one step decoded",
];

describe("normaliseEditorText", () => {
	it("is what the season row hash spelled out inline before", () => {
		const before = value => decodeEntities(String(value ?? "")).replace(/\s+/g, " ").trim();
		for (const s of [...samples, null, undefined]) expect(normaliseEditorText(s)).toBe(before(s));
	});

	it("leaves the Chronicle's prose form exactly as it was", () => {
		const before = html => decodeEntities(String(html ?? ""))
			.replace(/<br\s*\/?>/gi, "<br>")
			.replace(/\s+/g, " ")
			.replace(/>\s+</g, "><")
			.trim();
		for (const s of samples) expect(hashString(normaliseChronicleHtml(s))).toBe(hashString(before(s)));
	});
});
