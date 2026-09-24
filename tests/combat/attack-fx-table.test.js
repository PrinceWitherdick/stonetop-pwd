import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { WEAPON_META, MOVE_GRANTED_WEAPONS } from "../../module/data/weapons.js";
import { attackWeapon } from "../../module/utils/damage.js";
import {
	FX_KINDS, HIT_BURST, SOUND_FILES, blowDelivery, blowKind, blowSounds, fxFile, fxFilesFor,
	hitReaction, onTargetSize, swingSize,
} from "../../module/combat/attack-fx-table.js";

const kindOf = p => blowKind(p).kind;

describe("blowKind: what a blow is", () => {
	it("gives every catalog weapon, the holy light and bare hands a kind", () => {
		for (const [slug, meta] of Object.entries(WEAPON_META)) {
			expect(FX_KINDS[kindOf({ weapon: { slug, ...meta } })], slug).toBeTruthy();
		}
		const holy = MOVE_GRANTED_WEAPONS["Purifying Flames"];
		expect(kindOf({ weapon: { slug: holy.slug, ...holy.meta } })).toBe("holy");
		expect(kindOf({ weapon: null })).toBe("fist");
		// The attack flow's own nameless bare-hands record (attack-flow.js#unarmedWeapon).
		expect(kindOf({ weapon: { name: "", range: ["hand"] } })).toBe("fist");
	});

	it("reads a catalog weapon by its slug, and a gear choice by the choice", () => {
		expect(kindOf({ weapon: { slug: "sword", name: "Sword" } })).toBe("sword");
		expect(kindOf({ weapon: { slug: "weapons-of-war:sword", name: "Sword" } })).toBe("sword");
		expect(kindOf({ weapon: { slug: "bow-arrows", name: "Bow & arrows" } })).toBe("arrow");
		expect(kindOf({ weapon: { slug: "crossbow", name: "Crossbow" } })).toBe("bolt");
		expect(kindOf({ weapon: { slug: "hatchet", name: "Hatchet" } })).toBe("handaxe");
	});

	it("reads a write-in weapon by its name", () => {
		expect(kindOf({ weapon: { slug: "", name: "Grandfather's longbow" } })).toBe("arrow");
		expect(kindOf({ weapon: { slug: "", name: "Rusty short sword" } })).toBe("shortsword");
		expect(kindOf({ weapon: { slug: "", name: "Unarmed" } })).toBe("fist");
	});

	it("reads a stat block's blow by its printed name, earliest word first", () => {
		const blow = (label, tags = []) => kindOf({ weapon: attackWeapon({ tags }), blow: label });
		expect(blow("bite", ["close"])).toBe("bite");
		expect(blow("talons", ["hand", "close", "grabby"])).toBe("claw");
		expect(blow("slings", ["near"])).toBe("sling");
		expect(blow("bow", ["far"])).toBe("arrow");
		expect(blow("spears", ["close", "thrown"])).toBe("spear");
		// One attack, two names: the first is what the book leads with.
		expect(blow("bite or maul", ["close"])).toBe("bite");
		expect(blow("club, adz", ["close"])).toBe("club");
		expect(blow("Breathe sticky fire", ["near"])).toBe("fire");
		expect(blow("crossbow", ["far"])).toBe("bolt");
	});

	it("falls back on the blow's range, then a slash", () => {
		expect(kindOf({ weapon: attackWeapon({ tags: ["near"] }), blow: "hurled rocks" })).toBe("burst");
		expect(kindOf({ weapon: attackWeapon({ tags: ["close", "messy"] }), blow: "thrashing" })).toBe("slash");
		expect(kindOf({ weapon: attackWeapon({ tags: [] }), blow: "" })).toBe("slash");
	});

	it("knows which weapons can be thrown", () => {
		expect(blowKind({ weapon: { slug: "spear", ...WEAPON_META.spear } }).thrownCapable).toBe(true);
		expect(blowKind({ weapon: { slug: "long-spear", ...WEAPON_META["long-spear"] } }).thrownCapable).toBe(false);
		expect(blowKind({ weapon: attackWeapon({ tags: ["close", "thrown"] }), blow: "spears" }).thrownCapable).toBe(true);
	});
});

describe("blowDelivery: how it travels", () => {
	it("shoots what is shot and bites what is bitten", () => {
		expect(blowDelivery("arrow")).toBe("projectile");
		expect(blowDelivery("sling", { touching: true })).toBe("projectile");
		expect(blowDelivery("bite")).toBe("onTarget");
		expect(blowDelivery("burst")).toBe("onTarget");
		expect(blowDelivery("sword", { moveKey: "let-fly" })).toBe("swing");
	});

	it("throws a spear with Let Fly and thrusts it with Clash", () => {
		expect(blowDelivery("spear", { thrownCapable: true, moveKey: "let-fly", touching: true })).toBe("throw");
		expect(blowDelivery("spear", { thrownCapable: true, moveKey: "call-the-shot" })).toBe("throw");
		expect(blowDelivery("spear", { thrownCapable: true, moveKey: "clash", touching: false })).toBe("swing");
	});

	it("lets the map decide off a move: in contact it stabs, at a distance it flies", () => {
		expect(blowDelivery("spear", { thrownCapable: true, touching: true })).toBe("swing");
		expect(blowDelivery("spear", { thrownCapable: true, touching: false })).toBe("throw");
		expect(blowDelivery("handaxe", { thrownCapable: true, moveKey: "ambush", touching: false })).toBe("throw");
	});

	it("always throws a javelin and always swings a long spear", () => {
		expect(blowDelivery("javelin", { moveKey: "clash", touching: true })).toBe("throw");
		expect(blowDelivery("spear", { thrownCapable: false, moveKey: "let-fly" })).toBe("swing");
	});

	it("never throws a kind with nothing to throw", () => {
		expect(blowDelivery("sword", { thrownCapable: true, touching: false })).toBe("swing");
	});
});

describe("choosing a file", () => {
	it("takes the first key the database holds, the delivery's fallback last", () => {
		const free = new Set(["jb2a.arrow.physical.white.01", "jb2a.melee_generic.slash.01.orange"]);
		expect(fxFile(fxFilesFor("spear", "throw"), p => free.has(p))).toBe("jb2a.arrow.physical.white.01");
		const patreon = new Set([...free, "jb2a.spear.throw.01"]);
		expect(fxFile(fxFilesFor("spear", "throw"), p => patreon.has(p))).toBe("jb2a.spear.throw.01");
		expect(fxFile(fxFilesFor("maul", "swing"), p => free.has(p))).toBe("jb2a.melee_generic.slash.01.orange");
		expect(fxFile(fxFilesFor("sword", "swing"), () => false)).toBeNull();
	});

	it("sizes a swing by the attacker and a bite by the one bitten", () => {
		expect(swingSize(1)).toBe(5);
		expect(swingSize(2)).toBe(10);
		expect(swingSize(0.5)).toBe(5);
		expect(swingSize(undefined)).toBe(5);
		expect(onTargetSize(1, 1)).toBe(1.5);
		expect(onTargetSize(2, 3)).toBe(4.5);
	});
});

describe("blowSounds", () => {
	it("looses an arrow with a fly-by and lands it with an impact", () => {
		expect(blowSounds("arrow", "projectile")).toEqual([{ sound: "flyBy", at: 0 }, { sound: "arrowImpact", at: "land" }]);
		expect(blowSounds("arrow", "projectile", { missed: true })).toEqual([{ sound: "flyBy", at: 0 }]);
		expect(blowSounds("spear", "throw", { missed: true })).toEqual([{ sound: "whoosh", at: 0 }]);
	});

	it("growls with a bite and hits with a swing", () => {
		expect(blowSounds("bite", "onTarget").map(c => c.sound)).toEqual(["growl", "meleeHit"]);
		expect(blowSounds("sword", "swing")).toEqual([{ sound: "meleeHit", at: 550 }]);
	});

	it("names only sounds that exist", () => {
		for (const kind of Object.keys(FX_KINDS)) {
			for (const delivery of ["swing", "throw", "projectile", "onTarget"]) {
				for (const missed of [false, true]) {
					for (const cue of blowSounds(kind, delivery, { missed })) expect(SOUND_FILES[cue.sound], `${kind}/${delivery}`).toBeTruthy();
				}
			}
		}
	});
});

describe("hitReaction", () => {
	it("bursts on HP lost, clanks on armor that held, and does nothing for nothing", () => {
		expect(hitReaction({ raw: 6, effective: 4, lowered: true })).toBe("burst");
		expect(hitReaction({ raw: 3, effective: 0, lowered: false })).toBe("clank");
		expect(hitReaction({ ignored: true })).toBe("clank");
		expect(hitReaction({ raw: 0, effective: 0, lowered: false })).toBeNull();
		// A character already at 0 HP loses none, but the blow still landed through the armor.
		expect(hitReaction({ raw: 5, effective: 5, lowered: false })).toBeNull();
	});
});

describe("SOUND_FILES", () => {
	const all = Object.values(SOUND_FILES).flat();

	it("names every file outright, never by wildcard", () => {
		expect(all.some(f => f.includes("*"))).toBe(false);
		expect(all.every(f => f.startsWith("modules/soundfxlibrary/") && f.endsWith(".mp3"))).toBe(true);
	});

	it("lists what the module ships, and skips the shield hit it does not", () => {
		expect(SOUND_FILES.meleeHit).toHaveLength(13);
		expect(SOUND_FILES.whoosh).toHaveLength(1);
		expect(SOUND_FILES.flyBy).toHaveLength(3);
		expect(SOUND_FILES.arrowImpact).toHaveLength(5);
		expect(SOUND_FILES.shieldHit).toHaveLength(11);
		expect(SOUND_FILES.shieldHit.some(f => f.endsWith("shield-hit-2.mp3"))).toBe(false);
		expect(SOUND_FILES.impact).toHaveLength(6);
		expect(SOUND_FILES.growl).toHaveLength(6);
	});
});

// Against the modules themselves, where this machine has them installed beside the system. A
// renamed JB2A key or a moved mp3 is the kind of change nothing else would ever notice.
const MODULES = fileURLToPath(new URL("../../../../modules/", import.meta.url));
const FREE_DB = `${MODULES}JB2A_DnD5e/scripts/jb2a_sequencer.js`;
const PATREON_DB = `${MODULES}jb2a_patreon/scripts/jb2a_sequencer.js`;

/** Sequencer's flattened keys for a JB2A database object (`_templates`, `_markers` and the like left out). */
function flatten(node, prefix, out) {
	if (typeof node === "string" || Array.isArray(node)) { out.push(prefix); return out; }
	for (const [key, value] of Object.entries(node ?? {})) {
		if (key.startsWith("_")) continue;
		flatten(value, `${prefix}.${key}`, out);
	}
	return out;
}

/** The loader fills the module's exported database object and returns nothing. */
async function loadDb(file, fn, exported) {
	const mod = await import(pathToFileURL(file).href);
	await mod[fn]("modules");
	return flatten(mod[exported], "jb2a", []);
}

const holds = entries => path => entries.some(e => e === path || e.startsWith(`${path}.`));

describe.skipIf(!existsSync(FREE_DB))("against the installed JB2A", () => {
	it("names only keys some JB2A database holds, and gives every kind a free-module file", async () => {
		const free = holds(await loadDb(FREE_DB, "jb2aFreeDatabase", "freeDatabase"));
		const patreon = existsSync(PATREON_DB) ? holds(await loadDb(PATREON_DB, "jb2aPatreonDatabase", "patreonDatabase")) : () => false;
		for (const [kind, deliveries] of Object.entries(FX_KINDS)) {
			for (const [delivery, keys] of Object.entries(deliveries)) {
				for (const key of keys) expect(free(key) || patreon(key), `${kind}/${delivery}: ${key}`).toBe(true);
				expect(keys.some(free), `${kind}/${delivery} has no free file`).toBe(true);
			}
		}
		expect(HIT_BURST.some(free)).toBe(true);
	});
});

describe.skipIf(!existsSync(`${MODULES}soundfxlibrary`))("against the installed SoundFx Library", () => {
	it("names only files the module ships", () => {
		for (const file of Object.values(SOUND_FILES).flat()) {
			expect(existsSync(`${MODULES}${file.slice("modules/".length)}`), file).toBe(true);
		}
	});
});
