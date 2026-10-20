// ── Unlock section items ──────────────────────────────────────────────────────

export class ArcanaUnlockTextItem {
	constructor(content) {
		this.type    = "text";
		this.content = content;
	}
}

export class ArcanaUnlockOptionSnapshot {
	constructor(b) {
		this.type        = "option";
		this.slug        = b._slug;
		this.description = b._description;
		// `count` of `max` ticks: the template draws `max` boxes and checks the first `count`.
		this.count       = b._count;
		this.max         = b._max;
	}
}

export class ArcanaUnlockOptionSnapshotBuilder {
	withSlug(v)        { this._slug        = v; return this; }
	withDescription(v) { this._description = v; return this; }
	withCount(v)       { this._count       = v; return this; }
	withMax(v)         { this._max         = v; return this; }
	build()            { return new ArcanaUnlockOptionSnapshot(this); }
}

export class ArcanumUnlockSection {
	constructor(description, requirements) {
		this.description  = description;
		this.requirements = requirements;
	}
}

// ── Back side ─────────────────────────────────────────────────────────────────

export class ArcanumBackMoveSnapshot {
	constructor(name, rollType, description) {
		this.name        = name;
		this.rollType    = rollType;
		this.description = description;
	}
}

// A back option's label only. The ledger names a ticked option by it (CharacterLedger); nothing
// draws back options as a track or writes a count for one, so no count, max or selected is carried.
export class ArcanaBackOptionSnapshot {
	constructor(b) {
		this.slug        = b._slug;
		this.description = b._description;
	}
}

export class ArcanaBackOptionSnapshotBuilder {
	withSlug(v)        { this._slug        = v; return this; }
	withDescription(v) { this._description = v; return this; }
	build()            { return new ArcanaBackOptionSnapshot(this); }
}

// ── Front / back snapshots ────────────────────────────────────────────────────

export class MinorArcanumFrontSnapshot {
	constructor(b) {
		this.title       = b._title;
		this.item        = b._item;
		this.description = b._description;
		this.unlock      = b._unlock;
	}
}

export class MinorArcanumFrontSnapshotBuilder {
	withTitle(v)       { this._title       = v; return this; }
	withItem(v)        { this._item        = v; return this; }
	withDescription(v) { this._description = v; return this; }
	withUnlock(v)      { this._unlock      = v; return this; }
	build()            { return new MinorArcanumFrontSnapshot(this); }
}

export class MinorArcanumBackSnapshot {
	constructor(b) {
		this.title       = b._title;
		this.item        = b._item;
		this.description = b._description;
		this.resource    = b._resource;
		this.move        = b._move;
		this.options     = b._options;
	}
}

export class MinorArcanumBackSnapshotBuilder {
	withTitle(v)       { this._title       = v; return this; }
	withItem(v)        { this._item        = v; return this; }
	withDescription(v) { this._description = v; return this; }
	withResource(v)    { this._resource    = v; return this; }
	withMove(v)        { this._move        = v; return this; }
	withOptions(v)     { this._options     = v; return this; }
	build()            { return new MinorArcanumBackSnapshot(this); }
}

// ── Arcanum ───────────────────────────────────────────────────────────────────

export class MinorArcanumSnapshot {
	constructor(b) {
		this.slug       = b._slug;
		this.front      = b._front;
		this.back       = b._back;
		this.owned      = b._owned;
		this.checked    = b._checked;
		this.unlocked   = b._unlocked;
		this.identified = b._identified;
		// The back is owed: a 7-9 on the Know Things roll to identify this card let the owner
		// read the front, and promised the back "when they have some time to study it or learn
		// more" (Book I p.440). Purely a reminder that the GM owes a reveal — it grants no
		// access on its own, and it's meaningless once the back is permitted (revealed or
		// unlocked), which the sheet suppresses rather than the snapshot.
		this.backOwed   = b._backOwed ?? false;
		// A "lead": the owner knows this arcanum's whereabouts but hasn't recovered it yet
		// (the Seeker's Lead role). Shows a placeholder card with a "discovered" action that
		// promotes it to the normal, identified form. A card is never lead AND identified.
		this.lead       = b._lead ?? false;
		this.img        = b._img ?? null;
		// Resolved tier (stored `major` flag OR shipped allowlist) — drives the
		// Major/Minor section partition on the arcana tab.
		this.major      = b._major ?? false;
		// Resolved manifested followers (homebrew flags OR shipped ARCANA_SUMMONS) — drives
		// the "Add as follower" button on the arcana tab. null when nothing manifests.
		this.summonFollowers = b._summonFollowers ?? null;
		// Redwood Effigy: true once the Greater Conduit mystery is checked on the back,
		// which unlocks the two "potential" Conduit slots on the front.
		this.greaterConduit = b._greaterConduit ?? false;
		// The back's "Consequences" section HTML, surfaced onto the front for cards whose front
		// references it ("mark a consequence (see reverse)"). null for every other card. The
		// sheet folds it behind a collapsible and shows it only when the front is the sole
		// visible side (see showFrontConsequences).
		this.consequences = b._consequences ?? null;
		// A card whose unlock marks each buy a choice off its back (the Hec'tumel Codex's spells):
		// `{name, owed, html}`, the list's name, the marks still owing a choice, and the learned
		// choices' HTML for the front (null while none is learned). null for every other card.
		this.unlockChoice = b._unlockChoice ?? null;
		// The card is held (its slug is in `owned`) but no pack or world arcanum answers to it any
		// more: a homebrew card the GM deleted. The tab draws a stub with Remove rather than nothing,
		// or the held slug and its marks would linger with no way to clear them.
		this.missing    = b._missing ?? false;
	}
}

export class MinorArcanumSnapshotBuilder {
	withSlug(v)        { this._slug       = v; return this; }
	withFront(v)       { this._front      = v; return this; }
	withBack(v)        { this._back       = v; return this; }
	withOwned(v)       { this._owned      = v; return this; }
	withChecked(v)     { this._checked    = v; return this; }
	withUnlocked(v)    { this._unlocked   = v; return this; }
	withIdentified(v)  { this._identified = v; return this; }
	withBackOwed(v)    { this._backOwed   = v; return this; }
	withLead(v)        { this._lead       = v; return this; }
	withImg(v)         { this._img        = v; return this; }
	withMajor(v)       { this._major      = v; return this; }
	withSummonFollowers(v) { this._summonFollowers = v; return this; }
	withGreaterConduit(v) { this._greaterConduit = v; return this; }
	withConsequences(v) { this._consequences = v; return this; }
	withUnlockChoice(v) { this._unlockChoice = v; return this; }
	withMissing(v)     { this._missing    = v; return this; }
	build()            { return new MinorArcanumSnapshot(this); }
}

// ── Sections ──────────────────────────────────────────────────────────────────

export class ArcanaSectionSnapshot {
	constructor(title, items) {
		this.title = title;
		this.items = items;
	}

	get hasOwned() { return this.items.some(i => i.owned); }
}

export class ArcanaSnapshot {
	constructor(minor, major) {
		this.minor = minor;
		this.major = major;
	}
}
