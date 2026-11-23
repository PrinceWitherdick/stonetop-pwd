import { describe, expect, it, afterEach, vi } from "vitest";
import { patchCoreConfirms, withDressedConfirm } from "../../module/hooks/core-confirms.js";
import { stubConfirm } from "../fakes/confirm.js";

// core-confirms.js puts core's yes/no questions (sidebar deletes, clear chat, end combat, the
// canvas Delete key, Clear All, a token in combat) in our window with outcome-named buttons. These
// pin the parts that break quietly: each one wears the Stonetop classes, core's own yes-callback
// survives the dress (it is what actually deletes), the swap of DialogV2.confirm lasts exactly one
// call, and a token delete core would not ask about still goes straight to core.

const THEMED = ["stonetop", "stonetop-themed", "stonetop-ask"];

/** A fake DialogV2 whose `confirm` records the config it is handed and answers `answer`. */
function fakeDialog(answer = true) {
	const confirm = vi.fn(async config => answer && config.yes?.callback ? config.yes.callback() : answer);
	const DialogV2 = { confirm };
	globalThis.foundry = { applications: { api: { DialogV2 } } };
	return { DialogV2, confirm };
}

function fakeI18n() {
	globalThis.game = { i18n: { localize: k => ({
		"DOCUMENT.Actor": "Actor", "DOCUMENT.JournalEntry": "Journal Entry", "DOCUMENT.Folder": "Folder",
		"DOCUMENT.Region": "Region", "DOCUMENT.Regions": "Regions", "DOCUMENT.Tokens": "Tokens",
	})[k] ?? k }, user: { isGM: true }, combats: [] };
}

afterEach(() => { delete globalThis.foundry; delete globalThis.game; delete globalThis.CONFIG; });

describe("dressed core confirms", () => {
	it("dresses a sidebar delete through deleteDialog's options, keeping core's callback", async () => {
		const { confirm } = fakeDialog();
		fakeI18n();
		const deleted = vi.fn();
		// Core's deleteDialog, as it is: merges the options into its confirm.
		class ClientDocument {
			deleteDialog(options = {}) {
				return globalThis.foundry.applications.api.DialogV2.confirm({ ...options, yes: { callback: deleted, ...options.yes } });
			}
		}
		class Actor extends ClientDocument { static documentName = "Actor"; static metadata = { label: "DOCUMENT.Actor" }; }
		class JournalEntry extends ClientDocument { static documentName = "JournalEntry"; static metadata = { label: "DOCUMENT.JournalEntry" }; }
		globalThis.foundry.documents = { Actor, JournalEntry };
		patchCoreConfirms();

		await new Actor().deleteDialog();
		const asked = confirm.mock.calls[0][0];
		expect(asked.classes).toEqual(expect.arrayContaining(THEMED));
		expect(asked.yes.label).toBe("Delete the actor");
		expect(asked.yes.class).toBe("stonetop-dialog-btn--danger");
		expect(asked.no.label).toBe("Keep it");
		expect(deleted).toHaveBeenCalled();

		await new JournalEntry().deleteDialog();
		expect(confirm.mock.calls[1][0].yes.label).toBe("Delete the journal entry");
	});

	it("tells a folder's Remove (contents kept) from its Delete (contents gone)", async () => {
		const { confirm } = fakeDialog(false);
		fakeI18n();
		class ClientDocument { deleteDialog(options = {}) { return globalThis.foundry.applications.api.DialogV2.confirm(options); } }
		class Folder extends ClientDocument { static documentName = "Folder"; static metadata = { label: "DOCUMENT.Folder" }; }
		globalThis.foundry.documents = { Folder };
		patchCoreConfirms();

		await new Folder().deleteDialog({});
		const everything = vi.fn();
		await new Folder().deleteDialog({ yes: { callback: everything } });
		expect(confirm.mock.calls[0][0].yes.label).toBe("Remove the folder, keep what's in it");
		expect(confirm.mock.calls[1][0].yes.label).toBe("Delete the folder and everything in it");
		expect(confirm.mock.calls[1][0].yes.callback).toBe(everything);
	});

	it("dresses clear chat, end combat, the region Delete key and Clear All", async () => {
		const { DialogV2, confirm } = fakeDialog(false);
		fakeI18n();
		const ask = cfg => DialogV2.confirm(cfg);
		class PlaceablesLayer {
			async _confirmDeleteKey() { return ask({ yes: {} }); }
			async deleteAll() { return ask({ yes: { callback: () => "core deleteAll" } }); }
		}
		class RegionLayer extends PlaceablesLayer {
			static documentName = "Region";
			_confirmDeleteKey(documents) { return super._confirmDeleteKey(documents); }
		}
		class TokenLayer extends PlaceablesLayer { static documentName = "Token"; }
		globalThis.CONFIG = {
			Region: { documentClass: { metadata: { label: "DOCUMENT.Region", labelPlural: "DOCUMENT.Regions" } } },
			Token:  { documentClass: { metadata: { label: "DOCUMENT.Token",  labelPlural: "DOCUMENT.Tokens" } } },
		};
		Object.assign(globalThis.foundry, {
			documents: {
				collections: { ChatMessages: class { async flush() { return ask({ yes: {} }); } } },
				Combat: class { async endCombat() { await ask({ yes: {} }); return this; } },
			},
			canvas: { layers: { PlaceablesLayer, RegionLayer, TokenLayer } },
		});
		patchCoreConfirms();

		await new globalThis.foundry.documents.collections.ChatMessages().flush();
		await new globalThis.foundry.documents.Combat().endCombat();
		await new RegionLayer()._confirmDeleteKey([{}]);
		await new RegionLayer()._confirmDeleteKey([{}, {}]);
		await new TokenLayer().deleteAll();

		const labels = confirm.mock.calls.map(([c]) => [c.yes.label, c.no.label]);
		expect(labels).toEqual([
			["Clear the chat log", "Keep it"],
			["End the combat", "Keep fighting"],
			["Delete the region", "Keep it"],
			["Delete the regions", "Keep them"],
			["Delete all the tokens", "Keep them"],
		]);
		for (const [c] of confirm.mock.calls) expect(c.classes).toEqual(expect.arrayContaining(THEMED));
		// Clear All's callback is core's and comes through.
		expect(confirm.mock.calls[4][0].yes.callback()).toBe("core deleteAll");
	});

	it("dresses one confirm only, and puts DialogV2.confirm back", async () => {
		const { DialogV2, confirm } = fakeDialog(false);
		const original = DialogV2.confirm;
		withDressedConfirm({ yes: "Do it" }, () => { DialogV2.confirm({}); DialogV2.confirm({}); });
		expect(confirm.mock.calls[0][0].yes.label).toBe("Do it");
		expect(confirm.mock.calls[1][0].yes).toBeUndefined();
		expect(DialogV2.confirm).toBe(original);
		// And when the method never asks, the swap is still undone.
		withDressedConfirm({ yes: "Do it" }, () => null);
		expect(DialogV2.confirm).toBe(original);
	});

	it("is idempotent", () => {
		fakeDialog();
		class PlaceablesLayer { async deleteAll() {} async _confirmDeleteKey() {} }
		globalThis.foundry.canvas = { layers: { PlaceablesLayer } };
		patchCoreConfirms();
		const first = PlaceablesLayer.prototype.deleteAll;
		patchCoreConfirms();
		expect(PlaceablesLayer.prototype.deleteAll).toBe(first);
	});
});

describe("token delete confirm", () => {
	function installLayer(baseImpl = async () => "core") {
		const proto = { _confirmDeleteKey: baseImpl };
		globalThis.foundry = { canvas: { layers: { TokenLayer: { prototype: proto } } } };
		return proto;
	}
	function inCombat(...tokens) {
		globalThis.game = { combats: [{ combatants: tokens.map(token => ({ token })) }] };
	}

	it("asks in a Stonetop window, naming the token and the combat, and deletes on the red button", async () => {
		const proto = installLayer();
		patchCoreConfirms();
		const token = { name: "Crinwin <the> Bold" };
		inCombat(token);
		const wait = stubConfirm(true);

		expect(await proto._confirmDeleteKey([token])).toBe(true);
		const asked = wait.mock.calls[0][0];
		expect(asked.classes).toEqual(expect.arrayContaining(THEMED));
		expect(asked.content).toContain("<strong>Crinwin &lt;the&gt; Bold</strong>");
		expect(asked.content).toContain("in combat");
		expect(asked.buttons.map(b => b.label)).toEqual(["Delete the token", "Keep it"]);
		expect(asked.buttons[0].class).toBe("stonetop-dialog-btn--danger");
		// Enter keeps the token: the delete cannot be undone.
		expect(asked.buttons.find(b => b.default).action).toBe("no");
	});

	it("keeps the token on Keep it, and on closing the window", async () => {
		const proto = installLayer();
		patchCoreConfirms();
		const token = { name: "Goblin" };
		inCombat(token);
		stubConfirm(false);
		expect(await proto._confirmDeleteKey([token])).toBe(false);
		stubConfirm(null);
		expect(await proto._confirmDeleteKey([token])).toBe(false);
	});

	it("warns about an attached region", async () => {
		const proto = installLayer();
		patchCoreConfirms();
		globalThis.game = { combats: [] };
		const wait = stubConfirm(true);
		await proto._confirmDeleteKey([{ name: "Wagon", attachments: { regions: { size: 1 } } }]);
		expect(wait.mock.calls[0][0].content).toContain("A region is attached");
	});

	it("counts several tokens rather than naming one", async () => {
		const proto = installLayer();
		patchCoreConfirms();
		const a = { name: "A" }, b = { name: "B" };
		inCombat(a);
		const wait = stubConfirm(true);
		await proto._confirmDeleteKey([a, b]);
		const asked = wait.mock.calls[0][0];
		expect(asked.content).toContain("these 2 tokens");
		expect(asked.buttons.map(b => b.label)).toEqual(["Delete the tokens", "Keep them"]);
	});

	it("leaves a delete core would not ask about to core", async () => {
		const proto = installLayer(async () => "core");
		patchCoreConfirms();
		globalThis.game = { combats: [{ combatants: [{ token: { name: "Someone else" } }] }] };
		const wait = stubConfirm(true);
		expect(await proto._confirmDeleteKey([{ name: "Loose" }])).toBe("core");
		expect(wait).not.toHaveBeenCalled();
	});
});
