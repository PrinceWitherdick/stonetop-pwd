import { escHtml } from "../utils/strings.js";
import { rolledTotalCard, stonetopCardShell } from "../utils/chat.js";
import { charactersInPlay } from "../utils/characters-in-play.js";
import { SYSTEM_ID } from "../system-id.js";
import { moveLearnedIn } from "../actors/character/owns-move.js";
import { LOGBOOK } from "../actors/character/know-things.js";
import { autoOpenUserId, ownerUsers } from "../hooks/DeathsDoorPrompt.js";

// ── Seasons Change reminders ─────────────────────────────────────────────────
// A few playbook moves and special possessions have rules that fire "each
// season" / "once per season" (Book I). When the GM runs the Seasons Change move
// on the steading, a single public chat card lists every player character that
// carries one of these alongside its season-facing rule — so the seasonal upkeep
// doesn't get forgotten. The card is an ordinary ChatMessage, so it syncs to the
// whole table on its own (no socket needed).

// The seasonal upkeep registry. `kind` decides how a character is matched:
//   • "move"       — an embedded move Item with this exact name.
//   • "possession" — a selected special-possession slug (flags.stonetop-pwd.possessions.selected).
// `rule` is the season-facing reminder text shown in the card.
// `seasons` (optional) limits an entry to the seasons listed; omitted means every season.
//
// EVERYTHING HERE IS QUOTED FROM THE BOOK, and the card goes out publicly to the whole
// table, so an entry that paraphrases loosely teaches the table a rule that does not exist.
// Before adding one, find the printed line. Holy relics (The Lightbearer) was listed here
// with a "Restore 1 use this season" refresh and a "+1 to a roll involving Helior's favor"
// effect; it has NEITHER. Book I p.430, Book II's Helior entry, and the Lightbearer playbook
// all read the same and say nothing about seasons: "Holy relics (___ uses): if you have one
// in inventory when you Invoke the Sun God, you can mark a use in lieu of choosing a
// consequence." (The +1 belongs to Piety's Blessing, a different thing entirely.) Its uses
// are a one-way pool, so it does not belong in a seasonal-upkeep card at all.
export const SEASONAL_REMINDERS = [
	{
		kind:     "move",
		name:     "Rites of the Land",
		playbook: "The Blessed",
		rule:     "Once per season, when you oversee the sacred rites, hold 1 Boon. If you also sacrifice 1 Surplus, hold 4 Boon instead. Spend Boon in lieu of Stock, 1-for-1.",
	},
	{
		kind:     "possession",
		slug:     "collected-offerings",
		label:    "Collected offerings",
		playbook: "The Blessed",
		rule:     "Restore 1 use this season. (Expend a use to produce something valuable to a spirit of the wild.)",
		// "Restore 1 use each season": a button that takes 1 off the possession's spent uses
		// (REMINDER_RESETS.offerings), pressed by the Blessed's own player as the Logbook's is.
		reset:    "offerings",
	},
	{
		kind:     "possession",
		slug:     "goat-herd",
		label:    "Goat herd",
		playbook: "The Blessed",
		rule:     "Each season, there's a 1-in-4 chance your goat herd produces a bezoar: swallow it to cure poison. Roll a d4: on a 1, you have one.",
		// A d4 to chat; a 1 adds the Bezoar small item (REMINDER_RESETS.bezoar).
		reset:    "bezoar",
	},
	{
		// Spring only, unlike its neighbours: "Each SPRING, d4 uses of bendis root."
		kind:     "possession",
		slug:     "herb-garden",
		label:    "Herb garden",
		playbook: "The Blessed",
		seasons:  ["spring"],
		rule:     "Each spring, the garden yields d4 uses of bendis root (reach, area, burns ~1 hr, fumes repel perversions of nature). Roll this year's crop: it replaces what is left.",
		// A d4 to chat that SETS the bendis root's uses (REMINDER_RESETS.bendis).
		reset:    "bendis",
	},
	{
		// The only entry that RESETS something rather than producing it, and the only one whose
		// trigger is the move by name: "When the Seasons Change, reset your logbook to 2 uses."
		// The GM's Seasons Change does not write it itself: the pips are on the Seeker's own move
		// track, on their own sheet, and a GM's move reaching across to write another player's
		// character is not how any other seasonal upkeep here works. So the row carries a button
		// (`reset`, the user's ruling of 2026-09-26) that the Seeker's own player presses: see
		// wireSeasonsReminderResets.
		kind:     "move",
		name:     "Logbook",
		playbook: "The Seeker",
		reset:    "logbook",
		rule:     "When the Seasons Change, reset your logbook to 2 uses. (Expend a use to treat a Know Things roll you just made as a 10+.)",
	},
	{
		kind:     "possession",
		slug:     "laboratory",
		label:    "Laboratory",
		playbook: "The Seeker",
		// A button that rolls the d4-1 and adds it to the Laboratory's naphtha track (see
		// REMINDER_RESETS), pressed by the Seeker's own player as the Logbook's is.
		reset:    "naphtha",
		rule:    "Every season, the laboratory produces d4−1 uses of naphtha (thrown, area, dangerous, ignores armor). Roll this season's yield and add it to what's left (3 at most).",
	},
];

// Web-path season icon (the steading flow stores these under assets/icons/seasons;
// "autumn" maps to the "fall" art). Forward slashes keep it a valid URL.
export function seasonIconSrc(season) {
	const id = season === "autumn" ? "fall" : season;
	return `systems/stonetop-pwd/assets/icons/seasons/${id}_icon.svg`;
}

// The four seasons in turn order — the single source for the season picker and
// any other season-cycle UI, so ids/labels live in one place.
export const SEASON_IDS = ["spring", "summer", "autumn", "winter"];

export function seasonLabel(season) {
	return { spring: "Spring", summer: "Summer", autumn: "Autumn", winter: "Winter" }[season] ?? "A New Season";
}

// Which registered reminders apply to one character — a move match needs an
// embedded move Item of that name, LEARNED (a move kept on the sheet switched off
// has no upkeep); a possession match needs the slug selected.
//
// `season` filters the season-limited entries (Herb garden is spring-only). Omitting it
// lists everything the character carries regardless of season, which is what a caller
// asking "what seasonal upkeep does this PC have?" wants; the chat card always passes one.
export function remindersForActor(actor, season = "") {
	if (actor?.type !== "character") return [];
	const moveNames = new Set(actor.items.filter(i => i.type === "move" && moveLearnedIn(i, actor.items)).map(i => i.name));
	const selected  = new Set(actor.getFlag?.(SYSTEM_ID, "possessions.selected") ?? []);
	return SEASONAL_REMINDERS.filter(r => {
		if (season && r.seasons && !r.seasons.includes(season)) return false;
		return r.kind === "move" ? moveNames.has(r.name) : selected.has(r.slug);
	});
}

// Display rows for every seasonal item carried by the given actors: the matched
// move/possession's season-facing rule, tagged with the owning character. Pure
// (no globals), so the card builder and the tests can drive it directly.
export function collectSeasonalReminders(actors, season = "") {
	return actors.flatMap(actor =>
		remindersForActor(actor, season).map(r => ({
			character: actor.name, name: r.label ?? r.name, playbook: r.playbook, rule: r.rule,
			...(r.reset && actor.id ? { reset: r.reset, actorId: actor.id } : {}),
		})),
	);
}

// The public chat-card HTML for a season's upkeep reminders: a season hero plus an
// item per carried move/possession (name · owning character · rule). Reuses the
// `.stonetop-seasons-reminder-*` markup/styles inside the shared Stonetop chat shell.
export function seasonsReminderCard(season, reminders) {
	const items = reminders.map(r => `
			<li class="stonetop-seasons-reminder-item">
				<div class="stonetop-seasons-reminder-item-head">
					<span class="stonetop-seasons-reminder-item-name">${escHtml(r.name)}</span>
					<span class="stonetop-seasons-reminder-item-char">${escHtml(r.character)}</span>
				</div>
				<p class="stonetop-seasons-reminder-item-rule">${escHtml(r.rule)}</p>${resetButtonHtml(r)}
			</li>`).join("");
	const body = `<div class="stonetop-seasons-reminder">
			<header class="stonetop-seasons-reminder-hero">
				<img class="stonetop-seasons-reminder-icon" src="${seasonIconSrc(season)}" alt="">
				<div class="stonetop-seasons-reminder-heading">
					<h2>The Seasons Change</h2>
					<span class="stonetop-seasons-reminder-season">${escHtml(seasonLabel(season))}</span>
				</div>
			</header>
			<p class="stonetop-seasons-reminder-lead">A new season has come to Stonetop. Don't forget your seasonal upkeep:</p>
			<ul class="stonetop-seasons-reminder-list">${items}</ul>
		</div>`;
	return stonetopCardShell(body, "stonetop-seasons-reminder-chat-card");
}

// What each `reset` a reminder can carry does: its button's words, and the write. The Logbook's
// track counts uses SPENT (know-things.js#logbookUses), so "reset to 2 uses" is 0 spent. `flag` is
// the character's own note of the card it was last reset from, so one card resets it once.
const REMINDER_RESETS = {
	logbook: {
		label:  "Reset logbook (2 uses)",
		done:   "Logbook reset",
		flag:   "logbookResetCard",
		move:   LOGBOOK,
		update: actor => actor?.typedActor?.moveResources?.usesUpdate?.(LOGBOOK, 0) ?? null,
	},
	// The Laboratory: "Every season, produce d4-1 uses of ◇ naphtha." The roll goes to chat, and the
	// rolled uses are ADDED to what is left on the naphtha item's track (the user's ruling of
	// 2026-10-18: a season's yield is produced, it does not wipe last season's): see rollNaphthaYield.
	//
	// `rolls`: a press is a public roll, so pressing twice is not harmless as a logbook reset is. The
	// button is on ONE client (the character's player, else the GM: DeathsDoorPrompt.js#autoOpenUserId),
	// the card is noted on the character BEFORE the dice, and once the dice are in chat the button is
	// never handed back.
	naphtha: {
		label:  "Roll d4-1 naphtha",
		done:   "Naphtha rolled",
		icon:   "fa-dice",
		flag:   "naphthaRollCard",
		move:   "Laboratory",
		rolls:  true,
		update: actor => rollNaphthaYield(actor),
	},
	// The Blessed's Collected offerings: "Restore 1 use each season." Not a roll, so a plain reset.
	offerings: {
		label:  "Restore 1 use",
		done:   "Use restored",
		flag:   "offeringsRestoreCard",
		move:   "Collected offerings",
		update: actor => offeringsRestoreUpdate(actor),
	},
	// The Blessed's Goat herd: "Each season, 1 in 4 chance of having a bezoar." A public d4 (a 1 is the
	// bezoar), so it `rolls` like the naphtha's: see rollForBezoar.
	bezoar: {
		label:  "Roll for a bezoar (1 in 4)",
		done:   "Bezoar rolled",
		icon:   "fa-dice",
		flag:   "bezoarRollCard",
		move:   "Goat herd",
		rolls:  true,
		update: actor => rollForBezoar(actor),
	},
	// The Blessed's Herb garden: "Each spring, d4 uses of bendis root." See rollBendisRoot.
	bendis: {
		label:  "Roll d4 bendis root",
		done:   "Bendis root rolled",
		icon:   "fa-dice",
		flag:   "bendisRollCard",
		move:   "Herb garden",
		rolls:  true,
		update: actor => rollBendisRoot(actor),
	},
};

// ── The Blessed's seasonal possessions ───────────────────────────────────────

export const COLLECTED_OFFERINGS_SLUG = "collected-offerings";

/**
 * COLLECTED OFFERINGS: the update that restores 1 use, `flags.<id>.possessions.uses.collected-offerings`
 * (a possession's track counts uses SPENT, so it goes down by 1). A full track (nothing spent) stays
 * full: the season's use is simply not needed.
 */
export function offeringsRestoreUpdate(actor) {
	const spent = Math.max(0, Math.trunc(Number(actor?.getFlag?.(SYSTEM_ID, "possessions.uses")?.[COLLECTED_OFFERINGS_SLUG]) || 0));
	return { [`flags.${SYSTEM_ID}.possessions.uses.${COLLECTED_OFFERINGS_SLUG}`]: Math.max(0, spent - 1) };
}

// The Bezoar special small item (packs/src/stonetop-items/inventory-items/bezoar.json).
export const BEZOAR_SLUG = "bezoar";

/**
 * GOAT HERD: roll the season's d4 to chat, where a 1 is the book's "1 in 4 chance of having a bezoar",
 * and return the update that adds the Bezoar to the character's special items (`inventory.addedSpecial`,
 * as the Add Special Item picker adds one; its ✕ is the bezoar swallowed). "Having a bezoar" is one:
 * a character still carrying last season's gets no second, and a miss changes nothing. Never null, so a
 * miss is still the card's roll made.
 *
 * @returns {Promise<object>}  the actor update, `{}` when nothing is added
 */
export async function rollForBezoar(actor) {
	const roll = await new globalThis.Roll("1d4").evaluate();
	const hit = Math.trunc(roll.total) === 1;
	const added = actor?.getFlag?.(SYSTEM_ID, "inventory.addedSpecial") ?? [];
	const already = Array.isArray(added) && added.includes(BEZOAR_SLUG);
	const details = !hit ? "No bezoar this season (a 1 finds one)"
		: already ? "A bezoar, but one is already carried"
		: "A bezoar! Swallow it to cure poison";
	await roll.toMessage?.({ speaker: globalThis.ChatMessage?.getSpeaker?.({ actor }), flavor: rolledTotalCard(roll, "Goat herd", "on a 1, a bezoar", details) });
	if (!hit || already) return {};
	return { [`flags.${SYSTEM_ID}.inventory.addedSpecial`]: [...(Array.isArray(added) ? added : []), BEZOAR_SLUG] };
}

// The bendis root special small item (packs/src/stonetop-items/inventory-items/bendis-root.json), shown
// while the Herb garden is held (the possession's `specialItems`).
export const BENDIS_ROOT_SLUG = "bendis-root";

/**
 * HERB GARDEN: roll "d4 uses of bendis root" to chat and return the update that makes this spring's
 * crop the track. The item prints no number of uses (its `resource.max` is 0): the crop's size is
 * ACQUIRED, stored per character in `inventory.resourceMax` as the provisions' larder is
 * (CharacterInventory#resourceMax), with 0 spent. So a garden taken at creation shows no bendis root
 * until its first spring (the book gives the root "each spring", nothing at the start), and each
 * spring's crop REPLACES what is left: the book says nothing of last year's root keeping.
 *
 * @returns {Promise<object>}  the actor update: the track's size and its uses spent (0)
 */
export async function rollBendisRoot(actor) {
	const roll = await new globalThis.Roll("1d4").evaluate();
	const uses = Math.max(0, Math.trunc(Number(roll.total) || 0));
	await roll.toMessage?.({ speaker: globalThis.ChatMessage?.getSpeaker?.({ actor }), flavor: rolledTotalCard(roll, "Herb garden", "uses of bendis root this spring") });
	return {
		[`flags.${SYSTEM_ID}.inventory.resourceMax.${BENDIS_ROOT_SLUG}`]: uses,
		[`flags.${SYSTEM_ID}.inventory.resources.${BENDIS_ROOT_SLUG}`]:   0,
	};
}

// The naphtha special item (packs/src/stonetop-items/inventory-items/naphtha.json): slug and ○○○.
const NAPHTHA_SLUG  = "naphtha";
const NAPHTHA_TRACK = 3;

/**
 * The naphtha track's uses SPENT after `rolled` new uses are produced (an inventory track counts uses
 * spent, like the whisky's; nothing stored is 0 spent, a full ○○○, as the Items column reads it). The
 * new uses go onto what is left, and the printed ○○○ is the cap: a 0 keeps the leftovers as they were.
 */
export function naphthaSpentAfter(spent, rolled) {
	const was = Math.max(0, Math.min(NAPHTHA_TRACK, Number(spent) || 0));
	return Math.max(0, was - Math.max(0, Math.trunc(Number(rolled) || 0)));
}

/**
 * LABORATORY: roll "d4-1 uses of naphtha" to chat and return the naphtha track's update. `addTo`
 * (the season's yield) adds the uses to what the character has left; off (a Laboratory just taken at
 * creation, the user's ruling of 2026-10-18), the track starts from nothing, so it holds the roll.
 *
 * @returns {Promise<object>}  the actor update, `flags.<id>.inventory.resources.naphtha` = uses spent
 */
export async function rollNaphthaYield(actor, { addTo = true } = {}) {
	const roll = await new globalThis.Roll("1d4-1").evaluate();
	const what = addTo ? "uses of naphtha this season" : "uses of naphtha to start with";
	await roll.toMessage?.({ speaker: globalThis.ChatMessage?.getSpeaker?.({ actor }), flavor: rolledTotalCard(roll, "Laboratory", what) });
	const spent = addTo ? (actor?.getFlag?.(SYSTEM_ID, "inventory.resources")?.[NAPHTHA_SLUG] ?? 0) : NAPHTHA_TRACK;
	return { [`flags.${SYSTEM_ID}.inventory.resources.${NAPHTHA_SLUG}`]: naphthaSpentAfter(spent, roll.total) };
}

/**
 * Does this onboarding apply roll the Laboratory's first naphtha? Only when the Laboratory is taken by
 * it: held before (a re-run, or a Save part-way, that kept it), it rolled then and does not again.
 *
 * @param {Iterable<string>} before  the possession slugs selected before the apply
 * @param {Iterable<string>} after   the possession slugs the apply selects
 */
export function laboratoryNewlySelected(before, after) {
	return new Set(after ?? []).has("laboratory") && !new Set(before ?? []).has("laboratory");
}

function resetButtonHtml(r) {
	const reset = REMINDER_RESETS[r.reset];
	if (!reset || !r.actorId) return "";
	return `
				<button type="button" class="stonetop-seasons-reset-btn" data-reset="${escHtml(r.reset)}" data-actor-id="${escHtml(r.actorId)}">`
		+ `<i class="fas ${reset.icon ?? "fa-rotate-left"}"></i> ${escHtml(reset.label)}</button>`;
}

function markResetDone(btn, reset) {
	btn.disabled = true;
	btn.innerHTML = `<i class="fas fa-check"></i> ${escHtml(reset.done)}`;
}

/**
 * The reminder card's reset buttons (the Logbook's), wired on each client that renders it. Only the
 * character's owner can press one (a GM owns every character); anyone else gets the card without it,
 * since the write is to that character's own sheet. Pressed, it resets the track and notes this card
 * on the character, so the same card cannot hand out a second reset later in the season. A reset
 * that `rolls` is pressed on one client only, and noted before it rolls (REMINDER_RESETS.naphtha).
 */
export function wireSeasonsReminderResets(message, html, {
	actors = globalThis.game?.actors, userId = globalThis.game?.user?.id ?? null,
	presser = actor => autoOpenUserId(ownerUsers(actor)),
} = {}) {
	for (const btn of [...(html?.querySelectorAll?.(".stonetop-seasons-reset-btn") ?? [])]) {
		const reset = REMINDER_RESETS[btn.dataset?.reset];
		const actor = actors?.get?.(btn.dataset?.actorId);
		const elsewhere = () => { const who = presser(actor); return !!who && who !== userId; };
		if (!reset || !actor?.isOwner || (reset.rolls && elsewhere())) {
			btn.remove();
			continue;
		}
		if (message?.id && actor.getFlag?.(SYSTEM_ID, reset.flag) === message.id) {
			markResetDone(btn, reset);
			continue;
		}
		btn.addEventListener("click", () => (reset.rolls ? pressRollingReset : pressReset)(message, btn, reset, actor));
	}
}

// The character's note of the card a reset was last pressed from, as an update.
const noteCard = (reset, value) => ({ [`flags.${SYSTEM_ID}.${reset.flag}`]: value ?? null });

async function pressReset(message, btn, reset, actor) {
	if (btn.disabled) return;
	btn.disabled = true;
	// Read again at the press: the GM and the character's player both get the button, and the other client's
	// press does not redraw this card. A reset that counts down (Collected offerings) would otherwise restore
	// a second use from the same card.
	if (message?.id && actor.getFlag?.(SYSTEM_ID, reset.flag) === message.id) {
		markResetDone(btn, reset);
		return;
	}
	try {
		const update = await reset.update(actor);
		if (!update) throw new Error(`${actor.name} has no ${reset.move} track to reset`);
		await actor.update({ ...update, ...noteCard(reset, message?.id) }, { stonetopMove: reset.move });
		markResetDone(btn, reset);
	} catch (err) {
		console.error(`Stonetop | Could not reset ${reset.move}:`, err);
		btn.disabled = false;
	}
}

// A reset that rolls: the card noted FIRST, so a second press (or a re-render) finds it pressed. The
// note comes off again only when the dice never reached chat.
async function pressRollingReset(message, btn, reset, actor) {
	if (btn.disabled) return;
	btn.disabled = true;
	const was = actor.getFlag?.(SYSTEM_ID, reset.flag) ?? null;
	let update;
	try {
		await actor.update(noteCard(reset, message?.id));
		update = await reset.update(actor);
		if (!update) throw new Error(`${actor.name} has no ${reset.move} track to set`);
	} catch (err) {
		console.error(`Stonetop | Could not roll for ${reset.move}:`, err);
		await actor.update(noteCard(reset, was)).catch(e => console.error(`Stonetop | Could not release ${reset.move}'s note`, e));
		btn.disabled = false;
		return;
	}
	markResetDone(btn, reset);
	try {
		await actor.update({ ...update, ...noteCard(reset, message?.id) }, { stonetopMove: reset.move });
	} catch (err) {
		console.error(`Stonetop | Could not write ${reset.move}'s roll:`, err);
		globalThis.ui?.notifications?.warn?.(`${reset.move}: the roll is in chat, but ${actor.name}'s track could not be set. Set it by hand.`);
	}
}

// GM side of the Seasons Change move: gather every player character's seasonal
// upkeep and post one public chat card for the table. A no-op when nothing in the
// party carries seasonal upkeep (so off-season parties get no empty card).
export function postSeasonsChangeReminder(season) {
	if (!globalThis.ChatMessage) return;
	// Only those still in play: the dead and those who retired, left or turned threat keep no upkeep, and a
	// button on their row would roll for a character nobody plays.
	const reminders = collectSeasonalReminders(charactersInPlay(), season);
	if (!reminders.length) return;
	ChatMessage.create({
		speaker: { alias: "The Seasons Change" },
		content: seasonsReminderCard(season, reminders),
	});
}
