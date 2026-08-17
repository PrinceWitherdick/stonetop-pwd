// Identity + lookup for the seeded "Import Book Art" bring-your-own-book macro,
// shared by the Ready-hook seeder (_ensureBook2ArtMacro) and the Welcome guide's
// launch button (WelcomeDialog._runImportBookArt) so the pack id, macro id, name,
// and legacy names live in exactly one place and can never drift between them.
// The shipped compendium doc is the single source of truth for the macro's
// command/img.
import { MACROS_PACK } from "../system-id.js";

export const BOOK2_ART_MACRO_PACK = MACROS_PACK;
export const BOOK2_ART_MACRO_ID   = "stMacroBook2Art1";
export const BOOK2_ART_MACRO_NAME = "Import Book Art";
// Worlds seeded before the rename carry the old name; callers rename in place.
export const BOOK2_ART_MACRO_LEGACY_NAMES = ["Import Book II Art"];

/**
 * The world's copy of the macro — matched by its current name, else by a
 * pre-rename legacy name — or undefined if the world has none.
 */
export function findBook2ArtWorldMacro() {
	return game.macros.find(m => m.name === BOOK2_ART_MACRO_NAME)
		?? game.macros.find(m => BOOK2_ART_MACRO_LEGACY_NAMES.includes(m.name));
}

/**
 * The shipped compendium copy of the macro (the source of truth for command/img),
 * or undefined if the pack is unavailable. Never throws.
 */
export async function loadBook2ArtMacroSource() {
	try { return await game.packs.get(BOOK2_ART_MACRO_PACK)?.getDocument(BOOK2_ART_MACRO_ID); }
	catch { return undefined; }
}

/**
 * Launch the bring-your-own-book "Import Book Art" macro: prefer the world's seeded
 * copy in the Macro Directory, else run the shipped compendium copy directly. GM-only
 * (the macro browses and writes files), so callers must gate on isGM. Warns and no-ops
 * if neither copy is available. Shared by the Welcome guide's "Import Book Art" button
 * and the post-startup art-import chat reminder so the launch path lives in one place.
 */
export async function runImportBookArtMacro() {
	let macro = findBook2ArtWorldMacro();
	if (!macro) {
		const src = await loadBook2ArtMacroSource();
		if (src?.command) macro = new Macro({ name: BOOK2_ART_MACRO_NAME, type: "script", img: src.img, command: src.command, scope: "global" });
	}
	if (!macro) { ui.notifications.warn("The Import Book Art macro isn't set up in this world yet."); return; }
	return macro.execute();
}
