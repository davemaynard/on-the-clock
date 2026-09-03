// Builds the browser side into the two files the Python package inlines:
//   web/src/board.css         -> on_the_clock/assets/board.css   (minified)
//   web/src/tracker/main.js   -> on_the_clock/assets/tracker.js  (bundled, minified)
// Both outputs are committed so `uv add` from GitHub needs no Node; CI checks they
// are fresh. Edit web/src, run `npm run build`.
import { build } from "esbuild";

const banner = "/* Generated from web/src by `npm run build`. Do not edit. */";

await build({
  entryPoints: ["web/src/board.css"],
  bundle: true,
  minify: true,
  outfile: "on_the_clock/assets/board.css",
  banner: { css: banner },
  logLevel: "info",
});

await build({
  entryPoints: ["web/src/tracker/main.js"],
  bundle: true,
  minify: true,
  format: "iife",
  target: "es2022",
  outfile: "on_the_clock/assets/tracker.js",
  banner: { js: banner },
  logLevel: "info",
});
