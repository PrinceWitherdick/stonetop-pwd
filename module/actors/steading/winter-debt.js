import { escHtml, sign, signed } from "../../utils/strings.js";
import { parseSeasonStamp } from "../../seasons/campaign-year.js";
import { openDebilityPicker, openDisasterPicker, disasterFortunes, disasterOwedFlags, noteShortfallOnTimeline, debilityPath } from "./steading-debilities.js";
import { confirmOutcome } from "../../utils/ask-with-buttons.js";
import { pickPersonOnMap } from "../../dialogs/RelationshipLinkDialog.js";
import { npcStatusMeta } from "../../data-models/npc-status.js";
import { charactersInPlay } from "../../utils/characters-in-play.js";
import { canRetire, openRetireDialog } from "../../campaign/retire-pc.js";
import { stonetopChatCard } from "../../utils/chat.js";
import { askGMClient, queryAsker } from "../../utils/foundry-compat.js";
import { isPrimaryGM } from "../../utils/primary-gm.js";
import { getStonetopSteadingActor } from "../../utils/world.js";

// ── Winter's second bite (Book I, "Seasons Change": winter) ──────────────────────
// "7-9: the steading must consume 1d4+Population more Surplus before winter ends, or suffer
//  the consequences again.  6-: as 7-9, plus threats abound."
//
// EVERY other seasonal obligation is derivable: the watch's upkeep is "built, and not stamped
// for this season", and the tray works it out from state that was already there. This one is
// not. It is created by a die roll, its amount is another die roll, and until now nothing in
// the system remembered either — the 7-9 was said once in a chat card and the table carried it
// in their heads across however many sessions winter took.
//
// So this is the one hold with storage of its own (StonetopSteading#winterDebt), and the one
// with a settle control of its own. The others are all closed out inside the Seasons Change
// window; this one comes due AFTER that window is shut, which is exactly why the header glyph
// is the right place for it and why the glyph has to lead somewhere.
//
// THE DEADLINE IS THE STAMP. The debt is recorded against the "<year>:<season>" it was rolled
// in, so the header glyph goes out by the debt ceasing to match the clock, the way Tor's
// blessing does. But the rule does not let it lapse: "before winter ends, OR suffer the
// consequences". So the next spring's Seasons Change opens on it ("Winter's end"), found by
// its stamp rather than by the clock, and asks the same two-way question this file's window
// asks. It is asked in the open, in the window the GM is already walking, never charged
// quietly behind the table's back.

export const WINTER_DEBT_MOVE = "Seasons Change";

// Wider than core's 400px default: the four consequences are each a label over a sentence, and
// at 400 every one of those sentences ran to three lines, which turned a list you scan into a
// wall you read. 480 rather than the season flow's 560 because this window asks ONE question.
const DIALOG_OPTIONS = { width: 480, classes: ["dialog", "stonetop", "stonetop-winter-debt-dialog"] };

/**
 * What a steading that cannot feed itself through winter loses. ONE table, because two
 * different moments ask the same question with the same four answers: the first consumption
 * inside the Seasons Change window, and this debt settled some sessions later. They used to be
 * one list of hand-written <li>s in the season dialog, which is the shape a second copy starts
 * from.
 *
 * `population` is the only one written straight off; the other three are the GM's to narrate,
 * because what a lost cistern costs is a conversation, not a number. What each leaves on the
 * sheet is then OFFERED (followUpWinterConsequence): a lost resource may leave the steading
 * lacking, a dead NPC is marked dead, and a PC's going is a note for the group.
 */
export const WINTER_CONSEQUENCES = [
	{
		id: "population",
		label: "Population loss",
		detail: "Reduce Population by 1 (min -1) due to death, decrepitude, and departure.",
	},
	{
		id: "resource",
		label: "Important resource lost or damaged",
		detail: "A horse, the cistern, etc.: lost or not maintained. You'll be asked whether it leaves the steading lacking.",
	},
	{
		id: "npc",
		label: "Important NPC dies",
		detail: "Their role unfilled. You'll be asked who, and they are marked dead.",
	},
	{
		id: "pc",
		label: "A PC dies, leaves, or retires",
		detail: "Their player gets an epilogue and makes a new PC between sessions. You'll be asked who, to write a leaving or retiring PC's epilogue.",
	},
];

// ── What a picked consequence leaves on the sheet (Book I pp.511, 517-518) ───────
// Offered, never decided: the GM narrates the consequence first ("Name specific folks who die or leave
// or grow infirm. Play out the scene where the granary's roof falls in", p.518), and only then is asked
// what it leaves behind. Closing any of these leaves the sheet as it was.

/**
 * "An important resource (one of the horses, the cistern, etc.) is lost or not maintained" (p.517), and
 * "Should Stonetop lose access to one or more of these resources for a season or so, then mark the lacking
 * debility" (p.511). Whether this loss is one of those is the GM's call, so it is asked. Whether lacking
 * was marked.
 */
export async function offerLackingForLostResource(steading, { confirm = confirmOutcome, stonetopMove = WINTER_DEBT_MOVE } = {}) {
	if (steading?.getSystemValue?.(debilityPath("lacking"), false)) return false;
	const yes = await confirm({
		title: "An Important Resource Is Lost",
		content: `<p>Should Stonetop lose access to one of its resources (farming, the cistern, its tradesfolk...) for a season or so, it is <strong>lacking</strong>: treat Prosperity as 1 lower (Book I p.511).</p><p>Does this loss leave the steading lacking?</p>`,
		yes: { label: "Mark the steading lacking", icon: "fa-box-open" },
		no: { label: "Not lacking" },
	});
	if (!yes) return false;
	await steading.setSystemValue(debilityPath("lacking"), true, { stonetopMove });
	globalThis.ui?.notifications?.info?.("Stonetop marked lacking.");
	return true;
}

/** Whether `user` may see this actor at all (Observer or better; a GM sees everyone). A fake with no permission test sees all. */
const canSeeActor = (actor, user) => (typeof actor?.testUserPermission === "function" && user
	? !!actor.testUserPermission(user, "OBSERVER") : true);

/**
 * The NPCs a winter can take: every NPC actor in the world not already gone (dead or retired) that `user` can
 * see. Every world actor reaches every client, so the GM's hidden NPCs would otherwise be named to a player
 * running the shortfall. PURE but for the permission test.
 */
export function livingNpcs(actors = [], user = globalThis.game?.user ?? null) {
	return [...actors].filter(a => a?.type === "npc" && !npcStatusMeta(a.system?.status).inactive && canSeeActor(a, user));
}

/** The User query a player's client sends when the NPC winter takes is one they cannot write. */
export const WINTER_NPC_DEAD_QUERY = "stonetop.winterNpcDead";

/**
 * "An important NPC dies, their role unfilled" (p.517): ask who, and mark them dead (npc-status.js). The
 * people chooser, as every "which person" question asks it. A player who cannot write the NPC has the GM's
 * client mark them (WINTER_NPC_DEAD_QUERY); with no GM here, they are told who can. The NPC marked dead, or null.
 *
 * @param {object} [deps]  injectable for tests: `actors`, `pick`, `user`, `gm`, `ask` (askGMClient's shape)
 */
export async function markNpcDeadForWinter({
	actors = globalThis.game?.actors?.contents ?? [], pick = pickPersonOnMap, user = globalThis.game?.user ?? null,
	gm = globalThis.game?.users?.activeGM ?? null, ask = askGMClient,
} = {}) {
	const npcs = livingNpcs(actors, user);
	if (!npcs.length) {
		globalThis.ui?.notifications?.info?.("No NPC in the world to mark dead. Note who died on the Residents list.");
		return null;
	}
	const id = await pick({
		options: npcs.map(actor => ({ id: actor.id, name: actor.name, actor })),
		title: "Who dies this winter?",
		hint: "An important NPC dies, their role unfilled. Who was it?",
		icon: "fa-skull",
		formatLabel: name => `${name} dies`,
	});
	const npc = id ? npcs.find(a => a.id === id) : null;
	if (!npc) return null;
	if (npc.isOwner === false) {
		if (!gm) {
			globalThis.ui?.notifications?.warn?.(`Only the GM can mark ${npc.name} dead, and no GM is here. Ask them to set ${npc.name}'s status to Dead on their sheet.`);
			return null;
		}
		const done = await ask(gm, WINTER_NPC_DEAD_QUERY, { npcId: npc.id, userId: user?.id ?? null },
			{ fallback: null, what: "mark the NPC winter took dead" });
		if (!done) {
			globalThis.ui?.notifications?.warn?.(`The GM's client could not mark ${npc.name} dead. Ask the GM to set ${npc.name}'s status to Dead on their sheet.`);
			return null;
		}
	} else {
		await npc.update({ "system.status": "dead" });
	}
	globalThis.ui?.notifications?.info?.(`${npc.name} is marked dead.`);
	return npc;
}

/**
 * The GM's side of WINTER_NPC_DEAD_QUERY, on the primary GM only: mark the NPC dead when the asker can see it
 * and can write the steading whose winter it is (they are the one running the shortfall). Answers
 * `{npcId}`, or null when refused.
 */
export async function handleWinterNpcDeadQuery(data, context = {}, {
	users = globalThis.game?.users, actors = globalThis.game?.actors, steading = getStonetopSteadingActor(),
} = {}) {
	if (!globalThis.game?.user?.isGM || !isPrimaryGM()) return null;
	const asker = queryAsker(data, context, users);
	const npc = actors?.get?.(data?.npcId) ?? null;
	if (!asker || npc?.type !== "npc" || npcStatusMeta(npc.system?.status).inactive) return null;
	if (!npc.testUserPermission?.(asker, "OBSERVER")) return null;
	if (!steading?.testUserPermission?.(asker, "OWNER")) return null;
	await npc.update({ "system.status": "dead" });
	return { npcId: npc.id };
}

/** The note a PC's going posts, for the whole table (p.518). PURE. */
export function pcGoesNoteHtml() {
	return stonetopChatCard("Winter's shortfall: a PC dies, leaves, or retires",
		`<div class="card-content"><p>"If the player opts to have their PC die, leave, or retire, then let them have an epilogue (page 584) in this session or the next. Ask the player to make a new PC between sessions." (Book I p.518)</p></div>`);
}

/**
 * "The weariest PC's player has them die, leave, or retire" (Book I p.584, of p.518): ask which PC, and open the
 * retire window for them (campaign/retire-pc.js), where the player's epilogue is written down. Closing the chooser,
 * as for a PC who dies instead, leaves everyone in play. Whether the window was opened.
 */
export async function offerRetireForWinter({
	// Only those this user may retire (their own, or anyone for a GM): another player's PC would open nothing.
	characters = charactersInPlay().filter(actor => canRetire(actor)), pick = pickPersonOnMap, retire = openRetireDialog,
} = {}) {
	if (!characters.length) {
		globalThis.ui?.notifications?.info?.("None of the characters still in play is yours to retire. Their player or the GM can retire them from the character sheet.");
		return false;
	}
	const id = await pick({
		options: characters.map(actor => ({ id: actor.id, name: actor.name, actor })),
		title: "Who leaves or retires?",
		hint: "The weariest PC's player has them die, leave, or retire. Pick them to write their epilogue, or close this if they die instead.",
		icon: "fa-door-open",
		formatLabel: name => `${name} leaves or retires`,
	});
	const actor = id ? characters.find(a => a.id === id) : null;
	if (!actor) return false;
	await retire(actor);
	return true;
}

/** Run a follow-up, logging a failure: the shortfall already written stands either way. */
async function followUpQuietly(followUp, steading, consequenceId) {
	try { await followUp?.(steading, consequenceId); }
	catch (err) { console.error("Stonetop | a winter consequence's follow-up failed", err); }
}

/**
 * Offer what a picked winter consequence leaves on the sheet, once the shortfall is written. Population's is
 * already written by the shortfall itself.
 * @param {object} deps  injectable for tests: `confirm`, `pick`, `actors`, `post`
 */
export async function followUpWinterConsequence(steading, consequenceId, deps = {}) {
	const { post = data => globalThis.ChatMessage?.create?.(data) } = deps;
	if (consequenceId === "resource") return offerLackingForLostResource(steading, deps);
	if (consequenceId === "npc") return markNpcDeadForWinter(deps);
	if (consequenceId === "pc") {
		const actor = steading?._actor;
		await post({
			content: pcGoesNoteHtml(),
			speaker: actor ? { actor: actor.id, alias: actor.name } : undefined,
		});
		await offerRetireForWinter(deps);
		return true;
	}
	return null;
}

/** The four choices as the markup both windows click on. Same classes and the same
 *  `data-consequence` hook, so one stylesheet rule and one listener shape serve both. */
export function winterConsequencesHtml() {
	return `<ol class="stonetop-disaster-choices">
		${WINTER_CONSEQUENCES.map(c => `<li class="stonetop-disaster-choice" data-consequence="${c.id}">
			<span class="stonetop-disaster-choice-label">${escHtml(c.label)}</span>
			<span class="stonetop-disaster-choice-detail">${escHtml(c.detail)}</span>
		</li>`).join("")}
	</ol>`;
}

/**
 * The shortfall write: Surplus to 0, the steading Meets with Disaster, and Population down 1 if
 * that is the consequence picked. Shared by every moment that asks, for the same reason the
 * table above is.
 *
 * "Meets with Disaster" is Book I p. 84 and p. 518; the move box on p. 517 prints the short form
 * "reduce Fortunes by 1", which is the same thing everywhere except at the floor. At Fortunes −1
 * the disaster does not lower Fortunes at all, the GM picks a debility (or a Population loss)
 * instead (p. 532). That pick is a window, so it is the caller's: this returns `disaster` and
 * writes everything else. p. 518's "these consequences don't trigger it again" is why the
 * consequence and the disaster can both take a Population: they are two separate costs.
 *
 * Does NOT choose a season step. The first consumption closes `consumption` for the season and
 * the debt clears its own flag; which of those happened is the caller's business, so the caller
 * passes it as `alsoFlags`, and it goes out in this same write.
 *
 * @returns {{fortunes: number, population: number|null, disaster: boolean}} what it wrote, and
 *   whether the Meet with Disaster pick is still owed
 */
export async function applyWinterShortfall(steading, consequenceId, { stonetopMove = WINTER_DEBT_MOVE, alsoFlags = {}, season = null } = {}) {
	const { fortunes, disaster } = disasterFortunes(steading.getStatValue("fortunes"));
	const population = consequenceId === "population"
		? Math.max(steading.getStatValue("population") - 1, -1)
		: null;
	await steading.applyChanges({
		system: {
			"attributes.surplus.value": 0,
			...(disaster ? {} : { "stats.fortunes.value": fortunes }),
			...(population === null ? {} : { "attributes.population.value": population }),
		},
		// At −1 the pick is owed from this write on, so a picker shut unpicked leaves a glyph, and
		// it keeps the winter it is owed for (`season`), whose shortfall note the pick goes on.
		flags: { ...alsoFlags, ...(disaster ? disasterOwedFlags("winter's shortfall", season) : {}) },
	}, { stonetopMove });
	return { fortunes, population, disaster };
}

/** What a shortfall did, as the one notification every window posts for it. */
export function shortfallNotice({ fortunes, population, disaster }) {
	const pop = population === null ? "" : `, Population to ${sign(population)}`;
	return disaster
		? `Shortfall: Surplus to 0${pop}. Fortunes is already ${sign(fortunes)}, so the steading Meets with Disaster.`
		: `Shortfall: Surplus to 0, Fortunes to ${sign(fortunes)}${pop}.${population === null ? " Apply the narrative consequence." : ""}`;
}

/** The title of a winter's shortfall note on the timeline (timeline-season-entry.js). */
export const WINTER_SHORTFALL_TITLE = "Winter's shortfall";

/**
 * What a shortfall did, as the winter's shortfall line on the timeline says it: the consequence
 * picked, then what it cost. `late` for a debt refused (or unpayable) after winter ended.
 */
export function shortfallLine(consequenceId, { fortunes, population, disaster }, { late = false } = {}) {
	const picked = WINTER_CONSEQUENCES.find(c => c.id === consequenceId)?.label ?? "";
	const lead = late ? "Winter's debt went unpaid" : "The stores ran out";
	const cost = [
		"Surplus to 0",
		population === null ? "" : `Population to ${signed(population)}`,
		disaster ? "" : `Fortunes to ${signed(fortunes)}`,
	].filter(Boolean).join(", ");
	return `${lead}${picked ? `: ${picked}` : ""}. ${cost}.${disaster ? " Fortunes was already −1, so the steading Met with Disaster." : ""}`;
}

/**
 * The whole of a shortfall, as each window takes it: the write, the notice, and at Fortunes −1
 * the Meet with Disaster pick. No Cancel on that pick: the rule is not optional. A GM who closes
 * the window has only put it off: the write recorded the pick as owed, and the header glyph that
 * leaves behind reopens it (StonetopSteading#disasterOwed).
 *
 * `season` (`{seasonId, year}`, the WINTER it is owed for) puts it on that winter's shortfall
 * line on the timeline, the disaster's pick with it (user, 2026-10-10). `late`: a debt settled
 * after winter ended, which still belongs to that winter.
 */
export async function sufferWinterShortfall(steading, consequenceId, {
	stonetopMove = WINTER_DEBT_MOVE, onApplied, alsoFlags, season = null, late = false, followUp = followUpWinterConsequence,
} = {}) {
	const where = season ? { ...season, title: WINTER_SHORTFALL_TITLE } : null;
	const out = await applyWinterShortfall(steading, consequenceId, { stonetopMove, alsoFlags, season: where });
	globalThis.ui?.notifications?.info?.(shortfallNotice(out));
	if (where) await noteShortfallOnTimeline(where, shortfallLine(consequenceId, out, { late }));
	// Not awaited: the caller closes its step on the write, not when the GM gets round to the
	// follow-up's windows (a retire dialog can stay open a long while). The disaster's pick still
	// waits for them, so the two windows come one at a time.
	void followUpQuietly(followUp, steading, consequenceId).then(() => {
		if (!out.disaster) return;
		openDisasterPicker(steading, {
			introHtml: `<p><em>Winter's shortfall Meets with Disaster, and Fortunes cannot drop below −1.</em> The GM picks 1 instead:</p>`,
			stonetopMove,
			onApplied,
			settlesOwed: true,
			season: where,
			cause: "winter's shortfall",
		});
	});
	return out;
}

const ALREADY_SETTLED = "Winter's debt has already been settled.";

/**
 * Pay what winter still wants: spent and cleared in ONE update, the way the Inn's gathering is,
 * because two writes would append Seasons Change to the ledger twice for a single act.
 *
 * The debt is re-read by its stamp HERE, when the button is pressed, never taken from what the
 * window was built with: the header glyph and spring's "Winter's end" can both be open on the
 * same debt, and whichever is pressed second must find it gone rather than charge it again.
 * Says what happened itself, so the two windows cannot word it differently.
 * @returns {Promise<boolean>} true once the debt is settled (by this press or an earlier one)
 */
async function payWinterDebt(steading, stamp, { stonetopMove = WINTER_DEBT_MOVE } = {}) {
	const held = steading.winterDebtFor(stamp);
	if (!held) {
		globalThis.ui?.notifications?.info?.(ALREADY_SETTLED);
		return true;
	}
	const left = await steading.spendSurplus(held.amount, { stonetopMove, alsoFlags: { winterDebt: null } });
	if (left === null) {
		globalThis.ui?.notifications?.warn?.("The steading no longer has the Surplus to pay it.");
		return false;
	}
	globalThis.ui?.notifications?.info?.(`Winter consumed ${held.amount} more Surplus. Remaining: ${left}.`);
	return true;
}

/** Refuse it (or be unable to pay it): the shortfall and the debt cleared, in one write. Null
 *  rather than a "-=" deletion: the tray reads the AMOUNT, so a zeroed debt is already invisible,
 *  and a null leaves the flag readable by anything auditing the year. Re-read by its stamp first,
 *  like paying: a debt settled in the other window is not a second shortfall.
 *  @returns {Promise<boolean>} false when there was no debt left to refuse */
async function refuseWinterDebt(steading, stamp, consequenceId, { stonetopMove = WINTER_DEBT_MOVE, onApplied } = {}) {
	if (!steading.winterDebtFor(stamp)) {
		globalThis.ui?.notifications?.info?.(ALREADY_SETTLED);
		return false;
	}
	await sufferWinterShortfall(steading, consequenceId, {
		stonetopMove, onApplied, alsoFlags: { winterDebt: null },
		season: parseSeasonStamp(stamp), late: true,
	});
	return true;
}

/**
 * What the settle window can offer, given what the steading actually has.
 *
 * Pure, so the awkward cases are testable without a world: a debt already settled, a steading
 * that can pay exactly, and one that cannot pay at all and must take the consequences instead.
 *
 * @param {object} state
 * @param {number} state.amount   what winter still wants
 * @param {number} state.surplus  the steading's Surplus
 * @returns {{owed: number, surplus: number, canPay: boolean}}  a settled debt is `owed` 0, and
 *          the shortfall is `owed - surplus`; neither is stored, so neither can disagree.
 */
export function winterDebtState({ amount = 0, surplus = 0 } = {}) {
	const owed = Math.max(0, Math.trunc(Number(amount) || 0));
	const have = Math.max(0, Math.trunc(Number(surplus) || 0));
	return { owed, surplus: have, canPay: owed > 0 && have >= owed };
}

/**
 * The window's markup, from the state alone. Separated from the window for the same reason
 * `winterDebtState` is separated from both: the two cases it has to get right (a steading that
 * can pay, and one that cannot) are then renderable and readable without a world.
 *
 * The affordable case still shows the consequence list, and it is still clickable: a steading
 * CAN choose to keep its Surplus and take the hit, and the book does not say it may not.
 * Hiding the choice would be making a ruling on the table's behalf. What it must NOT do is
 * offer that choice quietly: refusing to pay is not "keep the Surplus", it is Surplus to 0 AND
 * Fortunes down 1 AND one of the four, which is strictly worse than paying whenever paying is
 * possible. The affordable branch used to read "if the steading would rather keep it", which
 * describes an option nobody has.
 */
export function winterDebtDialogHtml(state, { due = false } = {}) {
	// `due`: asked from the next spring's Seasons Change, once winter has run out. Paying then
	// is paying with the last of winter; the book's deadline is what makes the question
	// unavoidable there, not a reason to take the paying away.
	const lead = due
		? `Winter has ended, and the steading still owes it ${state.owed} Surplus. Consume it now, with the last of winter, or suffer the consequences again.`
		: `Winter is not done with the steading. It must consume ${state.owed} more Surplus before winter ends, or suffer the consequences again.`;
	// Meets with Disaster (p. 518): a Fortune, or at −1 a debility the GM picks.
	const disaster = `the steading Meets with Disaster (Fortunes drops by <strong>1</strong>, or at −1 the GM marks a debility)`;
	return `<p class="stonetop-inn-trigger"><em>${lead}</em></p>
		<p class="stonetop-season-note">Winter still wants <strong>${state.owed} Surplus</strong>. The steading has <strong>${state.surplus}</strong>.</p>
		${state.canPay
			? `<div class="stonetop-season-actions">
				<button type="button" class="stonetop-season-btn" data-action="pay-winter-debt">
					<i class="fas fa-wheat-awn"></i> Consume ${state.owed} Surplus, and winter is done
				</button>
			</div>
			<p class="stonetop-season-note"><em>Or refuse, and take the consequences instead. That costs more, not less: Surplus still drops to <strong>0</strong>, ${disaster}, and one of these happens on top. Pick the one the steading suffers.</em></p>`
			: `<p>⚠️ <strong>Not enough Surplus</strong> (${state.surplus} of ${state.owed}), so the debt cannot be paid. Surplus drops to <strong>0</strong>, ${disaster}, and one of these happens on top. Pick the one the steading suffers.</p>`}
		<p class="stonetop-rites-note">The first is written for you. The other three are the GM's to narrate; then you are asked what they leave on the sheet.</p>`;
}

/**
 * Spring's "Winter's end" step: the settle window's question, inside the Seasons Change window.
 * Consequences are a click list like the first consumption's, which sits in the same window,
 * rather than the glyph window's pick-then-commit footer, which this window has no room for.
 */
export function winterDebtStepHtml(state) {
	return `<div class="stonetop-winter-debt-step">
		<div data-winter-debt-open>
			${winterDebtDialogHtml(state, { due: true })}
			${winterConsequencesHtml()}
		</div>
		<p class="stonetop-season-note" data-winter-debt-settled hidden>Winter's debt is settled.</p>
	</div>`;
}

/**
 * Wire that step. Either way out settles it, and the step says so in place of the controls, so
 * a second click has nothing to land on.
 * @param {HTMLElement} root   the step's section
 * @param {object} steading
 * @param {object} opts
 * @param {string} opts.stamp          the "<year>:winter" the debt was rolled under
 * @param {Function} [opts.onSettled]  () => void, after either way out (and again after a
 *                                     Meet with Disaster pick, which is a write of its own)
 */
export function wireWinterDebtStep(root, steading, { stamp, onSettled } = {}) {
	const open    = root?.querySelector("[data-winter-debt-open]");
	const settled = root?.querySelector("[data-winter-debt-settled]");
	if (!open) return;
	let busy = false;
	const done = () => {
		open.hidden = true;
		if (settled) settled.hidden = false;
		onSettled?.();
	};
	open.querySelector("[data-action='pay-winter-debt']")?.addEventListener("click", async () => {
		if (busy) return;
		busy = true;
		try {
			if (await payWinterDebt(steading, stamp)) done();
			else busy = false;
		} catch (err) { busy = false; throw err; }
	});
	open.querySelectorAll("[data-consequence]").forEach(el => {
		el.addEventListener("click", async () => {
			if (busy) return;
			busy = true;
			try {
				await refuseWinterDebt(steading, stamp, el.dataset.consequence, { onApplied: onSettled });
				done();
			} catch (err) { busy = false; throw err; }
		});
	});
}

/**
 * The window the header glyph opens. Two ways out and no third: pay it, or take the
 * consequences. There is deliberately no "not now" that resolves anything — closing the window
 * leaves the debt standing and the glyph lit, which is the true state of a steading that has
 * not dealt with it.
 *
 * Built on the shared consequence picker (openDebilityPicker), which is what makes the second
 * way out survivable: the four consequences are keyboard-reachable, and picking one ARMS the
 * footer rather than firing. Refusing to pay costs Surplus, a Fortune and one of the four at
 * once, and a single mis-click on a list is no way to spend that.
 */
export function openWinterDebtDialog(steading, { onApplied } = {}) {
	const held = steading.winterDebt();
	if (!held) {
		globalThis.ui?.notifications?.info?.("Winter is not owed anything.");
		return;
	}
	const state = winterDebtState(held);

	// `const`, though the pay handler below refers to it: that runs on a click, long after this
	// statement has completed. Same reasoning as the picker's own dialog binding.
	const dialog = openDebilityPicker({
		title: "Winter Is Not Done",
		introHtml: winterDebtDialogHtml(state),
		marked: WINTER_CONSEQUENCES,
		bodyClass: "stonetop-winter-debt-body",
		choicesLabel: "Consequence the steading suffers",
		applyLabel: "Take the consequences",
		applyLabelFor: c => `Suffer: ${c.label}`,
		// Not "Close": the debt survives this window, and the label is the only place that says
		// so. The glyph stays lit, which is the sheet agreeing with the button.
		buttons: { close: { label: "Leave it standing for now" } },
		dialogOptions: DIALOG_OPTIONS,
		// Paying is not one of the four choices, it is the way out that avoids them, so it sits
		// in the body under the sentence naming the bill rather than in the picker's list.
		onRender: root => {
			root.querySelector("[data-action='pay-winter-debt']")?.addEventListener("click", async () => {
				if (!await payWinterDebt(steading, held.stamp)) return;
				onApplied?.();
				dialog.close();
			});
		},
		// `onApplied` twice over, and on purpose: once now for the shortfall's write, and once
		// from the Meet with Disaster pick at −1, which is a second write made later.
		onApply: async consequence => {
			await refuseWinterDebt(steading, held.stamp, consequence.id, { onApplied });
			onApplied?.();
		},
	});
	return dialog;
}
