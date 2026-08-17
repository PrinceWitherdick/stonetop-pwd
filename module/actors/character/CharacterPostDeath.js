import {
	PostDeathInsertSnapshotBuilder,
	PostDeathSectionSnapshotBuilder,
} from "../../model/PostDeathInsertSnapshot.js";
import { hasFillBlank } from "../../utils/fill-blanks.js";
import {
	LoreOptionSnapshotBuilder,
	LoreEntrySnapshotBuilder,
	LoreSection,
	InstinctOptionSnapshotBuilder,
	InstinctSection,
	MoveSnapshotBuilder,
} from "../../model/CharacterSnapshot.js";
import { composeInstinct, stripHtmlToText } from "../../utils/strings.js";
import { clampInt } from "../../utils/custom-move-data.js";
import { zeroHpResolution, FAVOR_TRACK } from "./deaths-door.js";

/**
 * The one lore section crossing-off applies to.
 *
 * Crossed-off slugs are MARK slugs and nothing else: `crossOffMark` is only ever reached from the
 * `mark-crossoff` effect, and `_crossedOffLabels` resolves them against the Marks list alone. Held
 * as a flat array of bare slugs with no section on them, so any reader that forgets this asks the
 * wrong section a Mark's question — and a Consequence or Impulse that happened to reuse a Mark's
 * slug would come back struck through and, since `crossedOff` folds into `blocked`, could never be
 * ticked again. Named once so the three readers cannot answer it differently.
 */
const MARKS_SECTION = "marks";

export class CharacterPostDeath {
	constructor(insertFlags, instinct, lore, insertRepo, moveRepo) {
		this._insertFlags = insertFlags;
		this._instinct    = instinct;
		this._lore        = lore;
		this._insertRepo  = insertRepo;
		this._moveRepo    = moveRepo;
	}

	get activeSlug() { return this._insertFlags.getFlag("slug") ?? null; }

	/**
	 * The same write as an `actor.update()` fragment, for a caller that must land it in ONE update
	 * alongside something outside this namespace.
	 *
	 * There is one such caller: taking an insert at the Door has to end the brush with death that
	 * led to it, and the Death's Door state is a sibling of these flags rather than one of them.
	 * As two writes it could be torn in half by a reload, leaving a character wearing a Ghost and
	 * still owing a fate (see StonetopCharacter#setPostDeathInsert).
	 */
	slugUpdateData(s) { return this._insertFlags.updateData("slug", s); }

	/**
	 * Keep the Post-Death tab on a sheet that has no insert?
	 *
	 * Asked because edit mode is the wrong answer on its own: a tab about being dead would then
	 * open on every living character whose player touches the wrench. So the empty tab is opt-in,
	 * and the one thing that opts in is REMOVING an insert (StonetopCharacter#setPostDeathInsert) —
	 * a character who was undead a moment ago is exactly the one whose fate is being reconsidered,
	 * and the tab has to stay put long enough to pick another. The tab's own foot takes it back.
	 *
	 * Only ever consulted while there is no insert; taking one shows the tab on its own merits and
	 * drops this, so the flag can't outlive the question it answers.
	 */
	get tabRequested() { return !!this._insertFlags.getFlag("tabOpen"); }

	async setTabRequested(requested) {
		const data = this.tabRequestUpdateData(requested);
		if (data) await this._insertFlags.applyUpdateData(data);
	}

	/**
	 * The same write as an `actor.update()` fragment, so a caller already writing the slug can
	 * land both in ONE update — see `slugUpdateData`. Null when there is nothing to write.
	 *
	 * Unset rather than write false: the flag's absence is the ordinary state, and leaving a
	 * `false` behind would keep a record of a tab nobody ever asked for.
	 */
	tabRequestUpdateData(requested) {
		if (requested) return this._insertFlags.updateData("tabOpen", true);
		return this.tabRequested ? this._insertFlags.deletionData("tabOpen") : null;
	}
	get instinct()         { return this._instinct; }
	get lore()             { return this._lore; }

	// ── The 0-HP moves' bookkeeping (Undying / Tethered / Dark Succor) ─────────
	// Consequences, Marks and Favor are all lore options on the insert, so marking one is a
	// lore count. Two things have no lore option to live in and are stored beside the slug:
	// the Marks a Thrall has crossed off (a permanent "you can never gain this", which is not
	// the same as simply not having it) and the task their master set them.

	/** Mark slugs the Thrall can never gain — Dark Succor's "cross off a Mark that you don't have". */
	get crossedOffMarks() {
		const stored = this._insertFlags.getFlag("crossedOff");
		return Array.isArray(stored) ? stored : [];
	}

	async crossOffMark(slug) {
		if (!slug || this.crossedOffMarks.includes(slug)) return false;
		// Written as a whole array: object flags merge, arrays replace, and this is a set.
		await this._insertFlags.setFlag("crossedOff", [...this.crossedOffMarks, slug]);
		return true;
	}

	/** Which of those slugs one section is entitled to read — see MARKS_SECTION. */
	_crossedOffIn(sectionSlug) {
		return sectionSlug === MARKS_SECTION ? this.crossedOffMarks : [];
	}

	/** "Your master gives you a task; until you complete it, your Favor stays at 0." */
	get masterTask()          { return this._insertFlags.getFlag("task") ?? ""; }
	async setMasterTask(text) { await this._insertFlags.setFlag("task", String(text ?? "").trim()); }

	/**
	 * The Ghost's tether: "Choose something to which you are bound: your mortal remains, the
	 * place where you died, an object of personal significance, etc." The insert prints no box
	 * for it, but Tethered turns on it every time the Ghost drops to 0 HP — it's where they
	 * reform, and losing it is the Final Consequence — so it's recorded here.
	 */
	get tether()          { return this._insertFlags.getFlag("tether") ?? ""; }
	async setTether(text) { await this._insertFlags.setFlag("tether", String(text ?? "").trim()); }

	/** The worn insert's data, or null when there isn't one (or the pack can't answer for it). */
	async _activeData() {
		return this.activeSlug ? await this._insertRepo.findBySlug(this.activeSlug) : null;
	}

	/** One lore section of the worn insert, by slug; null when either is missing. */
	async _activeSection(sectionSlug) {
		const data = await this._activeData();
		return (data?.lore ?? []).find(e => e.slug === sectionSlug) ?? null;
	}

	/**
	 * One lore section's options with their current state, for a move that says "mark a
	 * consequence" or "gain a Mark" and needs to offer the ones still available.
	 *
	 * `requires` is honoured (the Revenant's Unstable needs Breakdown first), as is a crossed-off
	 * Mark, which is gone for good.
	 */
	async sectionOptions(sectionSlug) {
		const section = await this._activeSection(sectionSlug);
		if (!section) return [];

		const crossed = this._crossedOffIn(sectionSlug);
		return (section.options ?? [])
			.filter(o => (o.type ?? "checkbox") !== "text")
			.map(o => {
				const marked     = this._lore.getCount(sectionSlug, o.slug) > 0;
				const crossedOff = crossed.includes(o.slug);
				// Its prerequisite option isn't marked yet. Reported in its own right as well as
				// folded into `blocked`: it is the only one of the three reasons a caller can turn
				// into something a player can act on ("needs BREAKDOWN"), and a caller that has to
				// re-derive it from `requires` ends up keeping a second copy of this rule.
				const needsFirst = !!o.requires && this._lore.getCount(sectionSlug, o.requires) <= 0;
				return {
					slug:        o.slug,
					label:       optionLabel(o.description),
					description: o.description ?? "",
					marked,
					crossedOff,
					needsFirst,
					// Can't be taken now: already held, crossed off for good, or its prerequisite
					// option isn't marked yet.
					blocked:     marked || crossedOff || needsFirst,
					requires:    o.requires ?? null,
				};
			});
	}

	/**
	 * The insert's three Instincts with the current pick resolved, for a chooser that isn't
	 * rendering the whole sheet snapshot to get at them. Same shape the tab's radios are built
	 * from, so both surfaces agree about what `value` a radio carries.
	 */
	async instinctOptions() {
		const data = await this._activeData();
		return _buildInstinctSection(data?.instincts ?? [], this._instinct.selectedValue).options;
	}

	/** The worn insert's printed name, for a window that has to title itself after it. */
	async insertName() {
		return (await this._activeData())?.name ?? "";
	}

	/** One lore option's written text — the counterpart to the count reader the sheet already has. */
	loreText(sectionSlug, optionSlug) {
		return this._lore.getText(sectionSlug, optionSlug) ?? "";
	}

	/**
	 * A "choose 1" section behaving like a radio group: the new option is marked and every other
	 * one in the same section is cleared, so changing your mind about a Terrible Purpose doesn't
	 * leave you holding two.
	 *
	 * Only ever used where the book says "choose 1". Sections that accumulate (a Thrall's Marks
	 * after the first, every Consequence after the first) go through markSectionOption instead.
	 */
	async chooseOneSectionOption(sectionSlug, optionSlug) {
		if (!optionSlug) return false;
		return this._setSectionPicks(sectionSlug, optionSlug);
	}

	/**
	 * Leave one option of a section marked and every other cleared — the whole of an exclusive
	 * choice, in ONE write. `winnerSlug` of null clears the section outright.
	 *
	 * The single write is what makes this safe as well as cheap: written option by option, each
	 * rewrote the counts object from a spread of what it last read, so the sequence had to be
	 * awaited in order or the writes would clobber one another.
	 */
	async _setSectionPicks(sectionSlug, winnerSlug) {
		const section = await this._activeSection(sectionSlug);
		if (!section) return false;

		const changes = {};
		for (const opt of section.options ?? []) {
			const wanted = opt.slug === winnerSlug ? 1 : 0;
			if (this._lore.getCount(sectionSlug, opt.slug) === wanted) continue;
			changes[opt.slug] = wanted;
		}
		if (Object.keys(changes).length) await this._lore.setCounts(sectionSlug, changes);
		return true;
	}

	/**
	 * Drop the answers that belong to the insert being left behind.
	 *
	 * Insert flags live in their own namespaces and survive a swap, so a Revenant who becomes a
	 * Ghost (Undying's 6-, "you may become a Ghost instead") used to carry CARRION STENCH — a
	 * consequence of having a body — onto a character who no longer has one, and a Thrall's
	 * Fascination Instinct would sit on a Ghost whose insert doesn't offer it.
	 *
	 * Kept, deliberately: anything the NEW insert also has an option for. The Revenant and the
	 * Ghost print the same three Terrible Purposes and the same Denial/Obsession/Ennui, and a
	 * character who refused the Door for their daughter refused it for their daughter either way.
	 * So this prunes by what the new insert can hold rather than by wiping and starting over.
	 */
	async pruneToInsert(newSlug) {
		const data = newSlug ? await this._insertRepo.findBySlug(newSlug) : null;
		// An insert we cannot READ is not an insert that holds nothing — but that is exactly what
		// the empty `valid` set below would tell pruneTo, and pruneTo deletes every key outside it.
		// A pack that hasn't loaded, a slug renamed between versions, a world Item standing in for
		// a compendium one: any of them would take a character's whole post-death record with it,
		// irreversibly. Nothing recorded is worth less than nothing known, so leave it alone.
		if (newSlug && !data) return;

		const valid = new Set();
		for (const entry of data?.lore ?? []) {
			for (const opt of entry.options ?? []) valid.add(`${entry.slug}:${opt.slug}`);
		}
		await this._lore.pruneTo(valid);

		// The instinct is one value rather than a keyed set, so it's kept only if the new insert
		// actually offers it.
		const selected = this._instinct.selectedValue;
		if (selected && !(data?.instincts ?? []).some(i => composeInstinct(i.word, i.description) === selected)) {
			await this._instinct.select("");
		}

		// The three records that have no lore option to live in, and so survived the prune above:
		// the Thrall's crossed-off Marks and their master's task, and the Ghost's tether. They are
		// published unconditionally by buildSnapshot, so a Thrall hand-swapped to a Ghost printed a
		// "Your Master's Task" section on a character with no Favor track, and a "Crossed Off" list
		// of RAW SLUGS — _crossedOffLabels looks each one up in the NEW insert's lore, finds no
		// `marks` section, and falls back to the slug. Each is dropped unless the incoming insert
		// is a thing that can hold it.
		const sections = new Set((data?.lore ?? []).map(e => e.slug));
		const drops = [];
		if (!sections.has("marks")) drops.push("crossedOff", "task");
		// The tether belongs to the insert whose 0-HP move disperses them — the Ghost's Tethered.
		if (!zeroHpResolution(newSlug)?.disperses) drops.push("tether");
		// unsetFlag, not a write of "" or []: an object flag MERGES, so a blank value would leave a
		// present-but-empty record behind rather than removing it. Only the keys actually present
		// are touched, so an ordinary swap is still one write or none.
		for (const key of drops) {
			if (this._insertFlags.getFlag(key) != null) await this._insertFlags.unsetFlag(key);
		}
	}

	/**
	 * Clear every pick in a section without taking one — the other half of an exclusive choice,
	 * for when it's answered by a write-in rather than by one of the printed options.
	 */
	async clearSectionPicks(sectionSlug) {
		return this._setSectionPicks(sectionSlug, null);
	}

	/** Untick one lore option. Returns false if it wasn't marked to begin with. */
	async unmarkSectionOption(sectionSlug, optionSlug) {
		if (!optionSlug) return false;
		if (this._lore.getCount(sectionSlug, optionSlug) <= 0) return false;
		await this._lore.setCount(sectionSlug, optionSlug, 0);
		return true;
	}

	/** Tick one lore option (a consequence, a Mark). Returns false if it was already marked. */
	async markSectionOption(sectionSlug, optionSlug) {
		if (!optionSlug) return false;
		if (this._lore.getCount(sectionSlug, optionSlug) > 0) return false;
		await this._lore.setCount(sectionSlug, optionSlug, 1);
		return true;
	}

	/**
	 * Where this insert's roll track lives in its lore, if it has one — the Thrall's Favor is
	 * the only such track today, and its coordinates are the resolution table's to state (see
	 * deaths-door.js), not this file's to retype.
	 */
	_rollTrack() {
		return zeroHpResolution(this.activeSlug)?.roll?.loreCount ?? FAVOR_TRACK;
	}

	/** The Thrall's current Favor (0-3), read from its own track. */
	favor() {
		const { entry, option } = this._rollTrack();
		return this._lore.getCount(entry, option);
	}

	async setFavor(value) {
		const { entry, option } = this._rollTrack();
		await this._lore.setCount(entry, option, clampInt(value, 0, 3));
	}

	async buildSnapshot() {
		const slug       = this.activeSlug;
		const allEntries = await this._insertRepo.getAll();

		let activeInsert = null;
		if (slug) {
			const data = await this._insertRepo.findBySlug(slug);
			if (data) {
				const moves   = await this._moveRepo.getPostDeathMoves(slug);
				const crossed = this.crossedOffMarks;
				// An insert whose 0-HP move disperses them binds them to a tether: it's what
				// they reform beside. The resolution table says which insert that is (the
				// Ghost's Tethered), on the same terms the walkthrough reads it.
				const boundToTether = !!zeroHpResolution(slug)?.disperses;
				activeInsert = new PostDeathInsertSnapshotBuilder()
					.withSlug(data.slug)
					.withName(data.name)
					.withImg(data.img)
					.withDescription(data.description)
					.withInstinct(_buildInstinctSection(data.instincts, this._instinct.selectedValue))
					.withLore(buildLoreSection(data.lore, this._lore, null, crossed))
					.withMoves(_buildMoveSnapshots(moves))
					// Three records the printed insert has no box for, but whose moves depend on
					// them: Dark Succor's crossed-off Marks and master's task, and the Ghost's tether.
					.withCrossedOffMarks(_crossedOffLabels(data.lore, crossed))
					.withMasterTask(this.masterTask)
					.withTether(boundToTether ? this.tether : "")
					.withNeedsTether(boundToTether && !this.tether)
					.build();
			}
		}
		return new PostDeathSectionSnapshotBuilder()
			.withActiveSlug(slug)
			.withActiveInsert(activeInsert)
			.withAvailableInserts(allEntries)
			.build();
	}
}

/**
 * How much an insert's marked options take off the character's max HP.
 *
 * Five of the Thrall's nine Marks open with "Reduce your max HP by 2", and a Thrall accumulates
 * them, so the penalty has to be live rather than a one-off write — un-marking a Mark has to give
 * the hit points back, and there is nowhere on the sheet to park a manual adjustment that would.
 *
 * Read from the printed text rather than a hand-maintained slug list: the phrase is fixed and
 * appears verbatim on every Mark that carries it, so a homebrew Mark written the same way is
 * honoured for free and no pack rebuild is needed to teach the system a new one.
 */
const _HP_PENALTY_RE = /reduce your max\.?\s*hp by (\d+)/i;

export function insertHpPenalty(loreSection) {
	let total = 0;
	for (const entry of loreSection?.entries ?? []) {
		for (const opt of entry.options ?? []) {
			if (!opt.count) continue;
			const n = Number(stripHtmlToText(opt.description).match(_HP_PENALTY_RE)?.[1]);
			if (Number.isFinite(n)) total += n;
		}
	}
	return total;
}

/** Display labels for the crossed-off Mark slugs, resolved against the insert's own Marks list. */
function _crossedOffLabels(loreData, slugs) {
	if (!slugs.length) return [];
	const marks = (loreData ?? []).find(e => e.slug === MARKS_SECTION)?.options ?? [];
	return slugs.map(slug => ({
		slug,
		label: optionLabel(marks.find(o => o.slug === slug)?.description) || slug,
	}));
}

/**
 * A short name for a lore option, for a picker that can't afford the option's full prose.
 * The book prints these as "**BREAKDOWN** — You lash out in…", so the leading bold word(s) are
 * the name; anything else falls back to the first clause of the stripped text.
 */
export function optionLabel(description) {
	const html = String(description ?? "");
	const bold = html.match(/<strong>(.*?)<\/strong>/i)?.[1];
	const plain = stripHtmlToText(bold ?? html);
	if (bold) return plain;
	// No bold lead (the Thrall's Impulse lines, say): take up to the first dash or full stop.
	return plain.split(/\s+—\s+|\.\s/)[0].slice(0, 60).trim();
}

// Exported so StonetopCharacter can reuse it for the playbook lore section.
// `arcanaDisplay` (Seeker only) carries the chosen major arcanum and the drawn
// minor cards. Lore entries/options opt in via the data flags `arcanaImage`
// (entry) and `arcanaRole` (option), so this stays playbook-agnostic.
export function buildLoreSection(loreData, loreState, arcanaDisplay = null, crossedOff = []) {
	const crossed = new Set(crossedOff);
	const entries = loreData.map(entry => {
		// Crossing off is a MARKS rule and nothing else — see MARKS_SECTION.
		const isMarks = entry.slug === MARKS_SECTION;
		const options = (entry.options ?? []).map(opt => {
			const isText = (opt.type ?? "checkbox") === "text";
			// A pick option may carry an inline fill-in blank (e.g. "… running for your
			// life from ___"). Its written value shares the lore.texts store, so load it as
			// the option's textValue even though the option is a checkbox, not a text field.
			const hasBlank = !isText && hasFillBlank(opt.description);
			const builder = new LoreOptionSnapshotBuilder()
				.withSlug(opt.slug)
				.withDescription(opt.description)
				.withType(opt.type ?? "checkbox")
				.withMax(isText ? 0 : (opt.max ?? 1))
				.withCount(isText ? 0 : loreState.getCount(entry.slug, opt.slug))
				.withCrossedOff(isMarks && crossed.has(opt.slug))
				.withTextValue((isText || hasBlank) ? loreState.getText(entry.slug, opt.slug) : null);
			if (arcanaDisplay && opt.arcanaRole) {
				const selectedSlug = arcanaDisplay.roles?.[opt.arcanaRole] ?? "";
				builder.withArcanaPicker({
					role:         opt.arcanaRole,
					options:      arcanaDisplay.minorOptions,
					selectedSlug,
					selectedName: arcanaDisplay.minorOptions.find(o => o.slug === selectedSlug)?.name ?? "",
					muted:        opt.arcanaRole === "lead",
				});
			}
			return builder.build();
		});
		const builder = new LoreEntrySnapshotBuilder()
			.withSlug(entry.slug)
			.withTitle(entry.title)
			.withDescription(entry.description ?? "")
			.withOptions(options)
			.withColumnBreak(entry.columnBreak)
			.withReadonlyMerge(entry.readonlyMerge)
			.withContinuation(entry.continuation)
			.withSubheader(entry.subheader);
		if (arcanaDisplay?.major && entry.arcanaImage) {
			builder.withArcanaImage(arcanaDisplay.major);
		}
		return builder.build();
	});
	return new LoreSection(entries);
}

function _buildInstinctSection(instincts, selectedValue) {
	const options = (instincts ?? []).map(({ word, description }) => {
		const value = composeInstinct(word, description);
		return new InstinctOptionSnapshotBuilder()
			.withWord(word)
			.withDescription(description)
			.withValue(value)
			.withSelected(selectedValue === value)
			.build();
	});
	return new InstinctSection(selectedValue || null, options);
}

function _buildMoveSnapshots(entries) {
	return entries.map(e => new MoveSnapshotBuilder()
		.withId(e.id)
		.withCompendiumId(e.id)
		.withOwnedId(null)
		.withName(e.name)
		.withDescription(e.description ?? "")
		.withRollType(e.rollType)
		.withIsStarting(false)
		.withSource({ type: "post-death" })
		.withSourceLabel(null)
		.withOwned(false)
		.withOwnedIds([])
		.withLocked(false)
		.withRequirement(null)
		.withRequiresLabel(null)
		.withResource(null)
		.withRepeat(null)
		.withRepeatable(false)
		.build()
	);
}
