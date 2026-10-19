// Checks the wiki source in wiki/ and publishes it to the GitHub wiki.
//
//   npm run wiki:check     links, images, sidebar coverage and banned characters; no network
//   npm run wiki:publish   the check, then mirror wiki/ into the wiki repo, commit and push
//   node scripts/sync-wiki.js --publish --dry-run   stage the mirror and print the diff, no commit
//
// The GitHub wiki is its own git repository (<repo>.wiki.git). It only exists once a first page
// has been saved in the web UI, so a clone that fails with "Repository not found" means nobody
// has done that yet. wiki/ is the source of truth: pages removed here are removed there.

import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";
import { fileURLToPath } from "url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WIKI = path.join(ROOT, "wiki");
const REMOTE = "https://github.com/PrinceWitherdick/stonetop-pwd.wiki.git";
const CLONE = process.env.STONETOP_WIKI_CLONE ?? "z:/tmp/stonetop-pwd.wiki";
const SPECIAL = new Set(["Home", "_Sidebar", "_Footer"]);

const args = new Set(process.argv.slice(2));

function listPages() {
	return fs.readdirSync(WIKI).filter(f => f.endsWith(".md")).map(f => f.slice(0, -3)).sort();
}

function listImages() {
	const dir = path.join(WIKI, "images");
	if (!fs.existsSync(dir)) return [];
	return fs.readdirSync(dir).filter(f => !f.startsWith(".")).map(f => `images/${f}`).sort();
}

/** Every markdown or HTML link target on a page, with fenced and inline code stripped out first. */
function linkTargets(text) {
	const prose = text.replace(/```[\s\S]*?```/g, "").replace(/`[^`\n]*`/g, "");
	const out = [];
	for (const m of prose.matchAll(/\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g)) out.push(m[1]);
	for (const m of prose.matchAll(/<img\b[^>]*\bsrc="([^"]+)"/gi)) out.push(m[1]);
	return out;
}

function check() {
	const pages = listPages();
	const pageSet = new Set(pages);
	const images = listImages();
	const usedImages = new Set();
	const problems = [];
	let shots = 0;

	for (const page of pages) {
		const text = fs.readFileSync(path.join(WIKI, `${page}.md`), "utf8");
		const lines = text.split(/\r?\n/);
		lines.forEach((line, i) => {
			if (line.includes("\u2014")) problems.push(`${page}.md:${i + 1}: em dash`);
			if (/\s\u2013\s/.test(line)) problems.push(`${page}.md:${i + 1}: en dash used as a dash`);
		});
		shots += (text.match(/<!--\s*SHOT:/g) ?? []).length;

		for (const target of linkTargets(text)) {
			if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith("#")) continue;
			const bare = decodeURIComponent(target.split("#")[0]);
			if (bare.startsWith("images/")) {
				usedImages.add(bare);
				if (!fs.existsSync(path.join(WIKI, bare))) problems.push(`${page}.md: missing image ${bare}`);
			} else if (!pageSet.has(bare)) {
				problems.push(`${page}.md: link to a page that does not exist: ${target}`);
			}
		}
	}

	for (const img of images) if (!usedImages.has(img)) problems.push(`unreferenced image ${img}`);

	if (!pageSet.has("Home")) problems.push("no Home.md");
	if (pageSet.has("_Sidebar")) {
		const sidebar = new Set(linkTargets(fs.readFileSync(path.join(WIKI, "_Sidebar.md"), "utf8"))
			.map(t => decodeURIComponent(t.split("#")[0])));
		for (const page of pages) {
			if (!SPECIAL.has(page) && !sidebar.has(page)) problems.push(`${page} is not linked from _Sidebar.md`);
		}
	} else {
		problems.push("no _Sidebar.md");
	}

	console.log(`wiki: ${pages.length} pages, ${images.length} images, ${shots} screenshot placeholders left`);
	if (problems.length) {
		for (const p of problems) console.error(`  ${p}`);
		console.error(`wiki check FAILED: ${problems.length} problem(s)`);
		process.exit(1);
	}
	console.log("wiki check ok");
}

function git(cwd, ...gitArgs) {
	return execFileSync("git", gitArgs, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] }).trim();
}

function publish() {
	const dryRun = args.has("--dry-run");
	if (fs.existsSync(path.join(CLONE, ".git"))) {
		const url = git(CLONE, "remote", "get-url", "origin");
		if (url !== REMOTE) throw new Error(`${CLONE} points at ${url}, not ${REMOTE}; refusing to publish there`);
		git(CLONE, "fetch", "origin");
		git(CLONE, "reset", "--hard", "origin/HEAD");
	} else {
		execFileSync("git", ["clone", REMOTE, CLONE], { stdio: "inherit" });
	}

	for (const entry of fs.readdirSync(CLONE)) {
		if (entry !== ".git") fs.rmSync(path.join(CLONE, entry), { recursive: true, force: true });
	}
	fs.cpSync(WIKI, CLONE, { recursive: true });
	git(CLONE, "add", "-A");

	const status = git(CLONE, "status", "--porcelain");
	if (!status) {
		console.log("wiki already matches wiki/; nothing to publish");
		return;
	}
	console.log(git(CLONE, "diff", "--cached", "--stat"));
	if (dryRun) {
		console.log(`dry run: changes are staged in ${CLONE}, not committed`);
		return;
	}
	const sha = git(ROOT, "rev-parse", "--short", "HEAD");
	git(CLONE, "commit", "-m", `Sync wiki from stonetop-pwd@${sha}`);
	execFileSync("git", ["push", "origin", "HEAD"], { cwd: CLONE, stdio: "inherit" });
	console.log("wiki published");
}

check();
if (args.has("--publish")) publish();
