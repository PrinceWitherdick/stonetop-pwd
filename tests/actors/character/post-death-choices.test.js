import { describe, it, expect, vi } from "vitest";
import {
	POST_DEATH_CHOICES,
	GM_CHOOSES_NOTE,
	buildPostDeathChoices,
	choiceWriteIns,
	outstandingLabel,
} from "../../../module/actors/character/post-death-choices.js";
import { CharacterPostDeath } from "../../../module/actors/character/CharacterPostDeath.js";
import { CharacterInstincts } from "../../../module/actors/character/CharacterInstincts.js";
import { CharacterLore } from "../../../module/actors/character/CharacterLore.js";

function makeFlags(store = {}) {
	return {
		getFlag: (key) => store[key] ?? null,
		setFlag: vi.fn(async (key, val) => { store[key] = val; }),
		// The real one deletes the key outright (an object flag merges, so writing "" or [] would
		// leave a present-but-empty record) — pruneToInsert drops the non-lore records this way.
		unsetFlag: vi.fn(async (key) => { delete store[key]; }),
		_store: store,
	};
}

const GHOST_LORE = [
	{
		slug: "terrible-purpose",
		options: [
			{ slug: "longing",   description: "<p><strong>LONGING</strong> &mdash; Name the person.</p>" },
			{ slug: "vengeance", description: "<p><strong>VENGEANCE</strong> &mdash; Name who must pay.</p>" },
			{ slug: "duty",      description: "<p><strong>DUTY</strong> &mdash; Name the task.</p>" },
		],
	},
	{
		slug: "consequences",
		options: [
			{ slug: "breakdown", description: "<p><strong>BREAKDOWN</strong> &mdash; You lash out.</p>" },
			{ slug: "unstable",  description: "<p><strong>UNSTABLE</strong> <em>(Requires Breakdown)</em> &mdash; Episodes.</p>", requires: "breakdown" },
			{ slug: "specter",   description: "<p><strong>SPECTER</strong> &mdash; You terrify.</p>" },
			// The one option in the book that asks a question of its own.
			{ slug: "strange-appetites", description: "<p><strong>STRANGE APPETITES</strong> &mdash; Pick 1: <em>still-warm blood</em> / <em>dying breaths</em> / <em>bone &amp; marrow</em></p><p>When you <em>consume your special fare</em>, heal half your max HP.</p>" },
			{ slug: "final-consequence", description: "<p><strong>THE FINAL CONSEQUENCE</strong> &mdash; You are lost.</p>" },
		],
	},
];

const THRALL_LORE = [
	{
		slug: "your-master",
		options: [{ slug: "master-name", type: "text", description: "<p>Name your master.</p>" }],
	},
	{
		slug: "impulse",
		options: [
			{ slug: "stoke-conflict", description: "<p>Stoke conflict, confusion, distrust</p>" },
			{ slug: "erode-hope",     description: "<p>Erode hope/faith/honor</p>" },
			{ slug: "custom-impulse", type: "text", description: "<p>Other (write in)</p>" },
		],
	},
	{
		slug: "marks",
		options: [
			{ slug: "red-wrath", description: "<p><strong>RED WRATH</strong> &mdash; Reduce your max HP by 2.</p>" },
			{ slug: "ravenous",  description: "<p><strong>RAVENOUS</strong> &mdash; You hunger.</p>" },
		],
	},
];

const INSTINCTS = [
	{ word: "Denial",    description: "To refuse to accept that you are dead." },
	{ word: "Obsession", description: "To pursue your Terrible Purpose no matter what." },
];

/**
 * A character stub with exactly the read/write surface post-death-choices.js uses — the same
 * approach the other dialog tests take, since nothing here needs a live Actor.
 */
function makeCharacter(slug, lore, { counts = {}, texts = {}, instinct = null, insertStore = {} } = {}) {
	const insertFlags = makeFlags({ slug, ...insertStore });
	const loreFlags   = makeFlags({ counts, texts });
	const repo = {
		findBySlug: async (s) => (s === slug ? { slug, name: slug[0].toUpperCase() + slug.slice(1), lore, instincts: INSTINCTS } : null),
		getAll: async () => [],
	};
	const pd = new CharacterPostDeath(
		insertFlags,
		new CharacterInstincts(makeFlags(instinct ? { selected: instinct } : {})),
		new CharacterLore(loreFlags),
		repo,
		{ getPostDeathMoves: async () => [] },
	);
	return {
		_postDeath: pd,
		get postDeathSlug()                { return pd.activeSlug; },
		async postDeathInsertName()        { return pd.insertName(); },
		async postDeathInstinctOptions()   { return pd.instinctOptions(); },
		postDeathLoreText(section, option) { return pd.loreText(section, option); },
		async sectionOptions(s)            { return pd.sectionOptions(s); },
		async chooseOneSectionOption(s, o) { return pd.chooseOneSectionOption(s, o); },
		async markSectionOption(s, o)      { return pd.markSectionOption(s, o); },
		async unmarkSectionOption(s, o)    { return pd.unmarkSectionOption(s, o); },
		async clearSectionPicks(s)         { return pd.clearSectionPicks(s); },
		get tether()                       { return pd.tether; },
	};
}

describe("POST_DEATH_CHOICES — what each insert asks for", () => {
	it("asks the Revenant for a Purpose, a Consequence and an Instinct", () => {
		expect(POST_DEATH_CHOICES.revenant.map(s => s.key)).toEqual(["purpose", "consequence", "instinct"]);
	});

	it("asks the Ghost for the same three plus its tether", () => {
		// Tethered reforms them beside it and its destruction is the Final Consequence, so the
		// Ghost is the only insert whose 0-HP move can't resolve until this is named.
		expect(POST_DEATH_CHOICES.ghost.map(s => s.key)).toEqual(["purpose", "consequence", "instinct", "tether"]);
	});

	it("asks the Thrall for a master, an Impulse, an Instinct and a Mark", () => {
		expect(POST_DEATH_CHOICES.thrall.map(s => s.key)).toEqual(["master", "impulse", "instinct", "mark"]);
	});

	it("marks exactly the Thrall's two GM picks as the GM's", () => {
		// "Ask the GM to choose 1" (Impulse) and "the GM will choose 1 Mark for you". Nothing on
		// the other two inserts is the GM's to pick.
		const gm = Object.entries(POST_DEATH_CHOICES)
			.flatMap(([slug, steps]) => steps.filter(s => s.gm).map(s => `${slug}:${s.key}`));
		expect(gm).toEqual(["thrall:impulse", "thrall:mark"]);
	});

	it("names the Purpose as the one pick that must also be written in", () => {
		// "If they can't tell you, they shouldn't pick this option" (p.245).
		const named = Object.values(POST_DEATH_CHOICES).flat().filter(s => s.nameFor).map(s => s.key);
		expect(new Set(named)).toEqual(new Set(["purpose"]));
	});
});

describe("buildPostDeathChoices — the view model both windows render", () => {
	it("returns null for a character wearing no insert", async () => {
		expect(await buildPostDeathChoices(makeCharacter(null, []))).toBe(null);
	});

	it("returns null for an insert we have no step table for", async () => {
		// A homebrew insert dragged onto the sheet: it still gets its tab, it just has no
		// walkthrough, which is better than a window of empty steps.
		expect(await buildPostDeathChoices(makeCharacter("wight", GHOST_LORE))).toBe(null);
	});

	it("reports every step outstanding on a freshly taken insert", async () => {
		const vm = await buildPostDeathChoices(makeCharacter("ghost", GHOST_LORE));
		expect(vm.slug).toBe("ghost");
		expect(vm.name).toBe("Ghost");
		expect(vm.outstanding).toBe(4);
		expect(vm.steps.every(s => !s.done)).toBe(true);
	});

	it("counts a picked-but-unnamed Purpose as still outstanding", async () => {
		const vm = await buildPostDeathChoices(makeCharacter("ghost", GHOST_LORE, {
			counts: { "terrible-purpose:longing": 1 },
		}));
		const purpose = vm.steps.find(s => s.key === "purpose");
		expect(purpose.chosenSlug).toBe("longing");
		expect(purpose.done).toBe(false);
		expect(vm.outstanding).toBe(4);
	});

	it("counts the Purpose done once it has been named", async () => {
		const vm = await buildPostDeathChoices(makeCharacter("ghost", GHOST_LORE, {
			counts: { "terrible-purpose:longing": 1 },
			texts:  { "terrible-purpose:longing": "My daughter, Wren" },
		}));
		const purpose = vm.steps.find(s => s.key === "purpose");
		expect(purpose.done).toBe(true);
		expect(purpose.nameValue).toBe("My daughter, Wren");
		expect(vm.outstanding).toBe(3);
	});

	it("hangs the name on the chosen option, so changing your mind keeps both names", async () => {
		const vm = await buildPostDeathChoices(makeCharacter("ghost", GHOST_LORE, {
			counts: { "terrible-purpose:vengeance": 1 },
			texts:  { "terrible-purpose:longing": "My daughter, Wren" },
		}));
		const purpose = vm.steps.find(s => s.key === "purpose");
		// VENGEANCE is what's picked now, and it hasn't been named — LONGING's name is still on
		// file against LONGING, not silently inherited.
		expect(purpose.chosenSlug).toBe("vengeance");
		expect(purpose.nameValue).toBe("");
		expect(purpose.done).toBe(false);
	});

	it("passes through a blocked Consequence rather than hiding it", async () => {
		const vm = await buildPostDeathChoices(makeCharacter("ghost", GHOST_LORE));
		const opts = vm.steps.find(s => s.key === "consequence").options;
		// UNSTABLE requires BREAKDOWN, which isn't marked — it prints, but it can't be taken.
		expect(opts.find(o => o.slug === "unstable").blocked).toBe(true);
		expect(opts.find(o => o.slug === "specter").blocked).toBe(false);
	});

	it("counts the Instinct done from the selection, not from the mere existence of options", async () => {
		const bare = await buildPostDeathChoices(makeCharacter("ghost", GHOST_LORE));
		expect(bare.steps.find(s => s.key === "instinct").done).toBe(false);

		const chosen = await buildPostDeathChoices(makeCharacter("ghost", GHOST_LORE, {
			instinct: "Denial — To refuse to accept that you are dead.",
		}));
		const step = chosen.steps.find(s => s.key === "instinct");
		expect(step.done).toBe(true);
		expect(step.options.find(o => o.selected).word).toBe("Denial");
	});

	it("reads the Ghost's tether off its own flag, not out of the lore", async () => {
		const vm = await buildPostDeathChoices(makeCharacter("ghost", GHOST_LORE, {
			insertStore: { tether: "The oak where they buried me" },
		}));
		const step = vm.steps.find(s => s.key === "tether");
		expect(step.value).toBe("The oak where they buried me");
		expect(step.done).toBe(true);
	});

	it("carries the GM note on the Thrall's two picks and on nothing else", async () => {
		const vm = await buildPostDeathChoices(makeCharacter("thrall", THRALL_LORE));
		const gm = vm.steps.filter(s => s.gm).map(s => s.key);
		expect(gm).toEqual(["impulse", "mark"]);
		expect(vm.steps.find(s => s.key === "impulse").gmNote).toBe(GM_CHOOSES_NOTE);
		expect(vm.steps.find(s => s.key === "instinct").gmNote).toBe("");
	});

	it("offers the Thrall's write-in Impulse, which sectionOptions drops", async () => {
		const vm = await buildPostDeathChoices(makeCharacter("thrall", THRALL_LORE, {
			texts: { "impulse:custom-impulse": "Drown the sound of bells" },
		}));
		const step = vm.steps.find(s => s.key === "impulse");
		// It's a text option, so it isn't in the radio list…
		expect(step.options.map(o => o.slug)).not.toContain("custom-impulse");
		// …but the step still carries it, or the GM could never write one in.
		expect(step.textOption).toBe("custom-impulse");
		expect(step.textValue).toBe("Drown the sound of bells");
	});

	it("reads the Thrall's master out of the lore texts", async () => {
		const vm = await buildPostDeathChoices(makeCharacter("thrall", THRALL_LORE, {
			texts: { "your-master:master-name": "The Nameless Weight" },
		}));
		const step = vm.steps.find(s => s.key === "master");
		expect(step.value).toBe("The Nameless Weight");
		expect(step.done).toBe(true);
	});

	it("treats whitespace as unanswered", async () => {
		const vm = await buildPostDeathChoices(makeCharacter("thrall", THRALL_LORE, {
			texts: { "your-master:master-name": "   " },
		}));
		expect(vm.steps.find(s => s.key === "master").done).toBe(false);
	});
});

describe("which sections accumulate, and which are one to a character", () => {
	it("accumulates Consequences and Marks, and only those", () => {
		// "When you first take this insert, choose 1. Choose ANOTHER whenever a move tells you to
		// do so." Treating these as exclusive is what silently deletes a Consequence a move gave
		// them three sessions ago.
		const acc = Object.entries(POST_DEATH_CHOICES)
			.flatMap(([slug, steps]) => steps.filter(s => s.accumulates).map(s => `${slug}:${s.key}`));
		expect(acc.sort()).toEqual(["ghost:consequence", "revenant:consequence", "thrall:mark"]);
	});

	it("keeps the Terrible Purpose and the Impulse exclusive", () => {
		const exclusive = Object.values(POST_DEATH_CHOICES).flat()
			.filter(s => s.kind === "pick" && !s.accumulates).map(s => s.key);
		expect(new Set(exclusive)).toEqual(new Set(["purpose", "impulse"]));
	});

	it("shows every Consequence already marked, rather than one of them", async () => {
		// A Revenant three sessions in. All three have to come back ticked; the old radio markup
		// rendered them as one group, so the browser showed only the last.
		const vm = await buildPostDeathChoices(makeCharacter("ghost", GHOST_LORE, {
			counts: { "consequences:breakdown": 1, "consequences:unstable": 1, "consequences:specter": 1 },
		}));
		const step = vm.steps.find(s => s.key === "consequence");
		expect(step.accumulates).toBe(true);
		expect(step.markedCount).toBe(3);
		expect(step.options.filter(o => o.marked).map(o => o.slug))
			.toEqual(["breakdown", "unstable", "specter"]);
	});

	it("leaves a marked Consequence clickable so it can be taken back off", async () => {
		const vm = await buildPostDeathChoices(makeCharacter("ghost", GHOST_LORE, {
			counts: { "consequences:breakdown": 1 },
		}));
		const step = vm.steps.find(s => s.key === "consequence");
		expect(step.options.find(o => o.slug === "breakdown").locked).toBe(false);
	});

	it("locks a marked option in an EXCLUSIVE section, where unticking means nothing", async () => {
		const vm = await buildPostDeathChoices(makeCharacter("ghost", GHOST_LORE, {
			counts: { "terrible-purpose:longing": 1 },
		}));
		const step = vm.steps.find(s => s.key === "purpose");
		expect(step.options.find(o => o.slug === "longing").locked).toBe(true);
	});

	it("hands out one Mark and then locks the rest", async () => {
		// The window owes a Thrall exactly one ("the GM will choose 1 Mark for you"). Accumulating
		// used to mean uncapped HERE too, so every Mark on the page stayed tickable.
		const bare = await buildPostDeathChoices(makeCharacter("thrall", THRALL_LORE));
		expect(bare.steps.find(s => s.key === "mark").options.every(o => !o.locked)).toBe(true);

		const vm = await buildPostDeathChoices(makeCharacter("thrall", THRALL_LORE, {
			counts: { "marks:red-wrath": 1 },
		}));
		const step = vm.steps.find(s => s.key === "mark");
		// The one that was taken stays live, so a mis-click is taken back the way it was made…
		expect(step.options.find(o => o.slug === "red-wrath").locked).toBe(false);
		// …and nothing else can be added alongside it.
		expect(step.options.find(o => o.slug === "ravenous").locked).toBe(true);
	});

	it("caps the first Consequence the same way", async () => {
		const vm = await buildPostDeathChoices(makeCharacter("ghost", GHOST_LORE, {
			counts: { "consequences:breakdown": 1 },
		}));
		const step = vm.steps.find(s => s.key === "consequence");
		expect(step.options.find(o => o.slug === "specter").locked).toBe(true);
	});

	it("caps on what's MARKED, so a Mark a move granted later leaves nothing to give", async () => {
		// Dark Succor writes the same section additively and is not capped by this — but once it
		// has, the window that owed one Mark has no business handing out another.
		const vm = await buildPostDeathChoices(makeCharacter("thrall", THRALL_LORE, {
			counts: { "marks:red-wrath": 1, "marks:ravenous": 1 },
		}));
		const step = vm.steps.find(s => s.key === "mark");
		expect(step.markedCount).toBe(2);
		expect(step.options.every(o => o.marked)).toBe(true);
		expect(step.options.every(o => !o.locked)).toBe(true);
	});

	it("keeps a prerequisite re-takeable at the cap, so unticking one can't strand the pair", async () => {
		// BREAKDOWN taken here, UNSTABLE granted later by Undying. Untick BREAKDOWN — which an
		// accumulating step invites — and both used to lock: UNSTABLE for want of its
		// prerequisite, BREAKDOWN behind the cap that UNSTABLE itself fills. No way back to a
		// legal sheet from this window.
		const vm = await buildPostDeathChoices(makeCharacter("ghost", GHOST_LORE, {
			counts: { "consequences:unstable": 1 },
		}));
		const opts = vm.steps.find(s => s.key === "consequence").options;
		// The prerequisite something held still needs: takeable despite the cap.
		expect(opts.find(o => o.slug === "breakdown").locked).toBe(false);
		// The stranded option itself: un-tickable, and still tagged with what it is missing.
		expect(opts.find(o => o.slug === "unstable").locked).toBe(false);
		expect(opts.find(o => o.slug === "unstable").requiresLabel).toBe("BREAKDOWN");
		// Everything unrelated stays locked — this is a repair, not an escape hatch.
		expect(opts.find(o => o.slug === "specter").locked).toBe(true);
	});

	it("doesn't let an inflicted Consequence fill the allowance", async () => {
		// A Ghost whose tether was destroyed carries THE FINAL CONSEQUENCE. Counting it would lock
		// every real Consequence behind the character's own ending.
		const vm = await buildPostDeathChoices(makeCharacter("ghost", GHOST_LORE, {
			counts: { "consequences:final-consequence": 1 },
		}));
		const opts = vm.steps.find(s => s.key === "consequence").options;
		expect(opts.find(o => o.slug === "breakdown").locked).toBe(false);
		expect(opts.find(o => o.slug === "specter").locked).toBe(false);
	});

	it("never lets THE FINAL CONSEQUENCE be chosen", async () => {
		// It's what happens TO them. One stray click here would end the character.
		const vm = await buildPostDeathChoices(makeCharacter("ghost", GHOST_LORE));
		const opt = vm.steps.find(s => s.key === "consequence").options.find(o => o.slug === "final-consequence");
		expect(opt.inflicted).toBe(true);
		expect(opt.locked).toBe(true);
	});

	it("still prints THE FINAL CONSEQUENCE, ticked, once it has been suffered", async () => {
		const vm = await buildPostDeathChoices(makeCharacter("ghost", GHOST_LORE, {
			counts: { "consequences:final-consequence": 1 },
		}));
		const opt = vm.steps.find(s => s.key === "consequence").options.find(o => o.slug === "final-consequence");
		expect(opt.marked).toBe(true);
		expect(opt.locked).toBe(true);
	});

	it("doesn't count an inflicted Consequence as the step's answer", async () => {
		// The same rule the allowance already followed, applied to the step's own report of
		// itself. A Ghost destroyed by losing their tether had the Consequence question ticked
		// off as answered — and dropped from "Still to choose" — on the strength of their ending.
		const vm = await buildPostDeathChoices(makeCharacter("ghost", GHOST_LORE, {
			counts: { "consequences:final-consequence": 1 },
		}));
		const step = vm.steps.find(s => s.key === "consequence");
		expect(step.chosenSlug).toBe("");
		expect(step.markedCount).toBe(0);
		expect(step.done).toBe(false);
		expect(outstandingLabel(vm)).toMatch(/consequence/i);
	});

	it("counts a real Consequence taken beside an inflicted one", async () => {
		// The exclusion is about WHICH option, not about the step: a Ghost who chose BREAKDOWN
		// and then lost their tether has answered the question.
		const vm = await buildPostDeathChoices(makeCharacter("ghost", GHOST_LORE, {
			counts: { "consequences:breakdown": 1, "consequences:final-consequence": 1 },
		}));
		const step = vm.steps.find(s => s.key === "consequence");
		expect(step.chosenSlug).toBe("breakdown");
		expect(step.markedCount).toBe(1);
		expect(step.done).toBe(true);
	});
});

describe("unmarkSectionOption / clearSectionPicks", () => {
	it("takes one option off and leaves the rest", async () => {
		const character = makeCharacter("ghost", GHOST_LORE, {
			counts: { "consequences:breakdown": 1, "consequences:specter": 1 },
		});
		expect(await character.unmarkSectionOption("consequences", "specter")).toBe(true);

		const step = (await buildPostDeathChoices(character)).steps.find(s => s.key === "consequence");
		expect(step.options.filter(o => o.marked).map(o => o.slug)).toEqual(["breakdown"]);
	});

	it("reports nothing to do when the option wasn't marked", async () => {
		const character = makeCharacter("ghost", GHOST_LORE);
		expect(await character.unmarkSectionOption("consequences", "specter")).toBe(false);
	});

	it("clears a whole exclusive section", async () => {
		const character = makeCharacter("thrall", THRALL_LORE, { counts: { "impulse:stoke-conflict": 1 } });
		expect(await character.clearSectionPicks("impulse")).toBe(true);

		const step = (await buildPostDeathChoices(character)).steps.find(s => s.key === "impulse");
		expect(step.options.some(o => o.marked)).toBe(false);
	});
});

describe("the Thrall's write-in Impulse", () => {
	it("answers the step on its own", async () => {
		// It's an ALTERNATIVE to the seven printed ones. Without this the step could never be
		// finished and the tab's button stayed amber for the rest of the character's life.
		const vm = await buildPostDeathChoices(makeCharacter("thrall", THRALL_LORE, {
			texts: { "impulse:custom-impulse": "Drown the sound of bells" },
		}));
		expect(vm.steps.find(s => s.key === "impulse").done).toBe(true);
	});

	it("doesn't count when it's only whitespace", async () => {
		const vm = await buildPostDeathChoices(makeCharacter("thrall", THRALL_LORE, {
			texts: { "impulse:custom-impulse": "  " },
		}));
		expect(vm.steps.find(s => s.key === "impulse").done).toBe(false);
	});

	it("names the write-in on the radios, so picking one can clear it", async () => {
		const vm = await buildPostDeathChoices(makeCharacter("thrall", THRALL_LORE));
		expect(vm.steps.find(s => s.key === "impulse").textOption).toBe("custom-impulse");
	});
});

describe("what the options say about themselves", () => {
	it("drops the repeated name from the summary, parenthetical and all", async () => {
		const vm = await buildPostDeathChoices(makeCharacter("ghost", GHOST_LORE));
		const opts = vm.steps.find(s => s.key === "consequence").options;
		// "<strong>UNSTABLE</strong> <em>(Requires Breakdown)</em> — Episodes." The name is
		// already the heading, and the requirement is already a tag.
		expect(opts.find(o => o.slug === "unstable").summary).toBe("<p>Episodes.</p>");
		expect(opts.find(o => o.slug === "breakdown").summary).toBe("<p>You lash out.</p>");
	});

	it("says what an option needs only while it still needs it", async () => {
		const bare = await buildPostDeathChoices(makeCharacter("ghost", GHOST_LORE));
		expect(bare.steps.find(s => s.key === "consequence").options
			.find(o => o.slug === "unstable").requiresLabel).toBe("BREAKDOWN");

		const met = await buildPostDeathChoices(makeCharacter("ghost", GHOST_LORE, {
			counts: { "consequences:breakdown": 1 },
		}));
		const unstable = met.steps.find(s => s.key === "consequence").options.find(o => o.slug === "unstable");
		expect(unstable.requiresLabel).toBe("");
		// Still locked, for an unrelated reason: taking BREAKDOWN spent the one Consequence this
		// window owes, and UNSTABLE would be a second. The tag is about the PREREQUISITE only —
		// telling someone they "need BREAKDOWN" when they have it is the thing being tested here.
		expect(unstable.locked).toBe(true);
	});

	it("carries a per-window group so two open copies don't share a radio group", async () => {
		const vm = await buildPostDeathChoices(makeCharacter("ghost", GHOST_LORE), { group: "chooser" });
		expect(vm.group).toBe("chooser");
	});
});

describe("chooseOneSectionOption — a 'choose 1' section behaves like a radio group", () => {
	it("clears the sibling when the pick changes", async () => {
		const character = makeCharacter("ghost", GHOST_LORE, { counts: { "terrible-purpose:longing": 1 } });
		await character.chooseOneSectionOption("terrible-purpose", "duty");

		const vm = await buildPostDeathChoices(character);
		const opts = vm.steps.find(s => s.key === "purpose").options;
		expect(opts.find(o => o.slug === "duty").marked).toBe(true);
		expect(opts.find(o => o.slug === "longing").marked).toBe(false);
	});

	it("leaves other sections alone", async () => {
		const character = makeCharacter("ghost", GHOST_LORE, { counts: { "consequences:specter": 1 } });
		await character.chooseOneSectionOption("terrible-purpose", "duty");

		const vm = await buildPostDeathChoices(character);
		expect(vm.steps.find(s => s.key === "consequence").options.find(o => o.slug === "specter").marked).toBe(true);
	});

	it("refuses an unknown section or a missing option", async () => {
		const character = makeCharacter("ghost", GHOST_LORE);
		expect(await character.chooseOneSectionOption("no-such-section", "duty")).toBe(false);
		expect(await character.chooseOneSectionOption("terrible-purpose", "")).toBe(false);
	});
});

describe("an option that asks a question of its own (STRANGE APPETITES)", () => {
	it("asks nothing until the option is actually taken", async () => {
		const vm = await buildPostDeathChoices(makeCharacter("ghost", GHOST_LORE));
		const opt = vm.steps.find(s => s.key === "consequence").options.find(o => o.slug === "strange-appetites");
		expect(opt.subPicks).toEqual([]);
	});

	it("reads its alternatives out of the printed line", async () => {
		// Parsed from the prose, not kept as a list in code — so a homebrew Consequence written
		// the same way is honoured with no code change and no pack rebuild.
		const vm = await buildPostDeathChoices(makeCharacter("ghost", GHOST_LORE, {
			counts: { "consequences:strange-appetites": 1 },
		}));
		const opt = vm.steps.find(s => s.key === "consequence").options.find(o => o.slug === "strange-appetites");
		expect(opt.subPicks).toEqual(["still-warm blood", "dying breaths", "bone & marrow"]);
	});

	it("holds the step open until it's answered", async () => {
		const unanswered = await buildPostDeathChoices(makeCharacter("ghost", GHOST_LORE, {
			counts: { "consequences:strange-appetites": 1 },
		}));
		expect(unanswered.steps.find(s => s.key === "consequence").done).toBe(false);

		const answered = await buildPostDeathChoices(makeCharacter("ghost", GHOST_LORE, {
			counts: { "consequences:strange-appetites": 1 },
			texts:  { "consequences:strange-appetites": "bone & marrow" },
		}));
		const step = answered.steps.find(s => s.key === "consequence");
		expect(step.done).toBe(true);
		expect(step.options.find(o => o.slug === "strange-appetites").subValue).toBe("bone & marrow");
	});

	it("puts the written-in answers where the tab can print them", async () => {
		const vm = await buildPostDeathChoices(makeCharacter("ghost", GHOST_LORE, {
			counts: { "terrible-purpose:duty": 1, "consequences:strange-appetites": 1 },
			texts:  {
				"terrible-purpose:duty": "The bridge at Marshedge, unfinished",
				"consequences:strange-appetites": "dying breaths",
			},
		}));
		expect(choiceWriteIns(vm)).toEqual([
			{
				label: "DUTY", section: "terrible-purpose", option: "duty",
				value: "The bridge at Marshedge, unfinished",
				picks: [], placeholder: "Name them, or name the task…",
			},
			{
				label: "STRANGE APPETITES", section: "consequences", option: "strange-appetites",
				value: "dying breaths",
				picks: ["still-warm blood", "dying breaths", "bone & marrow"], placeholder: "",
			},
		]);
	});

	// The tab is the only other place these can be given: Death's Door's chooser is a one-shot
	// step, and the tab's own Choose Your Fate buttons and a dropped insert Item never reach it.
	// Returning only what was already written would have left them unanswerable for good.
	it("still asks a question that has never been answered", async () => {
		const vm = await buildPostDeathChoices(makeCharacter("ghost", GHOST_LORE, {
			counts: { "terrible-purpose:duty": 1, "consequences:strange-appetites": 1 },
		}));
		expect(choiceWriteIns(vm).map(w => [w.option, w.value]))
			.toEqual([["duty", ""], ["strange-appetites", ""]]);
	});

	it("has nothing to ask when no option that asks one has been taken", async () => {
		expect(choiceWriteIns(await buildPostDeathChoices(makeCharacter("ghost", GHOST_LORE)))).toEqual([]);
	});
});

describe("swapping one insert for another", () => {
	// A Revenant becomes a Ghost (Undying's 6-: "you may become a Ghost instead"). The insert
	// flags live in their own namespaces and used to survive untouched.
	function swapCharacter(counts, instinct) {
		const insertFlags = makeFlags({ slug: "revenant" });
		const loreFlags   = makeFlags({ counts, texts: { "terrible-purpose:duty": "The bridge" } });
		// Both real inserts resolve, so a swap in either direction can be exercised; anything else
		// returns null, which is the "can't read the insert" case pruneToInsert refuses to act on.
		const inserts = {
			ghost:    { slug: "ghost",    name: "Ghost",    lore: GHOST_LORE, instincts: INSTINCTS },
			// Same two sections as the Ghost for this fixture's purposes — what matters here is
			// that neither insert carries a `marks` section, which is what the Thrall's crossed-off
			// Marks and master's task hang off.
			revenant: { slug: "revenant", name: "Revenant", lore: GHOST_LORE, instincts: INSTINCTS },
		};
		const repo = {
			findBySlug: async (s) => inserts[s] ?? null,
			getAll: async () => [],
		};
		const instincts = new CharacterInstincts(makeFlags(instinct ? { selected: instinct } : {}));
		const lore = new CharacterLore(loreFlags);
		// batch() is what pruning uses to actually DELETE keys — an object flag merges on write,
		// so a filtered copy would leave every dropped key exactly where it was.
		loreFlags.batch = vi.fn(async ({ deletes = {} }) => {
			for (const [key, subKeys] of Object.entries(deletes)) {
				for (const sub of subKeys) delete loreFlags._store[key][sub];
			}
		});
		const pd = new CharacterPostDeath(insertFlags, instincts, lore, repo, { getPostDeathMoves: async () => [] });
		return { pd, loreFlags, instincts, insertFlags };
	}

	it("drops what the new insert has no option for", async () => {
		const { pd, loreFlags } = swapCharacter({
			"consequences:carrion-stench": 1,   // Revenant only — a Ghost has no body to reek
			"consequences:breakdown": 1,        // on both lists
			"terrible-purpose:duty": 1,         // on both lists
		});
		await pd.pruneToInsert("ghost");

		expect(Object.keys(loreFlags._store.counts).sort()).toEqual(["consequences:breakdown", "terrible-purpose:duty"]);
	});

	it("keeps the name written against a purpose both inserts print", async () => {
		const { pd, loreFlags } = swapCharacter({ "terrible-purpose:duty": 1 });
		await pd.pruneToInsert("ghost");
		expect(loreFlags._store.texts["terrible-purpose:duty"]).toBe("The bridge");
	});

	it("keeps an Instinct the new insert also offers", async () => {
		const { pd, instincts } = swapCharacter({}, "Denial — To refuse to accept that you are dead.");
		await pd.pruneToInsert("ghost");
		expect(instincts.selectedValue).toBe("Denial — To refuse to accept that you are dead.");
	});

	it("clears an Instinct the new insert doesn't offer", async () => {
		const { pd, instincts } = swapCharacter({}, "Fascination — To explore your powers.");
		await pd.pruneToInsert("ghost");
		expect(instincts.selectedValue).toBe("");
	});

	it("drops the records the new insert has nowhere to put", async () => {
		// crossedOff / task / tether have no lore option to live in, so the prune above never saw
		// them. A Thrall hand-swapped to a Ghost printed "Your Master's Task" (on a character with
		// no Favor track) and a Crossed Off list of RAW SLUGS — the labels are looked up in the NEW
		// insert's lore, which has no `marks` section at all.
		const { pd, insertFlags } = swapCharacter({});
		insertFlags._store.crossedOff = ["red-wrath"];
		insertFlags._store.task       = "Bring me the Crow-Mother's eye";
		insertFlags._store.tether     = "The oak where they buried me";

		await pd.pruneToInsert("ghost");

		// The Ghost has no Marks, so neither of the Thrall's Mark records can follow them…
		expect(pd.crossedOffMarks).toEqual([]);
		expect(pd.masterTask).toBe("");
		// …but Tethered is the Ghost's own 0-HP move, so the tether stays.
		expect(pd.tether).toBe("The oak where they buried me");
	});

	it("drops a tether when the new insert has nothing to reform beside", async () => {
		const { pd, insertFlags } = swapCharacter({});
		insertFlags._store.tether = "The oak where they buried me";

		await pd.pruneToInsert("revenant");

		expect(pd.tether).toBe("");
	});

	it("keeps everything when the incoming insert can't be read at all", async () => {
		// An insert we cannot READ is not an insert that holds nothing — but an empty valid-set is
		// exactly how that used to arrive at pruneTo, which deletes every key outside it. A pack
		// that hasn't loaded or a slug renamed between versions would have taken the character's
		// whole post-death record with it, irreversibly.
		const { pd, loreFlags, instincts } = swapCharacter(
			{ "consequences:breakdown": 1, "terrible-purpose:duty": 1 },
			"Denial — To refuse to accept that you are dead.",
		);
		await pd.pruneToInsert("wight");   // no such insert in the repo

		expect(Object.keys(loreFlags._store.counts).sort())
			.toEqual(["consequences:breakdown", "terrible-purpose:duty"]);
		expect(loreFlags._store.texts["terrible-purpose:duty"]).toBe("The bridge");
		expect(instincts.selectedValue).toBe("Denial — To refuse to accept that you are dead.");
	});
});

describe("the labels the two windows share", () => {
	it("says nothing when nothing is outstanding", () => {
		expect(outstandingLabel(null)).toBe("");
		expect(outstandingLabel({ steps: [] })).toBe("");
		expect(outstandingLabel({ steps: [{ short: "tether", done: true }] })).toBe("");
	});

	it("names what's left rather than counting it", () => {
		const vm = steps => ({ steps });
		expect(outstandingLabel(vm([{ short: "first Mark", done: false }])))
			.toBe("Still to choose: first Mark");
		expect(outstandingLabel(vm([
			{ short: "Terrible Purpose", done: false },
			{ short: "first Consequence", done: true },
			{ short: "new Instinct",      done: false },
		]))).toBe("Still to choose: Terrible Purpose & new Instinct");
	});

	it("names every step of a freshly taken Thrall insert, in the order it asks them", async () => {
		const vm = await buildPostDeathChoices(makeCharacter("thrall", THRALL_LORE));
		expect(outstandingLabel(vm))
			.toBe("Still to choose: master's name, master's Impulse, new Instinct & first Mark");
	});

	it("swaps an accumulating step's invitation for a record once it's been answered", async () => {
		// "Take 1 now" over a list where every option is greyed out is an instruction that cannot
		// be followed. A Revenant three sessions in reads the other line.
		const bare = await buildPostDeathChoices(makeCharacter("ghost", GHOST_LORE));
		expect(bare.steps.find(s => s.key === "consequence").hint).toMatch(/Take 1 now/);

		const held = await buildPostDeathChoices(makeCharacter("ghost", GHOST_LORE, {
			counts: { "consequences:breakdown": 1 },
		}));
		const hint = held.steps.find(s => s.key === "consequence").hint;
		expect(hint).not.toMatch(/Take 1 now/);
		expect(hint).toMatch(/More arrive whenever a move says so/);
	});

	it("never tells a player to take the Mark their GM chooses", async () => {
		// The step carries GM_CHOOSES_NOTE; a second-person imperative beside it contradicts both
		// the note and thrall.json ("the GM will choose 1 Mark for you").
		const vm = await buildPostDeathChoices(makeCharacter("thrall", THRALL_LORE));
		const mark = vm.steps.find(s => s.key === "mark");
		expect(mark.gmNote).toBe(GM_CHOOSES_NOTE);
		expect(mark.hint).not.toMatch(/\bTake 1\b/);
	});

});
