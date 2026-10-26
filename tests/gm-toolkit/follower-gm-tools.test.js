import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { BALK_REASONS, BALK_RULE, REVIEW_ITEMS } from "../../module/gm-toolkit/follower-text.js";
import { balkCardBody, mayAnswerBalk, answerFollowerBalk, balkAnswerFor, BALK_FLAG, BALK_ANSWER_FLAG } from "../../module/gm-toolkit/follower-balk.js";
import { useUpChoices, useUpUpdate } from "../../module/actors/character/follower-use-up.js";
import { SYSTEM_ID } from "../../module/system-id.js";

// The GM's side of followers (Book I p.182, p.466-467, p.480): the book's words, "Use up their resources" on
// a follower's card, and the "They balk" card the player answers.

describe("the book's words", () => {
	it("keeps the reasons a follower resists an order, and what the player can do, as the book prints them (p.466)", () => {
		const text = BALK_REASONS.map(r => r.text).join(" ");
		for (const phrase of [
			"freeze up when surprised, or flee from a terrifying foe, or panic in the face of supernatural horror",
			"angry, miserable, shocked, or otherwise overwhelmed",
			"unreasonable, foolish, degrading, distasteful",
			"goes against the follower's instinct, tags, cost, or other traits",
		]) expect(text).toContain(phrase);
		expect(BALK_RULE).toContain("spend the follower's Loyalty (if they hold any) to have them \"do something they don't want to do.\"");
		expect(BALK_RULE).toContain("Or they could let it drop and do something else.");
	});

	it("keeps the between-session review's nine checks (p.480)", () => {
		expect(REVIEW_ITEMS).toHaveLength(9);
		expect(REVIEW_ITEMS[0]).toBe("... their instinct and/or cost no longer ring true, then revise them.");
		expect(REVIEW_ITEMS.some(i => i.includes("write them up as a threat (page 277)"))).toBe(true);
	});
});

describe("use up their resources (p.182)", () => {
	const pips = (n, of) => ({ pips: Array.from({ length: of }, (_, i) => ({ filled: i < n })) });
	const andras = {
		ftype: "custom", slug: "a1", loyaltySlug: "a1", orderName: "Andras",
		loyalty: [{ filled: true }, {}, {}], loyaltyValue: 1, usesAmmo: true, ammoValue: 1,
		gear: [{ index: 0, label: "bow", checked: true }, { index: 1, label: "rope", checked: false }],
	};

	it("offers only what this follower has to lose", () => {
		expect(useUpChoices(andras).map(c => c.key)).toEqual(["loyalty", "ammo", "gear"]);
		expect(useUpChoices(andras).find(c => c.key === "gear").items).toEqual([{ ref: "detail:0", label: "bow" }]);
		expect(useUpChoices({ ...andras, loyaltyValue: 0, ammoValue: 2, gear: [] })).toEqual([]);
		expect(useUpChoices(null)).toEqual([]);
	});

	it("offers the crew's Supplies, inventory and what members produced", () => {
		const crew = {
			ftype: "crew", slug: "", loyalty: [{}, {}, {}], loyaltyValue: 0,
			supplySets: [pips(2, 5), pips(0, 5)],
			gear: [{ slug: "spears", label: "<strong>spears</strong> &amp; shields", checked: true }, { slug: "rope", label: "rope", checked: false }],
			produced: [{ index: 0, label: "litter (Lowri)", checked: true }],
		};
		const choices = useUpChoices(crew);
		expect(choices.map(c => c.key)).toEqual(["supplies", "gear"]);
		expect(choices[0].left).toBe(2);
		expect(choices[1].items).toEqual([{ ref: "crew:spears", label: "spears & shields" }, { ref: "detail:0", label: "litter (Lowri)" }]);
	});

	it("counts and spends the crew's Supplies by the rule Make Camp uses (supply-cost.js)", () => {
		const crew = (...sets) => ({ ftype: "crew", slug: "", supplySets: sets.map(n => pips(n, 5)) });
		const spend = (card, stored, count) => useUpUpdate(card, { crew: { supplies: stored } }, { key: "supplies", count }, "stonetop-pwd");
		// The last member's set is eaten first, so the full ◇ stay at the head of the roster.
		expect(spend(crew(5, 5, 2), [5, 5, 2], 3)).toEqual({
			update: { "flags.stonetop-pwd.crew.supplies": [5, 4, 0] }, what: "3 uses of Supplies lost (9 left)",
		});
		// Never below empty: asking for more than is held takes what there is.
		expect(spend(crew(1), [1], 4)).toEqual({ update: { "flags.stonetop-pwd.crew.supplies": [0] }, what: "1 use of Supplies lost (0 left)" });
		expect(spend(crew(0), undefined, 2)).toBeNull();
		// A set past the roster is not drawn, so not counted or eaten; a stored count over the ◇ is capped.
		expect(spend(crew(5, 2), [9, 2, 5], 3)).toEqual({
			update: { "flags.stonetop-pwd.crew.supplies": [4, 0, 5] }, what: "3 uses of Supplies lost (4 left)",
		});
		expect(useUpChoices(crew(3, 1)).find(c => c.key === "supplies").left).toBe(4);
	});

	it("writes the step it chose, and says what went", () => {
		const flags = { customFollowers: { a1: { ammo: 1, gear: [{ label: "bow", checked: true }, { label: "rope", checked: false }] } }, crew: { supplies: [5, 2] } };
		expect(useUpUpdate(andras, flags, { key: "ammo" }, "stonetop-pwd")).toEqual({
			update: { "flags.stonetop-pwd.customFollowers.a1.ammo": 2 }, what: "all out of ammo",
		});
		expect(useUpUpdate(andras, flags, { key: "gear", ref: "detail:0" }, "stonetop-pwd")).toEqual({
			update: { "flags.stonetop-pwd.customFollowers.a1.gear": [{ label: "bow", checked: false }, { label: "rope", checked: false }] },
			what: "bow lost",
		});
		const crew = { ftype: "crew", slug: "", supplySets: [pips(5, 5), pips(2, 5)], gear: [{ slug: "spears", label: "spears", checked: true }] };
		expect(useUpUpdate(crew, flags, { key: "supplies", count: 3 }, "stonetop-pwd")).toEqual({
			update: { "flags.stonetop-pwd.crew.supplies": [4, 0] }, what: "3 uses of Supplies lost (4 left)",
		});
		expect(useUpUpdate(crew, flags, { key: "gear", ref: "crew:spears" }, "stonetop-pwd").update).toEqual({ "flags.stonetop-pwd.crew.gear.spears": 0 });
		expect(useUpUpdate(andras, { customFollowers: { a1: { ammo: 2 } } }, { key: "ammo" }, "stonetop-pwd")).toBeNull();
	});

	// Code review 10-22 (HC-9): the card was drawn when the window opened, the list is read at the press. A row
	// moved or removed meanwhile must not put another item under the chosen index.
	it("unticks the item the window named, found again by its label when the list changed meanwhile", () => {
		const moved = { customFollowers: { a1: { gear: [{ label: "rope", checked: true }, { label: "bow", checked: true }] } } };
		expect(useUpUpdate(andras, moved, { key: "gear", ref: "detail:0" }, "stonetop-pwd")).toEqual({
			update: { "flags.stonetop-pwd.customFollowers.a1.gear": [{ label: "rope", checked: true }, { label: "bow", checked: false }] },
			what: "bow lost",
		});
		const gone = { customFollowers: { a1: { gear: [{ label: "rope", checked: true }, { label: "bow", checked: false }] } } };
		expect(useUpUpdate(andras, gone, { key: "gear", ref: "detail:0" }, "stonetop-pwd")).toBeNull();
	});

	it("reads a marked-up label as plain text", () => {
		const card = { ftype: "crew", gear: [{ checked: true, slug: "spears", label: "<em>2</em> piercing &lt;x&gt;" }] };
		expect(useUpChoices(card).find(c => c.key === "gear").items[0].label).toBe("2 piercing <x>");
	});
});

describe("the balk card", () => {
	let saved;
	beforeEach(() => {
		saved = { ChatMessage: globalThis.ChatMessage, game: globalThis.game };
		globalThis.ChatMessage = { create: vi.fn(async () => ({})), getSpeaker: () => ({ alias: "Cadi" }) };
	});
	afterEach(() => { globalThis.ChatMessage = saved.ChatMessage; globalThis.game = saved.game; });

	it("offers the player's three answers, Loyalty only while some is held", () => {
		const html = balkCardBody({ name: "Andras", leaderName: "Cadi", reason: "scared", loyalty: 0 });
		expect(html).toContain('data-choice="spend" disabled');
		expect(html).toContain('data-choice="persuade"');
		expect(html).toContain('data-choice="drop"');
		expect(html).toContain("freeze up when surprised");
		expect(balkCardBody({ name: "A", leaderName: "C", reason: "against", loyalty: 2 })).not.toContain('data-choice="spend" disabled');
	});

	it("is answered by the leader's owner, or the GM while none of them is here", () => {
		const leader = { testUserPermission: (u) => u.id === "p1" };
		const player = { id: "p1", isGM: false, active: true };
		const gm = { id: "gm", isGM: true };
		expect(mayAnswerBalk(leader, player, [player, gm])).toBe(true);
		expect(mayAnswerBalk(leader, gm, [player, gm])).toBe(false);
		expect(mayAnswerBalk(leader, gm, [{ ...player, active: false }, gm])).toBe(true);
		expect(mayAnswerBalk(leader, { id: "p2", isGM: false }, [player])).toBe(false);
	});

	it("spends the Loyalty and answers with a card of its own, once", async () => {
		const message = { id: "m1", flags: { [SYSTEM_ID]: { [BALK_FLAG]: { characterUuid: "Actor.cadi", ftype: "crew", slug: "", loyaltySlug: "", name: "The Crew", reason: "scared" } } } };
		const cadi = { name: "Cadi", isOwner: true, flags: { [SYSTEM_ID]: { crew: { loyalty: 2 } } }, update: vi.fn(async () => {}) };
		globalThis.game = { ...saved.game, messages: [] };
		ChatMessage.create.mockImplementation(async () => ({ id: "a1" }));
		expect(await answerFollowerBalk(message, "spend", cadi)).toBe(true);
		expect(cadi.update.mock.calls[0][0][`flags.${SYSTEM_ID}.crew.loyalty`]).toBe(1);
		const answer = ChatMessage.create.mock.calls[0][0];
		expect(answer.flags[SYSTEM_ID][BALK_ANSWER_FLAG]).toEqual({ to: "m1", choice: "spend" });
		// Once answered, it stays answered.
		globalThis.game.messages = [{ flags: answer.flags }];
		expect(balkAnswerFor(message)).toBeTruthy();
		expect(await answerFollowerBalk(message, "drop", cadi)).toBe(false);
	});

	it("takes its answer back and spends nothing when another answer reached the log first", async () => {
		const message = { id: "m1", flags: { [SYSTEM_ID]: { [BALK_FLAG]: { characterUuid: "Actor.cadi", ftype: "crew", slug: "", loyaltySlug: "", name: "The Crew", reason: "scared" } } } };
		const cadi = { name: "Cadi", isOwner: true, flags: { [SYSTEM_ID]: { crew: { loyalty: 2 } } }, update: vi.fn(async () => {}) };
		const theirs = { id: "a1", flags: { [SYSTEM_ID]: { [BALK_ANSWER_FLAG]: { to: "m1", choice: "spend" } } } };
		globalThis.game = { ...saved.game, messages: [] };
		const mine = { id: "a2", delete: vi.fn(async () => {}) };
		// Another owner's answer, posted a moment earlier, lands in the log ahead of this one's.
		ChatMessage.create.mockImplementation(async data => {
			globalThis.game.messages.push(theirs, { ...mine, flags: data.flags });
			return mine;
		});
		expect(await answerFollowerBalk(message, "spend", cadi)).toBe(false);
		expect(mine.delete).toHaveBeenCalledTimes(1);
		expect(cadi.update).not.toHaveBeenCalled();
	});

	// Code review 10-22 (HC-6): the answer card IS the claim on the balk. Without one (a hook refused it, the
	// create failed), nothing is spent, or the card would stay open for a second spend.
	it("spends nothing when its answer card could not be posted", async () => {
		const message = { id: "m1", flags: { [SYSTEM_ID]: { [BALK_FLAG]: { characterUuid: "Actor.cadi", ftype: "crew", slug: "", loyaltySlug: "", name: "The Crew", reason: "scared" } } } };
		const cadi = { name: "Cadi", isOwner: true, flags: { [SYSTEM_ID]: { crew: { loyalty: 2 } } }, update: vi.fn(async () => {}) };
		globalThis.game = { ...saved.game, messages: [] };
		ChatMessage.create.mockImplementation(async () => undefined);
		expect(await answerFollowerBalk(message, "spend", cadi)).toBe(false);
		expect(cadi.update).not.toHaveBeenCalled();
	});

	it("takes its answer back when the Loyalty could not be spent after all", async () => {
		const message = { id: "m1", flags: { [SYSTEM_ID]: { [BALK_FLAG]: { characterUuid: "Actor.cadi", ftype: "crew", slug: "", loyaltySlug: "", name: "The Crew", reason: "scared" } } } };
		const cadi = { name: "Cadi", isOwner: true, flags: { [SYSTEM_ID]: { crew: { loyalty: 0 } } }, update: vi.fn(async () => {}) };
		globalThis.game = { ...saved.game, messages: [] };
		expect(await answerFollowerBalk(message, "spend", cadi)).toBe(false);
		expect(ChatMessage.create).not.toHaveBeenCalled();
		expect(cadi.update).not.toHaveBeenCalled();
	});
});
