/**
 * What a character still has to decide once they've refused the Last Door.
 *
 * Taking an insert is the mechanical half — the slug is written, the insert's moves land on the
 * sheet. The other half is the half the book spends its page on: a Terrible Purpose and who it's
 * about, a first Consequence, a new Instinct that replaces the one from your playbook, and for a
 * Thrall the master's name plus the two picks the GM makes for them.
 *
 * That half is asked in Death's Door's last step, and everything it needs lives here: the table of
 * what each insert asks, the reader that turns the character's current state into a view model, and
 * the DOM handlers the window wires. The dialog knows none of the rules; it renders this and hands
 * back clicks. The Post-Death tab prints the insert's own state instead, and edit mode is where an
 * answer gets changed afterwards.
 *
 * Nothing here is required. A player can close the window with every step outstanding and finish
 * later; the insert is already theirs. That's why this runs AFTER the insert is granted rather
 * than gating it — see DeathsDoorDialog._onTakeInsert.
 */

import { joinNames, stripHtmlToText, PICK_SEPARATOR } from "../../utils/strings.js";

/**
 * A step's `kind` decides where its answer is stored, and there are only four:
 *
 *   pick      lore options in a section                → postDeathLore.counts
 *   instinct  one of the insert's three instincts      → postDeathInstinct.selected
 *   text      one lore option's written value          → postDeathLore.texts
 *   tether    the Ghost's binding                      → postDeathInsert.tether (its own flag,
 *             because Tethered — the move — reads it, and it isn't printed on the insert)
 *
 * `accumulates` is the most important flag here, and getting it wrong LOSES PLAYER DATA.
 *
 * Two of the four pick sections are exclusive and two are not, and the book is explicit about
 * which: Consequences say "When you first take this insert, choose 1. Choose ANOTHER whenever a
 * move tells you to do so", and a Thrall's Marks are handed out the same way by Dark Succor. A
 * Revenant three sessions in is holding BREAKDOWN, UNSTABLE and CARRION STENCH, all marked by
 * UndeathDialog through the additive markSectionOption.
 *
 * So those two steps are CHECKBOXES that add and remove one option at a time. Only the Terrible
 * Purpose and the Thrall's Impulse — one to a character, ever — are exclusive, and only they get
 * the radio treatment that clears its siblings. This step is titled "your first Consequence"
 * because that's the one it exists to collect, not because it's the only one that may be ticked.
 *
 * `takeNow` is how many of an accumulating section this WINDOW may hand out, which is not the same
 * question as how many a character may end up holding — and conflating the two is what let a
 * Thrall tick every Mark on the page. The book gives exactly one here ("the GM will choose 1 Mark
 * for you"); the rest arrive later through Dark Succor and UndeathDialog, which write the same
 * section additively and are not capped by this. At the cap, options that are NOT already marked
 * lock; the marked ones stay live, so a mis-click is still taken back the way it was made.
 *
 * `neverPick` names options that appear in the list but can never be chosen here. There is one:
 * THE FINAL CONSEQUENCE is what happens TO a character, not something they take — it's printed
 * with the others, and one stray click on it would end them.
 *
 * `nameFor` marks a pick whose chosen option must ALSO be named ("Name the person or persons you
 * refuse to let go of"). The name is written against the chosen option's own key, so changing
 * your Purpose doesn't overwrite the name you gave the last one.
 *
 * `gm` marks a step the book hands to the GM. There are no sockets in this system, so it can't be
 * pushed to their screen; it renders in place with a note saying whose call it is.
 *
 * `short` is the step's name as it appears in the "still to choose" line and on the chooser's own
 * rail, where the titles are being read as a list rather than as headings: no leading "Your" (it
 * would repeat three times in one sentence) and no article. Written out rather than derived from
 * the title, because the two Thrall steps that share a subject need telling apart in a list —
 * "master's name" and "master's Impulse" — and a mechanical strip of "Your " would give the first
 * of them just "master".
 *
 * `icon` is the Font Awesome glyph that stands for the step on that rail. It lives here with the
 * rest of the step's identity rather than in the window: the rail is one entry per question the
 * insert asks, so adding a question must not mean remembering to add a picture for it somewhere
 * else.
 */
const _PURPOSE = {
	key:     "purpose",
	kind:    "pick",
	section: "terrible-purpose",
	title:   "Your Terrible Purpose",
	short:   "Terrible Purpose",
	icon:    "fa-hand-fist",
	hint:    "What you will not leave behind. Choose 1: and say who, or what.",
	nameFor: true,
	namePlaceholder: "Name them, or name the task…",
};

/**
 * Options that are INFLICTED, never chosen — printed with the rest so a character who has suffered
 * one can see it ticked, and never offered by any surface that hands options out.
 *
 * Exported because there are two such surfaces: this window's Consequence step and UndeathDialog's
 * "mark a consequence" picker, which is the one that actually runs at 0 HP. THE FINAL CONSEQUENCE
 * carries no `requires`, so nothing in the data marks it as un-takeable — only this list does, and
 * a copy of it that drifts is a character ended by a mis-click on a dropdown.
 */
export const NEVER_CHOSEN_OPTIONS = ["final-consequence"];

const _CONSEQUENCE = {
	key:     "consequence",
	kind:    "pick",
	section: "consequences",
	accumulates: true,
	takeNow: 1,
	neverPick: NEVER_CHOSEN_OPTIONS,
	title:   "Your first Consequence",
	short:   "first Consequence",
	icon:    "fa-heart-crack",
	hint:    "What coming back cost you. Take 1 now: and another whenever a move says so.",
	// Once one is held the step has nothing left to hand out, so the invitation stops being an
	// instruction and starts being a lie: a Revenant three sessions in would otherwise read
	// "Take 1 now" over a list where every remaining option is greyed out.
	hintDone: "What coming back cost you. More arrive whenever a move says so.",
};

const _INSTINCT = {
	key:   "instinct",
	kind:  "instinct",
	title: "Your new Instinct",
	short: "new Instinct",
	icon:  "fa-compass",
	hint:  "This replaces the Instinct from your playbook. Choose 1.",
};

export const POST_DEATH_CHOICES = {
	revenant: [_PURPOSE, _CONSEQUENCE, _INSTINCT],
	ghost: [
		_PURPOSE,
		_CONSEQUENCE,
		_INSTINCT,
		{
			key:   "tether",
			kind:  "tether",
			title: "Your tether",
			short: "tether",
			icon:  "fa-anchor",
			// Word for word `stonetop.postDeath.tetherHint` / `tetherPlaceholder` in
			// languages/en.json, which the Post-Death tab prints over the SAME field. They said
			// the same rule in two different sentences before, and the Final Consequence clause is
			// the one most likely to be revised — so a player naming their tether in the chooser
			// and then looking at the tab got two statements of it. Change both together.
			hint:  "Tethered reforms you beside it. If it's ever destroyed, you mark the Final Consequence.",
			placeholder: "Your mortal remains, the place where you died, an object of significance…",
		},
	],
	thrall: [
		{
			key:     "master",
			kind:    "text",
			section: "your-master",
			option:  "master-name",
			title:   "Your master",
			short:   "master's name",
			icon:    "fa-signature",
			hint:    "The Thing Below you called on by name. Name it here, with any titles you know.",
			placeholder: "Name your master…",
		},
		{
			key:     "impulse",
			kind:    "pick",
			section: "impulse",
			title:   "Your master's Impulse",
			short:   "master's Impulse",
			icon:    "fa-bolt",
			hint:    "Its nature and its will, working through you.",
			gm:      true,
			// The insert carries an "Other (write in)" option the book's seven bullets don't; it's
			// a text option, so sectionOptions drops it and it needs naming here to be offered.
			textOption: "custom-impulse",
			textPlaceholder: "…or write in an Impulse of the GM's own",
		},
		_INSTINCT,
		{
			key:     "mark",
			kind:    "pick",
			section: "marks",
			// Dark Succor grants more of these over a Thrall's career, and five of the nine take
			// 2 off max HP — clearing one silently hands hit points back.
			accumulates: true,
			takeNow: 1,
			title:   "Your first Mark",
			short:   "first Mark",
			icon:    "fa-fingerprint",
			// Third person, like the Impulse step beside it, because this one is the GM's to make
			// too — thrall.json says "the GM will choose 1 Mark for you". It read "Take 1 now"
			// directly above "Your GM chooses this one", which is an instruction and its own
			// contradiction in two lines.
			hint:    "What your master's touch leaves on you: one now, and more as your master gives them.",
			// Held once the first is taken: see `hintDone`.
			hintDone: "The Marks your master has left on you so far.",
			gm:      true,
		},
	],
};

/** The note printed on a step the book hands to the GM. Said once, so every step says it alike. */
export const GM_CHOOSES_NOTE = "Your GM chooses this one.";

/**
 * Everything a surface needs to draw the choices for whichever insert is active, with each step's
 * current answer resolved and a `done` flag so "what's left" can be counted without any caller
 * re-deriving the rules.
 *
 * Returns null when there's no insert — there is nothing to ask about.
 */
export async function buildPostDeathChoices(character, { group = "" } = {}) {
	const slug  = character?.postDeathSlug ?? null;
	const steps = POST_DEATH_CHOICES[slug];
	if (!slug || !steps) return null;

	const built = [];
	for (const step of steps) built.push(await _buildStep(character, step));

	return {
		slug,
		name:        await character.postDeathInsertName(),
		// Suffix for this window's radio `name`s. Radio grouping is document-global, so two open
		// copies of this partial — two PCs at Death's Door in one fight, each with their own
		// window — would otherwise share one group across two characters.
		group,
		steps:       built,
		outstanding: built.filter(s => !s.done).length,
	};
}

async function _buildStep(character, step) {
	const base = {
		key:   step.key,
		kind:  step.kind,
		title: step.title,
		short: step.short ?? step.title,
		// The rail's glyph. A step that forgot one still gets an entry rather than a gap where an
		// icon should be — the rail is how the window is navigated, so it can't lose a question
		// over a missing picture.
		icon:  step.icon ?? "fa-circle-dot",
		hint:  step.hint,
		gm:    !!step.gm,
		gmNote: step.gm ? GM_CHOOSES_NOTE : "",
		section: step.section ?? "",
	};

	if (step.kind === "instinct") {
		const options = await character.postDeathInstinctOptions();
		return { ...base, options, done: options.some(o => o.selected) };
	}

	if (step.kind === "tether") {
		const value = character.tether ?? "";
		return { ...base, value, placeholder: step.placeholder ?? "", done: !!value.trim() };
	}

	if (step.kind === "text") {
		const value = character.postDeathLoreText(step.section, step.option);
		return {
			...base,
			option: step.option,
			value,
			placeholder: step.placeholder ?? "",
			done: !!value.trim(),
		};
	}

	// A pick. sectionOptions already honours `requires` and crossed-off Marks, so an option that
	// can't be taken yet arrives `blocked` rather than having to be filtered here.
	const raw     = await character.sectionOptions(step.section);
	const never   = new Set(step.neverPick ?? []);
	// What the PLAYER chose, which is not the same as what is ticked. An INFLICTED option (THE
	// FINAL CONSEQUENCE) is put there by the fiction, never picked. Stated once because three
	// separate questions below — the hint, the cap, and the answer itself — all turn on it, and
	// the reason is the same every time: a step must not report itself answered, or spend its
	// allowance, on the strength of the character being destroyed. Reads equally well on a raw
	// option and on an enriched one, which carry the same `marked` and `slug`.
	const isPick  = (o) => o.marked && !never.has(o.slug);
	// An accumulating step's hint invites a pick ("Take 1 now"); once the pick is made the step
	// is a record instead, and the invitation would be describing something it no longer offers.
	// An INFLICTED option is not that pick, so the invitation stands.
	const hint    = step.hintDone && raw.some(isPick) ? step.hintDone : step.hint;
	// `requires` arrives as a slug; a player has never seen a slug. Resolve it against the
	// section's own options so a locked entry can say "needs BREAKDOWN" in the book's words.
	const labels  = new Map(raw.map(o => [o.slug, o.label]));
	// Has this window already handed out everything it may? Counted off what's MARKED, not off
	// what was clicked here: a counter of this session's clicks would reset with the window and
	// hand out a second. A Mark granted later by Dark Succor also counts, which is right: it takes
	// the step past its allowance, and there is nothing left for this window to give. An inflicted
	// option is not a pick and so does not fill the allowance — see `isPick`.
	const atCap   = raw.filter(isPick).length >= (step.takeNow ?? Infinity);
	// Prerequisites of something currently held. The cap must never lock one of these: unticking
	// BREAKDOWN while UNSTABLE ("Requires Breakdown") is marked would otherwise strand the pair —
	// UNSTABLE locked for want of its prerequisite, BREAKDOWN locked by the cap that UNSTABLE
	// itself fills — with no way back to a legal sheet from this window. Un-ticking is invited
	// here, so it has to stay reversible.
	const needed  = new Set(raw.filter(o => o.marked && o.requires).map(o => o.requires));
	const options = raw.map(o => {
		// Its prerequisite is what's missing — not the fact that it's already held, which is a
		// perfectly good reason to be un-clickable but not a reason to tell someone what they
		// still need. sectionOptions folds all three reasons into `blocked` and reports this one
		// on its own, so the rule is applied where it's stated rather than re-derived here.
		const needsFirst = o.needsFirst;
		// A question the option itself asks. Only offered once the option is taken — there's
		// nothing to answer about a Consequence you haven't got.
		const subPicks = o.marked ? _subPicks(o.description) : [];
		return {
			..._withSplitProse(o),
			requiresLabel: needsFirst ? (labels.get(o.requires) ?? o.requires) : "",
			inflicted:     never.has(o.slug),
			subPicks,
			subValue:      subPicks.length ? character.postDeathLoreText(step.section, o.slug) : "",
			// An accumulating section leaves a marked option clickable so it can be un-ticked;
			// only the exclusive ones treat "already held" as blocking. Everything NOT marked
			// locks once the step has given out its `takeNow` — which is what stops a Thrall
			// ticking all nine Marks at the window that owes them one — except a prerequisite
			// something held still needs, which stays live so the pair can be put back.
			// `needsFirst` only bars TAKING one: an option already held whose prerequisite has since
			// been un-ticked is in an illegal state, and locking it would be locking the sheet out
			// of the one click that fixes it. It still wears the tag, which is now a warning
			// rather than a price.
			locked: never.has(o.slug) || o.crossedOff || (needsFirst && !o.marked)
			        || (!step.accumulates && o.marked)
			        || (atCap && !o.marked && !needed.has(o.slug)),
		};
	});

	// Everything below reads the player's answer — the chosen slug, the count, and whether the
	// step is done — so all of it counts off this list rather than off what is merely ticked; see
	// `isPick`. The OPTIONS keep their own `marked`, so the window still draws an inflicted
	// Consequence as the ticked, un-clickable thing it is.
	const marked  = options.filter(isPick);
	const chosen  = marked[0] ?? null;
	const named   = step.nameFor && chosen ? character.postDeathLoreText(step.section, chosen.slug) : "";
	// The Thrall's "Other (write in)" Impulse is an ALTERNATIVE to the seven printed ones, not an
	// extra alongside them, so a filled write-in answers the step exactly as a ticked one does.
	const written = step.textOption ? character.postDeathLoreText(step.section, step.textOption) : "";

	return {
		...base,
		hint,
		options,
		accumulates: !!step.accumulates,
		chosenSlug:  chosen?.slug ?? "",
		markedCount: marked.length,
		nameFor:     !!step.nameFor,
		nameValue:   named,
		namePlaceholder: step.namePlaceholder ?? "",
		textOption:  step.textOption ?? "",
		textValue:   written,
		textPlaceholder: step.textPlaceholder ?? "",
		// A named pick isn't finished until it's been named — "if they can't tell you, they
		// shouldn't pick this option" (p.245) — and neither is one whose option asks a question
		// of its own that hasn't been answered.
		done: ((!!chosen && (!step.nameFor || !!named.trim())) || !!written.trim())
		      && options.every(o => !o.subPicks.length || !!o.subValue.trim()),
	};
}

/**
 * An option's prose, cut into the part you choose BY and the part you live with afterwards.
 *
 * The book prints a Consequence as "**BREAKDOWN** — you lash out…" and then four more paragraphs
 * of what that does at the table. Printed whole, three of those side by side are a page of rules
 * to wade through before you can pick one — and the first thing every one of them says is its own
 * name, which is already the heading on the button.
 *
 * So: strip the repeated name, keep the opening sentence as the summary every option shows, and
 * hold the rest back until the option is actually taken. Nothing is hidden that you need in order
 * to choose; everything is there once you have.
 */
function _withSplitProse(option) {
	const html  = String(option.description ?? "");
	const paras = html.match(/<p>[\s\S]*?<\/p>/gi) ?? (html ? [html] : []);
	if (!paras.length) return { ...option, summary: "", detail: "" };

	// "<strong>UNSTABLE</strong> <em>(Requires Breakdown)</em> — You are prone to…": the
	// parenthetical is part of the same repeated heading, and the requirement is already shown as
	// a tag on the option, so it goes with the name. The parens can sit inside their own tag or
	// outside it depending on the entry, hence the tolerance for markup on either side.
	const summary = paras[0].replace(
		/^(<p>)\s*<strong>[\s\S]*?<\/strong>\s*(?:(?:<[a-z]+>)?\s*\([\s\S]*?\)\s*(?:<\/[a-z]+>)?\s*)?(?:&mdash;|—|-)\s*/i,
		"$1");
	return {
		...option,
		// An option with no bold lead (the Thrall's one-line Impulses) has a "summary" that is
		// just its own label again. Drop it rather than printing the line twice. Compared through
		// the system's one strip-HTML helper, which is also what built `label` (see optionLabel),
		// so the two sides of this test normalise identically rather than agreeing by luck.
		summary: stripHtmlToText(summary) === stripHtmlToText(option.label) ? "" : summary,
		detail:  paras.slice(1).join(""),
	};
}

/**
 * An option that asks a question of its own.
 *
 * The Revenant's STRANGE APPETITES is the only one in the book today: "Pick 1: still-warm blood /
 * dying breaths / brains / bone & marrow / rotting meat / eyes", and the Consequence's healing
 * trigger ("when you consume your special fare") means nothing until it's answered.
 *
 * Read out of the printed line rather than kept as a list here, for the same reason
 * insertHpPenalty reads "reduce your max HP by 2" out of the prose: the wording is fixed, the
 * pack is the source of truth, and a homebrew Consequence written the same way is honoured for
 * free with no code change and no pack rebuild.
 *
 * The hinge is matched here rather than with `_PICK_MARKER` from utils/strings because this reads
 * HTML, not the move pipeline's flattened text: the `</p>` terminator is what keeps the match from
 * running out of the option's own line and into the paragraphs below it. The SEPARATOR is the
 * shared one, so an alternative list reads the same here as it does on a move card.
 */
const _SUB_PICK_RE = /\b(?:pick|choose|select)\s+1\s*:\s*([\s\S]*?)<\/p>/i;

function _subPicks(description) {
	const inner = String(description ?? "").match(_SUB_PICK_RE)?.[1];
	if (!inner) return [];
	// Strip the markup BEFORE splitting: each alternative is wrapped in its own <em>, so slicing
	// on the separator first would cut through every closing tag as well.
	return stripHtmlToText(inner).split(PICK_SEPARATOR).map(part => part.trim()).filter(Boolean);
}

/**
 * Wire one rendered copy of the choices partial. The caller passes its own root and its own
 * "something changed" callback, so the rules stay here and the window keeps only its lifecycle.
 *
 * jQuery `find`, not `html[0].querySelector`: the Death's Door template has two top-level elements
 * and `html[0]` is only the first of them, so a native query would silently miss half the window.
 *
 * `onChanged` is awaited after each write. Picks re-render (the answer changes what's shown);
 * text fields deliberately save on `change` — blur, not keystroke — so naming your Purpose doesn't
 * tear the field out from under the cursor.
 */
export function activatePostDeathChoices(html, character, onChanged) {
	const after = async () => { await onChanged?.(); };

	// An exclusive pick — a Terrible Purpose, an Impulse. Clears its siblings, and clears the
	// section's write-in too where there is one, since taking a printed Impulse is the GM saying
	// they no longer want the one they invented.
	html.find(".stonetop-pdc-pick").on("change", async (ev) => {
		const el = ev.currentTarget;
		await character.chooseOneSectionOption(el.dataset.section, el.dataset.option);
		// Only when there is one to clear. `data-writein` rides on EVERY radio of a section that
		// has a write-in, so an unguarded write would add an empty key — and a whole document
		// update and re-render — on every click of the seven printed Impulses.
		if (el.dataset.writein && character.postDeathLoreText(el.dataset.section, el.dataset.writein)) {
			await character.setPostDeathLoreText(el.dataset.section, el.dataset.writein, "");
		}
		await after();
	});

	// An accumulating pick — a Consequence, a Mark. One option at a time, both directions, and
	// nothing else in the section is touched: everything already marked was marked by a move.
	html.find(".stonetop-pdc-mark").on("change", async (ev) => {
		const el = ev.currentTarget;
		if (el.checked) await character.markSectionOption(el.dataset.section, el.dataset.option);
		else            await character.unmarkSectionOption(el.dataset.section, el.dataset.option);
		await after();
	});

	// The question an option asks of itself (STRANGE APPETITES' "Pick 1"). Its answer is written
	// against the option's own key, so it survives everything except giving the option up.
	html.find(".stonetop-pdc-subpick").on("change", async (ev) => {
		const el = ev.currentTarget;
		await character.setPostDeathLoreText(el.dataset.section, el.dataset.option, el.value);
		await after();
	});

	html.find(".stonetop-pdc-instinct").on("change", async (ev) => {
		await character.setPostDeathInstinct(ev.currentTarget.value);
		await after();
	});

	html.find(".stonetop-pdc-name, .stonetop-pdc-text").on("change", async (ev) => {
		const el = ev.currentTarget;
		await character.setPostDeathLoreText(el.dataset.section, el.dataset.option, el.value);
		// Writing one in is the other half of the same exclusive choice: it replaces whichever
		// printed option was ticked, or nothing at all if it's been cleared back to empty.
		if (el.classList.contains("stonetop-pdc-writein") && el.value.trim()) {
			await character.clearSectionPicks(el.dataset.section);
		}
		await after();
	});

	html.find(".stonetop-pdc-tether").on("change", async (ev) => {
		await character.setTether(ev.currentTarget.value);
		await after();
	});
}

/**
 * The written-in answers, for the Post-Death tab to print — and to ASK.
 *
 * Everything else a character decides here is a ticked box, and the tab's lore section already
 * renders those. These are free text hung off a pick — who the Terrible Purpose is about, what a
 * STRANGE APPETITES Revenant eats — and the printed insert has no box for any of them.
 *
 * Every question the active insert is currently asking is returned, ANSWERED OR NOT, because the
 * tab is the only other place they can be given. Death's Door's chooser step is a one-shot: it is
 * reached once, on the roll that granted the insert, and a player who took the window's own advice
 * ("no rush — finish on your Post-Death tab") or who took their insert some other way — the tab's
 * own Choose Your Fate buttons, an Item dropped on the sheet — never sees it at all. Returning
 * only what was already written would have printed those players an empty section.
 *
 * `picks` is the option's own alternative list where it has one (STRANGE APPETITES' "Pick 1"), and
 * empty for a free-text answer; a caller renders one or the other off it.
 */
export function choiceWriteIns(vm) {
	const rows = [];
	for (const step of vm?.steps ?? []) {
		// Asked as soon as there's an option to hang the name on — "if they can't tell you, they
		// shouldn't pick this option" is a question about the Purpose they took, not about the step.
		if (step.nameFor && step.chosenSlug) {
			rows.push({
				label:       step.options.find(o => o.slug === step.chosenSlug)?.label ?? step.title,
				section:     step.section,
				option:      step.chosenSlug,
				value:       step.nameValue ?? "",
				picks:       [],
				placeholder: step.namePlaceholder ?? "",
			});
		}
		for (const opt of step.options ?? []) {
			// `subPicks` is only built for a marked option (see _buildStep), so every one of these
			// is a question the character is actually being asked.
			if (!opt.subPicks?.length) continue;
			rows.push({
				label:       opt.label,
				section:     step.section,
				option:      opt.slug,
				value:       opt.subValue ?? "",
				picks:       opt.subPicks,
				placeholder: "",
			});
		}
	}
	return rows;
}

/**
 * "Still to choose: Terrible Purpose, new Instinct & first Mark" — for a button or a footer that
 * wants to say what's left.
 *
 * Names them rather than counting them. A bare "3 still to choose" is only actionable after you've
 * opened the window to find out WHICH three, and this line's whole job is to be read from a sheet
 * that isn't showing the choices; there are never more than four, so the list stays a phrase.
 *
 * Takes the whole view model, not a count, so a caller can't hand it a number that has drifted
 * from the steps it names. `joinNames` because it is the system's one list-joiner (utils/strings).
 */
export function outstandingLabel(vm) {
	const names = (vm?.steps ?? []).filter(s => !s.done).map(s => s.short || s.title);
	if (!names.length) return "";
	return `Still to choose: ${joinNames(names)}`;
}
