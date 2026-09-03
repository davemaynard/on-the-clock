// Builds the browser side into the two files the Python package inlines:
//   web/src/main.jsx  ->  on_the_clock/assets/board.js   (Preact, bundled and minified)
//                     ->  on_the_clock/assets/board.css  (global styles + every CSS module)
// Both outputs are committed so `uv add` from GitHub needs no Node; CI checks they are
// fresh. Edit web/src, run `npm run build`.
//
// CSS modules are esbuild's own: a `*.module.css` import yields an object of scoped class
// names, and `composes` lets a module extend a shared primitive. No plugins.
import { build } from "esbuild";

const banner = "/* Generated from web/src by `npm run build`. Do not edit. */";

await build({
  entryPoints: { board: "web/src/main.jsx" },
  outdir: "on_the_clock/assets",
  bundle: true,
  minify: true,
  format: "iife",
  target: "es2022",
  jsx: "automatic",
  jsxImportSource: "preact",
  banner: { js: banner, css: banner },
  logLevel: "info",
});
