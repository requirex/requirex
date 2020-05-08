# `requirex/src/platform`

This directory contains platform support functions and polyfills:

- [`URL.ts`](URL.ts) - Partial implementation of Node.JS URL API.
- [`browser.ts`](browser.ts) - Browser-specific low level utilities.
- [`features.ts`](features.ts) - Platform and feature detection.
- [`fetch.ts`](fetch.ts) - Partial WHATWG Fetch polyfill for browsers and Node.js.
- [`global.ts`](global.ts) - Global environment and indirect eval.
- [`node.ts`](node.ts) - Node.JS -specific low level utilities.
- [`util.ts`](util.ts) - Generic `Array`, `Object` etc. polyfills and extensions.
