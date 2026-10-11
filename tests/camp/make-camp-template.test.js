import { describe, expect, it } from "vitest";
import { readRepo, stripComments } from "../fakes/css.js";
import { seat } from "../fakes/camp.js";
import { CAMP_STATE, campLedger } from "../../module/camp/camp-rules.js";
import { campWindowView } from "../../module/camp/camp-view.js";

/**
 * The shared camp window's template, rendered for real (tests/setup.js#renderTemplate) over the
 * view camp-view.js builds, so what is asserted is the markup that ships.
 */

const TEMPLATE = "systems/stonetop-pwd/templates/dialogs/make-camp.hbs";

const aeliana = (over = {}) => seat({ id: "aeliana", name: "Aeliana", isHost: true, joinedAt: 1, ...over });
const bram    = (over = {}) => seat({ id: "bram", name: "Bram", joinedAt: 2, carried: { provisions: 2 }, ...over });

function render(members, over = {}) {
	return renderTemplate(TEMPLATE, campWindowView({
		state: CAMP_STATE.OPEN, hostName: "Aeliana", ledger: campLedger(members), manages: true,
		editable: ["aeliana"], mine: ["aeliana"], ...over,
	}));
}

/** One row's markup, found by the actor id stamped on its `<li>`, and cut at its own `</li>`. */
function row(html, actorId) {
	const chunk = html.split('<li class="stonetop-camp-row').slice(1).find(c => c.includes(`" data-actor-id="${actorId}">`)) ?? "";
	return chunk.slice(0, chunk.indexOf("</li>"));
}

describe("the camp window's template", () => {
	it("draws steppers a screen reader can name on the rows the reader can change", async () => {
		const html = await render([aeliana(), bram()]);
		expect(row(html, "aeliana")).toContain('data-camp-action="offer-add"');
		expect(row(html, "aeliana")).toContain('aria-label="Share one more use of Supplies"');
		expect(row(html, "aeliana")).toContain('aria-label="Take back one use of Supplies"');
	});

	it("draws everyone else's row as sentences, with nothing to press", async () => {
		const bramsRow = row(await render([aeliana(), bram()]), "bram");
		expect(bramsRow).not.toContain("data-camp-action");
		expect(bramsRow).not.toContain("<input");
		expect(bramsRow).toContain("Sharing no food yet.");
	});

	it("switches off sharing more once the meal is paid for", async () => {
		const html = await render([aeliana({ choices: { offer: { supplies: 1 } } })]);
		expect(row(html, "aeliana")).toMatch(/data-camp-action="offer-add"[^>]*disabled/);
		expect(row(html, "aeliana")).not.toMatch(/data-camp-action="offer-take"[^>]*disabled/);
	});

	it("makes a face a button onto its sheet, only for a reader allowed to open that sheet", async () => {
		const html = await render([aeliana({ img: "aeliana.webp" }), bram({ img: "bram.webp" })], { viewable: ["bram"] });
		expect(row(html, "bram")).toMatch(/<button type="button" class="stonetop-camp-portrait-btn" data-camp-sheet="bram" aria-label="Open Bram(&#x27;|')s character sheet"[^>]*><img class="stonetop-camp-portrait" src="bram.webp" alt=""><\/button>/);
		expect(row(html, "aeliana")).toContain('<img class="stonetop-camp-portrait" src="aeliana.webp" alt="">');
		expect(row(html, "aeliana")).not.toContain("data-camp-sheet");
		// A name is something a player typed, so the hover is text: core draws a plain data-tooltip as HTML.
		expect(row(html, "bram")).toMatch(/data-tooltip-text="Open Bram(&#x27;|')s character sheet"/);
		expect(row(html, "bram")).not.toContain("data-tooltip=");
	});

	// The settle restores a dying character none of their own HP: the card says so, and offers neither
	// the bedroll's die nor a peaceful night's advantage.
	it("tells a dying character the night restores no HP, with no bedroll or peaceful-night box", async () => {
		const dying = { ...aeliana({ hp: 0, carriesBedroll: true }), dying: true };
		const mine = row(await render([dying]), "aeliana");
		expect(mine).toContain("Dying, so the night itself restores no HP.");
		expect(mine).toMatch(/0 &rarr; 0|0 → 0/);
		expect(mine).not.toContain('data-camp-field="bedroll"');
		expect(mine).not.toContain('data-camp-field="peaceful"');
		const up = row(await render([aeliana({ hp: 0, carriesBedroll: true })]), "aeliana");
		expect(up).toContain('data-camp-field="bedroll"');
		expect(up).toContain('data-camp-field="peaceful"');
	});

	it("gives every row its own night radios", async () => {
		const html = await render([aeliana(), bram()], { editable: ["aeliana", "bram"] });
		expect(row(html, "aeliana")).toContain('name="campBenefit-aeliana"');
		expect(row(html, "bram")).toContain('name="campBenefit-bram"');
	});

	// Book I p.335: going without food costs the pick from the night, never the seat at the fire.
	it("keeps a card going without in the window, marked, with the way back on its button", async () => {
		const html = await render([aeliana(), bram({ choices: { eats: false } })], { editable: ["aeliana", "bram"] });
		const bramsRow = row(html, "bram");
		expect(html).toContain('<li class="stonetop-camp-row is-going-without" data-actor-id="bram">');
		expect(bramsRow).toContain("<strong>Going without</strong> food tonight, so no HP back and no debility cleared.");
		expect(bramsRow).toMatch(/data-camp-action="eat"[^>]*>Eat after all</);
		expect(bramsRow).not.toContain('data-camp-action="go-without"');
		// Still sharing, still bringing followers, still ticking ready; only the night is gone.
		expect(bramsRow).toContain('data-camp-action="offer-add"');
		expect(bramsRow).toContain('data-camp-action="followers-add"');
		expect(bramsRow).toContain("Ready to settle in");
		expect(bramsRow).not.toContain('name="campBenefit-bram"');
	});

	it("marks a card going without on every reader's screen, not only its own player's", async () => {
		const bramsRow = row(await render([aeliana(), bram({ choices: { eats: false } })]), "bram");
		expect(bramsRow).toContain("<strong>Going without</strong>");
		expect(bramsRow).not.toContain("data-camp-action");
	});

	it("gives the host Go without, with no ready tick, and no second control for eating", async () => {
		const hostsRow = row(await render([aeliana()]), "aeliana");
		expect(hostsRow).toMatch(/data-camp-action="go-without"[^>]*>Go without</);
		expect(hostsRow).not.toContain('data-camp-field="ready"');
		expect(hostsRow).not.toContain('data-camp-field="eats"');
		expect(hostsRow).not.toContain("Going without");
	});

	it("offers the Unliving no meal to go without", async () => {
		const hostsRow = row(await render([aeliana({ unliving: true })]), "aeliana");
		expect(hostsRow).not.toContain('data-camp-action="go-without"');
		expect(hostsRow).not.toContain("Going without");
		expect(hostsRow).not.toContain("stonetop-camp-row-foot");
	});

	it("gives a GM one line and one list to bring someone to the fire or send anyone but the host away", async () => {
		const html = await render([aeliana(), bram()], { sendsAway: true, addable: [{ id: "cora", name: "Cora" }] });
		expect(html.match(/class="stonetop-camp-roster"/g)).toHaveLength(1);
		expect(html.match(/<select name="campRosterActor"/g)).toHaveLength(1);
		expect(html).toContain('<optgroup label="Not at the fire"><option value="cora" data-camp-roster="add">Cora</option></optgroup>');
		expect(html).toContain('<optgroup label="At the fire"><option value="bram" data-camp-roster="send-away">Bram</option></optgroup>');
		expect(html).toMatch(/data-camp-action="send-away"[^>]*>.*Send them away</);
		expect(html.indexOf('data-camp-action="add"')).toBeLessThan(html.indexOf('data-camp-action="send-away"'));
		// The list opens on Cora, so Bring them starts pressable and Send them away says what it wants.
		expect(html).not.toMatch(/data-camp-action="add"[^>]*disabled/);
		expect(html).toMatch(/data-camp-action="send-away"[^>]*disabled data-tooltip="Pick someone at the fire to send them away\."/);
	});

	it("leaves Send them away pressable, and Bring them off the line, when nobody is left to bring", async () => {
		const html = await render([aeliana(), bram()], { sendsAway: true });
		expect(html).not.toContain('data-camp-action="add"');
		expect(html).not.toContain("Not at the fire");
		expect(html).toMatch(/data-camp-action="send-away"/);
		expect(html).not.toMatch(/data-camp-action="send-away"[^>]*disabled/);
	});

	it("gives a player no way to send anyone away", async () => {
		const html = await render([aeliana(), bram()], { manages: false, editable: ["bram"], mine: ["bram"] });
		expect(html).not.toContain("campRosterActor");
		expect(html).not.toContain('data-camp-action="send-away"');
	});

	it("says on the held Make Camp button how short the meal is, and what would fix it", async () => {
		const held = await render([aeliana()]);
		expect(held).toMatch(/data-camp-action="settle" disabled data-tooltip="The meal is \d+ uses? of food short\. Share more food, decide someone had supplies all along, or press Go without on the card of anyone not eating\."/);
		const paid = await render([aeliana({ choices: { offer: { supplies: 1 } } })]);
		expect(paid).not.toMatch(/data-camp-action="settle"[^>]*data-tooltip/);
	});

	// Affirmative on the left, dismissive on the right, like every Stonetop window.
	it("puts Make Camp before Break up the camp, and holds it while the meal is short", async () => {
		const html = await render([aeliana()]);
		expect(html.indexOf('data-camp-action="settle"')).toBeLessThan(html.indexOf('data-camp-action="break"'));
		expect(html).toMatch(/data-camp-action="settle"[^>]*disabled/);
	});

	it("gives a player who cannot settle the camp a sentence instead of its buttons", async () => {
		const html = await render([aeliana(), bram()], { manages: false, editable: ["bram"], mine: ["bram"] });
		expect(html).not.toContain('data-camp-action="settle"');
		expect(html).not.toContain('data-camp-action="break"');
		expect(html).toContain("Aeliana makes camp once everyone is ready.");
	});

	// The Judge's Break Bread: "a proper meal" is the fiction's to say, so it is a ticked box the host can untick.
	it("gives the host a ticked Break Bread box on the host's own record, and a player its sentence", async () => {
		const members = [aeliana({ breaksBread: true, choices: { offer: { supplies: 2 } } }), bram()];
		const html = await render(members);
		expect(html).toMatch(/<input type="checkbox" class="stonetop-check" data-camp-field="properMeal" data-actor-id="aeliana"[^>]* checked><span>A proper meal \(Break Bread\)/);
		const players = await render(members, { manages: false, editable: ["bram"], mine: ["bram"] });
		expect(players).not.toContain('data-camp-field="properMeal"');
		expect(players).toContain("A proper meal (Break Bread): everyone eating recovers 1d8 extra HP.");
		expect(await render([aeliana({ choices: { offer: { supplies: 2 } } }), bram()])).not.toContain("Break Bread");
	});

	// The Lightbearer's Keep the Home-Fires Burning: whether the fire has the hearth ash is the fiction's too.
	it("gives the host a ticked hearth-ash box when someone at the fire keeps the home fires", async () => {
		const members = [aeliana({ choices: { offer: { supplies: 2 } } }), bram({ hearthCha: 1 })];
		const html = await render(members);
		expect(html).toMatch(/<input type="checkbox" class="stonetop-check" data-camp-field="hearthAsh" data-actor-id="aeliana"[^>]* checked><span>Ash from your own hearth \(Keep the Home-Fires Burning\)/);
		const players = await render(members, { manages: false, editable: ["bram"], mine: ["bram"] });
		expect(players).not.toContain('data-camp-field="hearthAsh"');
		expect(players).toContain("recovers 1 extra HP.");
		expect(await render([aeliana({ choices: { offer: { supplies: 2 } } }), bram()])).not.toContain("Home-Fires");
	});

	it("says how a camp ended instead of drawing its rows", async () => {
		const html = await render([aeliana()], { state: CAMP_STATE.CANCELLED });
		expect(html).not.toContain('<li class="stonetop-camp-row');
		// Handlebars escapes the apostrophe, so the name is matched apart from it.
		expect(html).toContain("camp broke up before anyone ate.");
	});
});

// The user reads every one of these words, and em dashes read as machine-written to them.
describe("the camp's words", () => {
	it("use no em dashes", () => {
		for (const rel of ["module/camp/camp-view.js", "module/camp/camp-flow.js", "module/camp/CampWindow.js", "templates/dialogs/make-camp.hbs"]) {
			expect(stripComments(readRepo(rel)), rel).not.toContain("—");
		}
	});
});
