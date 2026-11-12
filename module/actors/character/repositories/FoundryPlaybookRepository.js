import { FoundryPackStore } from "./FoundryPackStore.js";
import { ITEMS_PACK } from "../StonetopFlags.js";
import { homebrewPlaybookBySlug } from "../../../playbooks/playbook-catalog.js";

export class FoundryPlaybookRepository {
	constructor() {
		this._store = new FoundryPackStore(ITEMS_PACK, ["system.slug"]);
		this._cache = new Map();
	}

	// The shipped pack first, cached forever (it cannot change at runtime). Then a HOMEBREW
	// playbook from the world (playbooks/playbook-catalog.js), read fresh each call and never
	// cached, so a GM's edit in the Playbook Builder shows on the next render.
	async findBySlug(slug) {
		if (this._cache.has(slug)) return this._cache.get(slug);
		const entry = await this._store.findEntry(e => e.system?.slug === slug);
		if (!entry) return homebrewPlaybookBySlug(slug)?.asPlaybook?.() ?? null;
		const doc = await this._store.getDocument(entry._id);
		const pb  = doc.asPlaybook();
		this._cache.set(slug, pb);
		return pb;
	}
}
