// The sidebar "Create Actor" entry point. Foundry's stock dialog is a name box and a type
// dropdown that drops you on a blank sheet, but every kind of actor in Stonetop already has
// a guided flow behind it, so we show our own chooser (the same one the "Create Stonetop
// Content" picker uses) and hand off:
//   • Player Character → minted for a chosen player, whose client is greeted with character
//     creation: playbook picker, then onboarding.
//   • Person (NPC) → the Resident/Neighbor worksheet (name suggestions, occupation, traits,
//     home), filed on the steading's roster when it belongs there.
//   • Monster → the Make-a-Monster worksheet (Book I, "Dangers"), one of the Things Below
//     corruption wizards, or a blank stat block for a GM who'd rather type it in.
// Opened from StonetopActor.createDialog.

import { pickContentOption, runPickedOption } from "./content-picker.js";
import { createCharacterForUser } from "../actors/character/create-character.js";
import { charactersOwnedBy } from "../utils/playbook-actors.js";
import { addPersonToSteading, createPersonNpc } from "../actors/steading/steading-people.js";
import { buildMonsterActorData } from "../data/monster-builder.js";
import { SYSTEM_ID } from "../system-id.js";
import { GM_TOOLKIT_TYPE, createGmToolkit, theGmToolkit } from "../actors/gmtoolkit/gm-toolkit-actor.js";

// Sentinel for the "no player yet" row of the character-owner step. Never a real user id.
const UNASSIGNED = "__unassigned__";

// What the chooser offers, and what each row DOES. The flow belongs on the row rather than in a
// dispatch ladder beside it: a subtype added to one and missed in the other is a picker option
// that silently returns null, or a flow nothing can reach, and neither fails loudly.
//
// `create` is called with the sidebar's folder and any caller-supplied name; the flows that want
// neither ignore them. NOTHING ELSE may be baked in here — actorOptionsFor hands the character
// row to PLAYERS, so a row that assumed its caller was the GM would be a player running the GM's
// branch of a flow. Whose client this is stays where it can be read afresh, in the flow itself.
const ACTOR_OPTIONS = [
	{
		id: "character",
		label: "Player Character",
		icon: "fa-user",
		hint: "A new PC. Pick whose it is, and character creation opens on their screen: playbook, stats, gear, bonds.",
		create: (folder, name) => _createCharacter(folder, name),
	},
	{
		id: "npc",
		label: "Person",
		icon: "fa-people-group",
		hint: "A villager, a neighbor from elsewhere, or a stranger. Built from the steading worksheet: name, occupation, traits, notes.",
		create: (folder) => _createPerson(folder),
	},
	{
		id: "monster",
		label: "Monster",
		icon: "fa-dragon",
		hint: "A stat block from the Dangers worksheet, a being or emanation corrupted by the Things Below, or a blank one you fill in yourself.",
		create: (folder, name) => _createMonster(folder, name),
	},
	{
		id: GM_TOOLKIT_TYPE,
		label: "GM Toolkit",
		icon: "fa-book-open",
		hint: "Your own sheet: the GM playbook on screen. Opens on the GM moves, with Exploration and Homefront under them.",
		create: (folder, name) => _createGmToolkit(folder, name),
	},
];

// The Person sub-chooser. Residents and Neighbors are the steading's own rosters (each row
// is backed by the NPC actor this creates); anyone else is a standalone NPC. `type` picks
// the worksheet, `list` the roster to file them on (null = neither), and `noun` names them
// — the window title, the confirm button and the "added to…" notice all read off those.
const PERSON_KINDS = [
	{
		id: "resident",
		label: "Resident of Stonetop",
		icon: "fa-house-chimney",
		hint: "One of the village's own. Added to the steading's Residents roster.",
		type: "resident",
		list: "residents",
		noun: "Resident",
	},
	{
		id: "neighbor",
		label: "Neighbor",
		icon: "fa-signs-post",
		hint: "Someone from Marshedge, Gordin's Delve, the Steplands, Lygos or beyond. Added to the steading's Neighbors roster.",
		type: "neighbor",
		list: "neighbors",
		noun: "Neighbor",
	},
	{
		id: "other",
		label: "Someone else",
		icon: "fa-user-pen",
		hint: "A person who isn't on either roster: a traveller, a rival, a face from a Book II location.",
		type: "neighbor",
		list: null,
		noun: "Person",
	},
];

/** "residents" → "Residents", for the confirm button and the "added to…" notice. */
const _rosterLabel = list => (list ? list[0].toUpperCase() + list.slice(1) : "");

// The Monster sub-chooser: the book's own worksheet, the two Things Below corruption
// wizards (which also end in a stat block), or an empty one. Each row carries its own flow, for
// the reason ACTOR_OPTIONS gives — the two corruption rows differ only in the `mode` they pass,
// and each names its own rather than the dispatch re-testing which of them was picked.
const MONSTER_KIND_OPTIONS = [
	{
		id: "worksheet",
		label: "Make a Monster",
		icon: "fa-dragon",
		hint: "The Book I worksheet: organization, size, tags, HP, armor, damage, instinct and moves, with the stats totted up as you go.",
		create: (folder, name) => _openMonsterWorksheet(folder, name),
	},
	{
		id: "being",
		label: "Corrupted being",
		icon: "fa-skull",
		hint: "Twist an existing monster with the Things Below's gifts and marks (Book II).",
		create: (folder) => _openCorruption("being", folder),
	},
	{
		id: "emanation",
		label: "Emanation",
		icon: "fa-hurricane",
		hint: "A Thing's discharge given form, from a source monster or a blank template (Book II).",
		create: (folder) => _openCorruption("emanation", folder),
	},
	{
		id: "blank",
		label: "Blank stat block",
		icon: "fa-file-lines",
		hint: "Skip the worksheet and fill the stat block in by hand.",
		create: (folder, name) => _createBlankMonster(folder, name),
	},
];

/**
 * Which kinds a user may create. Players only ever make their own character: people and
 * monsters are GM prep, and preCreateActor vetoes a player-made monster outright.
 *
 * The GM Toolkit row drops out once the world HAS one. It is a singleton
 * (hooks/StonetopSingleton.js), so the row would be a dead entry that only ever warns; the
 * steading is kept out of this table entirely for the same reason, and differs only in never
 * being absent. `haveToolkit` is passed in rather than read here so the table stays a pure
 * function of its inputs, which is what lets the tests drive both states.
 *
 * @param {boolean} isGM
 * @param {object}  [world]
 * @param {boolean} [world.haveToolkit=false]  Does this world already hold a GM Toolkit?
 */
export function actorOptionsFor(isGM, { haveToolkit = false } = {}) {
	if (!isGM) return ACTOR_OPTIONS.filter(o => o.id === "character");
	return ACTOR_OPTIONS.filter(o => !(o.id === GM_TOOLKIT_TYPE && haveToolkit));
}

/**
 * Rows for the "whose character is this?" step: one per player, plus an unassigned option.
 * A player who already has a character says so in their hint, and says which question that
 * raises — a second character to play alongside, or a replacement for the one they have.
 * The choice itself is made after this step (see createCharacterForUser); naming it here
 * means the GM picks a row already knowing the row isn't a delete.
 *
 * @param {Array} users              The world's users; GMs are filtered out (they run the world).
 * @param {(userId: string) => Array} charactersFor  Existing characters for a user.
 */
export function ownerOptions(users = [], charactersFor = () => []) {
	const rows = users.filter(u => u && !u.isGM).map(user => ({
		id: user.id,
		label: user.name,
		icon: user.active ? "fa-user" : "fa-user-clock",
		hint: _ownerHint(user, charactersFor(user.id)),
	}));
	rows.push({
		id: UNASSIGNED,
		label: "No one yet",
		icon: "fa-user-slash",
		hint: "Create the sheet here and now, unassigned. You can hand it to a player later.",
	});
	return rows;
}

function _ownerHint(user, existing = []) {
	const names = existing.map(a => a?.name).filter(Boolean);
	if (names.length) {
		return `Already plays ${names.join(", ")}. You'll be asked whether to add another character `
			+ `alongside, or replace ${names.length === 1 ? "it" : "them"}.`;
	}
	return user.active
		? "Online. Character creation opens on their screen."
		: "Offline. Creation greets them the next time they log in.";
}

/**
 * Open the chooser and run the picked flow.
 *
 * @param {object} [options]
 * @param {string|null} [options.folder]  Folder the sidebar was asking to create into.
 * @param {string} [options.name]         A name supplied by the caller (macros pass one).
 * @returns {Promise<Actor|null>}  The created actor, or null if any step was dismissed.
 */
export async function openCreateActor({ folder = null, name = "" } = {}) {
	const isGM = !!game.user?.isGM;
	// A player has exactly one option, so the chooser would be a one-row formality: send them
	// straight into their own character. Through the table, not past it — this is a shortcut
	// around the PICKER, and a second spelling of the flow beside it is the drift the table exists
	// to prevent.
	if (!isGM) return runPickedOption(ACTOR_OPTIONS, "character", folder, name);

	const choice = await pickContentOption({
		title: game.i18n.localize("stonetop.actorCreate.title"),
		options: actorOptionsFor(isGM, { haveToolkit: !!theGmToolkit() }),
	});
	if (!choice) return null;

	return runPickedOption(ACTOR_OPTIONS, choice, folder, name);
}

/**
 * GM Toolkit flow. There is no worksheet: the sheet is reference the GM reads, so it has
 * nothing to ask before it exists. Create it and open it.
 *
 * A world SINGLETON, on the same two hooks as the steading: hooks/StonetopSingleton.js vetoes a
 * second create and refuses to delete the last. This flow is not that guard and must not be read
 * as one — `actorOptionsFor` drops the row once the world has a toolkit (line 149-152 above) only
 * so the picker never offers a dead end that could just warn. Getting here at all means the world
 * had none, which is either a world whose launch predates the subtype or one somebody emptied;
 * both are exactly the cases this row exists to recover from.
 *
 * Visibility is handled where it belongs, in StonetopActor#_preCreate: a toolkit is stamped
 * `ownership.default = NONE` so it never appears in a player's Actors sidebar.
 */
async function _createGmToolkit(folder, name) {
	if (!game.user?.isGM) {
		ui.notifications?.warn("Only the GM can create a GM Toolkit.");
		return null;
	}
	// Both failure modes — a world launched before this subtype existed, and a create that
	// throws — are handled inside createGmToolkit, which owns the notices.
	const actor = await createGmToolkit({ name, folder });
	actor?.sheet?.render(true);
	return actor;
}

/**
 * Character flow: pick the player it belongs to, then mint it. The player's own client
 * takes over from there (the creation intro, then the playbook picker and onboarding);
 * an unassigned sheet has no player to greet, so we open it here instead. Its playbook
 * gate offers the same first step.
 *
 * Whose client this is, is READ HERE rather than passed in. Choosing an owner is the GM's step —
 * a player's character is their own by definition — and a caller that could get the answer wrong
 * would put a player in front of "Whose character is this?", listing every other player, and let
 * them mint a sheet that replaces someone else's.
 */
async function _createCharacter(folder, name) {
	if (!game.user?.isGM) return createCharacterForUser(game.user?.id ?? null, { folder, name });

	const owner = await _pickOwner();
	if (!owner) return null;
	const unassigned = owner === UNASSIGNED;
	const actor = await createCharacterForUser(unassigned ? null : owner, { folder, name });
	if (actor && unassigned) actor.sheet?.render(true);
	return actor;
}

/** The owner step, skipped when the world has no players yet (a solo prep session). */
async function _pickOwner() {
	const users = game.users?.filter?.(u => !u.isGM) ?? [];
	if (!users.length) return UNASSIGNED;
	return pickContentOption({
		title: "Whose character is this?",
		options: ownerOptions(users, charactersOwnedBy),
		buttonLabel: "Create Character",
	});
}

/**
 * Person flow: pick which roster (if any) they belong to, fill in the same worksheet the
 * steading sheet's "+ Add" buttons use, and create the NPC. Residents and Neighbors are
 * filed on the steading as they're made, so the roster row and the actor arrive together.
 */
async function _createPerson(folder) {
	const kind = await pickContentOption({
		title: "Create a Person",
		options: PERSON_KINDS,
	});
	if (!kind) return null;
	const spec = PERSON_KINDS.find(k => k.id === kind);
	if (!spec) return null;

	const { AddSteadingMemberDialog } = await import("./AddSteadingMemberDialog.js");
	const data = await new AddSteadingMemberDialog(spec.type, {
		titleOverride: `Create a ${spec.noun}`,
		confirmLabel: spec.list ? `Add to ${_rosterLabel(spec.list)}` : "Create NPC",
	}).promise();
	if (!data) return null;

	// Residents and Neighbors are filed on the steading as they're made; anyone else is a
	// loose NPC in whichever sidebar folder was open (see createPersonNpc for the difference).
	let actor;
	try {
		actor = spec.list
			? await addPersonToSteading(spec.list, data)
			: await createPersonNpc(null, data, { folder });
	} catch (err) {
		console.error("Stonetop | failed to create NPC", err);
		ui.notifications?.error?.("Couldn't create the NPC. See the console for details.");
		return null;
	}
	if (!actor) return null;
	if (spec.list) ui.notifications?.info?.(`Added ${actor.name} to the steading's ${_rosterLabel(spec.list)}.`);
	actor.sheet?.render(true);
	return actor;
}

/**
 * Monster flow. Each wizard creates its own finished stat block, so we just resolve theirs.
 * With the guided builder switched off (monsterBuilderEnabled), the whole sub-chooser is
 * moot: a blank stat block is what that setting asks for.
 */
async function _createMonster(folder, name) {
	if (!game.user?.isGM) {
		ui.notifications?.warn("Only the GM can create monsters.");
		return null;
	}
	const builderEnabled = game.settings?.get?.(SYSTEM_ID, "monsterBuilderEnabled") !== false;
	const kind = builderEnabled
		? await pickContentOption({ title: "Create a Monster", options: MONSTER_KIND_OPTIONS })
		: "blank";
	return runPickedOption(MONSTER_KIND_OPTIONS, kind, folder, name);
}

/** The Book I worksheet, which creates its own finished stat block. */
async function _openMonsterWorksheet(folder, name) {
	const { CreateMonsterDialog } = await import("./CreateMonsterDialog.js");
	return new CreateMonsterDialog({ name, folder }).promise();
}

/** Either Things Below corruption wizard; both also end in a stat block. */
async function _openCorruption(mode, folder) {
	const { CorruptBeingDialog } = await import("../things-below/corrupt-being-dialog.js");
	return new CorruptBeingDialog({ mode, folder }).promise();
}

async function _createBlankMonster(folder, name) {
	const cls = getDocumentClass("Actor");
	// Shaped by the same helper the worksheet and the corruption wizards use, so a blank
	// stat block still gets the attributes block, the empty `entry` and the hostile
	// unlinked prototype token that every other monster is created with.
	const createData = buildMonsterActorData({
		name: name?.trim() || cls.defaultName?.({ type: "monster" }) || "New Monster",
		folder,
	});
	let actor;
	try {
		// `stonetopMonsterBuilt` marks this as a deliberately blank stat block: without it
		// the preCreateActor guard vetoes the create and re-opens the worksheet the GM
		// just declined (see hooks/StonetopSingleton.js).
		actor = await cls.create(createData, { stonetopMonsterBuilt: true });
	} catch (err) {
		console.error("Stonetop | failed to create monster", err);
		ui.notifications?.error?.("Couldn't create the stat block. See the console for details.");
		return null;
	}
	actor?.sheet?.render(true);
	return actor ?? null;
}
