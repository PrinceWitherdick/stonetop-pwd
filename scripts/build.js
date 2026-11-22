// `npm run build`: write the release bundle and stylesheet to dist/. See scripts/bundle.js for why they exist.
import { buildBundle, buildStyles, BUNDLE_OUTFILE, STYLES_OUTFILE } from "./bundle.js";

const started = Date.now();
try {
	const result = await buildBundle();
	const bytes = result.metafile.outputs[BUNDLE_OUTFILE].bytes;
	const modules = Object.keys(result.metafile.inputs).length;
	console.log(`Bundled ${modules} modules into ${BUNDLE_OUTFILE} (${Math.round(bytes / 1024)} KB) in ${Date.now() - started} ms.`);
	console.log(`Wrote ${STYLES_OUTFILE} (${Math.round(buildStyles().bytes / 1024)} KB).`);
} catch (err) {
	console.error(err.message);
	process.exit(1);
}
