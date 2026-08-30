import {
	ArcanaBackOptionSnapshotBuilder, ArcanaSnapshot, ArcanaSectionSnapshot,
	ArcanaUnlockOptionSnapshotBuilder, ArcanaUnlockTextItem,
	ArcanumBackMoveSnapshot, ArcanumUnlockSection,
	MinorArcanumBackSnapshotBuilder, MinorArcanumFrontSnapshotBuilder,
	MinorArcanumSnapshotBuilder,
	ResourceBuilder,
} from "../../model/CharacterSnapshot.js";
import { OutfitItemBuilder } from "../../model/OutfitItem.js";
import { majorArcanaImg, isMajorArcanumItem, arcanumCardImg } from "../../arcana-icons.js";
import { arcanaSummonFollowers } from "../../data/arcana-summons.js";
import { isCarriedArcanumItem } from "../../data/arcana-facets.js";
import { findArcanumMove, markArcanumMoveNames } from "../../data/arcana-moves.js";
import { centerArcanumTracks, injectGlyphCheckboxes } from "../../utils/glyphs.js";
import { stonetopChatCard } from "../../utils/chat.js";

// Some arcana "items" are a place, structure, or phenomenon rather than carried gear
// (a sealed cave, a giant's dormitory, an arch you could walk through). Book I p.437 gives
// a card the `immobile` tag for exactly this, and where the book prints it, that tag is what
// holds the card back — isImmobileArcanumItem, applied in weightedInventoryItems, so a
// HOMEBREW place needs no entry here and the rule reads as what the book says.
//
// What remains listed are the shipped places the book leaves untagged: it prints them plain
// `magical`, and nothing in their data tells them apart from a portable curio (both carry a
// null weight), so there is nothing to derive and they are named. This gates only the
// WEIGHTLESS side (see weightedInventoryItems): a card whose front is such a place but whose
// unlocked BACK item is real, weighted gear still surfaces that gear once realised.
//
// An IMPLANTED arcanum — Storm Markings up your skin, the Ineffable Words on your soul — is
// kept off by its own printed tag too (isImplantedArcanumItem).
const CONCEPT_ARCANA_SLUGS = new Set([
	"crumbling-arch",
	"giants-dormitory",
	"metal-man",
	"odd-conveyance",
	"patch-of-rainbow-moss",
	"rune-etched-pillars",
	"runes-around-a-ruined-hall",
	"sealed-cave",
	"timeless-vault",
]);

function _isUnlocked(item, unlockCounts, arcanaBoxes, circleCount) {
	const reqs = item.front.unlock?.requirements ?? [];
	const reqsMet = reqs.every(r =>
		r.type !== "option" || (unlockCounts[`${item.slug}:${r.slug}`] ?? 0) >= (r.max ?? 1)
	);
	if (!reqsMet) return false;
	for (let i = 0; i < circleCount; i++) {
		if (!arcanaBoxes[`${item.slug}:unlock:${i}`]) return false;
	}
	return true;
}

/**
 * The sheet's own marker injection: {@link injectGlyphCheckboxes} with this card's persisted
 * box states supplying the checked test. Keys are `slug:context:index`, which is how the
 * sheet stores them; the onboarding dialog indexes the same boxes the same way through the
 * same helper, so a mark made there lands on this box when the sheet opens.
 *
 * The two track patterns below require a run of 2+ so a lone glyph stays a display glyph: a
 * single ◇/○ is an inline indicator ("a ◇ jar of butter", "BATTERY ○ ____"), only a run
 * is a markable track (◇◇◇ Conduit, ○○○ Loyalty). The patterns are precompiled module
 * constants so nothing recompiles inside the per-item loop (String.replace resets a
 * global regex's lastIndex, so sharing them across calls is safe).
 */
function _injectMarkers(html, slug, context, boxStates, cssClass, runRe) {
	return injectGlyphCheckboxes(html, runRe, {
		slug, context, cssClass,
		isChecked: i => !!boxStates[`${slug}:${context}:${i}`],
	});
}

const _DIAMOND_TRACK_RE = /◇{2,}/g;
const _CIRCLE_TRACK_RE  = /○{2,}/g;
// Runs, not single glyphs, purely so the wrapper above can hold consecutive boxes on one line —
// every □ / unlock ○ is a checkbox either way, and each still gets its own index in the same
// document order a per-glyph pattern produced.
const _BOX_RE           = /□+/g;
const _UNLOCK_CIRCLE_RE = /○+/g;

// A few cards' FRONT text tells you to "mark a consequence (see reverse)" (Hec'tumel Codex,
// Redwood Effigy). The consequences themselves live in a "Consequences" section on the BACK,
// which a player may not have unlocked. For those cards we surface that section onto the front
// (see buildSnapshot / the sheet's fold pass), so the pointer reads "(see below)".
//
// Detect such a front by the parenthetical "(see reverse)" attached to a "consequence" clause;
// the "consequence" word rules out the other "(see reverse)" pointers (to spells / named moves)
// that live in the unlock text of most cards.
const _FRONT_CONSEQUENCE_REF_RE = /consequences?\b[^.<]*?\(see reverse\)/i;
// Match the "Consequences" heading on its tag (any heading level) rather than the bare word,
// which also appears in body prose ("mark a consequence…", "marked 3 Consequences") before the
// real heading.
const _CONSEQUENCES_HEADING_RE = /<h([1-6])\b[^>]*>\s*Consequences\s*<\/h\1>/i;

// Slice the "Consequences" section out of an already-processed BACK description so it can be
// shown on the front. Runs from the heading to the next heading (or the end — the section is
// authored last on every shipped card), which keeps its nested lists and any trailing prose
// intact and sidesteps balanced-tag matching. Because the input is the PROCESSED back HTML,
// the □/○ inside already carry the back's own (slug, "back"/"backCircle", index) checkboxes, so
// marking a consequence from the front writes the exact same state as marking it from the back.
// Returns null when there's no section or only a pointer stub (e.g. Whispering Rocks' "See
// above."), so a contentless fold never renders.
function _extractConsequencesSection(processedBackHtml) {
	if (!processedBackHtml) return null;
	const m = _CONSEQUENCES_HEADING_RE.exec(processedBackHtml);
	if (!m) return null;
	const after = processedBackHtml.slice(m.index + m[0].length);
	const nextHeading = after.search(/<h[1-6]\b/i);
	const body = nextHeading >= 0 ? after.slice(0, nextHeading) : after;
	if (!/<li\b/i.test(body)) return null;
	return m[0] + body;
}

// Run a side description through the full marker pipeline: center standalone tracks, then
// make ◇ / ○ tracks and □ boxes selectable. `side` ("front"/"back") keeps each side's
// marker indices in their own context so they never collide. Returns the processed HTML.
function _processSideDescription(description, slug, side, boxStates) {
	let html = centerArcanumTracks(description);
	({ html } = _injectMarkers(html, slug, `${side}Diamond`, boxStates, "stonetop-arcanum-diamond", _DIAMOND_TRACK_RE));
	({ html } = _injectMarkers(html, slug, `${side}Circle`,  boxStates, "stonetop-arcanum-circle",  _CIRCLE_TRACK_RE));
	({ html } = _injectMarkers(html, slug, side,             boxStates, "stonetop-arcanum-box",     _BOX_RE));
	return html;
}

function _buildOutfitItem(slug, itemData, resolvedResource = undefined) {
	if (!itemData) return null;
	return new OutfitItemBuilder()
		.withSlug(slug)
		.withName(itemData.name)
		.withWeight(itemData.weight ?? null)
		.withNote(itemData.note ?? null)
		.withInventoryColumn(itemData.inventoryColumn ?? null)
		.withResource(resolvedResource !== undefined ? resolvedResource : (itemData.resource ?? null))
		.withTwoCol(false)
		.withBreakBefore(false)
		.build();
}

export class CharacterArcana {
	constructor(flags, arcanaRepo) {
		this._flags = flags;
		this._arcanaRepo = arcanaRepo;
	}

	get ownedSlugs()       { return new Set(this._flags.getFlag("owned") ?? []); }
	get revealedSlugs()    { return new Set(this._flags.getFlag("revealed") ?? []); }
	get identifiedSlugs()  { return new Set(this._flags.getFlag("identified") ?? []); }
	get backOwedSlugs()    { return new Set(this._flags.getFlag("backOwed") ?? []); }
	get leadSlugs()        { return new Set(this._flags.getFlag("leads") ?? []); }
	get unlockCounts()     { return this._flags.getFlag("unlock") ?? {}; }
	get backOptionCounts() { return this._flags.getFlag("backOptions") ?? {}; }
	get majorSlug()        { return this._flags.getFlag("major") ?? null; }
	get minorDrawSlugs()   { return this._flags.getFlag("minorDraw") ?? []; }
	get minorRoles()       { return this._flags.getFlag("minorRoles") ?? {}; }

	/**
	 * Display data for a playbook's arcana lore (the Seeker): the chosen major
	 * arcanum (name + icon) and the drawn minor cards with their role assignments.
	 * Minor arcana have no artwork, so they're name-only.
	 */
	async buildLoreDisplay() {
		const majorSlug = this.majorSlug;
		const drawSlugs = this.minorDrawSlugs;
		const slugs     = [...new Set([majorSlug, ...drawSlugs].filter(Boolean))];
		const fetched   = await this._arcanaRepo.findBySlugs(slugs);
		const names     = Object.fromEntries(fetched.map(a => [a.slug, a.front?.title ?? a.slug]));
		return {
			major: majorSlug
				? { slug: majorSlug, name: names[majorSlug] ?? majorSlug, img: majorArcanaImg(majorSlug) }
				: null,
			minorOptions: drawSlugs.map(slug => ({ slug, name: names[slug] ?? slug })),
			roles: this.minorRoles,
		};
	}

	async setMinorRole(role, slug) {
		const roles = { ...this.minorRoles };
		if (slug) roles[role] = slug; else delete roles[role];
		await this._flags.setFlag("minorRoles", roles);
	}

	async buildSnapshot(stats = {}, checkedMap = {}, inventoryResources = {}) {
		const ownedSlugs       = this.ownedSlugs;
		const identifiedSlugs  = this.identifiedSlugs;
		const backOwedSlugs    = this.backOwedSlugs;
		const leadSlugs        = this.leadSlugs;
		const unlockCounts     = this.unlockCounts;
		const backOptionCounts = this.backOptionCounts;
		const arcanaBoxes      = this._flags.getFlag("boxes") ?? {};

		const fetchedItems = await this._arcanaRepo.findBySlugs([...ownedSlugs]);

		const allItems = fetchedItems.map(item => {
			const unlockItems = (item.front.unlock?.requirements ?? []).map(li => {
				if (li.type === "text") return new ArcanaUnlockTextItem(li.content);
				const count = unlockCounts[`${item.slug}:${li.slug}`] ?? 0;
				return new ArcanaUnlockOptionSnapshotBuilder()
					.withSlug(li.slug)
					.withDescription(li.description)
					.withCount(count)
					.withMax(li.max ?? 1)
					.withSelected(count > 0)
					.build();
			});

			const frontDesc = _processSideDescription(item.front.description, item.slug, "front", arcanaBoxes);
			const { html: unlockDesc, count: circleCount } = _injectMarkers(centerArcanumTracks(item.front.unlock?.description ?? ""), item.slug, "unlock", arcanaBoxes, "stonetop-arcanum-circle", _UNLOCK_CIRCLE_RE);
			const unlocked = _isUnlocked(item, unlockCounts, arcanaBoxes, circleCount);

			const front = new MinorArcanumFrontSnapshotBuilder()
				.withTitle(item.front.title)
				.withItem(_buildOutfitItem(item.slug, item.front.item))
				.withDescription(frontDesc)
				.withUnlock(new ArcanumUnlockSection(unlockDesc, unlockItems))
				.build();

			const backOpts = (item.back.options ?? []).map(o => {
				const count = backOptionCounts[`${item.slug}:${o.slug}`] ?? 0;
				return new ArcanaBackOptionSnapshotBuilder()
					.withSlug(o.slug)
					.withDescription(o.description)
					.withCount(count)
					.withMax(o.max ?? 1)
					.withSelected(count > 0)
					.build();
			});

			const backResource = item.back.resource
				? new ResourceBuilder()
					.withCurrent(inventoryResources[item.slug] ?? 0)
					.withMax(item.back.resource.maxStat
						? (stats[item.back.resource.maxStat]?.value ?? 0)
						: item.back.resource.max)
					.withMaxStat(item.back.resource.maxStat ?? null)
					.withTitle(item.back.resource.title ?? null)
					.withLabels(item.back.resource.labels ?? [])
					.build()
				: null;

			const backItemResourceDef = item.back.item?.resource ?? null;
			// A card can carry BOTH a back-power resource (above, keyed by bare slug) and a
			// back-ITEM resource. They'd otherwise share `resources[slug]` and clobber each
			// other, so the item track is keyed `${slug}:item`. Fall back to the bare slug so
			// shipped item-only cards (e.g. "A bow with no string") keep their saved counts.
			const backItemResource = backItemResourceDef
				? new ResourceBuilder()
					.withCurrent(inventoryResources[`${item.slug}:item`] ?? inventoryResources[item.slug] ?? 0)
					.withMax(backItemResourceDef.maxStat
						? (stats[backItemResourceDef.maxStat]?.value ?? 0)
						: backItemResourceDef.max)
					.withMaxStat(backItemResourceDef.maxStat ?? null)
					.withTitle(backItemResourceDef.title ?? null)
					.withLabels(backItemResourceDef.labels ?? [])
					.build()
				: null;

			const backMove = item.back.move
				? new ArcanumBackMoveSnapshot(
					item.back.move.name,
					item.back.move.rollType ?? null,
					item.back.move.description)
				: null;

			// The card's mysteries are moves, so their NAMES render as clickable handles before the
			// marker pass runs (see data/arcana-moves.js) — the wrap adds no glyphs, so the □/○ each
			// side indexes are untouched by it.
			const backDesc = _processSideDescription(
				markArcanumMoveNames(item.back.description, item.slug), item.slug, "back", arcanaBoxes);

			// Surface the back's "Consequences" section onto the front, but ONLY for cards whose
			// front text points at it ("mark a consequence (see reverse)"). Those cards trigger
			// consequences from a front-side move, so the owner needs the list even with a locked
			// back — and because the front already names consequences, surfacing them leaks nothing.
			// (For every other card, consequences are a back-move payoff and stay hidden with the back.)
			const consequences = _FRONT_CONSEQUENCE_REF_RE.test(item.front.description ?? "")
				? _extractConsequencesSection(backDesc)
				: null;

			// Redwood Effigy: the two "potential" Conduit slots on the front stay locked
			// until the Greater Conduit mystery (a □ on the back) is checked. Find that
			// box's own □ — the last one at/before the label, since the text reads
			// "□ GREATER CONDUIT" — then index it by counting the □ before it, rather than
			// hard-coding an index, so it survives edits to the back text. The order matches
			// _injectMarkers, which indexes □ in document order.
			const backDescText = item.back.description ?? "";
			const gcLabelPos = backDescText.indexOf("GREATER CONDUIT");
			const gcBoxPos   = gcLabelPos >= 0 ? backDescText.lastIndexOf("□", gcLabelPos) : -1;
			const greaterConduit = gcBoxPos >= 0
				&& !!arcanaBoxes[`${item.slug}:back:${(backDescText.slice(0, gcBoxPos).match(/□/g) || []).length}`];

			const back = new MinorArcanumBackSnapshotBuilder()
				.withTitle(item.back.title)
				.withItem(_buildOutfitItem(item.slug, item.back.item, backItemResource))
				.withDescription(backDesc)
				.withResource(backResource)
				.withMove(backMove)
				.withOptions(backOpts)
				.build();

			return new MinorArcanumSnapshotBuilder()
				.withSlug(item.slug)
				.withFront(front)
				.withBack(back)
				.withOwned(true)
				.withChecked(checkedMap[item.slug] ?? false)
				.withUnlocked(unlocked)
				.withIdentified(identifiedSlugs.has(item.slug))
				.withBackOwed(backOwedSlugs.has(item.slug))
				.withLead(leadSlugs.has(item.slug) && !identifiedSlugs.has(item.slug))
				.withImg(arcanumCardImg(item))
				.withMajor(isMajorArcanumItem(item))
				.withSummonFollowers(arcanaSummonFollowers(item))
				.withGreaterConduit(greaterConduit)
				.withConsequences(consequences)
				.build();
		});

		const major = new ArcanaSectionSnapshot("Major Arcana", allItems.filter(i => i.major));
		const minor = new ArcanaSectionSnapshot("Minor Arcana", allItems.filter(i => !i.major));
		return new ArcanaSnapshot(minor, major);
	}

	/**
	 * One move printed on a card's back, by its parsed slug — the record behind a clicked move
	 * name on the arcana tab. `learned` reads the move's own □: an un-marked mystery is still
	 * readable (its name posts it to chat) but is not yet a move this character can roll, which
	 * is the line an un-owned playbook move sits on too.
	 */
	async getArcanumMove(slug, moveSlug) {
		const item = await this.getArcanum(slug);
		if (!item) return null;
		const move = findArcanumMove(item.back?.description ?? "", moveSlug);
		if (!move) return null;
		const boxes = this._flags.getFlag("boxes") ?? {};
		return {
			...move,
			cardTitle: item.back?.title ?? item.front?.title ?? "",
			learned:   move.boxIndex == null || !!boxes[`${slug}:back:${move.boxIndex}`],
		};
	}

	/** The resolved {@link MinorArcanum} for a slug (pack or world), or null. */
	async getArcanum(slug) {
		const [item] = await this._arcanaRepo.findBySlugs([slug]);
		return item ?? null;
	}

	async addArcanum(slug) {
		const slugsWeHae = this.ownedSlugs;
		slugsWeHae.add(slug);
		await this._flags.setFlag("owned", [...slugsWeHae]);
	}

	async removeArcanum(slug) {
		// Clear every per-card trace of this slug, not just owned/identified. Leaving the reveal
		// flag or the unlock/mark maps behind means re-acquiring the same arcanum later (a fresh
		// drop or level-up pick) silently restores a GM-revealed back, or a fully-unlocked/marked
		// state, with no GM action — a spoiler leak plus stale marks.
		//
		// Batched into ONE actor.update so removing a card is a single document write / sheet
		// re-render, not ~10 sequential setFlag/unsetFlag calls each re-rendering the open sheet.
		const prefix = `${slug}:`;
		const sets = {}, deletes = {};
		// Slug arrays: writing the filtered array replaces it wholesale (mergeObject doesn't
		// deep-merge arrays), dropping the slug.
		for (const key of ["owned", "identified", "backOwed", "leads", "revealed", "flipped"]) {
			const cur = this._flags.getFlag(key) ?? [];
			if (cur.includes(slug)) sets[key] = cur.filter(s => s !== slug);
		}
		// Keyed maps ("<slug>:…" keys): an update MERGES, so it can't drop a key — delete each
		// removed sub-key with the "-=key" syntax (see setArcanumBoxChecked's mergeObject note).
		for (const key of ["unlock", "boxes", "backOptions"]) {
			const cur = this._flags.getFlag(key) ?? {};
			const drop = Object.keys(cur).filter(k => k === slug || k.startsWith(prefix));
			if (drop.length) deletes[key] = drop;
		}
		await this._flags.batch({ sets, deletes });
	}

	// The three outcomes of identifying an arcanum (Book I, Discoveries p.440). The book's
	// ladder is a disclosure ladder, and the two flags we already keep are exactly its two
	// rungs: `identified` means the owner may read the FRONT, `revealed` means they may also
	// read the BACK of a still-locked card (it's the only owner-side input to the sheet's
	// permittedBack). So a 10+ writes both, a 7-9 writes only `identified`, and a 6- writes
	// nothing. Each write is batched so one tier is one document update / one re-render, and
	// each takes `options` so the caller can attribute it in the ledger ({stonetopMove: …}).

	/** Read the front, and nothing more. The GM's "front only" hand-over. */
	async identifyArcanum(slug, options) {
		const identified = this.identifiedSlugs;
		identified.add(slug);
		await this._flags.setFlag("identified", [...identified], options);
	}

	/**
	 * "on a 10+, give them the card and have them read both sides" — front and back at once.
	 * Clears any outstanding back debt from an earlier 7-9 on the same card, since the back
	 * has now arrived.
	 */
	async identifyAndRevealArcanum(slug, options) {
		const identified = this.identifiedSlugs;
		const revealed   = this.revealedSlugs;
		const backOwed   = this.backOwedSlugs;
		identified.add(slug);
		revealed.add(slug);
		backOwed.delete(slug);
		await this._flags.batch({ sets: {
			identified: [...identified],
			revealed:   [...revealed],
			backOwed:   [...backOwed],
		} }, options);
	}

	/**
	 * "on a 7-9, have them read the front, and show them the back when they have some time to
	 * study it or learn more" — the front now, the back as a debt the GM settles later. The
	 * debt needs its own flag because `identified && !revealed` is also the resting state of
	 * every card a GM simply hands over front-only; without it the promise would live only in
	 * a chat message that scrolls away.
	 */
	async identifyFrontOwedArcanum(slug, options) {
		const identified = this.identifiedSlugs;
		const backOwed   = this.backOwedSlugs;
		identified.add(slug);
		backOwed.add(slug);
		await this._flags.batch({ sets: {
			identified: [...identified],
			backOwed:   [...backOwed],
		} }, options);
	}

	// Record a "lead": the owner knows this arcanum exists and roughly where it is, but
	// hasn't recovered it yet (the Seeker's Lead role). It shows on the arcana tab as a
	// placeholder card. A lead is owned so it renders, but weightedInventoryItems skips
	// leadSlugs so its curio never leaks to the Inventory tab or the expedition load.
	async addLead(slug) {
		const owned = this.ownedSlugs;
		const leads = this.leadSlugs;
		owned.add(slug);
		leads.add(slug);
		await Promise.all([
			this._flags.setFlag("owned", [...owned]),
			this._flags.setFlag("leads", [...leads]),
			// Materializing the lead card (here or via onboarding) also arms the one-time
			// backfill guard, so a card the player later removes isn't resurrected on the next
			// world load. Without this the onboarding path leaves the flag unset and
			// ensureLeadBackfill can't tell "never had a card" from "had one and deleted it".
			this._flags.setFlag("leadBackfilled", true),
		]);
	}

	// Discover a lead: the owner has recovered the arcanum, so drop the lead marker and
	// identify it — it now renders as a normal (found) minor arcanum, exactly like a card
	// acquired through the Found role.
	async discoverArcanum(slug) {
		const leads = this.leadSlugs;
		if (!leads.has(slug)) return;
		leads.delete(slug);
		const identified = this.identifiedSlugs;
		identified.add(slug);
		await Promise.all([
			this._flags.setFlag("leads", [...leads]),
			this._flags.setFlag("identified", [...identified]),
		]);
	}

	// One-time backfill for Seekers created before the lead-card feature. Their onboarding
	// "Lead" pick was stored only as a role (minorRoles.lead) and never shown as a card;
	// surface it as a lead card. Guarded by a per-actor flag so a card the player later
	// discovers (identifies) or removes is never resurrected on the next world load. No-op
	// for non-Seekers, for Seekers with no Lead pick, and once the flag is set.
	async ensureLeadBackfill() {
		const leadSlug = this.minorRoles?.lead;
		if (!leadSlug) return;
		if (this._flags.getFlag("leadBackfilled")) return;
		if (!this.ownedSlugs.has(leadSlug)) await this.addLead(leadSlug);
		await this._flags.setFlag("leadBackfilled", true);
	}

	// Mark a card as fully realized ("mastered"): satisfy every option unlock requirement and
	// fill its unlock circles so _isUnlocked() reports true. Used at onboarding for the Seeker's
	// mastered minor, which begins play already realized — it carries its back item and its back
	// is visible to the owner. No-op if the slug can't be resolved to a pack/world arcanum.
	async masterArcanum(slug) {
		const item = await this.getArcanum(slug);
		if (!item) return;
		const unlock = { ...this.unlockCounts };
		for (const req of item.front?.unlock?.requirements ?? []) {
			if (req?.type === "option" && req.slug) unlock[`${slug}:${req.slug}`] = req.max ?? 1;
		}
		const circleCount = (item.front?.unlock?.description?.match(_UNLOCK_CIRCLE_RE) || []).length;
		const boxes = { ...(this._flags.getFlag("boxes") ?? {}) };
		for (let i = 0; i < circleCount; i++) boxes[`${slug}:unlock:${i}`] = true;
		await Promise.all([
			this._flags.setFlag("unlock", unlock),
			this._flags.setFlag("boxes", boxes),
		]);
	}

	// GM-only: in secretive mode, expose / hide a still-LOCKED card's back to the owning
	// player (an unlocked back is always visible to its owner, and with the peek setting on
	// players see backs anyway, so the reveal toggle only shows for a locked card while the
	// setting is off). The GM always sees both sides regardless.
	async revealArcanum(slug, options) {
		const revealed = this.revealedSlugs;
		const backOwed = this.backOwedSlugs;
		revealed.add(slug);
		// Handing the back over settles a 7-9's debt, whether the GM does it from the card's
		// footer or from the "back is owed" strip. Batched with the reveal so the strip can't
		// linger for a render after the back arrives. Most reveals owe nothing, so they stay a
		// plain single write rather than a batch of two.
		if (backOwed.delete(slug)) {
			await this._flags.batch({ sets: { revealed: [...revealed], backOwed: [...backOwed] } }, options);
		} else {
			await this._flags.setFlag("revealed", [...revealed], options);
		}
	}

	async hideArcanum(slug, options) {
		const s = this.revealedSlugs;
		s.delete(slug);
		await this._flags.setFlag("revealed", [...s], options);
	}

	async setUnlockCount(arcanumSlug, optionSlug, count) {
		const key = `${arcanumSlug}:${optionSlug}`;
		await this._flags.setFlag("unlock", { ...this.unlockCounts, [key]: count });
	}

	async setArcanumBoxChecked(slug, context, index, checked) {
		const boxes = this._flags.getFlag("boxes") ?? {};
		const key = `${slug}:${context}:${index}`;
		if (!!boxes[key] === !!checked) return;
		// Store false explicitly rather than deleting the key — Foundry's setFlag uses
		// mergeObject internally, which preserves keys missing from the update object.
		await this._flags.setFlag("boxes", { ...boxes, [key]: !!checked });
	}

	async setBackOptionCount(arcanumSlug, optionSlug, count) {
		const key = `${arcanumSlug}:${optionSlug}`;
		await this._flags.setFlag("backOptions", { ...this.backOptionCounts, [key]: count });
	}

	async getArcanumChatContent(slug, flipped) {
		const [item] = await this._arcanaRepo.findBySlugs([slug]);
		if (!item) return null;

		if (flipped) {
			const { title, description, move } = item.back;
			let body = `<div class="card-content">${description ?? ""}`;
			if (move) body += `<p class="stonetop-arcanum-move-trigger"><strong><em>${move.name}</em></strong></p>${move.description ?? ""}`;
			return stonetopChatCard(title, body + `</div>`, "stonetop-arcanum-chat-card");
		} else {
			const { title, description, unlock } = item.front;
			let body = `<div class="card-content">${description ?? ""}`;
			if (unlock?.description) {
				body += `<p class="stonetop-arcanum-unlock-lead">${unlock.description}</p>`;
				const reqs = unlock.requirements ?? [];
				if (reqs.length) {
					const items = reqs.map(r => `<li>${r.type === "text" ? r.content : r.description}</li>`).join("");
					body += `<ul class="stonetop-arcanum-unlock-list">${items}</ul>`;
				}
			}
			return stonetopChatCard(title, body + `</div>`, "stonetop-arcanum-chat-card");
		}
	}

	async weightedInventoryItems() {
		const ownedSlugs   = this.ownedSlugs;
		const identified   = this.identifiedSlugs;
		const leads        = this.leadSlugs;
		const unlockCounts = this.unlockCounts;
		const arcanaBoxes  = this._flags.getFlag("boxes") ?? {};
		const items = await this._arcanaRepo.findBySlugs([...ownedSlugs]);
		return items.flatMap(item => {
			// A "lead" is owned (so it renders on the arcana tab as a placeholder) but not yet
			// recovered, so its curio isn't in the party's packs — skip it entirely, or the
			// not-yet-found item leaks into the Inventory/Outfit list and its ◇ counts toward
			// load. Discovering the lead clears it from leadSlugs, at which point it flows through.
			if (leads.has(item.slug)) return [];
			// Which side's item you carry follows the card's unlock state, not the old manual
			// flip: a card realises its back-side item once unlocked, otherwise it's the front
			// item. Gate on identified too, so an unidentified face-down mystery always shows its
			// front curio — a homebrew card whose unlock is vacuously satisfied (no options, no
			// circles) can't leak its back item before it's even identified. circleCount reuses
			// buildSnapshot's shared ○-marker regex so the two counts can't drift.
			const circleCount = (item.front.unlock?.description?.match(_UNLOCK_CIRCLE_RE) || []).length;
			const unlocked = identified.has(item.slug) && _isUnlocked(item, unlockCounts, arcanaBoxes, circleCount);
			const sideItem = (unlocked && item.back.item) ? item.back.item : item.front.item;
			// Skip unnamed sides, and skip a card's weightless side when the card is one of the
			// shipped places the book leaves untagged (CONCEPT_ARCANA_SLUGS). A weightless
			// curio ("A gold ring", "A wolf pelt") still renders — at ◇0 — since most arcana
			// curios ship with no explicit weight; only true places are held back.
			if (sideItem?.weight == null && CONCEPT_ARCANA_SLUGS.has(item.slug)) return [];
			// An IMMOBILE side is too big to carry on your person, and an IMPLANTED one carries
			// an item only so its card can print the book's tag line. Both say so in that tag
			// line, so both are read off it: there is nothing in your hands and nothing in your
			// load. Applied per side, so a place whose realised BACK item is real gear (the vein
			// of milky crystal's Moonstone) still surfaces that gear once unlocked.
			//
			// THROUGH THE SHARED PREDICATE, which is also what gives a card its Relic chip in the
			// browser: the two used to be written out separately and had already come apart, so a
			// GM could read "the arcanum itself is an item in your load" on a chip and find no
			// such row on the sheet. The unnamed-side check is folded into it.
			if (!isCarriedArcanumItem(sideItem)) return [];
			return [new OutfitItemBuilder()
				.withSlug(item.slug)
				.withName(sideItem.name)
				.withWeight(sideItem.weight ?? 0)
				.withNote(sideItem.note ?? null)
				.withInventoryColumn(sideItem.inventoryColumn ?? "arcana")
				.withResource(sideItem.resource ?? null)
				.withTwoCol(false)
				.withBreakBefore(false)
				.build()
			];
		});
	}
}
