// A *stateful* fake actor + faithful repositories, so a real StonetopCharacter can be
// driven through an entire level-1→exhaustion climb. Unlike FakeActorBuilder (whose
// update / createEmbeddedDocuments are inert vi.fn()s), this actor actually applies
// `update` dot-path writes and grows/shrinks its `items` array, so each subsequent
// getLevelUpData() reflects the moves, stats, level and XP gained by the prior step —
// exactly as Foundry would. Moves come from the pack SOURCE (see sourcePack.js) so
// crossPlaybook / cap / requirement data matches runtime.

import { vi } from "vitest";
import { StonetopCharacter } from "../../module/actors/character/StonetopCharacter.js";
import { MoveDefinition } from "../../module/model/MoveDefinition.js";
import { FakeRepositoryFactory } from "./FakeRepositoryFactory.js";
import { loadPlaybookMoveDocs, movesByPlaybook, loadPlaybookDefs, STAT_KEYS } from "./sourcePack.js";

// Loaded once for the whole test file.
const ALL_DOCS = loadPlaybookMoveDocs();
const BY_NAME  = movesByPlaybook(ALL_DOCS);
const BY_ID    = new Map(ALL_DOCS.map(d => [d._id, d]));
const { bySlug: PB_BY_SLUG, byName: PB_BY_NAME } = loadPlaybookDefs();
// A playbook's "either X OR Y" starting-move groups. data/playbooks.json keeps the pack's
// `moves` block as `movesNote`; the engine reads them as StonetopPlaybook#startingMoveChoices.
const choiceGroupsOf = pb => pb?.movesNote?.choices ?? [];

// The standard creation array (+2/+1/+1/0/0/-1) with the +2 in STR, so STR-gated moves
// (the Heavy's Musclebound = STR +2) are reachable from level 1.
export const STANDARD_ARRAY = { str: 2, dex: 1, con: 1, int: 0, wis: 0, cha: -1 };

// Deterministic item ids (no Math.random/Date) so a run is reproducible.
let __idSeq = 0;
const nextId = () => `live-itm-${++__idSeq}`;
export function resetLiveIds() { __idSeq = 0; }

// ── dot-path helpers (mirror FakeActorBuilder's, with dotted-key support) ──────────
function getPath(obj, keyPath) {
	if (!obj || !keyPath) return undefined;
	if (Object.hasOwn(obj, keyPath)) return obj[keyPath];
	return String(keyPath).split(".").reduce((v, k) => v?.[k], obj);
}
function setPath(obj, keyPath, value) {
	const parts = String(keyPath).split(".");
	let cur = obj;
	for (const k of parts.slice(0, -1)) { cur[k] ??= {}; cur = cur[k]; }
	cur[parts.at(-1)] = value;
}
function unsetPath(obj, keyPath) {
	const parts = String(keyPath).split(".");
	let cur = obj;
	for (const k of parts.slice(0, -1)) { cur = cur?.[k]; if (!cur) return; }
	delete cur[parts.at(-1)];
}

function makeFlagStore(seed = {}) {
	const scoped = {};
	for (const [k, v] of Object.entries(seed)) setPath(scoped, k, v);
	// Both scopes alias the same object, matching FakeActorBuilder.
	return { "stonetop-pwd": scoped, stonetop: scoped };
}

// A live embedded Item. `data` is a toObject()-style payload ({ name, type, system,
// flags? }); every created item gets a fresh id, so a repeatable move's instances stay
// distinct (ownedIds, the stat-choice flag keyed by item id, grantedBy cascades, …).
export function makeLiveItem(data) {
	const _id = nextId();
	const flags = makeFlagStore();
	if (data.flags?.["stonetop-pwd"]) Object.assign(flags["stonetop-pwd"], structuredClone(data.flags["stonetop-pwd"]));
	return {
		_id,
		get id() { return _id; },
		type: data.type ?? "move",
		name: data.name,
		system: data.system ?? {},
		flags,
		getFlag: (scope, key) => getPath(flags[scope], key) ?? null,
		setFlag: vi.fn(async (scope, key, val) => { flags[scope] ??= {}; setPath(flags[scope], key, val); }),
		unsetFlag: vi.fn(async (scope, key) => unsetPath(flags[scope], key)),
	};
}

function makeStatsObject(stats = {}) {
	const out = {};
	for (const k of STAT_KEYS) out[k] = { value: stats[k] ?? 0 };
	return out;
}

export function makeLiveActor({ slug, name, level = 1, xp = 9999, stats = {}, items = [], flags = {} } = {}) {
	const flagStore = makeFlagStore(flags);
	const actor = {
		name: name ?? "Test Hero",
		type: "character",
		system: {
			playbook: { slug, name },
			stats: makeStatsObject(stats),
			attributes: {
				level:  { value: level },
				xp:     { value: xp, max: xp },
				hp:     { value: 8, max: 8 },
				armor:  { value: 0 },
				damage: { value: "d4" },
				debilities: { options: {
					weakened:  { value: false, stat: ["str", "dex"] },
					dazed:     { value: false, stat: ["int", "wis"] },
					miserable: { value: false, stat: ["con", "cha"] },
				} },
			},
		},
		items: items.slice(),
		flags: flagStore,
		getFlag: (scope, key) => getPath(flagStore[scope], key) ?? null,
		setFlag: vi.fn(async (scope, key, val) => { flagStore[scope] ??= {}; setPath(flagStore[scope], key, val); }),
		unsetFlag: vi.fn(async (scope, key) => unsetPath(flagStore[scope], key)),
		// Real, stateful writes — the whole point of this harness.
		update: vi.fn(async (updates = {}) => {
			for (const [k, v] of Object.entries(updates)) {
				// A deletion in either spelling deletionEntry writes: the legacy "-=key" or a
				// ForcedDeletion value. Set as a value, either would leave the key standing.
				const last = k.lastIndexOf(".");
				if (k.slice(last + 1).startsWith("-=")) unsetPath(actor, `${k.slice(0, last + 1)}${k.slice(last + 3)}`);
				else if (v instanceof (globalThis.foundry?.data?.operators?.ForcedDeletion ?? class {})) unsetPath(actor, k);
				else setPath(actor, k, v);
			}
		}),
		createEmbeddedDocuments: vi.fn(async (_type, dataArr = []) => {
			const created = dataArr.map(makeLiveItem);
			actor.items.push(...created);
			return created;
		}),
		deleteEmbeddedDocuments: vi.fn(async (_type, ids = []) => {
			const set = new Set(ids);
			actor.items = actor.items.filter(i => !set.has(i._id));
			return [...set];
		}),
	};
	return actor;
}

function makeSourceMoveRepo() {
	return {
		getPlaybookMoves: async (name) => (BY_NAME.get(name) ?? []).map(d => new MoveDefinition(d)),
		getPlaybookMoveDocument: async (id) => {
			const raw = BY_ID.get(id);
			if (!raw) return null;
			return { ...raw, toObject: () => ({ _id: raw._id, name: raw.name, type: "move", system: structuredClone(raw.system) }) };
		},
		getBasicMoves:           async () => [],
		getBasicMoveDocument:    async () => null,
		getExpeditionMoves:      async () => [],
		getPostDeathMoves:       async () => [],
		getPostDeathMoveDocument: async () => null,
	};
}

// The either/or groups ride along as the getter the engine reads them by, so the other half
// taken at a level-up counts as the pick it is. The starting-moves note does not: a climb's
// character never made its free pick, so its budget is its level-ups alone.
function makePlaybookRepo() {
	return {
		findBySlug: async (slug) => {
			const pb = PB_BY_SLUG.get(slug);
			return pb ? { ...pb, startingMoveChoices: choiceGroupsOf(pb) } : null;
		},
	};
}

// A freshly-created character owns its playbook's starting moves; seed them so prereqs
// rooted at a starting move resolve and starting moves aren't re-offered at level-up. Of an
// "either X OR Y" group only the first option, as onboarding grants it (stamped as the one
// started with), so the other half stays open to a level-up pick.
export function startingMoveItems(playbookName) {
	const groups = choiceGroupsOf(PB_BY_NAME.get(playbookName));
	const later  = new Set(groups.flatMap(g => (g.options ?? []).slice(1)));
	const first  = new Set(groups.map(g => g.options?.[0]).filter(Boolean));
	return (BY_NAME.get(playbookName) ?? [])
		.filter(d => d.system?.isStartingMove && !later.has(d.name))
		.map(d => makeLiveItem({
			name: d.name, type: "move", system: structuredClone(d.system),
			flags: first.has(d.name) ? { "stonetop-pwd": { startingChoice: true } } : undefined,
		}));
}

export function buildLiveCharacter({
	slug, name, stats = STANDARD_ARRAY, level = 1, xp = 9999,
	seedStartingMoves = true, items = [], flags = {},
} = {}) {
	const startItems = seedStartingMoves ? startingMoveItems(name) : [];
	const actor = makeLiveActor({ slug, name, level, xp, stats, items: [...startItems, ...items], flags });
	const factory = new FakeRepositoryFactory({ playbook: makePlaybookRepo(), moves: makeSourceMoveRepo() });
	const char = new StonetopCharacter(actor, factory);
	return { char, actor };
}

// Convenience accessors used by the climb tests.
export function ownedMoveNames(actor) {
	return actor.items.filter(i => i.type === "move").map(i => i.name);
}
export function moveCount(actor) {
	return actor.items.filter(i => i.type === "move").length;
}
export function sourceMovesFor(playbookName) {
	return BY_NAME.get(playbookName) ?? [];
}
