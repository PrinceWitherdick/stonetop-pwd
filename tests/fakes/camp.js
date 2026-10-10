import { vi } from "vitest";
import { SYSTEM_ID } from "../../module/system-id.js";
import { DEATHS_DOOR_FLAG, DEATHS_DOOR_STATE } from "../../module/actors/character/deaths-door.js";
import { readCampRecord } from "../../module/camp/camp-rules.js";
import { capitalizeFirst } from "../../module/utils/strings.js";

/**
 * Fakes for the shared camp (module/camp/), one file for every camp suite so they cannot drift
 * into describing different characters or different Foundries.
 *
 * `seat` is a character the way the RULES see one. `campCharacter` / `campWorld` / `campParty` are
 * the documents and users the STORE and the FLOW read and write.
 */

/**
 * One character at a camp fire, in the shape camp-store.js hands the rules (a CampMember), with the
 * defaults filled in: Aeliana, 4 of 15 HP, four uses of supplies, nothing marked.
 *
 * `choices` is what the player has set on their row. Everything else is the character: what they
 * carry (`carried`, and whether a bedroll or a mess kit is in their outfit), their HP, what they
 * have marked. `undefinedMarks`, `checked` and `usesPerSupply` are what Have What You Need draws on.
 */
export function seat({
	id = "aeliana", name = "Aeliana", isHost = false, joinedAt = 1, img = "",
	carried = { supplies: 4 }, hp = 4, maxHp = 15, marked = [], unliving = false,
	carriesBedroll = false, carriesFurBedroll = false, carriesMessKit = false, choices = {},
	undefinedMarks = 0, checked = {}, usesPerSupply = null, breaksBread = false, hearthCha = null, clearsTonight = [],
} = {}) {
	const debilities = marked.map(key => ({ key, name: capitalizeFirst(key) }));
	return {
		actorId: id,
		name,
		img,
		isHost,
		record: readCampRecord({
			id: "camp-1",
			host: "aeliana",
			joinedAt,
			vitals: { maxHp, bedroll: carriesBedroll, furBedroll: carriesFurBedroll, messKit: carriesMessKit, debilities },
			...choices,
		}),
		resources: carried,
		hpValue: hp,
		maxHp,
		activeDebilities: debilities,
		unliving,
		breaksBread,
		hearthCha,
		clearsTonight,
		pack: { undefinedMarks, checked, usesPerSupply },
	};
}

function isPlain(value) {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function mergeInto(target, value) {
	for (const [key, v] of Object.entries(value)) {
		if (isPlain(v) && isPlain(target[key])) mergeInto(target[key], v);
		else target[key] = structuredClone(v);
	}
}

/**
 * Apply an update the way Foundry applies one: dotted paths, a plain object MERGED into whatever is
 * already there, and anything else (arrays included) replaced. The merge is the whole reason a
 * fresh camp record names every field, so a fake that replaced objects would hide a leftover.
 */
export function applyUpdate(doc, update) {
	for (const [path, value] of Object.entries(update)) {
		const parts = path.split(".");
		const leaf  = parts.pop();
		let node = doc;
		for (const part of parts) node = node[part] ??= {};
		if (isPlain(value) && isPlain(node[leaf])) mergeInto(node[leaf], value);
		else node[leaf] = structuredClone(value);
	}
}

const DEBILITY_NAMES = { weakened: "Weakened", dazed: "Dazed", miserable: "Miserable" };

/**
 * A character document at the level of detail a camp reads: HP and debilities, the flags the camp
 * reads and writes, ownership, and the three things it asks of the character model.
 *
 * `update` and `unsetFlag` land a tick LATER, the way a real write lands when the server answers,
 * so a second attempt made before the first returns sees the document as it was.
 *
 * @param {object} o
 * @param {string[]} [o.owners]   user ids that own the character (a GM owns everything anyway)
 * @param {Array<{slug: string, checked: boolean}>} [o.outfit]  the outfit rows the sheet reports
 * @param {Array<{name: string, carried: boolean}>} [o.gear]  write-ins and treasures on the sheet, as
 *   StonetopCharacter#snapshotWithGear's `gear` answers them (each keyed by a made-up item id)
 * @param {"dead"|"ghost"|"revenant"|"thrall"|null} [o.pastDeath]
 * @param {string[]} [o.thrallMarks]  Mark slugs ticked, for a `pastDeath: "thrall"`
 * @param {Array<string|{name: string, learned: boolean}>} [o.moves]  the move Items on the sheet
 * @param {number} [o.cha]
 * @param {object|null} [o.background]  the selected background as the snapshot's playbook section
 *   shows it (`{label, setupResources: [{key, label, clearsOn}]}`), and `marks`, what is stored on
 *   each track (`background.setupResources`)
 */
export function campCharacter({
	id, name = id, owners = [], hp = 4, maxHp = 15, marked = [], carried = { supplies: 4 },
	outfit = [], gear = [], followers = {}, pastDeath = null, moves = [], cha = 0, background = null, thrallMarks = [],
} = {}) {
	const gearRecords = gear.map((g, at) => ({ slug: `item-${at}`, name: g.name, carried: !!g.carried }));
	const actor = {
		id,
		name,
		type: "character",
		img:  `${id}.webp`,
		items: moves.map(move => typeof move === "string"
			? { type: "move", name: move, flags: {} }
			: { type: "move", name: move.name, flags: { [SYSTEM_ID]: { learned: move.learned } } }),
		system: {
			attributes: {
				hp: { value: hp, max: maxHp },
				debilities: { options: Object.fromEntries(Object.keys(DEBILITY_NAMES).map(key => [key, { value: marked.includes(key) }])) },
			},
			stats: { cha: { value: cha } },
		},
		flags: { [SYSTEM_ID]: {
			inventory: { resources: { ...carried } },
			customFollowers: structuredClone(followers),
			...(background ? { background: { setupResources: { ...(background.marks ?? {}) } } } : {}),
		} },
		getFlag: (scope, key) => foundry.utils.getProperty(actor.flags[scope] ?? {}, key),
		update: vi.fn(async update => {
			await Promise.resolve();
			applyUpdate(actor, update);
		}),
		unsetFlag: vi.fn(async (scope, key) => {
			await Promise.resolve();
			delete actor.flags[scope]?.[key];
		}),
		testUserPermission: user => !!user?.isGM || owners.includes(user?.id),
		get isOwner() { return actor.testUserPermission(globalThis.game?.user); },
		typedActor: {
			// The sheet's snapshot and the gear picture it was built from, in one pass, as the model hands them.
			snapshotWithGear: vi.fn(async () => ({
				snapshot: {
					vitals:     { hp: { value: actor.system.attributes.hp.value, max: maxHp } },
					inventory:  { outfit: { regularItems: outfit } },
					debilities: Object.entries(DEBILITY_NAMES).map(([key, label]) => ({ key, name: label, active: marked.includes(key) })),
					playbook:   background
						? { background: { options: [{ selected: true, label: background.label, setupResources: background.setupResources ?? [] }] } }
						: null,
				},
				gear: {
					items: gearRecords.map(({ slug, name: itemName }) => ({ slug, name: itemName })),
					marks: Object.fromEntries(gearRecords.map(g => [g.slug, g.carried])),
				},
			})),
			inventoryResourceData: (slug, count) => ({ [`flags.${SYSTEM_ID}.inventory.resources.${slug}`]: count }),
			heldAdvantageData:     source => ({ [`flags.${SYSTEM_ID}.heldAdvantage`]: { sources: [source].flat() } }),
			heldDisadvantageData:  source => ({ [`flags.${SYSTEM_ID}.heldDisadvantage`]: { sources: [source].flat() } }),
		},
	};
	if (pastDeath === "dead") applyUpdate(actor, { [`flags.${SYSTEM_ID}.${DEATHS_DOOR_FLAG}`]: DEATHS_DOOR_STATE.DEAD });
	else if (pastDeath) applyUpdate(actor, { [`flags.${SYSTEM_ID}.postDeathInsert.slug`]: pastDeath });
	// A Thrall's Marks, ticked in the insert's `marks` section the way the Post-Death tab stores them.
	if (thrallMarks.length) {
		applyUpdate(actor, { [`flags.${SYSTEM_ID}.postDeathLore.counts`]: Object.fromEntries(thrallMarks.map(slug => [`marks:${slug}`, 1])) });
	}
	return actor;
}

const SETUP = { game: globalThis.game, ui: globalThis.ui };

/**
 * Install a world around a camp as `game`, with the chat and dice it posts to. Returns the Roll's
 * `toMessage` spy, and `act(userId)` to change whose client the next call runs on.
 */
export function campWorld({ me, users, actors = [], messages = [], rolled = 3 }) {
	globalThis.game = {
		...SETUP.game,
		user:     users.find(u => u.id === me),
		users:    { contents: users },
		actors:   { contents: actors, get: id => actors.find(a => a.id === id) ?? null },
		messages: { contents: messages },
	};
	globalThis.ChatMessage = {
		create:     vi.fn(async data => data),
		getSpeaker: vi.fn(({ actor } = {}) => ({ alias: actor?.name ?? "" })),
	};
	globalThis.ChatMessage.implementation = { createDocuments: vi.fn(async list => list) };
	// With `{create: false}`, core answers the message's data for the caller to create.
	const toMessage = vi.fn(async data => data);
	globalThis.Roll = class {
		constructor(formula) { this.formula = formula; }
		async evaluate() { this.total = rolled; return this; }
		toMessage(...args) { return toMessage(...args); }
	};
	globalThis.ui = {
		notifications: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
		chat:          { updateMessage: vi.fn() },
	};
	return { toMessage, act: id => { globalThis.game.user = users.find(u => u.id === id); } };
}

/** Put back what tests/setup.js installed. For an `afterEach`. */
export function restoreCampWorld() {
	globalThis.game = SETUP.game;
	globalThis.ui = SETUP.ui;
	delete globalThis.ChatMessage;
	delete globalThis.Roll;
}

/**
 * Aeliana, played by player-1, and Bram, played by player-2, carrying nothing; and a GM with no
 * character. Everyone is logged in unless `bramOnline` says otherwise.
 */
export function campParty({ me = "player-1", bramOnline = true, aeliana = {}, bram = {}, others = [], messages = [], rolled = 3 } = {}) {
	const a = campCharacter({ id: "aeliana", name: "Aeliana", owners: ["player-1"], ...aeliana });
	const b = campCharacter({ id: "bram", name: "Bram", owners: ["player-2"], carried: {}, ...bram });
	const users = [
		{ id: "gm",       isGM: true,  active: true,       character: null },
		{ id: "player-1", isGM: false, active: true,       character: a },
		{ id: "player-2", isGM: false, active: bramOnline, character: b },
	];
	return { aeliana: a, bram: b, ...campWorld({ me, users, actors: [a, b, ...others], messages, rolled }) };
}
