import { describe, it, expect } from "vitest";
import { actorLinkHtml } from "../../module/utils/actor-link.js";

// The link a retired PC's NPC notes and a threat page carry back to who they once were.
describe("actorLinkHtml", () => {
	it("links by uuid, labelled with the name", () => {
		expect(actorLinkHtml({ uuid: "Actor.abc", name: "Bram" })).toBe("@UUID[Actor.abc]{Bram}");
	});

	it("escapes the label, so a name is never markup", () => {
		expect(actorLinkHtml({ uuid: "Actor.abc", name: "A <b>" })).toBe("@UUID[Actor.abc]{A &lt;b&gt;}");
	});

	// The enricher's label ends at the first "}", so such a name would cut the link short.
	it("leaves the label off a name with a closing brace, for the enricher to show the actor's own", () => {
		expect(actorLinkHtml({ uuid: "Actor.abc", name: "Bran {the Red}" })).toBe("@UUID[Actor.abc]");
	});

	it("is the escaped name alone without a uuid", () => {
		expect(actorLinkHtml({ name: "A <b>" })).toBe("A &lt;b&gt;");
	});
});
