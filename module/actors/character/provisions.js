import { CharacterInventory } from "./CharacterInventory.js";
import { StonetopFlags } from "./StonetopFlags.js";

/**
 * PROVISIONS — food taken from the wild, and the one inventory track whose size is rolled for
 * rather than printed.
 *
 * Where it is stored: `flags.stonetop.inventory.resources.provisions` holds the uses left, which
 * is where every other item's uses live, so the ○ track on the sheet works with no new plumbing.
 * What it does NOT have is a printed capacity. Book I p.89 says a Forage yields "up to 2d6 uses",
 * and 12 would be a defensible ceiling if Forage were the only source — but the Ranger's trapping
 * gear adds "+1 use of provisions" to a Forage (13), a butchered pig is 1d6+10 (Book II p.286),
 * and the flora table (Book II p.461) gives 1d6 finds of 1d6 uses each. So capacity is stored per
 * character too, in `resourceMax`, and grows as the larder does.
 *
 * Why the item is `special: true` in the compendium: the printed Inventory insert has Supplies,
 * More supplies and Even more supplies and no Provisions row at all, because provisions are
 * something you come back with rather than something you Outfit with. A special item renders only
 * once it is in `addedSpecial`, so the row appears the moment a Forage pays out and not before —
 * and its ✕ takes the whole larder away again ("you toss what's left to the crows", p.89).
 */
export const PROVISIONS_SLUG = "provisions";

/**
 * The Ranger's On the Hoof: "When you travel through the wilderness, you can procure 1d6 uses of
 * provisions each day (roll with disadvantage in winter or barren terrain)." A description-only
 * move — no roll tier, nothing to hit — so USING it is simply collecting the day's food, which is
 * what MOVE_USE_EFFECTS hangs the prompt on.
 */
export const ON_THE_HOOF = "On the Hoof";

// The ◇/◆ that means "this option costs you a point of load". Forage's first option reads
// "You acquire ◇ provisions (1d6 uses)" and its second "an extra 1d6 uses of provisions" — the
// diamond is the whole difference between them, and it is the difference between claiming a
// point of load and merely topping up what is already in the pack.
const LOAD_DIAMONDS = /[◆◇]/;

/**
 * A count of provisions, as the books actually write them. Either a dice expression or a plain
 * number, and it only counts when the very next thing is "use(s)" or "provisions" — which is what
 * keeps a beast's own stat line out of it. The goat reads "HP 3, d4 damage; butcher for ◇
 * Provisions (6 uses)": neither the 3 nor the d4 is followed by either word, so the match lands on
 * the 6, which is the number that was actually being offered.
 *
 * The gap between the two allows the ◇ (raw or as the `&#9671;` the pack files store), because
 * snowembers are written "Harvest 1d4+4 ◇ Provisions" with no "uses" at all.
 */
const PROVISIONS_YIELD = /(\d*\s*d\s*\d+(?:\s*[+-]\s*\d+)?|\d+)\s*(?:&#9671;|[◆◇])?\s*(?:uses?\b|provisions?\b)/i;

/**
 * Read a line of printed text and say whether it hands over provisions, and how many.
 *
 * Text-matched rather than declared on the item, because the line IS the book's own wording —
 * Forage's pick list (chat.js#pickableMoveDescription turns those <li>s into the card's
 * checklist), and the parenthetical on a goat, a pig, a brightberry bush. One reader for both, so
 * a world that has reworded Forage, a homebrew move that pays in provisions, and a GM-written
 * beast that can be butchered all behave the same way without anyone wiring them up one at a time.
 *
 * The cost of text-matching: it needs BOTH a mention of provisions and a count, so "You discover
 * something interesting or useful" is left alone, and so is a horse (no provisions in its line).
 *
 * @param {string} text  one option's or one item's plain text
 * @returns {{formula: string, claimsLoad: boolean, isRoll: boolean}|null}
 *          null when the line pays no provisions. `formula` is always something Foundry's Roll
 *          accepts — a plain "6" is as valid a formula as "1d6+10" — and `isRoll` says whether
 *          there is really a die to throw, which is the difference between a button that offers to
 *          roll and one that just hands the food over.
 */
export function readProvisionsYield(text) {
	const line = String(text ?? "");
	if (!/provisions?/i.test(line)) return null;
	const match = PROVISIONS_YIELD.exec(line);
	if (!match) return null;
	// Foundry's Roll wants "1d6", not "d6" or "d6 + 10".
	const formula = match[1].replace(/\s+/g, "").replace(/^d/i, "1d");
	return { formula, claimsLoad: LOAD_DIAMONDS.test(line), isRoll: /d/i.test(formula) };
}

/**
 * Add uses of provisions to a character, creating the row if this is the first haul.
 *
 * Works off a bare Actor (the chat card that grants these has no sheet in hand), the same way
 * the steading's Trade & Barter picker writes to a character it was handed.
 *
 * Capacity becomes whatever is now being carried, never less than it was: forage 3, eat 2, and
 * the track reads 1 of 3 — one full circle and two empty ones, which is the record of the two
 * that were eaten. Forage 4 more and it reads 5 of 5, because a fresh haul is a full larder.
 *
 * `carry` marks the ◇ of load. It writes `checked` directly instead of going through
 * toggleCarriedItem: that spends from the undefined ◇ reserve, which is right for Have What You
 * Need (deciding you had something all along) and wrong here — provisions are weight picked up in
 * the field, on top of whatever was Outfitted, and may well put the character over their load.
 *
 * @param {Actor} actor
 * @param {number} uses      how many uses were rolled
 * @param {object} [options]
 * @param {boolean} [options.carry=false]  also mark the ◇ of load
 * @returns {Promise<{gained: number, held: number, max: number}|null>}  null if nothing was gained
 */
export async function grantProvisions(actor, uses, { carry = false } = {}) {
	const gained = Math.max(0, Math.trunc(Number(uses) || 0));
	if (!gained) return null;

	const inventory = new CharacterInventory(new StonetopFlags(actor, "inventory"));
	const held = Math.max(0, Number(inventory.resources[PROVISIONS_SLUG]) || 0);
	const max  = Math.max(0, Number(inventory.resourceMax[PROVISIONS_SLUG]) || 0);
	const nextHeld = held + gained;
	const nextMax  = Math.max(max, nextHeld);

	// One write for the whole haul (see CharacterInventory.addSpecialWithResource): four
	// sequential ones would re-render every open sheet four times over, and leave four places
	// for a failure to record half a larder.
	await inventory.addSpecialWithResource(PROVISIONS_SLUG, { held: nextHeld, max: nextMax, carry });

	return { gained, held: nextHeld, max: nextMax };
}

/**
 * Throw for a haul of provisions and put it in the pack.
 *
 * The one place the die, the clamp and the announcement live, for the three surfaces that pay in
 * food: Forage's chat-card options (stonetop.js#_onRollProvisions), the Ranger's On the Hoof, and
 * a harvest row's butcher/pick button. Each of those differs only in its wording, whether there is
 * a die worth showing, and whether the food claims a ◇ — so each keeps its own notification line
 * and nothing else.
 *
 * @param {Actor} actor
 * @param {object} options
 * @param {string} options.formula            anything Foundry's Roll accepts, a flat count included
 * @param {boolean} [options.announce=true]   post the die to chat; a flat count has nothing to show
 * @param {boolean} [options.carry=false]     also mark the ◇ of load
 * @param {object} [options.speaker]          defaults to this actor's
 * @param {string} [options.flavor]           defaults to "Provisions (<formula>)"
 * @returns {Promise<{uses: number, larder: {gained: number, held: number, max: number}|null}>}
 *          `larder` is null for a throw that paid nothing, which is what the callers gate their
 *          "you gained…" line on; `uses` is reported either way, because a card that offered the
 *          throw has to record that it happened.
 */
export async function rollProvisions(actor, { formula, announce = true, carry = false, speaker, flavor } = {}) {
	const roll = await new Roll(formula).evaluate();
	if (announce) {
		await roll.toMessage({
			speaker: speaker ?? ChatMessage.getSpeaker({ actor }),
			flavor:  flavor ?? `Provisions (${formula})`,
		});
	}
	const uses = Math.max(0, Math.trunc(roll.total));
	return { uses, larder: await grantProvisions(actor, uses, { carry }) };
}
