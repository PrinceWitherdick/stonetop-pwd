import { SYSTEM_ID } from "../../module/system-id.js";
import { SOUND_FILES } from "../../module/combat/attack-fx-table.js";

// logger.js captures console.warn when it loads, so a console spy never sees these.
vi.mock("../../module/utils/logger.js", () => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn() }));
const { warn } = await import("../../module/utils/logger.js");
const {
	playBlowFx, playMissFx, playHitReactions, hideAttackFxForReducedMotion, tokenOnScene, jb2aHas,
	MAX_ANIMATED_TARGETS,
} = await import("../../module/combat/attack-fx.js");

// ── A recording Sequencer ─────────────────────────────────────────────────────────────────────
// Every call on an effect is written down and answers the effect, as Sequencer's own fluent API
// does, so a test reads back exactly the recipe a blow was built with.
let sequences = [];
let playResult = () => Promise.resolve();

function recordingEffect() {
	const calls = [];
	const effect = new Proxy({}, {
		get(_t, name) {
			if (name === "calls") return calls;
			if (name === "then") return undefined;
			return (...args) => { calls.push([name, ...args]); return effect; };
		},
	});
	return effect;
}

class FakeSequence {
	constructor(options) {
		this.options = options;
		this.effects = [];
		this.steps = [];
		sequences.push(this);
	}
	effect() { const e = recordingEffect(); this.effects.push(e); this.steps.push(e); return e; }
	thenDo(fn) { this.steps.push(fn); return this; }
	play() { return playResult(); }
}

const called = (effect, name) => effect.calls.filter(c => c[0] === name).map(c => c.slice(1));

// ── A world ───────────────────────────────────────────────────────────────────────────────────
const SCENE = "scene-1";
const ALL_JB2A = [
	"jb2a.sword.melee.01.white.0", "jb2a.arrow.physical.white.01.30ft", "jb2a.bite.400px.red",
	"jb2a.melee_generic.slash.01.orange.0", "jb2a.impact.010.orange", "jb2a.spear.melee.01.white.0",
	"jb2a.dagger.throw.01.white.15ft",
];

let docs;
const _realGame = global.game;
const _realAudio = globalThis.foundry.audio;
let audioPlay;

function token(id, { x = 0, y = 0, size = 1, scene = SCENE, hidden = false } = {}) {
	const doc = {
		documentName: "Token", id, uuid: `Scene.${scene}.Token.${id}`, parent: { id: scene },
		_source: { x, y, width: size, height: size }, width: size, height: size, hidden,
		object: { name: `${id}-placeable`, controlled: false },
	};
	docs[doc.uuid] = doc;
	return doc;
}

function world({ setting = true, modules = ["sequencer", "JB2A_DnD5e", "soundfxlibrary"], jb2a = ALL_JB2A } = {}) {
	docs = {};
	sequences = [];
	playResult = () => Promise.resolve();
	audioPlay = vi.fn(() => Promise.resolve());
	global.game = {
		...(_realGame ?? {}),
		modules: { get: id => (modules.includes(id) ? { active: true } : undefined) },
		settings: { get: (scope, key) => (scope === SYSTEM_ID && key === "attackFx" ? setting : undefined) },
		users: [{ id: "gm-1", isGM: true }, { id: "player-1", isGM: false }],
	};
	globalThis.canvas = { ready: true, scene: { id: SCENE, grid: { size: 100, type: 1 } } };
	globalThis.Sequence = FakeSequence;
	globalThis.Sequencer = { Database: { flattenedEntries: jb2a } };
	globalThis.foundry.audio = { AudioHelper: { play: audioPlay } };
	globalThis.fromUuidSync = uuid => docs[uuid] ?? null;
}

beforeEach(() => {
	vi.useFakeTimers();
	warn.mockClear();
});

afterEach(() => {
	vi.useRealTimers();
	global.game = _realGame;
	globalThis.foundry.audio = _realAudio;
	delete globalThis.canvas;
	delete globalThis.Sequence;
	delete globalThis.Sequencer;
	delete globalThis.fromUuidSync;
	delete globalThis.matchMedia;
});

const sword = { slug: "sword", name: "Sword", range: ["hand", "close"], tags: [] };
const bow = { slug: "bow-arrows", name: "Bow & arrows", range: ["near"], tags: [] };
const target = t => ({ uuid: t.uuid, name: t.id, hasActor: true });

/** Let the fire-and-forget promise and every timed sound run out. */
const settle = () => vi.runAllTimersAsync();

describe("playBlowFx: the gates", () => {
	it("does nothing at all with the world switch off", async () => {
		world({ setting: false });
		const a = token("a"), b = token("b", { x: 100 });
		expect(playBlowFx({ attacker: a, weapon: sword, targets: [target(b)] })).toBeUndefined();
		await settle();
		expect(sequences).toHaveLength(0);
		expect(audioPlay).not.toHaveBeenCalled();
	});

	it("still sounds a blow without Sequencer, and draws nothing", async () => {
		world({ modules: ["soundfxlibrary"] });
		const a = token("a"), b = token("b", { x: 100 });
		playBlowFx({ attacker: a, weapon: sword, targets: [target(b)] });
		await settle();
		expect(sequences).toHaveLength(0);
		expect(audioPlay).toHaveBeenCalledTimes(1);
	});

	it("draws without the SoundFx Library, and is silent", async () => {
		world({ modules: ["sequencer", "jb2a_patreon"] });
		const a = token("a"), b = token("b", { x: 100 });
		playBlowFx({ attacker: a, weapon: sword, targets: [target(b)] });
		await settle();
		expect(sequences).toHaveLength(1);
		expect(sequences[0].steps.filter(s => typeof s === "function")).toHaveLength(0);
		expect(audioPlay).not.toHaveBeenCalled();
	});

	it("draws nothing without JB2A, or without a canvas", async () => {
		world({ modules: ["sequencer", "soundfxlibrary"] });
		const a = token("a"), b = token("b", { x: 100 });
		playBlowFx({ attacker: a, weapon: sword, targets: [target(b)] });
		globalThis.canvas.ready = false;
		playBlowFx({ attacker: a, weapon: sword, targets: [target(b)] });
		await settle();
		expect(sequences).toHaveLength(0);
		expect(audioPlay).toHaveBeenCalledTimes(2);
	});
});

describe("playBlowFx: never in the way", () => {
	it("swallows a Sequencer that throws, into one warning", async () => {
		world();
		globalThis.Sequence = class { constructor() { throw new Error("broken"); } };
		const a = token("a"), b = token("b", { x: 100 });
		expect(() => playBlowFx({ attacker: a, weapon: sword, targets: [target(b)] })).not.toThrow();
		await settle();
		expect(warn).toHaveBeenCalledTimes(1);
	});

	it("swallows a play that rejects", async () => {
		world();
		playResult = () => Promise.reject(new Error("no video"));
		const a = token("a"), b = token("b", { x: 100 });
		playBlowFx({ attacker: a, weapon: sword, targets: [target(b)] });
		await settle();
		expect(warn).toHaveBeenCalledTimes(1);
	});
});

describe("playBlowFx: the recipes", () => {
	it("swings a sword from the attacker toward the target, sized by the attacker", async () => {
		world();
		const a = token("a", { size: 2 }), b = token("b", { x: 200 });
		playBlowFx({ attacker: a, weapon: sword, targets: [target(b)] });
		const [seq] = sequences;
		expect(seq.options).toEqual({ moduleName: SYSTEM_ID, softFail: true });
		const [swing] = seq.effects;
		expect(called(swing, "file")).toEqual([["jb2a.sword.melee.01.white"]]);
		expect(called(swing, "atLocation")).toEqual([[a.object]]);
		expect(called(swing, "rotateTowards")).toEqual([[b.object]]);
		expect(called(swing, "anchor")).toEqual([[{ x: 0.4, y: 0.5 }]]);
		expect(called(swing, "size")).toEqual([[10, { gridUnits: true }]]);
		expect(called(swing, "stretchTo")).toEqual([]);
		await settle();
	});

	it("looses an arrow along the line, and lands its sound when the flight ends", async () => {
		world();
		const a = token("a"), b = token("b", { x: 600 });
		playBlowFx({ attacker: a, weapon: bow, moveKey: "let-fly", targets: [target(b)] });
		const [seq] = sequences;
		const [arrow] = seq.effects;
		expect(called(arrow, "file")).toEqual([["jb2a.arrow.physical.white.01"]]);
		expect(called(arrow, "stretchTo")).toEqual([[b.object]]);
		expect(called(arrow, "missed")).toEqual([]);
		expect(called(arrow, "waitUntilFinished")).toEqual([[-250]]);
		// The fly-by goes first; the landing comes after the arrow in the sequence.
		const steps = seq.steps.map(s => (typeof s === "function" ? "sound" : "effect"));
		expect(steps).toEqual(["sound", "effect", "sound"]);
		seq.steps.filter(s => typeof s === "function").forEach(fn => fn());
		await settle();
		const played = audioPlay.mock.calls.map(([data, push]) => [data.src, data.channel, push]);
		expect(played).toHaveLength(2);
		expect(SOUND_FILES.flyBy).toContain(played[0][0]);
		expect(SOUND_FILES.arrowImpact).toContain(played[1][0]);
		expect(played.every(([, channel, push]) => channel === "interface" && push === true)).toBe(true);
	});

	it("throws a spear at a distant foe when nothing says otherwise, and thrusts it in contact", async () => {
		world();
		const spear = { slug: "spear", name: "Spear", range: ["close", "thrown"], tags: [] };
		const a = token("a"), far = token("far", { x: 700 }), near = token("near", { x: 100 });
		playBlowFx({ attacker: a, weapon: spear, targets: [target(far)] });
		playBlowFx({ attacker: a, weapon: spear, targets: [target(near)] });
		expect(called(sequences[0].effects[0], "stretchTo")).toEqual([[far.object]]);
		expect(called(sequences[1].effects[0], "rotateTowards")).toEqual([[near.object]]);
		await settle();
	});

	it("bites on the one bitten", async () => {
		world();
		const wolf = token("wolf"), b = token("b", { x: 100 });
		playBlowFx({ attacker: wolf, weapon: { name: "", range: [], tags: ["close"] }, blow: "bite", targets: [target(b)] });
		const [bite] = sequences[0].effects;
		expect(called(bite, "file")).toEqual([["jb2a.bite.400px.red"]]);
		expect(called(bite, "atLocation")).toEqual([[b.object]]);
		expect(called(bite, "size")).toEqual([[1.5, { gridUnits: true }]]);
		expect(called(bite, "fadeIn")).toEqual([[250]]);
		await settle();
	});

	it("keeps a hidden token's blow to the GMs", async () => {
		world();
		const a = token("a", { hidden: true }), b = token("b", { x: 100 });
		playBlowFx({ attacker: a, weapon: sword, targets: [target(b)] });
		expect(called(sequences[0].effects[0], "forUsers")).toEqual([[["gm-1"]]]);
		await settle();
	});

	it("is only heard when the attacker stands on another scene", async () => {
		world();
		const a = token("a", { scene: "elsewhere" }), b = token("b", { x: 100 });
		playBlowFx({ attacker: a, weapon: sword, targets: [target(b)] });
		await settle();
		expect(sequences).toHaveLength(0);
		expect(audioPlay).toHaveBeenCalledTimes(1);
		// Out in the open: pushed to every client.
		expect(audioPlay.mock.calls[0][1]).toBe(true);
	});

	it("keeps a hidden token's sounds to the GMs too", async () => {
		world();
		const a = token("a", { scene: "elsewhere" }), b = token("b", { x: 100, hidden: true });
		playBlowFx({ attacker: a, weapon: sword, targets: [target(b)] });
		await settle();
		expect(audioPlay).toHaveBeenCalledTimes(1);
		expect(audioPlay.mock.calls[0][1]).toEqual({ recipients: ["gm-1"] });
	});

	it("keeps a whispered roll's blow to the GMs and the roller", async () => {
		world();
		global.game.user = { id: "player-1", isGM: false };
		const a = token("a"), b = token("b", { x: 100 });
		playBlowFx({ attacker: a, weapon: sword, targets: [target(b)], whispered: true });
		expect(called(sequences[0].effects[0], "forUsers")).toEqual([[["gm-1", "player-1"]]]);
		sequences[0].steps.filter(s => typeof s === "function").forEach(fn => fn());
		await settle();
		// The roller hears it here; only the GMs are sent it.
		expect(audioPlay).toHaveBeenCalled();
		for (const [, push] of audioPlay.mock.calls) expect(push).toEqual({ recipients: ["gm-1"] });
	});

	it("draws at most six of a crowd, and sounds the blow once", async () => {
		world();
		const a = token("a");
		const crowd = Array.from({ length: 9 }, (_, i) => token(`t${i}`, { x: 100 }));
		playBlowFx({ attacker: a, weapon: sword, targets: crowd.map(target) });
		expect(sequences[0].effects).toHaveLength(MAX_ANIMATED_TARGETS);
		sequences[0].steps.filter(s => typeof s === "function").forEach(fn => fn());
		await settle();
		expect(audioPlay).toHaveBeenCalledTimes(1);
	});
});

describe("playMissFx", () => {
	it("sends an arrow wide, and only its launch is heard", async () => {
		world();
		const a = token("a"), b = token("b", { x: 600 });
		playMissFx({ attacker: a, weapon: bow, moveKey: "let-fly", targets: [target(b)] });
		const [arrow] = sequences[0].effects;
		expect(called(arrow, "missed")).toEqual([[true]]);
		sequences[0].steps.filter(s => typeof s === "function").forEach(fn => fn());
		await settle();
		expect(audioPlay).toHaveBeenCalledTimes(1);
		expect(SOUND_FILES.flyBy).toContain(audioPlay.mock.calls[0][0].src);
	});

	it("draws no miss for a sword", async () => {
		world();
		const a = token("a"), b = token("b", { x: 100 });
		playMissFx({ attacker: a, weapon: sword, moveKey: "ambush", targets: [target(b)] });
		await settle();
		expect(sequences).toHaveLength(0);
		expect(audioPlay).not.toHaveBeenCalled();
	});
});

describe("playHitReactions", () => {
	it("bursts on the tokens that lost HP, with one impact for the press", async () => {
		world();
		const hurt = token("hurt"), held = token("held", { x: 300 });
		playHitReactions([{ uuid: hurt.uuid, reaction: "burst" }, { uuid: held.uuid, reaction: "clank" }]);
		await settle();
		expect(sequences).toHaveLength(1);
		expect(sequences[0].effects.map(e => called(e, "atLocation")[0][0])).toEqual([hurt.object]);
		expect(audioPlay).toHaveBeenCalledTimes(1);
		expect(SOUND_FILES.impact).toContain(audioPlay.mock.calls[0][0].src);
	});

	it("keeps a whispered card's burst to the GMs and whoever pressed Apply", async () => {
		world();
		global.game.user = { id: "player-1", isGM: false };
		const hurt = token("hurt");
		playHitReactions([{ uuid: hurt.uuid, reaction: "burst" }], { whispered: true });
		await settle();
		expect(called(sequences[0].effects[0], "forUsers")).toEqual([[["gm-1", "player-1"]]]);
		expect(audioPlay.mock.calls[0][1]).toEqual({ recipients: ["gm-1"] });
	});

	it("only clanks when armor held everything", async () => {
		world();
		const held = token("held");
		playHitReactions([{ uuid: held.uuid, reaction: "clank" }, { uuid: "x", reaction: null }]);
		await settle();
		expect(sequences).toHaveLength(0);
		expect(SOUND_FILES.shieldHit).toContain(audioPlay.mock.calls[0][0].src);
	});
});

describe("tokenOnScene", () => {
	it("finds an actor's one token here, and no token when it stands here twice", () => {
		world();
		const one = token("one");
		const actor = { documentName: "Actor", getActiveTokens: () => [one] };
		docs["Actor.pc"] = actor;
		expect(tokenOnScene("Actor.pc")).toBe(one);
		const twice = { documentName: "Actor", getActiveTokens: () => [token("x"), token("y")] };
		expect(tokenOnScene(twice)).toBeNull();
		const offScene = { documentName: "Actor", getActiveTokens: () => [token("z", { scene: "elsewhere" })] };
		expect(tokenOnScene(offScene)).toBeNull();
	});

	it("takes an unlinked actor's own token", () => {
		world();
		const own = token("own");
		expect(tokenOnScene({ documentName: "Actor", token: own })).toBe(own);
	});
});

describe("jb2aHas", () => {
	it("matches a whole key or a branch, never half a word", () => {
		world({ jb2a: ["jb2a.claws.400px.red", "jb2a.club.melee.01.white.2"] });
		expect(jb2aHas("jb2a.claws.400px.red")).toBe(true);
		expect(jb2aHas("jb2a.club.melee.01.white")).toBe(true);
		expect(jb2aHas("jb2a.club.melee.01.whi")).toBe(false);
		expect(jb2aHas("jb2a.cl")).toBe(false);
	});
});

describe("hideAttackFxForReducedMotion", () => {
	const reduced = on => { globalThis.matchMedia = () => ({ matches: on }); };

	it("hides this system's effects from a reader who asked for less motion", () => {
		reduced(true);
		const ours = { data: { moduleName: SYSTEM_ID, opacity: 1 } };
		const theirs = { data: { moduleName: "autoanimations", opacity: 1 } };
		hideAttackFxForReducedMotion(ours);
		hideAttackFxForReducedMotion(theirs);
		expect(ours.data.opacity).toBe(0);
		expect(theirs.data.opacity).toBe(1);
	});

	it("leaves them alone otherwise", () => {
		reduced(false);
		const ours = { data: { moduleName: SYSTEM_ID, opacity: 1 } };
		hideAttackFxForReducedMotion(ours);
		expect(ours.data.opacity).toBe(1);
	});
});
