// Builds the browser side into the two files the Python package inlines:
//   web/src/main.tsx  ->  on_the_clock/assets/board.js   (Preact, bundled and minified)
//                     ->  on_the_clock/assets/board.css  (global styles + every CSS module)
// Both outputs are committed so `uv add` from GitHub needs no Node; CI checks they are
// fresh. Edit web/src, run `npm run build`. Types are checked separately (`npm run check`
// runs tsc); esbuild only strips them.
//
// CSS modules are esbuild's own: a `*.module.css` import yields an object of scoped class
// names, and `composes` lets a module extend a shared primitive. No plugins.
import { build } from "esbuild";

const banner = "/* Generated from web/src by `npm run build`. Do not edit. */";

await build({
  entryPoints: { board: "web/src/main.tsx" },
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
