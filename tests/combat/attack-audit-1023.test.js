import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { SCOPE, pc, installCombatChatFakes, uninstallCombatChatFakes, makeMessage, cardWithFlag } from "../fakes/combat-chat.js";

// The 2026-10-23 combat audit's ATK findings, one block each: the attack moves and the damage pipeline.

const attackFlow = await import("../../module/combat/attack-flow.js");
const {
	carriedAttackWeapons, settleBronzeWeapon, bronzeAnswerPath, spendWeaponUse, weaponWarningsHtml, areaPlacement,
	reconcileClashCounter, setArmorIgnoredOnTheFly, wireIgnoresArmorBox, ARMOR_IGNORED_ON_THE_FLY,
	handleSufferCardQuery, sufferEnemyAttack, SUFFER_CARD_QUERY, wireSufferChoice, wireAttackConfirm,
} = attackFlow;
const { weaponMeta, bronzeMeta, BRONZE_WEAPONS, isClashWeapon, isLetFlyWeapon } = await import("../../module/data/weapons.js");

const CLASH = { key: "clash", filter: isClashWeapon };
const LET_FLY = { key: "let-fly", filter: isLetFlyWeapon };

/** A character whose StonetopCharacter answers with `gear`, its flags in a plain map it can also write. */
function actorWith(gear, flags = {}) {
	const store = { ...flags };
	const actor = {
		name: "Pim", uuid: "Actor.pim", items: [],
		typedActor: { carriedWeaponGear: async () => gear },
		getFlag: (_scope, path) => store[path] ?? null,
		update: vi.fn(async changes => {
			for (const [key, value] of Object.entries(changes)) {
				const m = /^flags\.[^.]+\.inventory\.(bronzeAs|resources)\.(.+)$/.exec(key);
				if (m) store[`inventory.${m[1]}`] = { ...(store[`inventory.${m[1]}`] ?? {}), [m[2]]: value };
			}
		}),
		store,
	};
	return actor;
}

/** A catalog outfit row, the shape StonetopCharacter#_gearSources gives one. */
const catalogRow = (slug, over = {}) => ({ slug, weaponSlug: slug, name: null, note: null, ammoStore: "inventory", ammo: false, catalog: true, ...over });

// The real English table (tests/setup.js), kept: the fakes' teardown takes `game` away with it.
const I18N = globalThis.game?.i18n;
let posted;
beforeEach(() => { posted = installCombatChatFakes(); globalThis.game.i18n = I18N; });
afterEach(() => { uninstallCombatChatFakes(); vi.restoreAllMocks(); });

describe("ATK-2: the sling and the javelins have ammo statuses", () => {
	it("marks both as ammo weapons, as the bows are", () => {
		expect(weaponMeta("sling").ammo).toBe(true);
		expect(weaponMeta("javelins").ammo).toBe(true);
	});

	it("offers the sling for Let Fly with its status read off its track", async () => {
		const actor = actorWith([catalogRow("sling", { ammo: true, ammoMax: 2, ammoLabels: ["low ammo", "all out"] })], { "inventory.resources": { sling: 1 } });
		const [sling] = await carriedAttackWeapons(actor, LET_FLY);
		expect(sling.meta.ammo).toBe(true);
		expect(sling.ammoLabel).toBe("Low ammo");
	});
});

describe("ATK-3: naphtha uses one of its uses each time it is thrown", () => {
	const naphtha = { slug: "naphtha", name: "Naphtha", uses: true, ammoStore: "inventory", ammoMax: 3, ammoLabels: ["", ""] };

	it("is a use-counted weapon, not an ammo one", () => {
		expect(weaponMeta("naphtha")).toMatchObject({ uses: true, ammo: false });
	});

	it("marks the next use on the item's own track and says what is left", async () => {
		const actor = actorWith([], { "inventory.resources": { naphtha: 1 } });
		const spent = await spendWeaponUse(actor, naphtha, "Let Fly");
		expect(spent).toMatchObject({ index: 2 });
		expect(actor.update).toHaveBeenCalledWith({ [`flags.${SCOPE}.inventory.resources.naphtha`]: 2 }, { stonetopMove: "Let Fly" });
		expect(posted.at(-1).content).toContain("1 of 3 left");
	});

	it("says it was the last one, and that there was none left to mark after that", async () => {
		const actor = actorWith([], { "inventory.resources": { naphtha: 2 } });
		await spendWeaponUse(actor, naphtha, "Let Fly");
		expect(posted.at(-1).content).toContain("uses the last of their Naphtha");
		await spendWeaponUse(actor, naphtha, "Let Fly");
		expect(posted.at(-1).content).toContain("had no uses left to mark");
	});

	it("marks nothing for a weapon that is not use-counted", async () => {
		const actor = actorWith([]);
		expect(await spendWeaponUse(actor, { slug: "crossbow", ammo: true }, "Let Fly")).toBeNull();
		expect(actor.update).not.toHaveBeenCalled();
		expect(posted).toHaveLength(0);
	});

	it("reads a treasure's 'uses' track as uses too", async () => {
		const actor = actorWith([{ slug: "spheres", weaponSlug: null, name: "Clay spheres", note: "◇◇◇◇ uses, damage d10, <em>thrown</em>, <em>area</em>", ammo: true, ammoMax: 4, ammoStore: "inventory" }]);
		const [spheres] = await carriedAttackWeapons(actor, LET_FLY);
		expect(spheres.meta).toMatchObject({ uses: true, ammo: false });
		expect(spheres.ammoLabel).toBe("4 of 4 uses left");
	});
});

describe("ATK-4: an all-out weapon is warned about, never refused", () => {
	it("is still offered, marked all out", async () => {
		const actor = actorWith([catalogRow("crossbow", { ammo: true, ammoMax: 2 })], { "inventory.resources": { crossbow: 2 } });
		const [crossbow] = await carriedAttackWeapons(actor, LET_FLY);
		expect(crossbow.allOut).toBe(true);
	});

	it("says so on the damage card, quoting the book", () => {
		const html = weaponWarningsHtml({ name: "Crossbow", allOut: true });
		expect(html).toContain("Crossbow was all out");
		expect(html).toContain("p.94");
	});

	it("says a use-counted item is used up", () => {
		expect(weaponWarningsHtml({ name: "Naphtha", allOut: true, uses: true })).toContain("Naphtha had no uses left");
	});

	it("says nothing about a weapon with boxes left", () => {
		expect(weaponWarningsHtml({ name: "Crossbow" })).toBe("");
	});
});

describe("ATK-6: where a weapon's own area lies", () => {
	it("is around the target for a shot or a throw", () => {
		expect(areaPlacement("let-fly", { range: ["thrown"] })).toBe("targets");
		expect(areaPlacement("call-the-shot", { range: ["far"] })).toBe("targets");
		expect(areaPlacement("", { range: [], tags: ["near", "area"] })).toBe("targets");
	});

	it("is around the roller in melee (the holy light)", () => {
		expect(areaPlacement("clash", { range: ["hand", "close"], area: true })).toBe("roller");
		expect(areaPlacement("", { range: [], tags: ["close", "area"] })).toBe("roller");
		expect(areaPlacement("clash", null)).toBe("roller");
	});
});

describe("ATK-7: a confirmed Clash moved down to 7-9 suffers the attack", () => {
	const targeting = () => {
		globalThis.fromUuid = async () => ({ actor: { name: "Crinwin", system: { attributes: { damage: { value: "bite d6 (close)", rollFormula: "d6" } } } } });
		return [{ uuid: "Scene.s.Token.t", name: "Crinwin" }];
	};

	it("strikes it once for a resolved 10+ that avoided, now on a 9", async () => {
		const message = makeMessage({ attack: { moveKey: "clash", targets: targeting(), resolved: true, avoids: "pick" } });
		expect(await reconcileClashCounter(message, pc, 9)).toBe(true);
		expect(message.flags.attack.countered).toBe(true);
		expect(cardWithFlag(posted, "damage")).toBeTruthy();
		expect(await reconcileClashCounter(message, pc, 8)).toBe(false);
	});

	it("leaves an unconfirmed 7-9 to its own Confirm", async () => {
		const message = makeMessage({ attack: { moveKey: "clash", targets: targeting() } });
		expect(await reconcileClashCounter(message, pc, 8)).toBe(false);
		expect(posted).toHaveLength(0);
	});
});

describe("ATK-8: the GM's 'Ignores armor' tick", () => {
	const damage = over => ({ move: "Clash", weapon: { name: "Sword", piercing: 0, ignoresArmor: false }, results: [{ uuid: "Scene.s.Token.t", raw: 6 }], applied: [], ...over });

	it("writes the blow's weapon as ignoring armor, and takes it back off", async () => {
		const message = makeMessage({ damage: damage() });
		expect(await setArmorIgnoredOnTheFly(message, true)).toBe(true);
		expect(message.flags.damage.weapon).toMatchObject({ name: "Sword", ignoresArmor: true });
		expect(message.flags.damage[ARMOR_IGNORED_ON_THE_FLY]).toBe(true);
		expect(await setArmorIgnoredOnTheFly(message, false)).toBe(true);
		expect(message.flags.damage.weapon.ignoresArmor).toBe(false);
	});

	it("never takes off a blow's own 'ignores armor', and changes nothing once a row is applied", async () => {
		const own = makeMessage({ damage: damage({ weapon: { name: "heat-drain", ignoresArmor: true } }) });
		expect(await setArmorIgnoredOnTheFly(own, false)).toBe(false);
		const done = makeMessage({ damage: damage({ applied: [{ uuid: "Scene.s.Token.t", effective: 6 }] }) });
		expect(await setArmorIgnoredOnTheFly(done, true)).toBe(false);
	});

	it("is drawn for a GM only", () => {
		const appended = [];
		const actions = { append: el => appended.push(el) };
		const savedDocument = globalThis.document;
		globalThis.document = { createElement: () => ({ append() {}, addEventListener() {}, set textContent(v) { this.text = v; } }) };
		const html = { querySelector: sel => (sel === ".stonetop-attack-actions" ? actions : null) };
		wireIgnoresArmorBox(makeMessage({ damage: damage() }), html, { isGM: false });
		expect(appended).toHaveLength(0);
		wireIgnoresArmorBox(makeMessage({ damage: damage() }), html, { isGM: true });
		expect(appended).toHaveLength(1);
		globalThis.document = savedDocument;
	});
});

describe("ATK-9: the mallet and bronze weapons", () => {
	it("knows the mallet as a hand weapon", () => {
		expect(weaponMeta("mallet")).toMatchObject({ name: "Mallet", range: ["hand"] });
	});

	it("deals a bronze weapon's profile with no x piercing", () => {
		expect(bronzeMeta("sword")).toMatchObject({ name: "Bronze sword", damageBonus: 1, piercing: 0 });
		expect(bronzeMeta("spear")).toMatchObject({ piercing: 0, range: ["close", "thrown"] });
		// A fixed piercing is not "x piercing" and stays.
		expect(bronzeMeta("warhammer").piercing).toBe(2);
		for (const list of Object.values(BRONZE_WEAPONS)) for (const slug of list) expect(weaponMeta(slug)).toBeTruthy();
	});

	it("asks once which weapon a bronze item is, keeps the answer, and uses it from then on", async () => {
		const actor = actorWith([catalogRow("bronze-weapon-of-war", { name: "Weapon of war, bronze" })]);
		const [unset] = await carriedAttackWeapons(actor, CLASH);
		expect(unset.bronzeUnset).toBe(true);
		const prompt = vi.fn(async options => ({ weapon: options.find(o => o.slug === "battleaxe") }));
		const settled = await settleBronzeWeapon(actor, unset, "Clash", { prompt });
		expect(prompt).toHaveBeenCalledTimes(1);
		expect(settled.meta).toMatchObject({ name: "Bronze battleaxe", tags: ["messy"] });
		expect(actor.update).toHaveBeenCalledWith({ [bronzeAnswerPath("bronze-weapon-of-war")]: "battleaxe" });
		const [kept] = await carriedAttackWeapons(actor, CLASH);
		expect(kept.bronzeUnset).toBeUndefined();
		expect(kept.meta.name).toBe("Bronze battleaxe");
	});

	it("does not offer a bronze weapon of war for Let Fly", async () => {
		const actor = actorWith([catalogRow("bronze-weapon-of-war")]);
		expect(await carriedAttackWeapons(actor, LET_FLY)).toEqual([]);
	});
});

describe("ATK-10: a shot with nothing to shoot", () => {
	it("says so on the damage card", () => {
		expect(weaponWarningsHtml(null, { noRangedWeapon: true })).toContain("No ranged or thrown weapon");
	});
});

describe("ATK-1: the GM's cards are posted by the GM's client", () => {
	const twoAttacks = () => {
		globalThis.fromUuid = async uuid => (uuid === pc.uuid ? pc : { actor: { name: "Rime Lord", system: { attributes: { damage: { value: "conjured ice d12+3 (area) or heat-drain d12+1 (reach, ignores armor)", rollFormula: "d12+3" } } } } });
		return [{ uuid: "Scene.s.Token.t", name: "Rime Lord" }];
	};

	it("asks the GM's client to post 'Which attack?' when a player's Clash fires it", async () => {
		const query = vi.fn(async () => "gmCard");
		globalThis.game.user = { isGM: false, id: "p1" };
		globalThis.game.users = { activeGM: { id: "gm1", isGM: true, active: true, query }, find: () => undefined };
		globalThis.game.messages = { get: id => ({ id }) };
		await sufferEnemyAttack(pc, { targets: twoAttacks() });
		expect(query).toHaveBeenCalledTimes(1);
		const [name, data] = query.mock.calls[0];
		expect(name).toBe(SUFFER_CARD_QUERY);
		expect(data.pcUuid).toBe(pc.uuid);
		expect(data.flags.sufferChoice.attacks).toHaveLength(2);
		// Nothing authored by the player.
		expect(cardWithFlag(posted, "sufferChoice")).toBeUndefined();
	});

	it("posts it from the player's client when the GM's does not answer", async () => {
		globalThis.game.user = { isGM: false, id: "p1" };
		globalThis.game.users = { activeGM: { id: "gm1", isGM: true, active: true, query: vi.fn(async () => { throw new Error("timeout"); }) }, find: () => undefined };
		vi.spyOn(console, "warn").mockImplementation(() => {});
		await sufferEnemyAttack(pc, { targets: twoAttacks() });
		expect(cardWithFlag(posted, "sufferChoice")).toBeTruthy();
	});

	it("is answered on the GM's side only for the character's owner, and only once per blow", async () => {
		const owner = { id: "p1", isGM: false };
		const stranger = { id: "p2", isGM: false };
		const resolve = async () => ({ testUserPermission: user => user.id === "p1" });
		const flags = { sufferChoice: { pcUuid: pc.uuid, attacks: [], chosen: null, nonce: "n1" } };
		const data = { content: "<p>card</p>", flags, pcUuid: pc.uuid };
		const messages = { contents: [] };
		expect(await handleSufferCardQuery(data, { user: stranger }, { messages, resolve })).toBeNull();
		expect(await handleSufferCardQuery({ ...data, flags: { damage: {} } }, { user: owner }, { messages, resolve })).toBeNull();
		expect(await handleSufferCardQuery(data, { user: owner }, { messages, resolve })).toBe("posted1");
		expect(cardWithFlag(posted, "sufferChoice").whisper).toEqual(["gm1"]);
		const twin = { id: "x", getFlag: (_s, key) => (key === "sufferChoice" ? { nonce: "n1" } : undefined) };
		expect(await handleSufferCardQuery(data, { user: owner }, { messages: { contents: [twin] }, resolve })).toBeNull();
	});

	it("draws the GM's card from its flag on the GM's side, never from HTML the player's client sent", async () => {
		const owner = { id: "p1", isGM: false };
		const resolve = async () => ({ name: "Bram", testUserPermission: user => user.id === "p1" });
		const attacks = [{ label: "Bite", formula: "d8" }];
		const flags = { sufferChoice: { pcUuid: pc.uuid, foeName: "Wolf", foeText: "", attacks, chosen: null, nonce: "n2" } };
		const data = { content: "<img src=x onerror=alert(1)><p>The GM rules you win</p>", flags, pcUuid: pc.uuid };
		expect(await handleSufferCardQuery(data, { user: owner }, { messages: { contents: [] }, resolve })).toBe("posted1");
		const content = cardWithFlag(posted, "sufferChoice").content;
		expect(content).not.toContain("onerror");
		expect(content).not.toContain("The GM rules you win");
		expect(content).toContain("Bite");
		expect(content).toContain("Wolf");
	});

	it("draws a player's copy with its body hidden", () => {
		globalThis.game.user = { isGM: false, id: "p1" };
		const body = { innerHTML: "<p>conjured ice d12+3</p>" };
		const root = { querySelectorAll: () => [{}], querySelector: sel => (sel === ".card-content" ? body : null) };
		wireSufferChoice(makeMessage({ sufferChoice: { pcUuid: pc.uuid, attacks: [], chosen: null } }), root);
		expect(body.innerHTML).not.toContain("d12");
		expect(body.innerHTML).toContain("The GM is choosing");
	});
});

describe("ATK-5: one live Confirm at the table", () => {
	function confirmCard(user, players) {
		globalThis.game.user = user;
		globalThis.game.users = { players, get: id => players.find(p => p.id === id), activeGM: null, find: () => undefined };
		const actor = { uuid: "Actor.pim", isOwner: true, testUserPermission: u => u.id === "p1" };
		globalThis.fromUuid = async () => actor;
		const btn = { disabled: false, title: "", dataset: {}, listeners: 0, addEventListener() { this.listeners += 1; } };
		const root = { querySelectorAll: sel => (sel === ".stonetop-attack-confirm" ? [btn] : []), querySelector: () => null };
		const message = makeMessage({ attack: { moveKey: "clash", attackerUuid: "Actor.pim", targets: [] } });
		message.canUserModify = () => true;
		wireAttackConfirm(message, root);
		return btn;
	}
	const flush = () => new Promise(resolve => setTimeout(resolve, 0));

	it("stands the GM's copy down while the player who owns the attacker is at the table", async () => {
		const btn = confirmCard({ id: "gm1", isGM: true }, [{ id: "p1", name: "Ana", active: true }]);
		await flush();
		expect(btn.disabled).toBe(true);
		expect(btn.title).toContain("Ana");
		expect(btn.listeners).toBe(0);
	});

	it("leaves the GM's copy live when that player is away, and the player's own copy live", async () => {
		const gmBtn = confirmCard({ id: "gm1", isGM: true }, [{ id: "p1", name: "Ana", active: false }]);
		await flush();
		expect(gmBtn.listeners).toBe(1);
		const playerBtn = confirmCard({ id: "p1", isGM: false }, [{ id: "p1", name: "Ana", active: true }]);
		await flush();
		expect(playerBtn.listeners).toBe(1);
	});
});
