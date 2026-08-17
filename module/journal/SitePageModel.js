// Data model for the "site" JournalEntryPage subtype, the 6th custom page type after
// bestiary / location / chronicle / threat / hazard (see stonetop.js). A site is GM prep
// (Book I, "Sites", pp. 345-377): an interesting place the PCs can explore, written up so
// it tells a story, excites, and offers meaningful decisions.
//
// The fields follow the book's own four-phase procedure ("Creating sites", p. 355) so the
// Create-a-Site walkthrough fills them in order and the card reads back in the same order:
//
//   1. Lay the foundation      description, why, manner + picks, region + terrain
//   2. Build up its story      connections, questions, timeline
//   3. Sketch out the contents denizens, dangers, discoveries, outside/inside impressions
//   4. Write it up             areas (each with its own exits), plans, random tables
//
// Every phase after the first is optional: the book is explicit that you do only as much
// as you need for the next session and improvise the rest, so nothing here is required.
//
// Storage/visibility is threats' and hazards' architecture verbatim: every site is a page
// of ONE "<Steading> Sites" journal, NONE-owned, never shared with players (see
// site-store.js and threat-store.js for the full rationale).
const fields = foundry.data.fields;

/** A list of short lines (denizens' dangers, GM plans, an area's exits). */
const lines = () => new fields.ArrayField(new fields.StringField({ required: true, blank: true }));

export class SitePageModel extends foundry.abstract.TypeDataModel {
	static defineSchema() {
		return {
			// ── 1. Foundation ────────────────────────────────────────────────────
			// The few sentences that describe the place ("Envision the site... try to get
			// fairly specific, but keep it brief", p. 357).
			description: new fields.HTMLField({ required: true, blank: true, initial: "" }),
			// "Why are you putting this site in the game?" (p. 356).
			why: new fields.StringField({ required: true, blank: true, initial: "" }),
			// What manner of site it is: a SITE_MANNERS id plus its label, stored alongside so
			// the card still reads right if a manner is ever renamed or retired.
			manner: new fields.StringField({ required: true, blank: true, initial: "" }),
			mannerLabel: new fields.StringField({ required: true, blank: true, initial: "" }),
			// The Book II table results, as ordered rows ("Theme: tombs, mummification...",
			// "Structure: ziggurat/pyramid/dome"). `key` is the source table's id, which is
			// what the editor matches a stored pick back on: labels are display text and two
			// entries may well print the same one.
			picks: new fields.ArrayField(new fields.SchemaField({
				key: new fields.StringField({ required: true, blank: true }),
				label: new fields.StringField({ required: true, blank: true }),
				value: new fields.StringField({ required: true, blank: true }),
			})),
			// Where it sits: a REGIONS id + label, and the terrain rolled or picked for it.
			regionId: new fields.StringField({ required: true, blank: true, initial: "" }),
			regionLabel: new fields.StringField({ required: true, blank: true, initial: "" }),
			terrain: new fields.StringField({ required: true, blank: true, initial: "" }),

			// ── 2. Story ─────────────────────────────────────────────────────────
			// "Look for connections" (p. 358): the ties that prompted the questions below.
			connections: lines(),
			// "Ask yourself questions... answer those questions" (pp. 358-359). An answered
			// pair is prep; an unanswered one is a note to self, so both halves are optional.
			questions: new fields.ArrayField(new fields.SchemaField({
				prompt: new fields.StringField({ required: true, blank: true }),
				answer: new fields.StringField({ required: true, blank: true }),
			})),
			// "Create a timeline" (p. 359): key events in relative order. `when` is deliberately
			// free text, because the book's own timelines read "centuries later", "last autumn".
			timeline: new fields.ArrayField(new fields.SchemaField({
				when: new fields.StringField({ required: true, blank: true }),
				text: new fields.StringField({ required: true, blank: true }),
			})),

			// ── 3. Contents ──────────────────────────────────────────────────────
			// "Populate it" (p. 362): who or what lives, dwells, visits, or passes through,
			// plus notes on how they relate to each other.
			denizens: new fields.ArrayField(new fields.SchemaField({
				name: new fields.StringField({ required: true, blank: true }),
				notes: new fields.StringField({ required: true, blank: true }),
			})),
			// "Identify dangers & discoveries" (p. 362). Kept as two plain lists: at this stage
			// the book only wants the elements named, not placed or written up.
			dangers: lines(),
			discoveries: lines(),
			// "Describe the environment" (p. 363): the vocabulary of places, imagery and
			// impressions to pull from when framing scenes, split the way the book's own
			// example splits it (outside the site, and throughout the interior).
			outside: lines(),
			inside: lines(),

			// ── 4. Write-up ──────────────────────────────────────────────────────
			// "Establish areas/rooms" + "Detail each area/room" + "Arrange areas/rooms"
			// (pp. 363-368). `exits` is what makes the arrangement concrete without forcing a
			// map: each area names what it connects to.
			areas: new fields.ArrayField(new fields.SchemaField({
				title: new fields.StringField({ required: true, blank: true }),
				description: new fields.StringField({ required: true, blank: true }),
				contents: new fields.StringField({ required: true, blank: true }),
				exits: new fields.StringField({ required: true, blank: true }),
			})),
			// "Make plans" (p. 369): if/then tactics, timetables, the GM moves you mean to make.
			plans: lines(),
			// "Make lists and tables" (p. 369): content in a quantum state. Rollable from the
			// card, which is the point of writing it as a table rather than a list.
			randomTables: new fields.ArrayField(new fields.SchemaField({
				caption: new fields.StringField({ required: true, blank: true }),
				rows: lines(),
			})),
		};
	}
}
