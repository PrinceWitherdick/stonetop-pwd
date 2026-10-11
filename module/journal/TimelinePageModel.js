// Data model for the "timeline" JournalEntryPage subtype, the 7th custom page type after
// bestiary / location / chronicle / threat / hazard / site (see stonetop.js).
//
// ONE PAGE IS ONE TRACK, not one entry. A track is a thread of the campaign's story -- Stonetop
// itself, or one player character -- and its whole run of dated entries lives in this page's
// `entries`, an object KEYED BY ENTRY ID (see the field below for why not a list). The other way round, a page per entry, was refused for the reason the
// relationship map hides its own pages from the sidebar: a campaign's worth of entries would bury
// every other journal in the world under a list nobody reads that way.
//
// These pages ARE meant to be read in the sidebar, unlike the GM-prep families. The timeline the
// sheet draws is the good version, but a journal page is what a table can share, print, and read on
// a phone, and keeping the record legible outside our own UI is half of what makes it a chronicle.
//
// Storage/visibility: one "Timeline" JournalEntry in The Chronicle folder, created OWNER by default
// so a player can write their own thread. See timeline-store.js for why that is the same bargain
// the relationship map strikes rather than a new one.
import { MIN_HISTORY_YEAR } from "../seasons/campaign-year.js";

const fields = foundry.data.fields;

export class TimelinePageModel extends foundry.abstract.TypeDataModel {
	static defineSchema() {
		return {
			// Which thread this page is. `trackKind` is "steading" or "character"; `trackId` is the
			// steading marker or an actor id. Stored as well as being recoverable from the page's
			// `chronicleKey` flag, because a data model should be readable without reaching for a
			// flag on the document that holds it, and the aggregate view groups on it.
			trackKind: new fields.StringField({ required: true, blank: true, initial: "" }),
			trackId:   new fields.StringField({ required: true, blank: true, initial: "" }),

			// The entries, KEYED BY THEIR OWN ID, in no stored order: `timeline-core.js#sortEntries`
			// puts them in reading order off the date fields.
			//
			// ⚠ AN OBJECT AND NOT A LIST, because a track has several writers on different clients (a
			// GM's Apply credits a kill, a player's level-up writes a milestone, a player retitles a
			// row). Foundry merges a list as one atomic value, so every write was the WHOLE list, read
			// a moment earlier, and the last one back erased whatever landed in between. Keyed, a
			// write touches only `system.entries.<id>` (timeline-store.js#writeEntries), and two
			// writers to different rows, or different fields of one row, both win.
			entries: new fields.TypedObjectField(new fields.SchemaField({
				// This entry's own handle. ⚠ Must not contain a dot -- see normalizeEntry.
				id: new fields.StringField({ required: true, blank: true }),

				// The date: the campaign clock's own pair, plus where this sits among the other
				// entries in that same season. No day number, deliberately -- the book gives Stonetop
				// seasons and years and nothing finer.
				//
				// `year` is STORED (1 = the first year of play; what it is called is the world's
				// `campaignStartYear`, seasons/campaign-year.js). Below 1 is history from before play,
				// which only a timeline holds. `yearOnly` marks a row whose season nobody knows: a
				// blank season WITH it is "some time that year", a blank season without it is undated.
				year:   new fields.NumberField({ required: true, integer: true, min: MIN_HISTORY_YEAR, initial: 1 }),
				season: new fields.StringField({ required: true, blank: true, initial: "" }),
				yearOnly: new fields.BooleanField({ required: true, initial: false }),
				order:  new fields.NumberField({ required: true, integer: true, min: 0, initial: 0 }),

				// What happened. `title` is the line the timeline prints; `place` is free text with a
				// datalist of the places this world already knows, because a party names places the
				// book never did. `body` is the freeform account, and is HTML so it can carry the
				// content links that tie an entry back to an NPC, a site or a location.
				title: new fields.StringField({ required: true, blank: true, initial: "" }),
				place: new fields.StringField({ required: true, blank: true, initial: "" }),
				// The document the place IS, when one was dropped on the field. Optional: most
				// places a party names are nowhere in the world as a document, and typing stays
				// free. A COMPENDIUM uuid is welcome here (unlike on the character rosters, which
				// refuse one) because this is only ever a link to follow, never a document to
				// match against something in the world.
				placeUuid: new fields.StringField({ required: true, blank: true, initial: "" }),
				body:  new fields.HTMLField({ required: true, blank: true, initial: "" }),

				// "hand" for an entry somebody typed; otherwise the kind of milestone the system wrote
				// ("season", "levelup", "kills", ...). See TIMELINE_SOURCES in timeline-core.js.
				// ⚠ NO `choices`, deliberately: a page written by a newer build with a kind this one
				// has never heard of must still load, and `normalizeEntry` files the stranger as typed.
				source: new fields.StringField({ required: true, blank: true, initial: "hand" }),

				// What a milestone row IS (`levelup:4`, `expedition:<trip id>`), so recording the
				// same event again patches the row instead of adding a second. Blank on typed rows.
				key: new fields.StringField({ required: true, blank: true, initial: "" }),

				// A kills row's foes, one name per kill; a track's kill total is the sum of these.
				// Blank strings are allowed so one stray row in a hand-edited page cannot fail the
				// whole page's validation; `normalizeEntry` drops them on the way out.
				foes: new fields.ArrayField(new fields.StringField({ required: true, blank: true }), { initial: [] }),

				// The one tag a TYPED row wears: a kind's id it borrows ("wound") or a custom tag's id
				// (`tag-<random>`, kept on the Timeline journal). Blank for none. No `choices`, for the
				// reason `source` has none, and because custom tags come and go. See timeline-tags.js.
				tag: new fields.StringField({ required: true, blank: true, initial: "" }),

				// Provenance. `createdAt` is also the last tie-break in the sort, so two entries
				// added to one season in the same click cannot swap places on a repaint.
				createdAt: new fields.NumberField({ required: true, integer: true, initial: 0 }),
				authorId:  new fields.StringField({ required: true, blank: true, initial: "" }),
			}), { validateKey: key => !key.includes(".") }),

			// Whether the STORED entries are already keyed. A page written before the change still
			// holds a list in the world's data: `migrateData` reads it as keyed, but the server merges
			// into what it stores, so the first write to such a page has to replace the list whole
			// rather than patch one key into it (timeline-store.js#writeEntries), and sets this.
			keyed: new fields.BooleanField({ required: true, initial: false }),
		};
	}

	/** A page from before the entries were keyed: its list, read as an object keyed by id. */
	static migrateData(source) {
		if (Array.isArray(source?.entries)) {
			source.entries = Object.fromEntries(source.entries.map((entry, index) => {
				const id = String(entry?.id ?? "").replace(/\./g, "").trim() || `entry-${index}`;
				return [id, { ...entry, id }];
			}));
		}
		return super.migrateData(source);
	}
}
