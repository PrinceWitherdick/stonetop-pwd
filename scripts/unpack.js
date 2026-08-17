import { extractPack } from "@foundryvtt/foundryvtt-cli";
import { promises as fs } from "fs";
import { PACKS } from "./packs.js";

for (const { name: pack, sources } of PACKS) {
	// Multi-source packs are assembled from several generator-owned source dirs and
	// can't be round-tripped back into one tree — skip them (their source already exists).
	if (sources) {
		console.log(`Skipping ${pack} — assembled from multiple source dirs (${sources.join(", ")})`);
		continue;
	}
	const src  = `packs/${pack}`;
	const dest = `packs/src/${pack}`;
	try {
		await fs.access(dest);
		console.log(`Skipping ${pack} — source already exists at ${dest}`);
		continue;
	} catch {
		// fs.access throws exactly when `dest` does NOT exist, which is the case we want:
		// fall through and extract. Any other reason to fail will resurface on extractPack.
	}
	await extractPack(src, dest, { nedb: false, log: true });
}
