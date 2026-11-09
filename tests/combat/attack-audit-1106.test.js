import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { SCOPE, installCombatChatFakes, uninstallCombatChatFakes, makeMessage } from "../fakes/combat-chat.js";

// The 2026-11-06 combat audit's (round 2) ATK findings and the items the ATK fixer took on: FGT-3, EDG-11, FOE-6's
// on-the-fly piercing, EDG-13's weapon picker. One block each.

const attackFlow = await import("../../module/combat/attack-flow.js");
const {
	carriedAttackWeapons, sufferEnemyAttack, versusNames, versusRowsFor, blowMaterial,
	attackerDowned, weaponWarningsHtml, concealedTraits, setPiercingOnTheFly, piercingOnTheFly, PIERCING_ON_THE_FLY,
	setArmorIgnoredOnTheFly, letFlyAmmoStatuses, depleteAmmoAndPost,
} = attackFlow;
const { withoutDowned } = await import("../../module/fight/fight-targets.js");
const { weaponMeta, weaponMaterial, bronzeMeta, isLetFlyWeapon, EXTRA_ARROWS_SLUG } = await import("../../module/data/weapons.js");
const { weaponMetaFromNote, ownDamageDie } = await import("../../module/data/weapon-from-note.js");
const { openDamageCard } = await import("../../module/actors/character/damage-card-boost.js");
const { beingApplied } = await import("../../module/utils/applying-mark.js");

const LET_FLY = { key: "let-fly", filter: isLetFlyWeapon };

/** A character whose StonetopCharacter answers with `gear`, its flags in a plain map it can also write. */
function actorWith(gear, flags = {}) {
	const store = { ...flags };
	return {
		name: "Rhianna", uuid: "Actor.rhi", type: "character", items: [],
		typedActor: { carriedWeaponGear: async () => gear },
		getFlag: (_scope, path) => store[path] ?? null,
		update: vi.fn(async changes => {
			for (const [key, value] of Object.entries(changes)) {
				const m = /^flags\.[^.]+\.inventory\.resources\.(.+)$/.exec(key);
				if (m) store["inventory.resources"] = { ...(store["inventory.resources"] ?? {}), [m[1]]: value };
			}
		}),
		store,
	};
}
const catalogRow = (slug, over = {}) => ({ slug, weaponSlug: slug, name: null, note: null, ammoStore: "inventory", ammo: false, catalog: true, ...over });
const BOW = catalogRow("bow-arrows", { ammo: true, ammoMax: 2, ammoLabels: ["low ammo", "all out"] });
const EXTRA = catalogRow(EXTRA_ARROWS_SLUG, { name: "Extra arrows", ammo: true, ammoMax: 3, ammoLabels: ["plenty left", "low ammo", "all out"] });

const I18N = globalThis.game?.i18n;
let posted;
beforeEach(() => { posted = installCombatChatFakes(); globalThis.game.i18n = I18N; });
afterEach(() => { uninstallCombatChatFakes(); vi.restoreAllMocks(); });

describe("ATK-1: a monster's 'Armor N vs. X' meets what the blow is made of", () => {
	it("knows the book's iron weapons as iron (Book I p.94-95), bronze as bronze, the mallet as unknown", () => {
		for (const slug of ["spear", "long-spear", "hatchet", "mattock", "maul", "javelins", "knife-dagger", "bow-arrows", "sword", "warhammer"]) {
			expect(weaponMaterial(weaponMeta(slug))).toBe("iron");
		}
		expect(weaponMaterial(bronzeMeta("spear"))).toBe("bronze");
		expect(weaponMaterial(weaponMeta("silver-alloy-dagger"))).toBe("silver");
		expect(weaponMaterial(weaponMeta("mallet"))).toBeNull();
		expect(weaponMaterial(weaponMeta("staff"))).toBeNull();
		// A card weapon written before it carried a material is read off the table by its slug.
		expect(weaponMaterial({ slug: "spear", name: "Spear" })).toBe("iron");
	});

	it("reads the bestiary's clauses as written: 'bronze or fire' names bronze, 'black iron' is not iron", () => {
		expect(versusNames("vs. bronze", "bronze")).toBe(true);
		expect(versusNames("vs. bronze or fire", "bronze")).toBe(true);
		expect(versusNames("vs. black iron", "iron")).toBe(false);
		expect(versusNames("vs. iron", "bronze")).toBe(false);
		expect(versusNames("vs. bare hands", "bare hands")).toBe(true);
		expect(versusNames("Barkskin", "iron")).toBe(false);
	});

	it("opens the box unticked (armor off) on a monster whose exception the blow's material names", () => {
		const weeFolk = { type: "monster", system: { attributes: { armor: { value: 6, conditional: 4, conditionalSource: "vs. iron" } } } };
		const wretch = { type: "monster", system: { attributes: { armor: { value: 4, conditional: 4, conditionalSource: "vs. bronze" } } } };
		const resolve = uuid => ({ documentName: "Token", actor: uuid.endsWith("wee") ? weeFolk : wretch });
		const results = [{ uuid: "Scene.s.Token.wee" }, { uuid: "Scene.s.Token.wretch" }];
		expect(versusRowsFor(results, "iron", { resolve })).toEqual(["Scene.s.Token.wee"]);
		expect(versusRowsFor(results, "bronze", { resolve })).toEqual(["Scene.s.Token.wretch"]);
		expect(versusRowsFor(results, null, { resolve })).toEqual([]);
	});

	it("never seeds a character's conditional armor, which is a move's clause and not a material", () => {
		const pc = { type: "character", system: { attributes: { armor: { value: 2, conditional: 2, conditionalSource: "vs. iron" } } } };
		expect(versusRowsFor([{ uuid: "Actor.x" }], "iron", { resolve: () => pc })).toEqual([]);
	});

	it("names nothing in hand as bare hands, and a known weapon by its material", () => {
		expect(blowMaterial(null)).toBe("bare hands");
		expect(blowMaterial({ name: "", range: ["hand"] })).toBe("bare hands");
		expect(blowMaterial({ slug: "sword", name: "Sword", material: "iron" })).toBe("iron");
		expect(blowMaterial({ slug: "purifying-flames-holy-light", name: "Holy light" })).toBeNull();
	});
});

describe("ATK-5: extra arrows are the bow's next statuses (Book I p.94)", () => {
	it("are not out of ammo while the spare quiver has statuses left", async () => {
		const actor = actorWith([BOW, EXTRA], { "inventory.resources": { "bow-arrows": 2 } });
		const [bow] = await carriedAttackWeapons(actor, LET_FLY);
		expect(bow.spare).toMatchObject({ slug: EXTRA_ARROWS_SLUG, ammoMax: 3 });
		expect(bow.allOut).toBeUndefined();
		expect((await letFlyAmmoStatuses(actor)).allOut).toBe(false);
	});

	it("marks the extra arrows once the bow's own track reads all out, and is all out only when both are", async () => {
		const actor = actorWith([BOW, EXTRA], { "inventory.resources": { "bow-arrows": 2, [EXTRA_ARROWS_SLUG]: 2 } });
		const [bow] = await carriedAttackWeapons(actor, LET_FLY);
		const message = makeMessage({ attack: { weapon: { ...bow, ammo: true, slug: "bow-arrows", name: "Bow & arrows" } } });
		const attack = { move: "Let Fly", weapon: { slug: "bow-arrows", name: "Bow & arrows", ammo: true, ammoMax: 2, ammoLabels: ["low ammo", "all out"], ammoStore: "inventory", spare: bow.spare } };
		const status = await depleteAmmoAndPost(message, actor, attack, "0");
		expect(actor.store["inventory.resources"]).toMatchObject({ "bow-arrows": 2, [EXTRA_ARROWS_SLUG]: 3 });
		expect(status).toMatchObject({ allOut: true });
		const [after] = await carriedAttackWeapons(actor, LET_FLY);
		expect(after.allOut).toBe(true);
	});

	it("leaves a bow with no extra arrows as it was", async () => {
		const actor = actorWith([BOW], { "inventory.resources": { "bow-arrows": 2 } });
		const [bow] = await carriedAttackWeapons(actor, LET_FLY);
		expect(bow.spare).toBeUndefined();
		expect(bow.allOut).toBe(true);
	});
});

describe("ATK-6: an attacker down at 0 HP is cautioned, never stopped (Book I p.240)", () => {
	const hero = (value, flags = {}) => ({ type: "character", name: "Vahid", system: { attributes: { hp: { value, max: 18 } } }, flags: { [SCOPE]: flags }, getFlag: (_s, k) => flags[k] });

	it("is down at 0 HP, dying or out of the action", () => {
		expect(attackerDowned(hero(0))).toBe(true);
		expect(attackerDowned(hero(0, { deathsDoor: "out-of-action" }))).toBe(true);
		expect(attackerDowned(hero(3))).toBe(false);
	});

	it("is not cautioned making Death's Door's last move", () => {
		expect(attackerDowned(hero(0, { deathsDoor: "fate-pending" }))).toBe(false);
		expect(attackerDowned(hero(0, { deathsDoor: "dead" }))).toBe(false);
	});

	it("says so on the damage card", () => {
		expect(weaponWarningsHtml(null, { downed: "Vahid" })).toContain("out of the action");
		expect(weaponWarningsHtml(null, {})).toBe("");
	});
});

describe("FGT-3: a frozen foe that is down neither takes the blow nor strikes back", () => {
	const crinwin = hp => ({ uuid: "Scene.s.Token.c", documentName: "Token", actor: { type: "monster", name: "Crinwin", system: { attributes: { hp: { value: hp, max: 3 }, damage: { value: "claws d6" } } } } });

	it("drops a target at 0 HP from the list, keeps one standing", () => {
		const frozen = [{ uuid: "Scene.s.Token.c", name: "Crinwin" }];
		expect(withoutDowned(frozen, { resolve: () => crinwin(0) })).toEqual([]);
		expect(withoutDowned(frozen, { resolve: () => crinwin(2) })).toBe(frozen);
	});

	it("posts no counter-attack from a foe that is down, and says why", async () => {
		globalThis.fromUuidSync = () => crinwin(0);
		globalThis.fromUuid = async () => crinwin(0);
		const pc = { uuid: "Actor.pim", name: "Pim", type: "character", testUserPermission: () => true };
		expect(await sufferEnemyAttack(pc, { targets: [{ uuid: "Scene.s.Token.c", name: "Crinwin", hasActor: true }] })).toBeNull();
		expect(posted.some(p => p.flags?.[SCOPE]?.damage)).toBe(false);
		expect(posted.at(-1).content).toContain("Crinwin");
		expect(posted.at(-1).content).toContain("is down");
		delete globalThis.fromUuidSync;
	});
});

describe("EDG-11: a picked-up weapon's own damage die", () => {
	it("is read off its tag line, as the naphtha's is (the clay spheres' d10)", () => {
		expect(weaponMetaFromNote("Clay spheres", "damage d10, thrown, area, dangerous, ignores armor")).toMatchObject({ damageDie: "d10", area: true, ignoresArmor: true });
		expect(ownDamageDie("close, d8+1 damage, messy")).toBe("d8+1");
	});

	it("never reads a +die bonus as the weapon's die", () => {
		expect(ownDamageDie("close, +1d4 damage")).toBeNull();
		expect(weaponMetaFromNote("Blade", "close, +1 damage, 1 piercing").damageDie).toBeNull();
	});
});

describe("EDG-13: an artifact not yet worked out keeps its traits from the players", () => {
	it("hides them from a player, never from the GM, and not once it is known", () => {
		expect(concealedTraits({ artifactState: "unknown" }, { isGM: false })).toBe(true);
		expect(concealedTraits({ artifactState: "unknown" }, { isGM: true })).toBe(false);
		expect(concealedTraits({ artifactState: "known" }, { isGM: false })).toBe(false);
		expect(concealedTraits({}, { isGM: false })).toBe(false);
	});

	it("carries the state onto the picker's record", async () => {
		const blade = { slug: "item1", weaponSlug: null, name: "Strange blade", note: "close, +1 damage, messy", catalog: false, artifactState: "unknown" };
		const [weapon] = await carriedAttackWeapons(actorWith([blade]), { key: "clash", filter: m => m.range.includes("close") });
		expect(weapon.artifactState).toBe("unknown");
		expect(weapon.meta.damageBonus).toBe(1);
	});
});

describe("FOE-6: piercing on the fly (Book I p.239)", () => {
	const damage = over => ({ move: "Bite", weapon: { name: "Bite", piercing: 0 }, results: [{ uuid: "Actor.x", raw: 6 }], applied: [], ...over });

	it("writes a whole number from 0 onto the card, and refuses once a row is applied", async () => {
		const message = makeMessage({ damage: damage() });
		expect(await setPiercingOnTheFly(message, 3)).toBe(true);
		expect(message.flags.damage[PIERCING_ON_THE_FLY]).toBe(3);
		expect(piercingOnTheFly(message.flags.damage)).toBe(3);
		expect(await setPiercingOnTheFly(message, 3)).toBe(false);
		const done = makeMessage({ damage: damage({ applied: [{ uuid: "Actor.x" }] }) });
		expect(await setPiercingOnTheFly(done, 2)).toBe(false);
		expect(piercingOnTheFly({ [PIERCING_ON_THE_FLY]: -4 })).toBe(0);
	});
});

describe("ATK-4: nothing rewrites a card while another client applies it", () => {
	const users = { get: id => ({ id, active: id === "gm1" }) };

	it("reads a mark left by a connected user as under way, one by a user gone as not", () => {
		expect(beingApplied({ applying: "gm1" }, users)).toBe(true);
		expect(beingApplied({ applying: "p9" }, users)).toBe(false);
		expect(beingApplied({}, users)).toBe(false);
	});

	it("offers no boost on a card being applied", () => {
		const message = makeMessage({ damage: { results: [{ uuid: "a", raw: 3 }], applied: [], applying: "gm1" } });
		globalThis.game.users = { ...globalThis.game.users, get: id => ({ id, active: true }) };
		expect(openDamageCard(message, "preparationDamage", SCOPE)).toBeNull();
	});

	it("refuses the GM's ignores-armor tick and piercing while it is applied", async () => {
		globalThis.game.users = { ...globalThis.game.users, get: id => ({ id, active: true }) };
		const message = makeMessage({ damage: { move: "Clash", weapon: { name: "Sword" }, results: [{ uuid: "a", raw: 3 }], applied: [], applying: "gm1" } });
		expect(await setArmorIgnoredOnTheFly(message, true)).toBe(false);
		expect(await setPiercingOnTheFly(message, 2)).toBe(false);
	});
});

// FGT-3, the live re-test's exact sequence: a Clash 7-9 freezes Crinwin H; the GM drops it to 0 HP (and marks it
// defeated) before the player presses "Roll your damage". The blow lands on nobody, and the 7-9's "you suffer your
// enemy's attack" says the foe is down rather than asking the GM to name an unknown enemy's damage.
describe("FGT-3: the 7-9 Confirm against a foe killed since the dice", () => {
	const crinwinToken = { uuid: "Scene.s.Token.h", documentName: "Token", name: "Crinwin H", actor: { type: "monster", name: "Crinwin", system: { attributes: { hp: { value: 0, max: 3 }, damage: { value: "claws d6 (hand)" } } } } };
	const aeliana = { uuid: "Actor.ae", id: "ae", name: "Camp Aeliana", type: "character", isOwner: true, items: [], getFlag: () => null, testUserPermission: () => true, system: { attributes: { hp: { value: 12, max: 12 }, damage: { value: "d8" } } } };

	function pressConfirm(message) {
		const listeners = [];
		const btn = { disabled: false, title: "", dataset: { counter: "1" }, innerHTML: "", addEventListener: (type, fn) => listeners.push(fn) };
		const root = { querySelectorAll: sel => (sel === ".stonetop-attack-confirm" ? [btn] : []), querySelector: () => null };
		attackFlow.wireAttackConfirm(message, root);
		return { btn, listeners };
	}

	it("posts a plain damage card and 'Crinwin H is down', never 'Name the enemy's damage'", async () => {
		globalThis.game.settings = { get: (_scope, key) => (key === "promptDamageModifier" ? false : key === "fightTab" ? false : "roll") };
		globalThis.game.users = { ...globalThis.game.users, players: [], get: () => null };
		globalThis.fromUuid = async uuid => (uuid === aeliana.uuid ? aeliana : uuid === crinwinToken.uuid ? crinwinToken : null);
		globalThis.fromUuidSync = uuid => (uuid === crinwinToken.uuid ? crinwinToken : uuid === aeliana.uuid ? aeliana : null);
		globalThis.foundry = { ...(globalThis.foundry ?? {}), utils: { ...(globalThis.foundry?.utils ?? {}), randomID: () => "nonce1" } };
		const message = makeMessage({ attack: { move: "Clash", moveKey: "clash", attackerUuid: aeliana.uuid, weapon: null, targets: [{ uuid: crinwinToken.uuid, name: "Crinwin H", actorId: "c", disposition: -1, hasActor: true }] } });
		message.canUserModify = () => true;
		// The plain card (nobody to hit) goes out through Roll#toMessage.
		globalThis.Roll.prototype.toMessage = async function (data) { posted.push({ ...data, plainRoll: true }); return data; };
		const { listeners } = pressConfirm(message);
		await new Promise(resolve => setTimeout(resolve, 0));
		expect(listeners).toHaveLength(1);
		await listeners[0]({ shiftKey: true });
		await new Promise(resolve => setTimeout(resolve, 0));
		const contents = posted.map(p => String(p.content ?? p.flavor ?? ""));
		expect(contents.some(c => c.includes("Name the enemy"))).toBe(false);
		expect(posted.some(p => p.flags?.[SCOPE]?.sufferAmount || p.flags?.[SCOPE]?.sufferChoice)).toBe(false);
		expect(contents.some(c => c.includes("Crinwin H") && c.includes("is down"))).toBe(true);
		// The blow itself landed on nobody: the plain card, no damage row aimed at the corpse.
		expect(posted.some(p => p.plainRoll)).toBe(true);
		expect(posted.some(p => (p.flags?.[SCOPE]?.damage?.results ?? []).some(r => r.uuid === crinwinToken.uuid))).toBe(false);
		// And the card remembers who was down, for a later rewrite onto a tier that suffers the attack.
		expect(message.flags.attack.downedTargets?.map(t => t.name)).toEqual(["Crinwin H"]);
	});
});

describe("FGT-3: a rewrite onto a tier that suffers the attack, after the foe fell", () => {
	it("says the foe is down instead of asking for an unknown enemy's damage", async () => {
		globalThis.game.settings = { get: (_scope, key) => (key === "fightTab" ? false : "roll") };
		globalThis.fromUuidSync = () => null;
		const crinwin = { uuid: "Scene.s.Token.h", name: "Crinwin H", hasActor: true };
		const message = makeMessage({ attack: { moveKey: "clash", resolved: true, avoids: "pick", targets: [], downedTargets: [crinwin] } });
		message.rolls = [];
		const pc = { uuid: "Actor.ae", name: "Camp Aeliana", type: "character" };
		expect(await attackFlow.reconcileClashCounter(message, pc, 8)).toBe(true);
		expect(posted.some(p => p.flags?.[SCOPE]?.sufferAmount)).toBe(false);
		expect(posted.at(-1).content).toContain("is down");
	});
});
