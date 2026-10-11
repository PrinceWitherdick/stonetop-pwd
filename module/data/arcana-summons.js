import { slugify } from "../utils/strings.js";
import { boxIndexBefore } from "../utils/glyphs.js";
import { normalizeTags } from "./follower-build.js";

// Arcana that manifest creature(s) as followers — the arcana whose reverse says
// "Treat it/them as a follower" (Book II, The Things They Carried). Each entry's
// `followers` are buildCustomFollower() inputs; the character sheet's "Add as
// follower" button (templates/actor/partials/tab-arcana.hbs) turns them into custom
// follower cards via _onArcanaSummon. `sourceUuid` is a stable identity marker
// (`slug:creature`) so re-summoning never duplicates a card. Stat blocks are
// transcribed verbatim from each arcanum's reverse; OCR "(band)" damage tags are
// corrected to "(hand)". A summon whose card prints boxes to pick from (the beautiful
// scroll's tulpa) lists them as `choices`, and the button asks for them before it adds the
// card (ArcanaSummonDialog); one whose picks are prose (the rusty cauldron's chimera) ships a
// base card whose `notes` spell them out. The Ring of Daagon's Servants go further: they're
// rolled and shaped through the Call Up the Deep Ones dialog (see servant-of-daagon.js), so
// the Servant entry here is a `viaCallUp` marker the summon button skips (it adds only the
// Ring) rather than a card the button manifests directly.

export const ARCANA_SUMMONS = {
	"blackwood-fetishes": {
		followers: [
			{
				name:         "Astor",
				pronoun:      "they",
				typeLabel:    "bound spirit",
				portraitIcon: "fas fa-ghost",
				tags:         ["undead", "spirit", "hunter", "cunning", "jealous", "sarcastic", "warrior"],
				hp:           13,
				armor:        1,
				damage:       "ghostly spear d8 (reach, ignores armor)",
				instinct:     "to comply maliciously",
				moves:        "Stalk assigned prey\nManifest a ghostly presence (harmed only by silver or salt)\nMake a pessimistic observation",
				cost:         "proof of honor, nobility",
				notes:        "Armor 1 (lacks organs). Bound to obey your direct commands; can take no overt action against you, but Persuade them to do anything beyond your orders to the letter. Dismiss them and they return to their figurine; banished or reduced to 0 HP, both spirits return to their fetishes and can't be called forth again until the next new moon.",
				sourceUuid:   "blackwood-fetishes:astor",
			},
			{
				name:         "Halix",
				pronoun:      "they",
				typeLabel:    "bound spirit",
				portraitIcon: "fas fa-ghost",
				tags:         ["undead", "spirit", "magical", "hedonistic", "cautious", "devious", "stealthy", "exceptional"],
				hp:           10,
				armor:        1,
				damage:       "ghostly touch d4 (hand, ignores armor) or host's weapon d6",
				instinct:     "to second-guess your decisions",
				moves:        "Manifest a ghostly presence\nPossess an inebriated victim\nSpot a weakness, want, or fear\nSpin plots and falsehoods",
				cost:         "pleasures of the flesh",
				notes:        "Armor 1 (lacks organs). Bound to obey your direct commands; can take no overt action against you, but Persuade them to do anything beyond your orders to the letter. Dismiss them and they return to their figurine; banished or reduced to 0 HP, both spirits return to their fetishes and can't be called forth again until the next new moon.",
				sourceUuid:   "blackwood-fetishes:halix",
			},
		],
	},

	"beautiful-scroll": {
		followers: [
			{
				name:         "Tulpa",
				pronoun:      "it",
				typeLabel:    "tulpa",
				portraitIcon: "fas fa-hand-sparkles",
				tags:         ["spirit", "construct", "tiny", "naive"],
				hp:           8,
				armor:        0,
				damage:       "1d4 (if that)",
				// The one move printed without a box. The other four are picks (below).
				moves:        "Manifest a form of dust/snow/vapor",
				notes:        "Your hand-made familiar, named and described when you unlocked the scroll.",
				// "Pick 2 additional tags, an instinct, 2 additional moves, and its cost." Each
				// option is a □ on the card's reverse; `match` is the text printed after that box
				// when it differs from what the follower carries (see summonChoiceGroups).
				choices: [
					{ field: "tags",     label: "Tags",     pick: 2, options: ["eager", "fierce", "kind", "sly", "timid", "willful"] },
					{ field: "instinct", label: "Instinct", pick: 1, options: ["to play", "to learn", "to flaunt"] },
					{ field: "moves",    label: "Moves",    pick: 2, options: [
						{ value: "Produce light (area, reach)", match: "Produce light" },
						"Carry/manipulate a ◇ item",
						"Deliver a message",
						"Spy on someone/something",
					] },
					{ field: "cost",     label: "Cost",     pick: 1, options: ["respect given", "new experiences", "comfort/compassion"] },
				],
				askName:      true,
				// What the tulpa's notes said before its picks were asked for (see applySummonRepair).
				replacesNotes: ["Your hand-made familiar \u2014 name it, then pick its extras: 2 more tags (eager / fierce / kind / sly / timid / willful), an instinct (to play / to learn / to flaunt), 2 more moves of your own, and a cost (respect given / new experiences / comfort & compassion)."],
				sourceUuid:   "beautiful-scroll:tulpa",
			},
		],
	},

	"metal-man": {
		followers: [
			{
				name:         "Bronze Protector",
				pronoun:      "it",
				typeLabel:    "construct",
				portraitIcon: "fas fa-robot",
				tags:         ["construct", "spirit", "durable", "vigilant", "overbearing", "mute", "gullible"],
				hp:           13,
				armor:        3,
				damage:       "pummel 1d8 (hand)",
				instinct:     "to be overzealous in guarding you",
				moves:        "Loom menacingly, belching smoke\nStart fires, cause collateral damage\nRun low on fuel",
				cost:         "profuse gratitude",
				notes:        "Armor 3 (metal). Special qualities: fireproof; holds +1 Readiness on a 7+ to Defend; requires a smithy and tools to regain HP. The hearth spirit animates it only as long as fire burns in its stove-like chest.",
				sourceUuid:   "metal-man:bronze-protector",
			},
		],
	},

	"cloak-richly-embroidered": {
		followers: [
			{
				name:         "The Spirit in the Cloak",
				pronoun:      "it",
				typeLabel:    "spirit",
				portraitIcon: "fas fa-cloud",
				tags:         ["spirit", "magical", "proud", "mute"],
				hp:           13,
				armor:        1,
				damage:       "lashing wind, rain, debris d6 (near, area)",
				instinct:     "to \"not hear\" your commands",
				moves:        "Bear its master aloft on a cushion of swirling winds\nManifest a storm as it flies\nWreak havoc on its surroundings\nFling lightning from a raging storm, d10+3 (far, forceful, reload)",
				cost:         "flying about for hours",
				notes:        "Armor 1 (amorphous). It never wants to land; spend its Loyalty or Persuade it to do otherwise.",
				sourceUuid:   "cloak-richly-embroidered:storm-spirit",
			},
		],
	},

	"cracked-flute": {
		followers: [
			{
				name:         "The Andalau of the Flute",
				pronoun:      "it",
				typeLabel:    "spirit",
				portraitIcon: "fas fa-wind",
				tags:         ["spirit", "tiny", "stealthy", "mischievous"],
				hp:           8,
				armor:        0,
				damage:       "none",
				instinct:     "to play and frolic",
				moves:        "Manifest as a fluttering gust of wind (harmed only by salt)\nDeliver a whispery message\nFlit things about (dust, leaves, etc.)\nAnnoy or spook someone",
				cost:         "entertainment",
				loyalty:      1,
				notes:        "Tied to the cracked flute; holds 1 Loyalty to start. Dismiss it while it holds no Loyalty and the flute splits and falls apart, setting the andalau free.",
				sourceUuid:   "cracked-flute:andalau",
			},
		],
	},

	"demonhide-cloak": {
		followers: [
			{
				name:         "The Cloak",
				pronoun:      "it",
				typeLabel:    "cloak (follower)",
				portraitIcon: "fas fa-mask",
				tags:         ["bloodthirsty", "demon-wise", "extraordinary", "magical"],
				hp:           0,
				armor:        0,
				damage:       "none",
				instinct:     "to bicker and argue (with you, with itself)",
				moves:        "Reveal a dark and terrible secret, or part of one\nManifest a minor demonic effect\nPossess you in your sleep",
				cost:         "chaos and wanton destruction",
				notes:        "The Demonhide Cloak itself, now a follower. When you would mark a Consequence, you can spend 1 of the Cloak's Loyalty instead.",
				sourceUuid:   "demonhide-cloak:the-cloak",
			},
		],
	},

	"mindgem": {
		followers: [
			{
				name:         "The Mighty Servant",
				pronoun:      "it",
				typeLabel:    "construct",
				portraitIcon: "fas fa-mountain",
				tags:         ["large", "construct", "Maker-wise", "beautiful", "meek", "hardy", "slow", "strong", "exceptional"],
				hp:           24,
				armor:        4,
				damage:       "stone fists d10+1 (hand, close, disadvantage)",
				instinct:     "to misunderstand",
				moves:        "Perform a mighty feat of strength\nCarry on implacably",
				cost:         "wonder, excitement, joy, discovery",
				notes:        "Special qualities: living stone, tireless. When it makes a move at your behest and rolls a 6-, mark a Consequence — the Mindgem's reverse lists how it changes (new tags/moves, shifting damage, or developing a purpose of its own).",
				sourceUuid:   "mindgem:mighty-servant",
			},
		],
	},

	"oversized-crown": {
		followers: [
			{
				name:         "Void elemental",
				pronoun:      "it",
				typeLabel:    "elemental",
				portraitIcon: "fas fa-circle",
				tags:         ["spirit", "primordial", "confused", "angry"],
				hp:           15,
				armor:        1,
				damage:       "void touch 1d10 w/advantage (hand, grabby, ignores armor)",
				instinct:     "to rage at all the noise and chaos",
				moves:        "Manifest as a black hole in reality\nSnuff out a source of energy\nBecome confused, unsure what to do",
				cost:         "profuse gratitude",
				loyalty:      3,
				notes:        "Armor 1 (lacks organs). Special qualities: immune to most harm. Starts with 3 Loyalty and can never gain more. Speak the Words of Unbeing to send it back to the void—if it wants to go.",
				sourceUuid:   "oversized-crown:void-elemental",
			},
		],
	},

	"scroll-and-bone-flute": {
		followers: [
			{
				name:         "Dool spirit",
				pronoun:      "it",
				typeLabel:    "spirit",
				portraitIcon: "fas fa-skull",
				tags:         ["spirit", "terrifying", "stealthy", "devious"],
				hp:           13,
				armor:        1,
				damage:       "feast on fear d8 (close, hand, ignores armor, disadvantage)",
				instinct:     "to take things too far",
				moves:        "Sense a victim's doubt and worries\nShape sound and shadow to unnerve and frighten\nManifest as its victim's fears (harmed only by one who masters their fear)",
				cost:         "new, exquisite fears",
				notes:        "Armor 1 (amorphous). Special qualities: powerless in bright light. Only one dool spirit will serve you at a time.",
				sourceUuid:   "scroll-and-bone-flute:dool-spirit",
			},
		],
	},

	"stone-idol": {
		followers: [
			{
				name:         "All-mighty Thistlewik",
				pronoun:      "it",
				typeLabel:    "fae",
				portraitIcon: "fas fa-frog",
				tags:         ["fae", "tiny", "magical", "devious", "arrogant"],
				hp:           15,
				armor:        6,
				damage:       "none",
				instinct:     "to heap abuse on its worshippers",
				moves:        "Make unreasonable demands\nConsume the essence of foodstuffs\nSense one's idle thoughts/memories\nWeave powerful illusions and hallucinations (near, area)\nGrow bored/huffy and go to sleep",
				cost:         "obeisance and ever-larger offerings of food",
				notes:        "Armor 6 (stone, resilience), 2 vs. iron. Special qualities: inert; disembodied voice. It hardly considers itself a follower.",
				sourceUuid:   "stone-idol:thistlewik",
			},
		],
	},

	"tattered-mantle": {
		followers: [
			{
				name:         "Mantle wraiths",
				pronoun:      "they",
				typeLabel:    "wraith group",
				portraitIcon: "fas fa-ghost",
				tags:         ["group (3)", "spirit", "undead", "terrifying", "vicious"],
				hp:           13,
				armor:        1,
				damage:       "life drain d8 (hand, ignores armor)",
				instinct:     "to run rampant",
				moves:        "Whisper their longings to the weaver\nManifest a form of shadow and cold (harmed only by silver and salt)\nHurl themselves at the living\nSuck the vitality from their prey",
				cost:         "souls feasted upon",
				notes:        "Group of 3. Armor 1 (amorphous). Special qualities: powerless in daylight. They are loathe to return to the mantle; spend their Loyalty or Persuade them.",
				sourceUuid:   "tattered-mantle:mantle-wraiths",
			},
		],
	},

	"rusty-cauldron": {
		followers: [
			{
				name:         "Unliving chimera",
				pronoun:      "it",
				typeLabel:    "construct",
				portraitIcon: "fas fa-paw",
				tags:         ["undead", "construct", "terrifying", "clumsy"],
				hp:           3,
				armor:        4,
				damage:       "varies d6 (hand, maybe others)",
				instinct:     "to get confused and lash out",
				moves:        "Do something one of its component beasts could do\nMoan, wretchedly and disturbingly",
				cost:         "lots of fresh blood",
				notes:        "Armor 4 (0 vs. bronze). Add a tag for each beast whose bones you used (bear-like, owl-like, etc.). For each debility you marked when raising it (up to 3), pick 1: it is stable (else it falls apart in a day); it is not clumsy; replace its instinct with \"to shun light.\"",
				sourceUuid:   "rusty-cauldron:unliving-chimera",
			},
		],
	},

	"ring-of-daagon": {
		// The Ring becomes a follower only "when you make the last mark" (Book II p.560): its summon
		// waits on the card being unlocked (servant-of-daagon.js#summonUnlocked).
		untilUnlocked: true,
		followers: [
			{
				name:         "Ring of Daagon",
				pronoun:      "it",
				typeLabel:    "ring (follower)",
				portraitIcon: "fas fa-ring",
				tags:         ["deep-wise", "greedy", "patient", "knowledgeable", "magical"],
				hp:           0,
				armor:        0,
				damage:       "none",
				instinct:     "to give nothing (not even secrets or info) away",
				moves:        "Speak mind-to-mind\nReveal a secret, for a price\nKnow someone's desires",
				cost:         "devouring fallen, named creatures",
				notes:        "The Ring itself, now a follower. Servants of Daagon you Call Up share a pool of Loyalty with the Ring.",
				sourceUuid:   "ring-of-daagon:the-ring",
			},
			{
				name:         "Servant of Daagon",
				pronoun:      "it",
				typeLabel:    "deep one",
				portraitIcon: "fas fa-fish",
				tags:         ["terrifying", "violent", "wretched"],
				hp:           6,
				armor:        0,
				damage:       "d8",
				instinct:     "to devour",
				cost:         "shares the Ring's Loyalty",
				// You Call Up a fresh batch of Servants each time, so this card can be
				// added again and again — never deduped by sourceUuid (see _onArcanaSummon).
				repeatable:   true,
				// Not manifested by the plain "Add as follower" button (that adds only the
				// Ring). A Servant batch is rolled and shaped through the Call Up the Deep
				// Ones dialog on the Ring's follower card — the sheet filters this entry out
				// of the summon button and drives it via CallUpDeepOnesDialog instead.
				viaCallUp:    true,
				notes:        "Base 'group' build — adjust this card to your roll. Each Call Up, roll five d4s and assign each to one aspect:\n• Tags: 1 +craven; 2 +ravenous; 3 +cunning; 4 +exceptional (roll +2 for moves).\n• No. Appearing: 1 horde (2d6, HP 3, d6); 2-3 group (1d6+1, HP 6, d8); 4 solitary (HP 12, d10).\n• Size: 1 small (-2 HP, -2 damage, hand); 2-3 medium (close); 4 large (+4 HP, +1 damage, close, reach).\n• Traits (choose N = assigned die): blubbery/scaly hide (2 armor) / +stealthy & +cautious / powerful (+2 damage, forceful) / tentacles, pincers (reach, grabby) / big claws, fangs (1 piercing, messy) / projectiles (+near).\n• Moves (choose N = assigned die): Wriggle free of danger/restraint / Heal at a prodigious rate / Smother/constrict/engulf them / Dissolve organic material / Mesmerize the weak-willed / Paralyze them with venom.",
				sourceUuid:   "ring-of-daagon:servant-of-daagon",
			},
		],
	},
};

/** The summon definition for an arcanum slug, or null if it manifests no follower. */
export function arcanaSummon(slug) {
	return ARCANA_SUMMONS[slug] ?? null;
}

/** True if the arcanum manifests one or more followers. */
export function hasArcanaSummon(slug) {
	return !!ARCANA_SUMMONS[slug];
}

/**
 * Resolve the follower list for a resolved arcanum ({@link MinorArcanum}), homebrew first:
 * a card that authors its own followers in `flags.stonetop.summon.followers` uses those;
 * otherwise fall back to the shipped {@link ARCANA_SUMMONS} map by slug. Homebrew followers
 * get a derived, stable `sourceUuid` (`slug:name`) so re-summoning never duplicates a card.
 * Returns an array (possibly empty → no summon) or null when nothing manifests.
 */
export function arcanaSummonFollowers(arcanum) {
	const homebrew = arcanum?.summon?.followers;
	if (Array.isArray(homebrew) && homebrew.length) {
		return homebrew
			.filter(f => String(f?.name ?? "").trim())
			.map(f => ({
				...f,
				sourceUuid: f.sourceUuid || `${arcanum.slug}:${slugify(f.name) || "follower"}`,
			}));
	}
	return arcanaSummon(arcanum?.slug)?.followers ?? null;
}

// ── Picks a summon asks for ─────────────────────────────────────────────────────────────────
// A summon's `choices` are the boxes its card prints to pick from ("Pick 2 additional tags, an
// instinct, 2 additional moves, and its cost"). The player may already have ticked them reading
// the card, so the ask opens on those ticks, and what they settle on is written back to the card.

/** An option as `{ value, match }`: `value` is what the follower carries, `match` the text printed after its □. */
function _choiceOption(o) {
	if (typeof o === "string") return { value: o, match: o };
	const value = String(o?.value ?? "");
	return { value, match: String(o?.match ?? value) };
}

/**
 * One pick group as its entry prints it: how many it asks for (never fewer than 1), its options as
 * `_choiceOption` reads them, and `chosen`, the values of `picks[group.field]` among those options
 * in the card's printed order (whatever order they were picked in), cut to the pick.
 */
function _groupChoice(group, picks = {}) {
	const pick    = Math.max(1, Math.trunc(Number(group.pick) || 1));
	const options = (group.options ?? []).map(_choiceOption);
	const picked  = new Set(picks[group.field] ?? []);
	const chosen  = options.map(o => o.value).filter(v => picked.has(v)).slice(0, pick);
	return { pick, options, chosen };
}

/** True if a summoned follower asks for picks or a name before it is added. */
export function summonAsks(follower) {
	return !!(follower?.choices?.length || follower?.askName);
}

/**
 * A summon's pick groups, ready to ask: each option with the index of its □ on the card's
 * reverse (-1 when the card prints none for it) and whether that box is ticked. A group ticked
 * past its pick keeps its first ticks; the rest open clear.
 *
 * @param {object} follower  an ARCANA_SUMMONS follower entry
 * @param {{backDescription?: string, slug?: string, boxStates?: object}} [card]
 * @returns {{field: string, label: string, pick: number, options: {value: string, box: number, checked: boolean}[]}[]}
 */
export function summonChoiceGroups(follower, { backDescription = "", slug = "", boxStates = {} } = {}) {
	return (follower?.choices ?? []).map(group => {
		const { pick, options: printed } = _groupChoice(group);
		let ticked = 0;
		const options = printed.filter(o => o.value).map(o => {
			const box = boxIndexBefore(backDescription, o.match, { adjacent: true });
			const checked = box >= 0 && !!boxStates[`${slug}:back:${box}`] && ++ticked <= pick;
			return { value: o.value, box, checked };
		});
		return { field: group.field, label: group.label ?? group.field, pick, options };
	});
}

/**
 * The card's boxes once picks are made, as `{ [boxIndex]: checked }`: ticked for what was picked,
 * clear for the rest, so the card stays the record of the picks. Options with no box are skipped,
 * and so is a group with nothing picked: the follower keeps that group as it was
 * (applySummonRepair), so the card must too.
 */
export function summonPickTicks(groups, picks = {}) {
	const ticks = {};
	for (const group of groups ?? []) {
		const picked = new Set(picks[group.field] ?? []);
		if (!picked.size) continue;
		for (const option of group.options ?? []) if (option.box >= 0) ticks[option.box] = picked.has(option.value);
	}
	return ticks;
}

/**
 * The buildCustomFollower() input for a summon once its picks are made. Picked tags join the
 * printed ones, picked moves follow the printed ones, and a picked instinct or cost fills that
 * field. A group left short is named in the notes, so the card says what is still to pick.
 *
 * @param {object} follower  an ARCANA_SUMMONS follower entry
 * @param {Record<string, string[]>} picks  the values picked, by group `field`
 * @param {{name?: string}} [o]  a name for it, which replaces the printed one when given
 */
export function resolveSummonChoices(follower, picks = {}, { name } = {}) {
	const { choices, askName, ...base } = follower ?? {};
	const out = { ...base };
	const short = [];
	for (const group of choices ?? []) {
		const { pick, chosen } = _groupChoice(group, picks);
		if (chosen.length < pick) short.push(`${group.label ?? group.field} (${pick - chosen.length} more)`);
		if (!chosen.length) continue;
		if (group.field === "tags") out.tags = [...normalizeTags(base.tags), ...chosen];
		else if (group.field === "moves") out.moves = [base.moves, ...chosen].filter(Boolean).join("\n");
		else out[group.field] = chosen.join(", ");
	}
	if (short.length) out.notes = [base.notes, `Still to pick from the card: ${short.join(", ")}.`].filter(Boolean).join(" ");
	const named = String(name ?? "").trim();
	if (named) out.name = named;
	return out;
}

// ── Putting right a follower summoned before its picks were asked for ───────────────────────
// A tulpa added before the card's picks were asked for came with all five moves, no instinct and
// no cost, whatever the card had ticked. The sheet offers to put one right (summon-repair.js):
// it reads what the follower has now, asks the same picks a new summon asks, and rewrites only
// the parts those picks decide. `picksSettled` on the stored follower means it has been through
// the ask (a new summon, a repair, or the player keeping it as it is) and is never asked again.

const _SHORT_NOTE_RE = /\s*Still to pick from the card: [^.]*\./g;
const _lines = text => String(text ?? "").split("\n").map(s => s.trim()).filter(Boolean);
const _same = (a, b) => String(a ?? "").trim().toLowerCase() === String(b ?? "").trim().toLowerCase();

/** The shipped summon entry a stored follower was made from (by its sourceUuid), or null. */
export function summonEntryFor(follower) {
	const uuid = String(follower?.sourceUuid ?? "");
	if (!uuid.includes(":")) return null;
	return arcanaSummon(uuid.split(":")[0])?.followers.find(f => f.sourceUuid === uuid) ?? null;
}

/** Does the follower carry this option of a pick group now? */
function _carries(follower, field, value) {
	if (field === "tags")  return normalizeTags(follower?.tags).some(t => _same(t, value));
	if (field === "moves") return _lines(follower?.moves).some(l => _same(l, value));
	return String(follower?.[field] ?? "").split(",").some(v => _same(v, value));
}

/**
 * What is off about a stored follower against its summon's picks, and the picks to open the ask
 * on. Per group: `have` is how many of its options the follower carries. Exactly the pick is
 * right, and so is an instinct or cost the player wrote in themselves. More than the pick opens
 * with none ticked, since which to keep is the player's call; fewer opens on what it has plus
 * the card's own ticks.
 *
 * @param {object} follower  the stored follower (customFollowers.<id>)
 * @param {object} entry     its ARCANA_SUMMONS entry (summonEntryFor)
 * @param {object} [card]    as summonChoiceGroups takes it
 * @returns {{groups: object[], issues: {field: string, label: string, have: number, pick: number, kind: "over"|"short"}[]}}
 */
export function summonRepair(follower, entry, card = {}) {
	const issues = [];
	const groups = summonChoiceGroups(entry, card).map(group => {
		const carried = group.options.filter(o => _carries(follower, group.field, o.value));
		const have = carried.length;
		const written = (group.field === "instinct" || group.field === "cost") && !have
			&& String(follower?.[group.field] ?? "").trim() !== "";
		const issue = kind => issues.push({ field: group.field, label: group.label, have, pick: group.pick, kind });
		if (have > group.pick) {
			issue("over");
			return { ...group, over: true, options: group.options.map(o => ({ ...o, checked: false })) };
		}
		if (have === group.pick || written) {
			return { ...group, options: group.options.map(o => ({ ...o, checked: carried.includes(o) })) };
		}
		issue("short");
		let room = group.pick - have;
		return { ...group, options: group.options.map(o => {
			const checked = carried.includes(o) || (o.checked && room-- > 0);
			return { ...o, checked };
		}) };
	});
	return { groups, issues };
}

/** True if the stored follower came from a summon with picks, hasn't been through them, and is off. */
export function summonNeedsRepair(follower, card = {}) {
	if (!follower || follower.picksSettled || follower.dead) return false;
	const entry = summonEntryFor(follower);
	if (!entry?.choices?.length) return false;
	return summonRepair(follower, entry, card).issues.length > 0;
}

/**
 * The fields to write on a stored follower once its picks are made. Only what the picks decide
 * changes: tags and move lines the player added by hand stay where they are, the printed moves
 * stay first, and an instinct or cost the player wrote themselves stays unless a pick replaces
 * it. A group with nothing picked is left exactly as it is, so saving before choosing the moves
 * never strips them. The pre-picks notes are swapped for the entry's, and a "Still to pick" line
 * is dropped.
 *
 * `picksSettled` is set only when the result is complete, so a follower saved part-way is asked
 * again next session rather than never.
 */
export function applySummonRepair(stored, entry, picks = {}) {
	const out = {};
	for (const group of entry?.choices ?? []) {
		const { options, chosen } = _groupChoice(group, picks);
		const isOption = v => options.some(o => _same(o.value, v));
		if (!chosen.length) continue;
		if (group.field === "tags") {
			out.tags = normalizeTags([...normalizeTags(stored?.tags).filter(t => !isOption(t)), ...chosen]);
		} else if (group.field === "moves") {
			const printed = _lines(entry.moves);
			const lines   = _lines(stored?.moves).filter(l => !isOption(l));
			const head    = lines.filter(l => printed.some(p => _same(p, l)));
			out.moves = [...head, ...chosen, ...lines.filter(l => !head.includes(l))].join("\n");
		} else {
			out[group.field] = chosen.join(", ");
		}
	}
	let notes = String(stored?.notes ?? "");
	for (const old of entry?.replacesNotes ?? []) notes = notes.replace(old, entry.notes ?? "");
	out.notes = notes.replace(_SHORT_NOTE_RE, "").trim();
	out.picksSettled = summonPicksComplete({ ...stored, ...out }, entry);
	return out;
}

/** True if a follower carries every pick its summon's card gives it (summonRepair finds nothing off). */
export function summonPicksComplete(follower, entry) {
	return summonRepair(follower, entry).issues.length === 0;
}
