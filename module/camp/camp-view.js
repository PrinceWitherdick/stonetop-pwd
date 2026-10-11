import { escHtml, joinNames } from "../utils/strings.js";
import { recoveredHpTo } from "../actors/character/deaths-door-actor.js";
import {
	CAMP_BENEFIT, CAMP_STATE, HAD_ALL_ALONG, HAD_ALL_ALONG_REFUSAL, SETTLE_REFUSAL, breakBreadOffered,
	CAMP_EXTRA, debilityToClear, eatsTonight, foodAfterTonight, healTo, homeFiresHp, homeFiresKeeper, homeFiresOffered, planExtras,
	nightmaresWarded,
	messKitAllAlong, messKitWouldHelp, provisionsAtFire, spareUses, suppliesAllAlong,
} from "./camp-rules.js";

/**
 * WHAT THE CAMP SAYS: the shared window's rows, the card that invites the table to the fire, and
 * the card that says how the night went. Pure, like camp-rules.js, so every sentence a player
 * reads can be tested without Foundry.
 *
 * The sentences name characters and never give them pronouns. A row's name heads it, and what is
 * said under the name reads the same whoever is behind it.
 */

function uses(n) {
	return n === 1 ? "use" : "uses";
}

function plural(n, one, many) {
	return n === 1 ? one : many;
}

function campOf(hostName) {
	return hostName ? `${hostName}'s camp` : "This camp";
}

/** "2 uses of supplies, 1 of provisions": what one pack gives. */
function shareLine(purses) {
	return purses
		.filter(p => p.n > 0)
		.map((p, i) => `${p.n} ${i === 0 ? `${uses(p.n)} of ` : "of "}${p.label.toLowerCase()}`)
		.join(", ");
}

// ── The cards ────────────────────────────────────────────────────────────────

/**
 * The body of the card a new camp posts. The button is stored in the card so it shows the moment
 * the card lands; camp-flow.js#wireCampCard decides at every render whether it still should.
 *
 * The slot's marker carries a VALUE. Foundry's HTML sanitizer drops a valueless attribute unless
 * it is a boolean it knows, and a bare `data-camp-join` would reach the log as a plain div the
 * wiring could never find.
 */
export function campJoinCardBody(hostName) {
	return `<div class="card-content stonetop-camp-card">
		<p class="stonetop-camp-card-text"><strong>${escHtml(hostName)}</strong> is making camp. Everyone settling in for the night can share food from their pack and take their rest.</p>
		<div class="card-buttons stonetop-card-buttons stonetop-camp-card-actions" data-camp-join="1">
			<button type="button" class="stonetop-camp-join"><i class="fas fa-campground"></i> Join the camp</button>
		</div>
	</div>`;
}

/** What a join card says in place of its button, once its camp is over. */
export function campCardClosedText(state, hostName) {
	const camp = campOf(hostName);
	switch (state) {
		case CAMP_STATE.SETTLED:   return `${camp} ate and settled in for the night.`;
		case CAMP_STATE.CANCELLED: return `${camp} broke up before anyone ate.`;
		case CAMP_STATE.COLD:      return `${camp} was left without anyone eating.`;
		default:                   return `${camp} is over.`;
	}
}

/**
 * What an open camp window says as it closes because the camp ended, or null to close quietly. A
 * settled camp closes quietly: its card has just said how the night went, and saying it twice
 * would bury that under a toast.
 */
export function closedCampNotice(state, hostName) {
	if (state === CAMP_STATE.SETTLED) return null;
	if (state === CAMP_STATE.CANCELLED) return `${campOf(hostName)} broke up. Nothing was eaten or spent.`;
	return `${campOf(hostName)} is over.`;
}

/**
 * What a player's camp window says as it closes because somebody else took their characters from the
 * fire: a GM sending them away, or bringing them to another camp. Without it the window just vanished.
 */
export function departedCampNotice(names, hostName) {
	const camp = hostName ? `${hostName}'s camp` : "the camp";
	return `${joinNames(names)} ${plural(names.length, "is", "are")} no longer at ${camp}.`;
}

const SETTLE_REFUSAL_TEXT = {
	[SETTLE_REFUSAL.CLOSED]:    "That camp is no longer open.",
	[SETTLE_REFUSAL.NOT_YOURS]: "Only the player whose character opened the camp, or the GM, can make camp.",
	[SETTLE_REFUSAL.SHORT]:     "Not everyone eating has food yet. Share more, or mark who goes without.",
};

/** Why pressing Make Camp did nothing, in words a player can act on. */
export function settleRefusalText(reason) {
	return SETTLE_REFUSAL_TEXT[reason] ?? "The camp could not be made.";
}

function mealLine(ledger) {
	const { mouths, bill, messKit, cooks } = ledger;
	if (!mouths) return "Nobody needed feeding.";
	const proper = breakBreadOffered(ledger) && ledger.properMeal ? " A proper meal (Break Bread)." : "";
	const hungry = ravenousText(ledger);
	return `${mouths} fed on ${bill} ${uses(bill)} of food${messKit ? `, cooked in ${cooks[0]}'s mess kit` : ""}.${hungry ? ` ${hungry}` : ""}${proper}`;
}

/** A Ravenous Thrall's extra 1d4 uses, said as rolled: "Ravenous: Rook eats 3 extra uses (1d4)." Empty without one. */
function ravenousText(ledger) {
	return (ledger.ravenous ?? [])
		.map(r => `Ravenous: ${r.name} eats ${r.uses} extra ${uses(r.uses)} (1d4).`)
		.join(" ");
}

/**
 * What a Thrall's Quicksilver Dreams do to tonight, in the meal box and on the settled card: everyone
 * else at the fire has nightmares and disadvantage on their next roll, unless the fire's ash keeps
 * them away (camp-rules.js#nightmaresWarded). Empty with no such Thrall at the fire.
 */
function nightmaresText(ledger) {
	const dreamers = (ledger.dreamers ?? []).map(d => d.name);
	if (!dreamers.length) return "";
	const who = joinNames(dreamers);
	if (nightmaresWarded(ledger)) {
		return `Quicksilver Dreams: the ash from ${homeFiresKeeper(ledger).name}'s hearth keeps ${who}'s nightmares from everyone here.`;
	}
	return `Quicksilver Dreams: everyone with ${who} suffers nightmares and has disadvantage on their next roll.`;
}

/** What each source of extra HP is called on a summary line (camp-rules.js#CAMP_EXTRAS). */
const EXTRA_WORDS = {
	[CAMP_EXTRA.BEDROLL]:     n => `bedroll rolled ${n}`,
	[CAMP_EXTRA.BREAK_BREAD]: n => `Break Bread rolled ${n}`,
	[CAMP_EXTRA.HOME_FIRES]:  n => `the home fires gave ${n} extra HP`,
};

/** One extra-HP step on a summary line: what it was, and what it did to their HP. */
function extraPart({ source, amount, from, to }) {
	const said = EXTRA_WORDS[source]?.(amount) ?? `${amount} extra HP`;
	return to > from ? `${said}, HP ${from} → ${to}` : `${said}, but HP was already full`;
}

function outcomeLine(entry) {
	const dreams = entry.nightmares?.length
		? `nightmares from ${joinNames(entry.nightmares)}'s Quicksilver Dreams, so disadvantage is held for the next roll`
		: "";
	if (entry.unliving) return `Needs no food or sleep, and took nothing from the night${dreams ? `; ${dreams}` : ""}.`;
	// The extra HP in the order it landed, then any background track making camp cleared.
	const after = [
		...planExtras(entry).map(extraPart),
		// The steps above say what the night should have healed; Torment's Blessing halves the lot.
		...(entry.slowToHeal ? [`Torment's Blessing recovers only half of that, rounded up, HP ${entry.hpBefore} → ${entry.hpAfter}`] : []),
		...(entry.clears ?? []).map(track => `cleared ${track.name}`),
		...(dreams ? [dreams] : []),
	];
	const tail = after.map(part => `; ${part}`).join("");
	if (!entry.eats) return `Went without food, so took no pick tonight${tail}.`;
	if (!entry.rests) return `Ate, but got no real sleep, so took no pick tonight${tail}.`;
	const parts = [];
	if (entry.benefit === CAMP_BENEFIT.DEBILITY) parts.push(`Cleared ${entry.debility?.name ?? "a debility"}`);
	// Book I p.240 and p.245: dying, they can't save themselves; whoever tends them Aids the roll.
	else if (entry.dying) parts.push("Dying, so the night itself restores no HP: someone who tends them Aids their roll at the Door instead");
	else if (entry.hpAfterPick > entry.hpBefore) parts.push(`HP ${entry.hpBefore} → ${entry.hpAfterPick} (half max)`);
	else parts.push(`HP already full at ${entry.hpBefore}`);
	parts.push(...after);
	if (entry.peaceful) parts.push("a peaceful night, so advantage is held for the next roll");
	if (entry.furBedroll) parts.push("slept in the fur-lined bedroll, so advantage is held for the next roll");
	return `${parts.join("; ")}.`;
}

/**
 * The fire's line on the settled card, when the ash was sprinkled: "free from nightmares or bad
 * dreams" is for everyone, even at CHA 0, so it is said whatever the HP. Null otherwise.
 */
function hearthLine(ledger) {
	if (!homeFiresOffered(ledger) || ledger.hearthAsh === false) return null;
	const hp = homeFiresHp(ledger);
	return `Ash from ${homeFiresKeeper(ledger).name}'s hearth (Keep the Home-Fires Burning): everyone making camp here is free from nightmares or bad dreams${hp ? ` and recovers ${hp} extra HP` : ""}.`;
}

/**
 * The settled camp's card, as label and value rows: the meal, whose food paid for it, then what
 * the night bought each person. Told from the plan, so it says what every share was told to do.
 */
export function campSummaryRows(ledger, plan) {
	const rows = [{ label: "The meal", value: mealLine(ledger) }];
	const hearth = hearthLine(ledger);
	if (hearth) rows.push({ label: "The fire", value: hearth });
	const dreams = nightmaresText(ledger);
	if (dreams) rows.push({ label: "The night", value: dreams });
	for (const entry of plan) {
		const shared = shareLine(entry.spend ?? []);
		if (shared) rows.push({ label: `From ${entry.name}'s pack`, value: shared });
	}
	for (const entry of plan) rows.push({ label: entry.name, value: outcomeLine(entry) });
	return rows;
}

// ── The window ───────────────────────────────────────────────────────────────

function mealView(ledger) {
	const { mouths, bill, offered, short, over, messKit, cooks } = ledger;
	const atFire    = ledger.rows.filter(eatsTonight).length;
	const followers = mouths - atFire;
	const followerWord = plural(followers, "follower", "followers");
	let mouthsText;
	if (!mouths) mouthsText = "Nobody here needs feeding.";
	else if (!followers) mouthsText = `${mouths} to feed.`;
	else if (!atFire) mouthsText = `${mouths} ${followerWord} to feed.`;
	else mouthsText = `${mouths} to feed: ${atFire} at the fire and ${followers} ${followerWord}.`;

	let statusText = "";
	if (short) statusText = `${short} more ${uses(short)} needed. Share more food, decide someone had supplies all along, or mark who goes without.`;
	else if (over) statusText = `Paid for, with ${over} to spare. Only what the meal needs is eaten, and the rest stays in the packs.`;
	else if (mouths) statusText = "Paid for.";

	return {
		mouthsText,
		cookText: !mouths ? "" : messKit
			? `${cooks[0]}'s mess kit stretches each use to feed 4.`
			: "With no mess kit, each use feeds 1.",
		costText: !mouths ? "" : `The meal costs ${bill} ${uses(bill)} of food, and ${offered} ${plural(offered, "has", "have")} been shared.`,
		statusText,
		// Forage is the other way to more food, and it comes before the fire: "a few hours seeking
		// food in the wild" (p.79), so it is said only while the meal is short.
		forageText: short ? "Or Forage first: a few hours seeking food in the wild, rolling +WIS." : "",
		afterText:  mouths && !short ? afterTonightText(foodAfterTonight(ledger)) : "",
		provisionsText: provisionsAtFire(ledger)
			? "Provisions spoil and attract beasts more readily than supplies do (Book I p.89)."
			: "",
		// A Ravenous Thrall's extra, part of the cost above, rolled when they sat down.
		hungerText: ravenousText(ledger),
		nightmaresText: nightmaresText(ledger),
		isShort: short > 0,
		isPaid:  mouths > 0 && short === 0,
	};
}

/**
 * The host's "A proper meal (Break Bread)" box, in the meal box once the meal is paid and somebody
 * eating holds the move. Ticked unless the host unticks it: whether the meal is a proper one and
 * everyone eats their fill is the fiction's to say, so the window cannot check it. Only a reader who
 * settles the camp can change it; everyone else reads which way it stands.
 */
function breakBreadView(ledger, { isOpen, manages }) {
	const host = ledger.rows.find(m => m.isHost);
	if (!isOpen || !host || !breakBreadOffered(ledger)) return { show: false };
	const holders = joinNames(ledger.breadBreakers);
	return {
		show:     true,
		canTick:  manages,
		hostId:   host.actorId,
		ticked:   ledger.properMeal,
		label:    "A proper meal (Break Bread): everyone eating their fill recovers 1d8 extra HP",
		holders:  `${holders} ${plural(ledger.breadBreakers.length, "has", "have")} Break Bread. Untick this if the meal is not a proper one or somebody does not eat their fill.`,
		says:     ledger.properMeal
			? "A proper meal (Break Bread): everyone eating recovers 1d8 extra HP."
			: "Not a proper meal tonight, so Break Bread gives nothing.",
	};
}

/**
 * The host's "Ash from your own hearth" box (Keep the Home-Fires Burning), in the meal box whenever
 * somebody at the fire holds the move. Ticked unless the host unticks it: whether the fire was
 * sprinkled with ash from the holder's own hearth is the fiction's to say. As with Break Bread, only a
 * reader who settles the camp can change it.
 */
function homeFiresView(ledger, { isOpen, manages }) {
	const host   = ledger.rows.find(m => m.isHost);
	const keeper = homeFiresKeeper(ledger);
	if (!isOpen || !host || !keeper) return { show: false };
	const hp      = Math.max(0, keeper.cha);
	const gives   = `free from nightmares or bad dreams${hp ? ` and recovers ${hp} extra HP` : ""}`;
	const holders = ledger.hearthKeepers.map(k => k.name);
	return {
		show:     true,
		canTick:  manages,
		hostId:   host.actorId,
		ticked:   ledger.hearthAsh !== false,
		label:    `Ash from your own hearth (Keep the Home-Fires Burning): everyone making camp here is ${gives}`,
		holders:  `${joinNames(holders)} ${plural(holders.length, "has", "have")} Keep the Home-Fires Burning${holders.length > 1 ? `; ${keeper.name}'s CHA counts` : ""}. Untick this if the fire is not sprinkled with ash from their own hearth.`,
		says:     ledger.hearthAsh !== false
			? `Ash from ${keeper.name}'s hearth: everyone making camp here is ${gives}.`
			: "No ash from a hearth on this fire, so Keep the Home-Fires Burning gives nothing.",
	};
}

function nights(n) {
	return n === 1 ? "night" : "nights";
}

/** What the fire has left to eat once tonight is paid, as the p.327 party works it out. */
function afterTonightText({ left, nights: more }) {
	if (!left) return "After tonight, the packs at this fire hold no more food.";
	const lasts = more ? `enough for ${more} more ${nights(more)} like this one` : "not enough for another night like this one";
	return `After tonight, ${left} ${uses(left)} of food ${plural(left, "stays", "stay")} in the packs at this fire: ${lasts}.`;
}

const SUPPLY_ROW_LABELS = {
	"supplies":           "Supplies",
	"more-supplies":      "More supplies",
	"even-more-supplies": "Even more supplies",
};

/**
 * Have What You Need at the fire, on a row the reader drives. Supplies are offered while the meal is
 * short by more than this pack could still share, and held with the reason when this pack cannot
 * produce them, since a short meal is exactly when a player looks for them. A mess kit is offered only when it would save a use tonight and this
 * character could produce one: it is a bargain, never a need.
 */
function allAlongView(member, ledger, canEdit) {
	const supplies = suppliesAllAlong(member);
	// Food already in this pack is shared, not conjured: the button waits until the pack is short too.
	const showSupplies = canEdit && ledger.short > spareUses(ledger, member);
	const showKit = canEdit && messKitWouldHelp(ledger) && messKitAllAlong(member);
	let blocked = "";
	if (supplies.reason === HAD_ALL_ALONG_REFUSAL.NO_MARKS) blocked = `${member.name} has no undefined ◇ left to turn into supplies.`;
	else if (supplies.reason === HAD_ALL_ALONG_REFUSAL.NO_ROW) blocked = `All three supplies rows are already marked on ${member.name}'s Inventory.`;
	return {
		show: showSupplies || showKit,
		supplies: {
			show:    showSupplies,
			can:     supplies.ok,
			label:   supplies.ok ? `Had supplies all along (${supplies.uses} ${uses(supplies.uses)})` : "Had supplies all along",
			blocked,
			// A held button says on hover why it is held; otherwise, what pressing it spends.
			tip:     blocked || "Have What You Need: 1 undefined ◇ becomes a row of supplies you had all along.",
		},
		messKit: { show: showKit, tip: "Have What You Need: 1 undefined ◇ becomes a mess kit you had all along." },
	};
}

/**
 * The chat card a Have What You Need at the fire posts, as label and value rows. It goes to chat
 * because the move lets anyone object: "The GM or any player can veto unreasonable items" (p.78).
 */
export function hadAllAlongRows(what, { row, uses: n } = {}) {
	const item = what === HAD_ALL_ALONG.MESS_KIT
		? "A mess kit, for 1 undefined ◇. It needs fire and water, and then 1 use of food feeds 4."
		: `${SUPPLY_ROW_LABELS[row] ?? "Supplies"}, ${n} ${uses(n)} of food, for 1 undefined ◇.`;
	return [
		{ label: "Had all along", value: item },
		{ label: "Any objection", value: "The GM or any player can veto something that could not have been there all along." },
	];
}

/**
 * What a dying member's row says under the night's pick: the pick, their own bedroll and a peaceful
 * night restore them nothing (Book I p.240), while an ally's Break Bread or hearth ash still can.
 */
const DYING_ROW_TEXT = "Dying, so the night itself restores no HP. An ally's Break Bread or hearth ash still can, and whoever tends them Aids their roll at the Door.";

/** What a row the reader cannot change says instead of its controls. */
function rowSentences(member, offer, { eats, benefit, clearing, hpAfter, dying = false }) {
	const { record } = member;
	const says = [offer.total ? `Sharing ${shareLine(offer.purses)}.` : "Sharing no food yet."];
	const others = record.followers
		? `${record.followers} ${plural(record.followers, "follower eats", "followers eat")}`
		: "";
	if (member.unliving) says.push(`Needs no food or sleep (Unliving)${others ? `, but ${others}` : ""}.`);
	// The card's own mark already says they are going without, so only who still eats is left to say.
	else if (!record.eats) { if (others) says.push(`${others} tonight.`); }
	else says.push(others ? `Eating tonight, and ${others} too.` : "Eating tonight.");
	if (record.messKit && record.vitals.messKit) says.push("Cooking with a mess kit.");
	if (!eats) return says;
	if (benefit === CAMP_BENEFIT.NONE) {
		says.push("Getting no real sleep, so no pick.");
		return says;
	}
	if (benefit === CAMP_BENEFIT.DEBILITY) says.push(`Clearing ${clearing?.name ?? "a debility"}.`);
	else if (dying) says.push(DYING_ROW_TEXT);
	else says.push(`Regaining HP: ${member.hpValue} → ${hpAfter}${member.slowToHeal ? " (halved: Torment's Blessing)" : ""}.`);
	if (dying) return says;
	if (record.bedroll && record.vitals.bedroll) says.push("Sleeping in a bedroll for 1d6 extra HP.");
	if (record.peaceful) says.push("Found the rest peaceful.");
	return says;
}

function rowView(member, at, ledger, { canEdit, isMine, canOpenSheet }) {
	const { record } = member;
	const offer   = ledger.offers[at];
	const kept    = ledger.spends[at];
	const eats    = eatsTonight(member);
	const marked  = member.activeDebilities;
	// Torment's Blessing halves the pick's HP, rounded up; the settled card halves the whole night's.
	// One dying at the fire takes no HP from the pick (camp-rules.js#freezeCampPlan), so none is promised.
	const dying   = !!member.dying;
	const hpAfter = dying ? member.hpValue
		: recoveredHpTo(member.hpValue, healTo(member.hpValue, Math.ceil(member.maxHp / 2), member.maxHp), !!member.slowToHeal);
	// A debility pick with nothing marked any more has only healing left to mean.
	const benefit  = record.benefit === CAMP_BENEFIT.DEBILITY && !marked.length ? CAMP_BENEFIT.HP : record.benefit;
	const clearing = debilityToClear(member);
	const spare    = spareUses(ledger, member);
	const returned = offer.total - kept.total;
	return {
		actorId:    member.actorId,
		name:       member.name,
		img:        member.img ?? "",
		// The face opens the character's sheet, for a reader allowed to see it.
		canOpenSheet,
		sheetLabel: `Open ${member.name}'s character sheet`,
		isMine,
		canEdit,
		unliving:   member.unliving,
		stateText:  member.isHost ? "Making camp" : record.ready ? "Ready" : "Still choosing",
		stateClass: member.isHost ? "is-host" : record.ready ? "is-ready" : "is-choosing",
		purses: offer.purses.map(p => ({
			slug:      p.slug,
			label:     p.label,
			remaining: p.remaining,
			n:         p.n,
			canTake:   p.n > 0,
			// Once the meal is paid for, more food is only more to give back.
			canAdd:    p.n < p.remaining && ledger.short > 0,
		})),
		cover: {
			show:  ledger.short > 0 && spare > 0,
			label: spare >= ledger.short
				? `Cover the last ${ledger.short} ${uses(ledger.short)}`
				: `Share the ${spare} ${uses(spare)} still in this pack`,
		},
		allAlong: allAlongView(member, ledger, canEdit),
		givesBackText: returned > 0
			? `${returned} ${uses(returned)} shared here ${plural(returned, "stays", "stay")} in the pack: the meal is already paid for.`
			: "",
		// Going without food (p.335) costs the night's pick, not the seat: the card stays, marked. The
		// Unliving have no meal to go without.
		goesWithout:     !member.unliving && !record.eats,
		followers:       record.followers,
		canTakeFollower: record.followers > 0,
		// No most: every mouth in the party eats (camp-rules.js, beside CAMP_LEFT_MAX).
		canAddFollower:  true,
		messKit:         { carries: record.vitals.messKit, uses: record.messKit },
		night: {
			show:          eats,
			radioName:     `campBenefit-${member.actorId}`,
			hp:            benefit === CAMP_BENEFIT.HP,
			debility:      benefit === CAMP_BENEFIT.DEBILITY,
			none:          benefit === CAMP_BENEFIT.NONE,
			hpBefore:      member.hpValue,
			hpAfter,
			halvedText:    member.slowToHeal && !dying ? "(halved: Torment's Blessing)" : "",
			dyingText:     dying ? DYING_ROW_TEXT : "",
			hasDebilities: marked.length > 0,
			debilities:    marked.map(d => ({ key: d.key, name: d.name, selected: d.key === clearing?.key })),
		},
		// Their own bedroll and a peaceful night do nothing for one dying at the fire, so neither is offered.
		bedroll:   { carries: record.vitals.bedroll && !dying, uses: record.bedroll },
		showPeaceful: !dying,
		peaceful:  record.peaceful,
		ready:     record.ready,
		readyLabel: eats ? "Ready to eat and rest" : "Ready to settle in",
		// The foot holds the ready tick and Go without. The host settles the camp, so the host has no
		// ready tick to give; an Unliving host has nothing to go without either, and no foot.
		showReady: !member.isHost,
		showFoot:  !member.isHost || !member.unliving,
		says:      canEdit ? [] : rowSentences(member, offer, { eats, benefit, clearing, hpAfter, dying }),
	};
}

/**
 * Why Make Camp cannot be pressed yet, and what would change that: what a held button says on hover.
 * A disabled button answers no click, so hovering it is the only way left to ask it.
 */
function settleBlockedText(ledger) {
	if (!ledger.rows.length) return "Nobody is at the fire.";
	const { short } = ledger;
	return `The meal is ${short} ${uses(short)} of food short. Share more food, decide someone had supplies all along, or press Go without on the card of anyone not eating.`;
}

function navView({ isOpen, manages, ledger, hostName }) {
	if (!isOpen) return { manages, canSettle: false, hint: "", blocked: settleRefusalText(SETTLE_REFUSAL.CLOSED) };
	if (!manages) {
		return { manages, canSettle: false, hint: `${hostName || "Whoever opened the camp"} makes camp once everyone is ready.`, blocked: "" };
	}
	let hint = "Everyone is ready.";
	if (!ledger.canSettle) hint = "Make Camp waits until everyone eating has food.";
	else if (ledger.waitingOn.length) hint = `Still choosing: ${joinNames(ledger.waitingOn)}.`;
	return { manages, canSettle: ledger.canSettle, hint, blocked: ledger.canSettle ? "" : settleBlockedText(ledger) };
}

/**
 * Everything the camp window draws, for one reader.
 *
 * @param {object}   o
 * @param {string}   o.state     CAMP_STATE
 * @param {string}   o.hostName
 * @param {object}   o.ledger    camp-rules.js#campLedger
 * @param {boolean}  o.manages   the reader can settle the camp or break it up
 * @param {boolean}  o.sendsAway the reader can send someone away from the fire (a GM)
 * @param {string[]} o.editable  actor ids of the rows the reader can change
 * @param {string[]} o.mine      actor ids of the characters the reader plays
 * @param {string[]} o.viewable  actor ids of the characters whose sheets the reader may open
 * @param {Array<{id: string, name: string}>} o.addable  who a GM could still bring to the fire
 */
export function campWindowView({ state, hostName = "", ledger, manages = false, sendsAway = false, editable = [], mine = [], viewable = [], addable = [] }) {
	const isOpen  = state === CAMP_STATE.OPEN;
	const canEdit = new Set(editable);
	const plays   = new Set(mine);
	const sees    = new Set(viewable);
	// Never the host: a camp without its host has nobody to settle it, and Break up is for that.
	const awayable = sendsAway ? ledger.rows.filter(m => !m.isHost).map(m => ({ id: m.actorId, name: m.name })) : [];
	const rows = ledger.rows.map((member, at) => rowView(member, at, ledger, {
		canEdit: isOpen && canEdit.has(member.actorId),
		isMine:  plays.has(member.actorId),
		canOpenSheet: sees.has(member.actorId),
	}));
	return {
		isOpen,
		closedText: isOpen ? "" : campCardClosedText(state, hostName),
		title:      hostName ? `${hostName}'s camp` : "Make Camp",
		meal:       mealView(ledger),
		breakBread: breakBreadView(ledger, { isOpen, manages }),
		homeFires:  homeFiresView(ledger, { isOpen, manages }),
		// What the Have What You Need buttons are, said once in the meal box rather than on every card.
		allAlongText: rows.some(r => r.allAlong.show)
			? "Have What You Need: anyone can decide an undefined ◇ was supplies or a mess kit all along. The GM or any player can veto it."
			: "",
		rows,
		add:        { show: isOpen && addable.length > 0, options: addable },
		sendAway:   { show: isOpen && awayable.length > 0, options: awayable },
		// Bring someone and Send them away share one list and one line.
		roster:     { show: isOpen && (addable.length > 0 || awayable.length > 0) },
		nav:        navView({ isOpen, manages, ledger, hostName }),
	};
}
