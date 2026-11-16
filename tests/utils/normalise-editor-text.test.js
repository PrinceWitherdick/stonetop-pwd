import { describe, it, expect } from "vitest";
import { normaliseEditorText } from "../../module/utils/strings.js";
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
	// Release 1.8.5 review: decodeEntities learned these after the hashes were stamped; the hash
	// form must not, or a pristine section holding one reads as edited.
	"&ldquo;Tor&rdquo; said &apos;no&apos;, &#x2019;twas &#8220;so&#8221;",
];

// decodeEntities as it was when the stored hashes were stamped (before release 1.8.5's cleanup).
const legacyDecode = text => String(text ?? "")
	.replace(/&mdash;|&#8212;|&#x2014;/gi, "—")
	.replace(/&ndash;|&#8211;|&#x2013;/gi, "–")
	.replace(/&hellip;|&#8230;/gi, "…")
	.replace(/&rsquo;|&#8217;/gi, "’")
	.replace(/&lsquo;|&#8216;/gi, "‘")
	.replace(/&nbsp;|&#160;/gi, " ")
	.replace(/&quot;|&#34;/gi, '"')
	.replace(/&#39;|&#x27;/gi, "'")
	.replace(/&lt;|&#60;/gi, "<")
	.replace(/&gt;|&#62;/gi, ">")
	.replace(/&amp;|&#38;/gi, "&");

describe("normaliseEditorText", () => {
	it("is what the season row hash spelled out inline before", () => {
		const before = value => legacyDecode(value).replace(/\s+/g, " ").trim();
		for (const s of [...samples, null, undefined]) expect(normaliseEditorText(s)).toBe(before(s));
	});

	it("leaves the Chronicle's prose form exactly as it was", () => {
		const before = html => legacyDecode(html)
			.replace(/<br\s*\/?>/gi, "<br>")
			.replace(/\s+/g, " ")
			.replace(/>\s+</g, "><")
			.trim();
		for (const s of samples) expect(hashString(normaliseChronicleHtml(s))).toBe(hashString(before(s)));
	});
});
