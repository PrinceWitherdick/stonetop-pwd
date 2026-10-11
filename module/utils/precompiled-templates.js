// The release bundle's precompiled Handlebars templates, keyed by template path.
//
// A checkout has none: this file is the stand-in, and Foundry fetches and compiles each template
// the first time something renders it, so a template edited mid-session is the one that renders.
// `npm run build` swaps this file's contents for every templates/**/*.hbs, already compiled
// (scripts/bundle.js), and templates.js registers them at init. Nothing else imports it.
export default null;
