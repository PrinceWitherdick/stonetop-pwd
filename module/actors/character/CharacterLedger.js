import { BEAST_CATALOG } from "../../data/beasts.js";
import { stripHtmlToText } from "../../utils/strings.js";
import { categoryForCharacterPath } from "../../utils/ledger-categories.js";
import { crewAnonMemberLabel, crewIndividualLabel } from "../../utils/crew.js";
import { SYSTEM_ID } from "../../system-id.js";
import {
	LEDGER_SCOPE, isLedgerPath, normalizeFlagPath, getActorProperty,
	appendLedgerEntries, deleteLedgerEntries, getLedgerEntries,
	isBlank, truncateValue, formatValue, valuesEqual, actionForField, coalesceEntries,
	prettifySlug, listMerge, scalarEntry,
} from "../../utils/ledger-core.js";

const SYSTEM_PATH_LABELS = {
	"name": "Name",
	"system.playbook.name": "Playbook",
	"system.attributes.damage.value": "Damage value",
	"system.attributes.hp.value": "HP",
	"system.attributes.hp.max": "Max HP",
	// The lasting hand-set change on top of the derived max — an arcanum's soul-wound or a
	// Mark's boon. Labelled so it lands in the ledger like any other permanent change; without
	// a row here an unlabelled path is dropped, and the one write that OUGHT to be on the
	// record would be the one that isn't.
	"system.attributes.hp.adjustment": "Max HP (permanent)",
	"system.attributes.xp.value": "XP",
	"system.attributes.xp.max": "XP max",
	"system.attributes.level.value": "Level",
	"system.attributes.armor.value": "Armor",
	"system.attributes.forward.value": "Forward",
	"system.attributes.ongoing.value": "Ongoing",
	"system.stats.str.value": "STR",
	"system.stats.dex.value": "DEX",
	"system.stats.int.value": "INT",
	"system.stats.wis.value": "WIS",
	"system.stats.con.value": "CON",
	"system.stats.cha.value": "CHA",
	"system.attributes.debilities.options.weakened.value": "Weakened",
	"system.attributes.debilities.options.dazed.value": "Dazed",
	"system.attributes.debilities.options.miserable.value": "Miserable",
};

/**
 * Key a label table by flag path, given the paths WITHOUT the `flags.<scope>.` head.
 *
 * The head is stated once here instead of on every row. These tables are matched against paths
 * that `normalizeFlagPath` has already rewritten into LEDGER_SCOPE, so a row written in any other
 * scope simply never matches — `labelForPath` returns null and the change is dropped from the
 * ledger with nothing raised. Two of these tables were spelled out in the literal scope while the
 * prefix constants below them were built from LEDGER_SCOPE, so a rename would have moved half of
 * the file and quietly muted the other half.
 */
const byFlagPath = (rows) => Object.fromEntries(
	Object.entries(rows).map(([suffix, label]) => [`flags.${LEDGER_SCOPE}.${suffix}`, label]),
);

const FLAG_PATH_LABELS = byFlagPath({
	"background.selected": "Background",
	"instinct.selected": "Instinct",
	"origin.selected": "Origin",
	"inventory.regularPool": "Item slots ◇",
	"inventory.smallPool": "Small item slots □",
	"postDeathInsert.slug": "Post-death insert",
	"steadingId": "Linked steading",
});

const FLAG_NAMESPACE_LABELS = byFlagPath({
	"animalCompanion": "Animal companion",
	"appearance": "Appearance",
	"arcana": "Arcana",
	"background.choices": "Background choices",
	"crew": "Crew",
	"initiatesLoyalty": "Initiates loyalty",
	"initiateDetails": "Initiate details",
	"inventory.checked": "Inventory",
	"inventory.custom": "Custom inventory",
	"inventory.resources": "Inventory resource",
	"invocations": "Invocations",
	"lore": "Lore",
	"moves": "Move resource",
	"possessions": "Possessions",
	"postDeathInstinct": "Post-death instinct",
	"postDeathLore": "Post-death lore",
});

const SORTED_NAMESPACE_PREFIXES = Object.keys(FLAG_NAMESPACE_LABELS).sort((a, b) => b.length - a.length);
const INVENTORY_CHECKED_PREFIX = `flags.${LEDGER_SCOPE}.inventory.checked.`;
const INVENTORY_RESOURCE_PREFIX = `flags.${LEDGER_SCOPE}.inventory.resources.`;
// Move resource tracks (e.g. the Blessed's "Rites of the Land" Favor) live under the
// misnamed "backgroundChoices" sub-flag (see MoveResources), keyed by move name for
// shipped moves and by stable item id for player-authored custom moves.
const MOVE_RESOURCE_PREFIX = `flags.${LEDGER_SCOPE}.moves.backgroundChoices.`;
// Per-option advancement marks (e.g. Potential for Greatness): keyed
// "<moveName>.<optionSlug>", each an array of { stat, level } entries.
const MOVE_MARKS_PREFIX = `flags.${LEDGER_SCOPE}.moves.moveMarks.`;
const BACKGROUND_CHOICES_PREFIX = `flags.${LEDGER_SCOPE}.background.choices.`;
const INITIATES_LOYALTY_PREFIX = `flags.${LEDGER_SCOPE}.initiatesLoyalty.`;
const INITIATES_HP_PREFIX = `flags.${LEDGER_SCOPE}.initiatesHp.`;
const INITIATES_READINESS_PREFIX = `flags.${LEDGER_SCOPE}.initiatesReadiness.`;
const ANIMAL_COMPANION_PREFIX = `flags.${LEDGER_SCOPE}.animalCompanion.`;
const CREW_PREFIX = `flags.${LEDGER_SCOPE}.crew.`;
// Custom followers (walkthrough / monster conversion / arcana summon) keep their
// Loyalty, current HP and Readiness inside one per-id record; beast/livestock
// followers track theirs per catalog slug. Neither had ledger coverage, so a
// Strengthen Your Bond or an HP change on them went unrecorded — these prefixes
// (and the entry builders below) close that gap.
const CUSTOM_FOLLOWERS_PREFIX = `flags.${LEDGER_SCOPE}.customFollowers.`;
const BEAST_LOYALTY_PREFIX = `flags.${LEDGER_SCOPE}.beastLoyalty.`;
const BEAST_HP_PREFIX = `flags.${LEDGER_SCOPE}.beastHp.`;
const BEAST_READINESS_PREFIX = `flags.${LEDGER_SCOPE}.beastReadiness.`;
const POSSESSION_USES_PREFIX = `flags.${LEDGER_SCOPE}.possessions.uses.`;
const POSSESSION_SUBCHOICES_PREFIX = `flags.${LEDGER_SCOPE}.possessions.subChoices.`;
const POSSESSION_CHOICE_USES_PREFIX = `flags.${LEDGER_SCOPE}.possessions.choiceUses.`;
// The ◇ load mark on a gear bundle's chosen option (a Heavy's Weapons of war), which is
// separate from choosing it — same "selected / deselected" reading as an inventory mark.
const POSSESSION_CHOICE_CARRIED_PREFIX = `flags.${LEDGER_SCOPE}.possessions.choiceCarried.`;
const POSSESSION_SELECTED_PATH = `flags.${LEDGER_SCOPE}.possessions.selected`;
const POSSESSION_CUSTOM_PATH = `flags.${LEDGER_SCOPE}.possessions.custom`;

// Wounds (the 4th harm track) live as an array on this path; flattenObject leaves an array
// as a single leaf, so the whole list arrives at the granular handler as one old/new pair.
const WOUNDS_PATH = "system.attributes.wounds";
// Arcana marks all live under the arcana namespace keyed by arcanum slug: the ◇/○/□ track
// boxes (booleans, "<slug>:<context>:<index>"), the front unlock requirements, and the back
// power options (both counts, "<slug>:<optionSlug>"). Resolve the slug to the card's tier +
// title so a tick reads "Minor Arcana The Key: … master your fear selected" not "Arcana …".
const ARCANA_BOXES_PREFIX = `flags.${LEDGER_SCOPE}.arcana.boxes.`;
const ARCANA_UNLOCK_PREFIX = `flags.${LEDGER_SCOPE}.arcana.unlock.`;
const ARCANA_BACK_OPTIONS_PREFIX = `flags.${LEDGER_SCOPE}.arcana.backOptions.`;
// The remaining arcana sub-flags are slug arrays / slug scalars. They all used to fall through
// to the "Arcana" namespace label and render as raw slug lists — and because `owned` and
// `identified` hold the same slugs, adding one card produced two byte-identical "Arcana changed
// from a, b to a, b, c" entries from two separate updates, which read as a duplicate bug.
const ARCANA_PREFIX = `flags.${LEDGER_SCOPE}.arcana.`;
const ARCANA_SLUG_LISTS = {
	owned:      { added: "Arcanum gained",     removed: "Arcanum lost",              merge: "Arcana gained" },
	identified: { added: "Arcanum identified", removed: "Arcanum un-identified",     merge: "Arcana identified" },
	leads:      { added: "Arcanum lead found", removed: "Arcanum lead resolved",     merge: "Arcana leads" },
	revealed:   { added: "Arcanum revealed",   removed: "Arcanum hidden again",      merge: "Arcana revealed" },
	// A 7-9 on the Know Things roll to identify a card (Book I p.440) hands over the front and
	// promises the back later; the debt is settled when the GM reveals it.
	backOwed:   { added: "Arcanum back owed",  removed: "Arcanum back delivered",    merge: "Arcana backs owed" },
};
// Bookkeeping sub-flags with no play meaning of their own — a backfill guard, the onboarding
// draw, per-card display state. They were logging lines like "Arcana set to on".
const ARCANA_SILENT_KEYS = new Set(["leadBackfilled", "minorDraw", "majorMarksFor", "flipped", "seeBothSides"]);

// Lore: `lore.counts.<loreSlug>:<optionSlug>` (a tick count) and `lore.texts.<loreSlug>:<optionSlug>`
// (the written answer). Both were falling through to the "Lore" namespace label, so a ticked box
// read "Lore set to 1" and a written answer dumped its whole paragraph into the action string.
const LORE_COUNTS_PREFIX = `flags.${LEDGER_SCOPE}.lore.counts.`;
const LORE_TEXTS_PREFIX  = `flags.${LEDGER_SCOPE}.lore.texts.`;
// Appearance lines are stored by index (`appearance.selected.<n>`) and the playbook data gives
// them no category names, so entries name the chosen trait and merge into one line per burst.
const APPEARANCE_PREFIX  = `flags.${LEDGER_SCOPE}.appearance.selected.`;
const INITIATE_DETAILS_PREFIX = `flags.${LEDGER_SCOPE}.initiateDetails.`;
const INVOCATIONS_PATH = `flags.${LEDGER_SCOPE}.invocations.selected`;
// Written fill-in answers on a background's moves ("Well Versed in ___, the Things Below").
// These were reading as "Move resource set to …" — the `moves` namespace fallback label.
const BACKGROUND_ANSWERS_PREFIX = `flags.${LEDGER_SCOPE}.moves.backgroundAnswers.`;
// Pure sheet state: which level-overage warning the player dismissed. Never a ledger event.
const MOVES_SILENT_PATH = `flags.${LEDGER_SCOPE}.moves.dismissedLevelOverage`;
const BACKGROUND_SELECTED_PATH = `flags.${LEDGER_SCOPE}.background.selected`;
// The roll-mode selector stores the slug the dice formula is built from, so the generic scalar
// formatter wrote the slug itself: "Roll mode set to dis". Spell the mode out. An absent flag
// is Normal (see normalizeRollMode), so a first pick is still a real change.
const ROLL_MODE_PATH = `flags.${LEDGER_SCOPE}.rollMode`;
const ROLL_MODE_NAMES = { adv: "Advantage", normal: "Normal", dis: "Disadvantage" };

// Numeric/scalar sheet fields whose repeated nudges collapse into one entry (see mergeRuns):
// clicking XP up three times, or walking a new character from level 1 to level 34.
// Debilities are booleans; "Dazed changed from off to on" reads as a data dump rather than
// something that happened at the table. Labels come from SYSTEM_PATH_LABELS, which already
// names all three.
const DEBILITY_PATHS = new Set([
	"system.attributes.debilities.options.weakened.value",
	"system.attributes.debilities.options.dazed.value",
	"system.attributes.debilities.options.miserable.value",
]);

function labelForPath(path) {
	if (SYSTEM_PATH_LABELS[path]) return SYSTEM_PATH_LABELS[path];
	if (FLAG_PATH_LABELS[path]) return FLAG_PATH_LABELS[path];
	const namespace = SORTED_NAMESPACE_PREFIXES.find(prefix => path === prefix || path.startsWith(`${prefix}.`));
	if (namespace) return FLAG_NAMESPACE_LABELS[namespace];
	return null;
}


// The ledger wants null (not "") for an empty value so a rich-text clear reads as a removal;
// otherwise it's the shared strip-HTML helper.
function stripHtml(value) {
	return stripHtmlToText(value) || null;
}

function firstLabelPart(value) {
	return (stripHtml(value) ?? "").split(",")[0]?.trim() || null;
}

// Cap a long detail phrase (e.g. an arcanum's unlock-requirement sentence, which can run
// 250+ chars) to a readable ledger length, cutting on a word boundary when one is near.
// Shorter than VALUE_MAX_CHARS: a detail is one clause inside a longer action string.
function truncateDetail(text) {
	return truncateValue(text, 64);
}

function getPlaybookFlags(actor, snapshot) {
	const snapshotPlaybook = snapshot?.playbook;
	if (snapshotPlaybook?.backgrounds || snapshotPlaybook?.crew || snapshotPlaybook?.animalCompanion) return snapshotPlaybook;

	const playbookItem = [...(actor.items ?? [])].find(item => item?.type === "playbook");
	return playbookItem?.flags?.stonetop ?? playbookItem?.flags?.[LEDGER_SCOPE] ?? null;
}

function addPossessionChoiceNames(names, possession) {
	const add = choice => {
		if (!choice?.slug) return;
		names.possessionChoices.set(`${possession.slug}:${choice.slug}`, stripHtml(choice.label) ?? prettifySlug(choice.slug));
	};
	for (const choice of possession.choices?.options ?? []) add(choice);
	for (const group of possession.choiceGroups ?? []) {
		// A choice group either lists its options directly or splits them across `subgroups`
		// (the Sacred pouch's "choose 1 on each line"). Only the direct form was being read, so
		// every subgroup-shaped choice missed the lookup and fell back to its prettified slug —
		// "Sacred pouch: Sacred Pouch Origin Heirloom selected".
		for (const choice of group.options ?? []) add(choice);
		for (const subgroup of group.subgroups ?? []) {
			for (const choice of subgroup.options ?? []) add(choice);
		}
	}
}

async function buildNameLookup(actor) {
	const names = {
		inventory: new Map(),
		inventoryResourceTitles: new Map(),
		arcana: new Map(),
		possessions: new Map(),
		possessionChoices: new Map(),
		backgroundChoices: new Map(),
		backgrounds: new Map(),
		lore: new Map(),
		loreOptions: new Map(),
		invocations: new Map(),
		moveResourceTitles: new Map(),
		moveResourceNames: new Map(),
		moveMarkOptions: new Map(),
		followers: new Map(),
		crewIndividuals: new Map(),
		crewNamedCount: 0,
		followerFields: new Map([
			["cost", "cost"],
			["hpCurrent", "HP"],
			["instinct", "instinct"],
			["kind", "kind"],
			["loyalty", "loyalty"],
			["name", "name"],
			["readiness", "Readiness"],
			["supplies", "supplies"],
			["tag", "tag"],
			["tags", "tags"],
			["traits", "traits"],
			["type", "type"],
		]),
	};

	const addBackgroundChoice = choice => {
		if (choice?.slug) names.backgroundChoices.set(choice.slug, stripHtml(choice.label) ?? prettifySlug(choice.slug));
	};

	const addFollower = (key, label) => {
		const name = firstLabelPart(label);
		if (name) names.followers.set(key, name);
	};

	for (const item of actor.items ?? []) {
		if (item?._id && item.name) names.inventory.set(item._id, item.name);
		// Custom moves persist their resource track by item id; map that id back to the
		// move's name/title so a ledger tick reads "<Move> - <Title>", not a raw id.
		if (item?.type === "move" && item.flags?.[SYSTEM_ID]?.custom && item._id) {
			names.moveResourceNames.set(item._id, stripHtml(item.name) ?? item.name);
			if (item.system?.resource?.title) names.moveResourceTitles.set(item._id, stripHtml(item.system.resource.title));
		}
	}

	try {
		const snapshot = await actor.typedActor?.buildSnapshot?.();
		const playbookFlags = getPlaybookFlags(actor, snapshot);
		const outfit = snapshot?.inventory?.outfit;
		for (const item of [
			...(outfit?.regularItems ?? []),
			...(outfit?.smallItems ?? []),
			...(outfit?.smallGridItems ?? []),
			...(outfit?.arcanaRegular ?? []),
			...(outfit?.arcanaSmall ?? []),
			...(outfit?.treasureRegular ?? []),
			...(outfit?.treasureSmall ?? []),
		]) {
			if (!item?.slug) continue;
			names.inventory.set(item.slug, stripHtml(item.name) ?? prettifySlug(item.slug));
			// Titled resource tracks (e.g. an arcanum's "Souls") name the track in the
			// ledger; untitled tracks (e.g. "Bow & arrows" ammo) just say "resource".
			if (item.resource?.title) names.inventoryResourceTitles.set(item.slug, stripHtml(item.resource.title));
		}
		for (const item of snapshot?.inventory?.other ?? []) {
			if (item?.ownedId) names.inventory.set(item.ownedId, stripHtml(item.name) ?? prettifySlug(item.ownedId));
		}
		// Owned arcana → tier-prefixed card name ("Minor Arcana The Key") plus its front
		// unlock-requirement and back-power option labels, so a marked box or a selected
		// requirement names the specific card and choice in the ledger.
		for (const section of [snapshot?.arcana?.minor, snapshot?.arcana?.major]) {
			for (const item of section?.items ?? []) {
				if (!item?.slug) continue;
				const tier = item.major ? "Major Arcana" : "Minor Arcana";
				const title = stripHtml(item.front?.title) ?? prettifySlug(item.slug);
				const unlockOptions = new Map();
				for (const req of item.front?.unlock?.requirements ?? []) {
					if (req?.type === "option" && req.slug) unlockOptions.set(req.slug, truncateDetail(stripHtml(req.description) ?? prettifySlug(req.slug)));
				}
				const backOptions = new Map();
				for (const opt of item.back?.options ?? []) {
					if (opt?.slug) backOptions.set(opt.slug, truncateDetail(stripHtml(opt.description) ?? prettifySlug(opt.slug)));
				}
				names.arcana.set(item.slug, { subject: `${tier} ${title}`, unlockOptions, backOptions });
			}
		}
		for (const possession of snapshot?.inventory?.possessions?.items ?? []) {
			if (!possession?.slug) continue;
			names.possessions.set(possession.slug, stripHtml(possession.label) ?? prettifySlug(possession.slug));
			addPossessionChoiceNames(names, possession);
		}
		for (const background of playbookFlags?.backgrounds ?? []) {
			if (background.slug) names.backgrounds.set(background.slug, stripHtml(background.label) ?? prettifySlug(background.slug));
			for (const choice of background.choices?.options ?? []) {
				addBackgroundChoice(choice);
				if (background.slug === "initiate") addFollower(`initiate:${choice.slug}`, choice.label);
			}
		}
		// Lore questions ("The Earth Mother") and their answer options, so a ticked box names the
		// question it belongs to instead of reading "Lore set to 1".
		for (const lore of playbookFlags?.lore ?? []) {
			if (!lore?.slug) continue;
			names.lore.set(lore.slug, stripHtml(lore.title) ?? prettifySlug(lore.slug));
			for (const option of lore.options ?? []) {
				if (option?.slug) names.loreOptions.set(`${lore.slug}:${option.slug}`, truncateDetail(stripHtml(option.description) ?? prettifySlug(option.slug)));
			}
		}
		// Invocations are stored as a slug array; the playbook holds their authored names.
		// The field is an array on some playbooks and {options:[…]} on others.
		const invocations = playbookFlags?.invocations;
		for (const option of (Array.isArray(invocations) ? invocations : invocations?.options) ?? []) {
			if (option?.slug) names.invocations.set(option.slug, stripHtml(option.label) ?? prettifySlug(option.slug));
		}
		for (const category of snapshot?.moves ?? []) {
			for (const move of category?.moves ?? []) {
				if (!move?.name) continue;
				if (move.resource?.title) names.moveResourceTitles.set(move.name, stripHtml(move.resource.title));
				for (const opt of move.markOptions ?? []) {
					if (opt?.slug) names.moveMarkOptions.set(`${move.name}:${opt.slug}`, { label: stripHtml(opt.label) ?? prettifySlug(opt.slug), choice: opt.choice ?? null });
				}
			}
		}
		for (const follower of snapshot?.followers?.initiates ?? []) {
			addFollower(`initiate:${follower.slug}`, follower.label);
		}
		const companionName = getActorProperty(actor, `flags.${LEDGER_SCOPE}.animalCompanion.name`);
		if (companionName) names.followers.set("animalCompanion", companionName);
		const companionKind = getActorProperty(actor, `flags.${LEDGER_SCOPE}.animalCompanion.kind`);
		if (!names.followers.has("animalCompanion") && companionKind) names.followers.set("animalCompanion", companionKind);
		const companionType = getActorProperty(actor, `flags.${LEDGER_SCOPE}.animalCompanion.type`);
		const companionTypeLabel = (playbookFlags?.animalCompanion?.types ?? []).find(type => type.slug === companionType)?.label;
		if (!names.followers.has("animalCompanion")) addFollower("animalCompanion", companionTypeLabel ?? "Animal companion");
		const crewName = getActorProperty(actor, `flags.${LEDGER_SCOPE}.crew.name`);
		addFollower("crew", crewName || "Crew");
		const crewIndividuals = getActorProperty(actor, `flags.${LEDGER_SCOPE}.crew.individuals`) ?? [];
		for (const [index, individual] of Object.entries(crewIndividuals)) {
			if (individual?.name) names.crewIndividuals.set(String(index), individual.name);
		}
		// How many of the crew are named, so an ANONYMOUS member can be labelled the way the sheet
		// labels them — "Crew member 4" counts from the end of the named ones. Taken from the array
		// length rather than from the map above, which drops a row with no name yet.
		names.crewNamedCount = Array.isArray(crewIndividuals) ? crewIndividuals.length : 0;
		// Custom followers (walkthrough / monster conversion / arcana summon): name from
		// the stored record so a Loyalty/HP change reads "<Name> loyalty changed…".
		for (const [id, data] of Object.entries(getActorProperty(actor, `flags.${LEDGER_SCOPE}.customFollowers`) ?? {})) {
			addFollower(`custom:${id}`, data?.name || "A follower");
		}
		// Beast / livestock followers: name comes from the catalog by owned slug.
		for (const slug of getActorProperty(actor, `flags.${LEDGER_SCOPE}.inventory.addedSpecial`) ?? []) {
			const beastName = BEAST_CATALOG[slug]?.name;
			if (beastName) names.followers.set(`beast:${slug}`, beastName);
		}
	} catch (err) {
		console.warn("Stonetop | Could not build ledger name lookup", err);
	}

	return names;
}

function nameFrom(map, slug) {
	return map.get(slug) ?? prettifySlug(slug);
}

function inventorySelectionEntry(path, oldValue, newValue, names) {
	const slug = path.slice(INVENTORY_CHECKED_PREFIX.length);
	const itemName = nameFrom(names.inventory, slug);
	if (!!oldValue === !!newValue) return null;
	return { action: `${itemName} ${newValue ? "selected" : "deselected"}` };
}

// "<Name> - <Title>" for a titled track (an arcanum's "Souls", the Blessed's
// "Favor"), else "<Name> resource". Shared by inventory- and move-resource tracks.
function resourceEntry(name, title, oldValue, newValue) {
	const label = title ? `${name} - ${title}` : `${name} resource`;
	return { action: actionForField(label, oldValue, newValue) };
}

function inventoryResourceEntry(path, oldValue, newValue, names) {
	const slug = path.slice(INVENTORY_RESOURCE_PREFIX.length);
	return resourceEntry(nameFrom(names.inventory, slug), names.inventoryResourceTitles.get(slug), oldValue, newValue);
}

function moveResourceEntry(path, oldValue, newValue, names) {
	const key = path.slice(MOVE_RESOURCE_PREFIX.length);
	// Custom moves key by item id; resolve it back to the move name for the subject.
	const subject = names.moveResourceNames.get(key) ?? key;
	return resourceEntry(subject, names.moveResourceTitles.get(key), oldValue, newValue);
}

function moveMarkEntries(path, oldValue, newValue, names) {
	const key        = path.slice(MOVE_MARKS_PREFIX.length);
	const dot        = key.lastIndexOf(".");
	const moveName   = dot >= 0 ? key.slice(0, dot) : key;
	const optionSlug = dot >= 0 ? key.slice(dot + 1) : key;
	const option     = names.moveMarkOptions.get(`${moveName}:${optionSlug}`);
	const subject    = `${moveName} - ${option?.label ?? prettifySlug(optionSlug)}`;
	const oldEntries = Array.isArray(oldValue) ? oldValue : [];
	const newEntries = Array.isArray(newValue) ? newValue : [];

	// Stat-choice marks (Potential for Greatness): each slot picks a stat. Report
	// every slot whose chosen stat changed. The +1/-1 to the stat itself rides the
	// same update and is logged separately, so this just attributes it to the move.
	if (option?.choice === "stat") {
		const slots = Math.max(oldEntries.length, newEntries.length);
		const entries = [];
		for (let i = 0; i < slots; i++) {
			const oldStat = oldEntries[i]?.stat ?? "";
			const newStat = newEntries[i]?.stat ?? "";
			if (oldStat === newStat) continue;
			if (oldStat) entries.push({ action: `${subject}: ${oldStat.toUpperCase()} unmarked` });
			if (newStat) entries.push({ action: `${subject}: ${newStat.toUpperCase()} marked` });
		}
		return entries;
	}

	// Count-style marks (a checkbox track): report the net direction of the change.
	if (oldEntries.length === newEntries.length) return [];
	return [{ action: `${subject} ${newEntries.length > oldEntries.length ? "marked" : "unmarked"}` }];
}

function backgroundChoiceEntry(path, oldValue, newValue, names) {
	const slug = path.slice(BACKGROUND_CHOICES_PREFIX.length);
	const choiceName = nameFrom(names.backgroundChoices, slug);
	if (!!oldValue === !!newValue) return null;
	return { action: `${choiceName} ${newValue ? "selected" : "deselected"}` };
}

function followerFieldEntry(followerName, field, oldValue, newValue) {
	const label = field ? `${followerName} ${field}` : followerName;
	return { action: actionForField(label, oldValue, newValue) };
}

/**
 * The hand-edited fields every follower keeps under its own `details` namespace (_FOLLOWER_FLAGS
 * in StonetopCharacterSheet.js). Every entry builder that meets one used to reach them through
 * `key.split(".")[0]`, which collapses all of them to the literal "details" — a field name no
 * label map knows — so a Moves edit, a Notes edit and an Armor override all came out as the
 * follower's bare name with no indication of what had moved.
 *
 * `gear` is absent on purpose: it is an ARRAY OF OBJECTS (the ◇ checklist), so the generic
 * formatter renders it "[object Object]" whatever it is labelled. It is handled below.
 */
const FOLLOWER_DETAIL_LABELS = new Map([
	["moves",       "moves"],
	["notes",       "notes"],
	["hpMax",       "max HP"],
	["armor",       "armor"],
	["armorSource", "armor source"],
	["damage",      "damage"],
	["instinct",    "instinct"],
	["cost",        "cost"],
	["exceptional", "exceptional"],
	["usesAmmo",    "uses ammo"],
]);

/**
 * One follower's `details.<field>` write, named. `gear` is a free-text ◇ checklist rewritten whole
 * on every tick, rename or addition — there is no honest one-line diff of an array of
 * `{label, checked}` objects, and it was printing "[object Object]" into the Chronicle — so it is
 * reported as a fact rather than as a value, and an unknown field stays quiet rather than guessing.
 */
function followerDetailEntries(followerName, field, oldValue, newValue) {
	if (field === "gear") return [{ action: `${followerName} gear updated` }];
	const label = FOLLOWER_DETAIL_LABELS.get(field);
	return label ? [followerFieldEntry(followerName, label, oldValue, newValue)] : [];
}

function animalCompanionEntry(path, oldValue, newValue, names) {
	const key = path.slice(ANIMAL_COMPANION_PREFIX.length);
	const followerName = names.followers.get("animalCompanion") ?? "Animal companion";
	if (key.split(".").some(segment => segment.startsWith("-="))) return [];
	if (key.startsWith("details.")) return followerDetailEntries(followerName, key.slice("details.".length), oldValue, newValue);
	return [followerFieldEntry(followerName, names.followerFields.get(key.split(".")[0]), oldValue, newValue)];
}

// ── The crew's roster, as ledger lines ──────────────────────────────────────────────────────
//
// The crew keeps three of its four roster stores in flag ARRAYS, written back WHOLE because a
// flag array cannot be updated by dotted path (see actors/character/roster-portraits.js). That is
// what the rules below are for: a whole-array write reaches the ledger as one leaf holding the
// entire roster, and the generic field formatter has nothing useful to say about it. Left alone,
// `formatValue` joins the array with ", ", so an array of OBJECTS came out as the literal
// "[object Object]" — one such line in the player's Chronicle for every portrait pick, every
// "Use default", and every member added or removed.
//
// So each store is read for what actually changed, and the cosmetic ones say nothing at all.

/** Crew-only field names the shared `followerFields` map has no entry for. */
const CREW_FIELD_LABELS = new Map([
	["size",    "roster size"],
	["groupHp", "group HP"],
	["ammo",    "ammo"],
]);

// Cosmetic crew writes: a face and the rect that crops it, on the crew CARD (`details`) and on the
// anonymous members' roster slots. A portrait is not an act of play and has no business in a
// ledger — and each of these rendered as junk besides ("[object Object]" for the roster slots, a
// raw file path or a bare "0.1, 0.2, 0.3, 0.4" for the card's).
//
// The custom group follower's equivalent needs no entry here: customFollowerEntry below works off
// an ALLOWLIST, so it is already silent. It has a test of its own so that stays true if the
// allowlist ever grows.
// The anonymous members' faces. Needs naming here, where the two `.img`-shaped stores do not
// (isBookkeepingPath covers those): this is an ARRAY of portrait slots, which flattenObject
// leaves as ONE atomic leaf, so the path never mentions `img` at all — it rendered as the literal
// "[object Object]".
const isUnloggedCrewKey = (key) => key === "memberPortrait";

/**
 * How many of the crew are named, AS THIS UPDATE LEAVES THEM — which is what the anonymous tail
 * is numbered from.
 *
 * `names` is built from the PRE-update actor, so on an update that rewrites `crew.individuals`
 * and touches member HP in the same breath it is already stale: naming a member grows the named
 * block and shrinks the anonymous tail in one `actor.update`, and removing one does the reverse.
 * Numbering the survivors against the roster they have just left is off by one against what the
 * sheet draws a moment later. The update's own value wins wherever it carries one.
 */
function crewNamedCount(names, ctx) {
	const written = ctx?.newValues?.get(`${CREW_PREFIX}individuals`);
	return Array.isArray(written) ? written.length : names.crewNamedCount;
}

/**
 * Who joined and who left, from the whole-array write behind naming or removing a member.
 *
 * Matched by NAME rather than by position: the array is spliced, so every index above the change
 * shifts and a positional diff would report the whole tail as replaced. A portrait pick rewrites
 * this same array with the membership untouched, which is exactly why this yields nothing then.
 */
function crewMembershipEntries(oldValue, newValue, crewName) {
	const tally = (value) => (Array.isArray(value) ? value : []).reduce((counts, row) => {
		const name = String(row?.name ?? "").trim();
		if (name) counts.set(name, (counts.get(name) ?? 0) + 1);
		return counts;
	}, new Map());
	const before = tally(oldValue);
	const after  = tally(newValue);

	// A MULTISET diff, not a set one. The crew's names come from a nine-name pick list on a roster
	// that is a half-dozen strong by default, so two members called Aled is a keystroke away — and
	// with plain sets, removing one of them changed no set and the Chronicle recorded that nobody
	// had left. Repeats are numbered in the text so coalesceEntries (which dedupes on the action
	// string) cannot fold two genuinely separate departures into one line.
	const entries = [];
	for (const name of new Set([...before.keys(), ...after.keys()])) {
		const delta = (after.get(name) ?? 0) - (before.get(name) ?? 0);
		const verb  = delta > 0 ? `named to ${crewName}` : `removed from ${crewName}`;
		for (let i = 0; i < Math.abs(delta); i++) {
			const ordinal = Math.abs(delta) > 1 ? ` (${i + 1} of ${Math.abs(delta)})` : "";
			entries.push({ action: `${name}${ordinal} ${verb}` });
		}
	}
	return entries;
}

/**
 * Per-member HP out of the anonymous members' whole-array write, so a hit reads as "Crew member 3
 * HP changed from 6 to 4" rather than as two lists of numbers to spot the difference between.
 *
 * A SHRINKING array is a resize or a promotion, not damage: the indices no longer line up, so a
 * positional diff would invent hits nobody took. The `crew.size` write, or the membership line
 * above, is what records those. Growth is normal — the HP writer sizes the array to the member it
 * is writing — so it is diffed against the missing slots.
 */
function crewMemberHpEntries(oldValue, newValue, namedCount) {
	const before = Array.isArray(oldValue) ? oldValue : [];
	const after  = Array.isArray(newValue) ? newValue : [];
	if (after.length < before.length) return [];
	return after
		.map((value, index) => (value === before[index]
			? null
			: { action: actionForField(`${crewAnonMemberLabel(namedCount, index)} HP`, before[index], value) }))
		.filter(Boolean);
}

/**
 * A roster resize is recognised HERE, from `ctx.paths`, rather than being handed down as a
 * crew-shaped flag: when the SAME update also rewrites `crew.individuals`, the delete handler has
 * RE-KEYED `individualsHp` to stay aligned with the spliced array. Read per key, those re-keyed
 * writes look like every survivor above the gap taking the damage of the member below them, under
 * the wrong name. The membership line already says what happened, so the HP noise beside it is
 * dropped rather than reported wrongly.
 */
function crewEntries(path, oldValue, newValue, names, ctx = {}) {
	const key = path.slice(CREW_PREFIX.length);
	const crewName = names.followers.get("crew") ?? "Crew";

	// A DELETION rather than a value. Older cores send `-=<key>` with null; v14+ sends a
	// ForcedDeletion instance at the plain path (utils/foundry-compat.js#deletionEntry), which the
	// individualsHp guard below catches by way of ctx. Neither is anything to read out to a player:
	// they rendered as "set to blank" and "changed to changed" respectively.
	//
	// Matched as a SEGMENT, not after a dot: `unsetFlag("stonetop-pwd", "crew.groupHp")` deletes at
	// the crew's own root, so the key is a bare `-=groupHp` with no dot in front of it. That is the
	// crew's "Restore the group to full HP" button, and a dotted-only test let it through.
	if (key.split(".").some(segment => segment.startsWith("-="))) return [];

	if (isUnloggedCrewKey(key)) return [];

	// One named individual's own field: individuals.<i>.<field>. A row with no name yet falls back
	// to crewIndividualLabel, NOT to the anonymous labeller: this row is INSIDE the named block, so
	// it numbers from the top of the roster the way the sheet draws it, where the anonymous tail
	// counts on from the end of that block (see utils/crew.js — the two labellers differ on
	// purpose). Labelling it "Crew member 4" put a ledger line against a row the sheet calls
	// "Crew member 1".
	if (key.startsWith("individuals.")) {
		const [, index, field] = key.split(".");
		const memberName = names.crewIndividuals.get(index) ?? crewIndividualLabel(index);
		return [followerFieldEntry(memberName, names.followerFields.get(field), oldValue, newValue)];
	}
	if (key === "individuals")     return crewMembershipEntries(oldValue, newValue, crewName);
	if (key === "memberHp")        return crewMemberHpEntries(oldValue, newValue, crewNamedCount(names, ctx));
	// The WHOLE per-individual HP map, rewritten as one object by the promote and delete handlers.
	// It carries nothing the per-key branch below does not already report, and on a crew whose HP
	// has never been touched it is an EMPTY object — which Foundry's flattenObject keeps as a leaf,
	// so naming the very first crew member logged "<crew> set to changed" beside the good line.
	if (key === "individualsHp")   return [];
	// Hand-edited card fields (Moves, Notes, the Armor / max-HP overrides…). Named here because
	// `key.split(".")[0]` collapses every one of them to "details", which no label map knows — so
	// they all read as the crew's bare name and became indistinguishable in the Chronicle.
	if (key.startsWith("details.")) return followerDetailEntries(crewName, key.slice("details.".length), oldValue, newValue);
	// The crew's kit is a pip track PER ITEM (`gear.<slug>` = filled load pips), so name the item.
	// Without this a shield being taken up read as a bare number against the crew's own name.
	if (key.startsWith("gear.")) {
		return [followerFieldEntry(crewName, `${prettifySlug(key.slice("gear.".length))} load`, oldValue, newValue)];
	}
	if (key.startsWith("individualsHp.")) {
		if (ctx.paths?.has(`${CREW_PREFIX}individuals`)) return [];
		const index = key.slice("individualsHp.".length);
		// A named individual's own HP — same named-block numbering as the branch above.
		const memberName = names.crewIndividuals.get(index) ?? crewIndividualLabel(index);
		return [followerFieldEntry(memberName, "HP", oldValue, newValue)];
	}

	const field = key.split(".")[0];
	return [followerFieldEntry(crewName, CREW_FIELD_LABELS.get(field) ?? names.followerFields.get(field), oldValue, newValue)];
}

// Custom follower record (customFollowers.<id>.<field>). Only the play-relevant scalar
// tracks (Loyalty / HP / Readiness) of an ALREADY-EXISTING follower become ledger lines.
// Creation, duplicate, transfer, removal, and detail edits (name/cost/instinct/tags/…) stay
// quiet so the ledger isn't flooded: a whole-record create/duplicate/transfer flattens into
// one write per field, and buildNameLookup runs against the pre-update state — so a brand-new
// follower has no entry in names.followers, and its initial-value writes are suppressed here.
const CUSTOM_FOLLOWER_LOGGED_FIELDS = new Set(["loyalty", "hpCurrent", "readiness"]);

function customFollowerEntry(path, oldValue, newValue, names) {
	const key = path.slice(CUSTOM_FOLLOWERS_PREFIX.length);
	const dot = key.indexOf(".");
	const id = dot >= 0 ? key.slice(0, dot) : key;
	const field = dot >= 0 ? key.slice(dot + 1) : "";
	if (!CUSTOM_FOLLOWER_LOGGED_FIELDS.has(field)) return null;
	// A brand-new follower isn't in the pre-update name map; suppressing it here keeps a
	// whole-record create/duplicate/transfer from emitting a line per field.
	const followerName = names.followers.get(`custom:${id}`);
	if (!followerName) return null;
	return followerFieldEntry(followerName, names.followerFields.get(field), oldValue, newValue);
}

// Per-slug follower track (beast / initiate Loyalty, HP, Readiness): the flag key
// after the prefix is the follower's slug; `keyPrefix` selects its name map.
function perSlugFollowerEntry(path, prefix, keyPrefix, field, oldValue, newValue, names) {
	const slug = path.slice(prefix.length);
	const followerName = names.followers.get(`${keyPrefix}:${slug}`) ?? prettifySlug(slug);
	return followerFieldEntry(followerName, field, oldValue, newValue);
}

function possessionSelectionEntries(oldValue, newValue, names) {
	const oldSet = new Set(Array.isArray(oldValue) ? oldValue : []);
	const newSet = new Set(Array.isArray(newValue) ? newValue : []);
	const entries = [];
	for (const slug of newSet) {
		if (!oldSet.has(slug)) entries.push({ action: `${nameFrom(names.possessions, slug)} selected` });
	}
	for (const slug of oldSet) {
		if (!newSet.has(slug)) entries.push({ action: `${nameFrom(names.possessions, slug)} deselected` });
	}
	return entries;
}

// Write-in possessions carry their own label, so diff the { slug, label } list
// directly rather than looking names up in the snapshot.
function possessionCustomEntries(oldValue, newValue) {
	const oldBySlug = new Map((Array.isArray(oldValue) ? oldValue : []).map(c => [c.slug, c.label]));
	const newBySlug = new Map((Array.isArray(newValue) ? newValue : []).map(c => [c.slug, c.label]));
	const entries = [];
	for (const [slug, label] of newBySlug) {
		if (!oldBySlug.has(slug)) entries.push({ action: `${label} added (write-in possession)` });
	}
	for (const [slug, label] of oldBySlug) {
		if (!newBySlug.has(slug)) entries.push({ action: `${label} removed (write-in possession)` });
	}
	return entries;
}

// Ledger the wound lifecycle: additions, removals, heals (→ scars), reopens, and status
// changes. Move-driven writes (Recover, Convalesce) tag these "via <move>" through the
// update's stonetopMove option. Wound text is included — wounds are no longer hidden.
const WOUND_STATUS_VERB = { problematic: "became problematic", stabilized: "stabilized", permanent: "became permanent" };

function woundLedgerEntries(oldValue, newValue) {
	const oldById = new Map((Array.isArray(oldValue) ? oldValue : []).map(w => [w.id, w]));
	const newById = new Map((Array.isArray(newValue) ? newValue : []).map(w => [w.id, w]));
	const label = (w) => (w?.text ? `"${stripHtml(w.text)}"` : "a wound");
	const entries = [];
	for (const [id, w] of newById) {
		const prev = oldById.get(id);
		if (!prev) { entries.push({ action: `Wound recorded: ${label(w)}` }); continue; }
		if (!prev.healed && w.healed)      entries.push({ action: `Wound healed to a scar: ${label(w)}` });
		else if (prev.healed && !w.healed) entries.push({ action: `Wound reopened: ${label(w)}` });
		else if (prev.status !== w.status) entries.push({ action: `Wound ${WOUND_STATUS_VERB[w.status] ?? "updated"}: ${label(w)}` });
	}
	for (const [id, w] of oldById) {
		if (!newById.has(id)) entries.push({ action: `Wound removed: ${label(w)}` });
	}
	return entries;
}

function possessionUsesEntry(path, oldValue, newValue, names) {
	const slug = path.slice(POSSESSION_USES_PREFIX.length);
	const itemName = nameFrom(names.possessions, slug);
	return { action: `${itemName} uses changed from ${formatValue(oldValue)} to ${formatValue(newValue)}` };
}

function possessionSubchoiceEntries(path, oldValue, newValue, names) {
	const possessionSlug = path.slice(POSSESSION_SUBCHOICES_PREFIX.length);
	const oldSet = new Set(Array.isArray(oldValue) ? oldValue : []);
	const newSet = new Set(Array.isArray(newValue) ? newValue : []);
	const possessionName = nameFrom(names.possessions, possessionSlug);
	const entries = [];
	for (const choiceSlug of newSet) {
		if (!oldSet.has(choiceSlug)) {
			const choiceName = nameFrom(names.possessionChoices, `${possessionSlug}:${choiceSlug}`);
			entries.push({ action: `${possessionName}: ${choiceName} selected` });
		}
	}
	for (const choiceSlug of oldSet) {
		if (!newSet.has(choiceSlug)) {
			const choiceName = nameFrom(names.possessionChoices, `${possessionSlug}:${choiceSlug}`);
			entries.push({ action: `${possessionName}: ${choiceName} deselected` });
		}
	}
	return entries;
}

function possessionChoiceCarriedEntry(path, oldValue, newValue, names) {
	const key = path.slice(POSSESSION_CHOICE_CARRIED_PREFIX.length);
	const [possessionSlug] = key.split(":");
	if (!!oldValue === !!newValue) return null;
	const possessionName = nameFrom(names.possessions, possessionSlug);
	const choiceName = nameFrom(names.possessionChoices, key);
	return { action: `${possessionName}: ${choiceName} ${newValue ? "carried" : "set down"}` };
}

function possessionChoiceUsesEntry(path, oldValue, newValue, names) {
	const key = path.slice(POSSESSION_CHOICE_USES_PREFIX.length);
	const [possessionSlug] = key.split(":");
	const possessionName = nameFrom(names.possessions, possessionSlug);
	const choiceName = nameFrom(names.possessionChoices, key);
	return { action: `${possessionName}: ${choiceName} uses changed from ${formatValue(oldValue)} to ${formatValue(newValue)}` };
}

// "Minor Arcana The Key" for a known card, else "Arcana <Slug>" when the snapshot
// couldn't resolve it (e.g. a card removed in the same breath as its marks clearing).
function arcanaSubject(names, slug) {
	return names.arcana.get(slug)?.subject ?? `Arcana ${prettifySlug(slug)}`;
}

// Describe an arcana track glyph by side, kind, and 1-based position — the boxes carry no
// authored label of their own, only their glyph (◇ diamond, ○ circle, □ box) and index.
function arcanaBoxDetail(context, index) {
	const n = Number(index) + 1;
	if (context === "unlock") return `unlock ${n}`;
	const side = context.startsWith("back") ? "back" : "front";
	const kind = context.endsWith("Diamond") ? "diamond" : context.endsWith("Circle") ? "circle" : "box";
	return `${side} ${kind} ${n}`;
}

function arcanaBoxEntry(path, oldValue, newValue, names) {
	const [slug, context = "", index = ""] = path.slice(ARCANA_BOXES_PREFIX.length).split(":");
	if (!!oldValue === !!newValue) return null;
	return { action: `${arcanaSubject(names, slug)}: ${arcanaBoxDetail(context, index)} ${newValue ? "marked" : "unmarked"}` };
}

// Front unlock requirements and back power options are count tracks keyed "<slug>:<option>".
// They can hold more than one mark, so describe each change as a mark added or removed — not
// "selected/deselected", which would wrongly read as the whole option turning off when a
// multi-mark option merely drops a mark (e.g. 3 → 2). `optionField` picks which label map
// (unlockOptions / backOptions) names the specific choice.
function arcanaOptionEntry(path, prefix, optionField, oldValue, newValue, names) {
	const key = path.slice(prefix.length);
	const colon = key.indexOf(":");
	const slug = colon >= 0 ? key.slice(0, colon) : key;
	const optionSlug = colon >= 0 ? key.slice(colon + 1) : "";
	const label = names.arcana.get(slug)?.[optionField]?.get(optionSlug) ?? prettifySlug(optionSlug);
	const marked = Number(newValue ?? 0) > Number(oldValue ?? 0);
	return { action: `${arcanaSubject(names, slug)}: ${label} ${marked ? "marked" : "unmarked"}` };
}

// Which slugs joined / left a slug-array flag. Both arcana lists and the invocation list grow
// one entry at a time, so the interesting fact is the delta, not the whole array.
function slugListDelta(oldValue, newValue) {
	const before = new Set(Array.isArray(oldValue) ? oldValue : []);
	const after  = new Set(Array.isArray(newValue) ? newValue : []);
	return {
		added:   [...after].filter(s => !before.has(s)),
		removed: [...before].filter(s => !after.has(s)),
	};
}

/**
 * Entries for a slug array that gained and lost members: one line per slug, with the added
 * ones carrying a run descriptor so a burst of picks collapses into a single entry.
 *
 * @param {object} list   `{ added, removed, merge }` phrasings for this list
 * @param {string} runKey merge key that scopes the run to this list alone
 * @param {Function} nameFor  slug → display name
 */
function slugListEntries(oldValue, newValue, list, runKey, nameFor) {
	const { added, removed } = slugListDelta(oldValue, newValue);
	return [
		...added.map(slug => ({
			action: `${list.added}: ${nameFor(slug)}`,
			merge: listMerge(list.merge, runKey, [nameFor(slug)]),
		})),
		...removed.map(slug => ({ action: `${list.removed}: ${nameFor(slug)}` })),
	];
}

/**
 * Arcana sub-flags other than the mark tracks. `owned` / `identified` / `leads` / `revealed`
 * are slug arrays; `major` and the `minorRoles` picks are single slugs. Everything here
 * resolves the slug to the card's tier-prefixed name, and the pure-bookkeeping keys stay silent.
 */
function arcanaFlagEntries(path, oldValue, newValue, names) {
	const key = path.slice(ARCANA_PREFIX.length).split(".")[0];
	if (ARCANA_SILENT_KEYS.has(key)) return [];

	const list = ARCANA_SLUG_LISTS[key];
	if (list) return slugListEntries(oldValue, newValue, list, `arcana:${key}`, slug => arcanaSubject(names, slug));

	if (key === "major") {
		if (isBlank(newValue)) return [{ action: "Major arcanum cleared" }];
		return [{ action: `Major arcanum chosen: ${arcanaSubject(names, newValue)}` }];
	}

	// minorRoles: { mastered, found, lead } — the Seeker's three onboarding picks. Written both
	// as the whole object and as individual sub-paths, so name the role when we have one.
	if (key === "minorRoles") {
		const role = path.slice(ARCANA_PREFIX.length).split(".")[1];
		if (!role) return [];
		// isBlank BEFORE the object check: a cleared role can arrive as null, and `typeof null`
		// is "object", so testing the shape first swallowed the clear that `""` reported.
		if (isBlank(newValue)) return [{ action: `Minor arcanum (${role}) cleared` }];
		if (typeof newValue === "object") return [];
		return [{ action: `Minor arcanum (${role}): ${arcanaSubject(names, newValue)}` }];
	}

	return [];
}

const INVOCATIONS_LIST = { added: "Invocation learned", removed: "Invocation lost", merge: "Invocations learned" };

function invocationEntries(oldValue, newValue, names) {
	return slugListEntries(oldValue, newValue, INVOCATIONS_LIST, "invocations", slug => nameFrom(names.invocations, slug));
}

// A lore tick: `lore.counts.<loreSlug>:<optionSlug>`. Names the question and the answer picked,
// instead of reporting the raw counter as "Lore set to 1".
function loreCountEntry(path, oldValue, newValue, names) {
	const key = path.slice(LORE_COUNTS_PREFIX.length);
	const [loreSlug = ""] = key.split(":");
	const question = nameFrom(names.lore, loreSlug);
	const answer = names.loreOptions.get(key) ?? prettifySlug(key.split(":")[1] ?? "");
	const before = Number(oldValue ?? 0);
	const after  = Number(newValue ?? 0);
	if (after === before) return null;
	return { action: `Lore: ${question}: ${answer} ${after > before ? "marked" : "unmarked"}` };
}

// A written lore answer. The prose can run several hundred characters, so the entry records the
// question and a short preview rather than the whole paragraph.
function loreTextEntry(path, newValue, names) {
	const key = path.slice(LORE_TEXTS_PREFIX.length);
	const [loreSlug = ""] = key.split(":");
	const question = nameFrom(names.lore, loreSlug);
	const text = stripHtml(newValue);
	if (!text) return { action: `Lore: ${question}: answer cleared` };
	return { action: `Lore: ${question} answered: “${truncateValue(text)}”` };
}

// Appearance lines carry no category names in the playbook data (they are just four ordered
// lists), so the entry names the chosen trait and merges the burst into a single line.
//
// A CLEARED line arrives as a DELETION, not a value, and the two cores disagree on its shape:
// v13 sends `-=<n>` with null (which falls out at the empty check below), while v14+ sends a
// ForcedDeletion INSTANCE at the plain path (utils/foundry-compat.js#deletionEntry) — and that
// stringifies to "[object Object]", so without the type test a player emptying a write-in box
// got a ledger row reading "Appearance set to [object Object]". Same trap crewEntries guards
// at its own door; a line is only ever a string, so anything else is not a choice to read out.
function appearanceEntry(newValue) {
	if (typeof newValue !== "string") return null;
	const value = stripHtml(newValue);
	if (!value) return null;
	return { action: `Appearance set to ${value}`, merge: listMerge("Appearance", "appearance", [value]) };
}

function initiateDetailEntry(newValue) {
	const value = stripHtml(newValue);
	if (!value) return null;
	return { action: `Initiate details set to ${value}`, merge: listMerge("Initiate details", "initiateDetails", [value]) };
}

function rollModeEntry(oldValue, newValue) {
	const before = ROLL_MODE_NAMES[oldValue] ?? ROLL_MODE_NAMES.normal;
	const after  = ROLL_MODE_NAMES[newValue] ?? ROLL_MODE_NAMES.normal;
	if (before === after) return null;
	return { action: `Roll mode set to ${after}` };
}

function debilityEntry(label, oldValue, newValue) {
	if (!!oldValue === !!newValue) return null;
	return { action: newValue ? `${label} marked` : `${label} cleared` };
}

// ── Path → entry dispatch ───────────────────────────────────────────────────
// Every handler takes (path, oldValue, newValue, names) and returns the entries for that
// change. Returning [] means "this path is deliberately silent"; nulls inside the array are
// dropped centrally, so a handler that decides there is nothing to say can just return one.
//
// Two tables rather than a chain of ifs. An exact path is more specific than any prefix, so
// EXACT wins; among prefixes the LONGEST match wins, which is what keeps `arcana.boxes.`
// ahead of `arcana.` without anyone having to remember to write it first. Adding a nested
// namespace under an existing one is therefore just a new row.

// Max HP is stored twice on purpose: `hp.adjustment` is the signed DELTA that survives a later
// level raising the base underneath it, and `hp.max` is a mirror written beside it so the token
// bar over the character's head reads the right number (see StonetopCharacter#setMaxHp).
const MAX_HP_PATH            = "system.attributes.hp.max";
const MAX_HP_ADJUSTMENT_PATH = "system.attributes.hp.adjustment";

const EXACT_PATH_ENTRIES = {
	[POSSESSION_SELECTED_PATH]: (p, o, n, names) => possessionSelectionEntries(o, n, names),
	// The mirror says nothing when its source landed in the same update. Both paths are
	// labelled, so one player typing 24 into the max-HP box filed TWO rows for one edit —
	// "Max HP (permanent) changed …" and "Max HP changed …". The delta is the change that was
	// made; the mirror is bookkeeping. Silencing the pair at the WRITE would have been wrong in
	// the other direction: `stonetopLedger: true` is a whole-update kill switch, and a permanent
	// change to max HP is exactly the kind of thing the ledger exists to record.
	//
	// Still speaks on its own. A character with no playbook has no derived base to sit a delta
	// on top of, so setMaxHp writes the typed number straight to this field and nothing else —
	// and that write is the only record there is.
	[MAX_HP_PATH]: (p, o, n, names, ctx) =>
		ctx?.paths?.has(MAX_HP_ADJUSTMENT_PATH) ? [] : [scalarEntry(SYSTEM_PATH_LABELS[MAX_HP_PATH], o, n, p)],
	[POSSESSION_CUSTOM_PATH]:   (p, o, n) => possessionCustomEntries(o, n),
	[WOUNDS_PATH]:              (p, o, n) => woundLedgerEntries(o, n),
	[INVOCATIONS_PATH]:         (p, o, n, names) => invocationEntries(o, n, names),
	// Pure sheet state: which level-overage warning the player dismissed.
	[MOVES_SILENT_PATH]:        () => [],
	[BACKGROUND_SELECTED_PATH]: (p, o, n, names) => [{
		action: isBlank(n) ? "Background cleared" : `Background set to ${nameFrom(names.backgrounds, n)}`,
	}],
	[ROLL_MODE_PATH]:           (p, o, n) => [rollModeEntry(o, n)],
};

const PREFIX_ENTRIES = {
	[INVENTORY_CHECKED_PREFIX]:  (p, o, n, names) => [inventorySelectionEntry(p, o, n, names)],
	[INVENTORY_RESOURCE_PREFIX]: (p, o, n, names) => [inventoryResourceEntry(p, o, n, names)],
	[MOVE_RESOURCE_PREFIX]:      (p, o, n, names) => [moveResourceEntry(p, o, n, names)],
	[MOVE_MARKS_PREFIX]:         (p, o, n, names) => moveMarkEntries(p, o, n, names),
	[BACKGROUND_CHOICES_PREFIX]: (p, o, n, names) => [backgroundChoiceEntry(p, o, n, names)],

	[INITIATES_LOYALTY_PREFIX]:   (p, o, n, names) => [perSlugFollowerEntry(p, INITIATES_LOYALTY_PREFIX, "initiate", "loyalty", o, n, names)],
	[INITIATES_HP_PREFIX]:        (p, o, n, names) => [perSlugFollowerEntry(p, INITIATES_HP_PREFIX, "initiate", "HP", o, n, names)],
	[INITIATES_READINESS_PREFIX]: (p, o, n, names) => [perSlugFollowerEntry(p, INITIATES_READINESS_PREFIX, "initiate", "Readiness", o, n, names)],
	[BEAST_LOYALTY_PREFIX]:       (p, o, n, names) => [perSlugFollowerEntry(p, BEAST_LOYALTY_PREFIX, "beast", "loyalty", o, n, names)],
	[BEAST_HP_PREFIX]:            (p, o, n, names) => [perSlugFollowerEntry(p, BEAST_HP_PREFIX, "beast", "HP", o, n, names)],
	[BEAST_READINESS_PREFIX]:     (p, o, n, names) => [perSlugFollowerEntry(p, BEAST_READINESS_PREFIX, "beast", "Readiness", o, n, names)],
	[ANIMAL_COMPANION_PREFIX]:    (p, o, n, names) => animalCompanionEntry(p, o, n, names),
	[CREW_PREFIX]:                (p, o, n, names, ctx) => crewEntries(p, o, n, names, ctx),
	[CUSTOM_FOLLOWERS_PREFIX]:    (p, o, n, names) => [customFollowerEntry(p, o, n, names)],
	[INITIATE_DETAILS_PREFIX]:    (p, o, n) => [initiateDetailEntry(n)],

	[POSSESSION_USES_PREFIX]:           (p, o, n, names) => [possessionUsesEntry(p, o, n, names)],
	[POSSESSION_SUBCHOICES_PREFIX]:     (p, o, n, names) => possessionSubchoiceEntries(p, o, n, names),
	[POSSESSION_CHOICE_USES_PREFIX]:    (p, o, n, names) => [possessionChoiceUsesEntry(p, o, n, names)],
	[POSSESSION_CHOICE_CARRIED_PREFIX]: (p, o, n, names) => [possessionChoiceCarriedEntry(p, o, n, names)],

	[ARCANA_BOXES_PREFIX]:        (p, o, n, names) => [arcanaBoxEntry(p, o, n, names)],
	[ARCANA_UNLOCK_PREFIX]:       (p, o, n, names) => [arcanaOptionEntry(p, ARCANA_UNLOCK_PREFIX, "unlockOptions", o, n, names)],
	[ARCANA_BACK_OPTIONS_PREFIX]: (p, o, n, names) => [arcanaOptionEntry(p, ARCANA_BACK_OPTIONS_PREFIX, "backOptions", o, n, names)],
	// Shorter than the three mark-track prefixes above, so longest-match keeps it last.
	[ARCANA_PREFIX]:              (p, o, n, names) => arcanaFlagEntries(p, o, n, names),

	[LORE_COUNTS_PREFIX]: (p, o, n, names) => [loreCountEntry(p, o, n, names)],
	[LORE_TEXTS_PREFIX]:  (p, o, n, names) => [loreTextEntry(p, n, names)],
	[APPEARANCE_PREFIX]:  (p, o, n) => [appearanceEntry(n)],

	[BACKGROUND_ANSWERS_PREFIX]: (p, o, n) => {
		const question = prettifySlug(p.slice(BACKGROUND_ANSWERS_PREFIX.length));
		const text = stripHtml(n);
		return [{ action: text ? `${question} answered: “${truncateValue(text)}”` : `${question} answer cleared` }];
	},
};

const SORTED_ENTRY_PREFIXES = Object.keys(PREFIX_ENTRIES).sort((a, b) => b.length - a.length);

/**
 * A follower's face, the rect that crops it, and the link to the Actor made for them — plumbing
 * wherever it is stored, and never a ledger line.
 *
 * Every follower type keeps its portrait at `<namespace>.img` with an optional `portraitFrame`
 * beside it (StonetopCharacterSheet's _FOLLOWER_FLAGS), and a roster member keeps theirs the same
 * way. None of it is an act of play, and all of it rendered badly when it fell through to the
 * generic field formatter: a raw file path for the picture, a bare "0.1, 0.2, 0.3, 0.4" for the
 * rect (a `portraitFrame` is a plain object, so flattenObject splits it into `.src` and `.rect`).
 *
 * `actorUuid` is the same kind of key and belongs in the same rule. It is written by the sweep
 * that gives every follower an Actor (actors/character/follower-actors.js#ensureFollowerActors)
 * and by a drag onto the canvas (hooks/FollowerDrop.js) — never by a player deciding anything.
 * Left to fall through, one sweep put "Initiate details set to Actor.E0FGjEd91XwUD7Jc,
 * Actor.si3Eu6QXhkPwDnIJ" into a Blessed's Chronicle, two raw ids run together because the sweep
 * writes the lot in ONE update and listMerge folded the pair into a single line.
 *
 * ONE rule rather than an entry per follower type — the crew, the animal companion, the initiates,
 * the beasts, the custom followers and the roster members all store these the same way, so a type
 * added later is quiet by default instead of quietly noisy.
 *
 * Restricted to FLAG paths so it cannot reach the actor's own top-level `img`, which is a
 * different question and not this function's to answer.
 */
// `(?:-=)?` because clearing a portrait is TWO writes, not one: "Use default" sends the picture
// away as `img: ""` and the frame with it as `.-=portraitFrame`. Silencing only the first left
// every follower's "Use default" writing "<name> set to blank" into the Chronicle.
const BOOKKEEPING_KEY = /\.(?:-=)?(img|portraitFrame|actorUuid)(\.|$)/;
const isBookkeepingPath = (path) =>
	path.startsWith(`flags.${LEDGER_SCOPE}.`) && BOOKKEEPING_KEY.test(path);

function granularEntriesForPath(path, oldValue, newValue, names, ctx) {
	if (isBookkeepingPath(path)) return [];
	// Object.hasOwn, not a bare lookup: `path` is attacker-adjacent data off an actor update,
	// and a plain `EXACT_PATH_ENTRIES[path]` would happily hand back Object.prototype members
	// for a path named "constructor" or "toString" — which this then tries to call.
	// The prefix scan only runs when no exact row claimed the path, so the common exact hits
	// don't pay for a walk of every prefix.
	let handler = Object.hasOwn(EXACT_PATH_ENTRIES, path) ? EXACT_PATH_ENTRIES[path] : null;
	if (!handler) {
		const prefix = SORTED_ENTRY_PREFIXES.find(p => path.startsWith(p));
		handler = prefix ? PREFIX_ENTRIES[prefix] : null;
	}
	if (handler) return (handler(path, oldValue, newValue, names, ctx) ?? []).filter(Boolean);

	// A set rather than table rows: it reads its label from SYSTEM_PATH_LABELS, so a row here
	// would just repeat what that map already says.
	if (DEBILITY_PATHS.has(path)) return [debilityEntry(SYSTEM_PATH_LABELS[path], oldValue, newValue)].filter(Boolean);
	const label = SYSTEM_PATH_LABELS[path];
	// scalarEntry decides for itself whether this field's runs collapse, by asking the value
	// whether it is a number — which is what the allowlist that used to sit here spelled out by
	// hand, for exactly the numeric subset of the map above.
	if (label) return [scalarEntry(label, oldValue, newValue, path)];
	return null;
}

/** Tag every entry from one path with that path's category, leaving any explicit one alone. */
function withCategory(entries, path) {
	const category = categoryForCharacterPath(path);
	return entries.map(entry => ({ category, ...entry }));
}

async function actorUpdateEntries(actor, changed) {
	const names = await buildNameLookup(actor);
	const entries = [];
	const flattened = foundry.utils.flattenObject(changed);
	// Facts about the update AS A WHOLE, for the handful of entry builders that cannot tell what
	// happened from one key alone. Kept separate from `names` so it stays obvious that this is
	// per-update state and not a lookup table.
	//
	// What ELSE landed alongside the key a builder is looking at, and what it landed AS.
	// Deliberately the raw question rather than a pre-chewed answer: the callers today are both
	// the crew's (see crewEntries), and a generic walker that knew that fact by name would need a
	// second bespoke flag for the next builder with the same need. `names` cannot answer either
	// question — it is built from the actor BEFORE the update.
	const normalized = new Map();
	for (const [path, value] of Object.entries(flattened)) {
		const key = normalizeFlagPath(path);
		if (key) normalized.set(key, value);
	}
	const ctx = {
		paths:     new Set(normalized.keys()),
		newValues: normalized,
	};
	for (const [path, newValue] of Object.entries(flattened)) {
		const normalizedPath = normalizeFlagPath(path);
		if (!normalizedPath || isLedgerPath(normalizedPath)) continue;

		if (normalizedPath === "system.playbook" || normalizedPath.startsWith("system.playbook.")) {
			const oldName = actor.system?.playbook?.name;
			const newName = normalizedPath === "system.playbook"
				? newValue?.name
				: normalizedPath === "system.playbook.name"
					? newValue
					: foundry.utils.getProperty(changed, "system.playbook.name");
			if (newName && oldName !== newName) {
				entries.push({
					category: "character",
					action: oldName ? `Playbook changed from ${oldName} to ${newName}` : `Playbook added: ${newName}`,
				});
			}
			continue;
		}

		const oldValue = getActorProperty(actor, normalizedPath);
		if (valuesEqual(oldValue, newValue)) continue;

		const granularEntries = granularEntriesForPath(normalizedPath, oldValue, newValue, names, ctx);
		if (granularEntries) {
			entries.push(...withCategory(granularEntries, normalizedPath));
			continue;
		}

		const label = labelForPath(normalizedPath);
		if (!label) continue;

		entries.push({
			category: categoryForCharacterPath(normalizedPath),
			action: actionForField(label, oldValue, newValue),
		});
	}
	return coalesceEntries(entries);
}

function itemTypeLabel(item) {
	const moveType = item.system?.moveType;
	if (item.type === "playbook") return "Playbook";
	if (item.type !== "move") return item.type ?? "Item";
	if (moveType === "arcanum") return "Arcanum";
	if (moveType === "inventory-custom") return "Inventory item";
	if (moveType === "post-death") return "Post-death move";
	return "Move";
}

function createdItemAction(item) {
	const label = itemTypeLabel(item);
	if (label === "Move" || label === "Post-death move") return `${item.name} learned`;
	if (label === "Playbook") return `Playbook added: ${item.name}`;
	return `${label} added: ${item.name}`;
}

function deletedItemAction(item) {
	const label = itemTypeLabel(item);
	if (label === "Move" || label === "Post-death move") return `${item.name} removed`;
	if (label === "Playbook") return `Playbook removed: ${item.name}`;
	return `${label} removed: ${item.name}`;
}

// Picking a playbook grants every basic and starting move in one create call — 21 items for a
// Blessed, which used to land as 21 near-identical "X learned" lines at a single timestamp.
// Above this many items of the same kind in one batch, name the first few and count the rest.
const ITEM_BATCH_SUMMARY_THRESHOLD = 5;
const ITEM_BATCH_NAMES_SHOWN = 3;

// How a summarised batch of one item type reads, keyed by the label itemTypeLabel derives:
// the plural subject, the verb a grant of them takes, and the filter category they file under.
// "learned" belongs to moves alone — the singular createdItemAction already draws that line,
// and the batch path ignoring it is what produced "Arcanums learned (5)". `s` is likewise not
// a pluraliser: "Arcana" is the plural of "Arcanum".
const ITEM_BATCH_LABELS = {
	"Playbook":        { plural: "Playbooks",        gained: "added",   category: "character" },
	"Arcanum":         { plural: "Arcana",           gained: "added",   category: "arcana" },
	"Inventory item":  { plural: "Inventory items",  gained: "added",   category: "inventory" },
	"Move":            { plural: "Moves",            gained: "learned", category: "moves" },
	"Post-death move": { plural: "Post-death moves", gained: "learned", category: "moves" },
};

// itemTypeLabel falls back to the raw item type for anything else, which has no authored
// wording — so the fallback keeps the naive plural rather than inventing one.
const itemBatchLabel = label =>
	ITEM_BATCH_LABELS[label] ?? { plural: `${label}s`, gained: "added", category: "inventory" };

/**
 * One entry per created/deleted item, unless a batch is large enough to be a bulk grant — then
 * one summary entry per item-type ("Moves learned (21): Aid, Clash, Defend, and 18 more").
 * Batches stay split by item type so a playbook grant doesn't swallow the arcanum added with it.
 *
 * The count sits in parentheses after the verb rather than leading the phrase, so ledgerNoun
 * still derives a clean subject ("Moves") instead of one that varies with the batch size.
 *
 * @param {object}  [options]
 * @param {boolean} [options.removed]  phrase the summary as a loss rather than a grant
 */
function summariseItemBatch(items, actionFor, { removed = false } = {}) {
	const byLabel = new Map();
	for (const item of items) {
		const label = itemTypeLabel(item);
		if (!byLabel.has(label)) byLabel.set(label, []);
		byLabel.get(label).push(item);
	}

	const entries = [];
	for (const [label, group] of byLabel) {
		const { plural, gained, category } = itemBatchLabel(label);
		if (group.length < ITEM_BATCH_SUMMARY_THRESHOLD) {
			entries.push(...group.map(item => ({ category, action: actionFor(item) })));
			continue;
		}
		const names = group.map(item => item.name).filter(Boolean);
		const shown = names.slice(0, ITEM_BATCH_NAMES_SHOWN).join(", ");
		const rest  = names.length - ITEM_BATCH_NAMES_SHOWN;
		entries.push({
			category,
			// Losing something is "removed" whatever it is — only the gaining verb varies.
			action: `${plural} ${removed ? "removed" : gained} (${group.length}): ${shown}${rest > 0 ? `, and ${rest} more` : ""}`,
		});
	}
	return entries;
}

export class CharacterLedger {
	static getEntries(actor) {
		return getLedgerEntries(actor);
	}

	static async append(actor, entries, options = {}) {
		if (actor?.type !== "character") return;
		await appendLedgerEntries(actor, entries, options);
	}

	static entriesForActorUpdate(actor, changed) {
		return actorUpdateEntries(actor, changed);
	}

	static async deleteEntries(actor, ids) {
		if (actor?.type !== "character") return;
		await deleteLedgerEntries(actor, ids);
	}

	static entriesForCreatedItems(items) {
		return summariseItemBatch(items, createdItemAction);
	}

	static entriesForDeletedItems(items) {
		return summariseItemBatch(items, deletedItemAction, { removed: true });
	}
}
