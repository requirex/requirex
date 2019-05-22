# RequireX

[![npm version](https://img.shields.io/npm/v/requirex.svg)](https://www.npmjs.com/package/requirex)
[![dependency status](https://david-dm.org/requirex/requirex.svg)](https://david-dm.org/requirex/requirex)
[![install size](https://img.shields.io/bundlephobia/min/requirex.svg)](https://bundlephobia.com/result?p=requirex)
[![license](https://img.shields.io/npm/l/requirex.svg)](https://raw.githubusercontent.com/requirex/requirex/master/LICENSE)

`requirex` is a zero-configuration module loader for browsers and Node.js.
It allows modern JavaScript and TypeScript development without requiring other tooling, even Node.js.

**REQUIREX IS NOT READY. NOT EVERYTHING BELOW IS TRUE.**

You can write in ES6 or TypeScript, import any npm packages and run the code in browsers without installing anything.
Code can be transpiled, minified and bundled for publication directly in the browser.

`requirex` supports importing CommonJS, AMD, ES6, TypeScript, JSON, plain text and CSS.

On top of everything `requirex` is small, below 30kb minified. It has no dependencies.
TypeScript and PostCSS compilers are downloaded from a CDN during development if needed.

## Usage

In browsers:

```HTML
<script src="https://cdn.jsdelivr.net/npm/requirex"></script>
<script>

System.import('./App.ts');

</script>
```

In Node.js:

```JavaScript
require('requirex');

System.import('./App.ts');
```

From `package.json` section `scripts`:

`requirex ./App.ts`

If installed globally using `npm`, `requirex` can effectively replace `npx`.

# License

[The MIT License](https://raw.githubusercontent.com/requirex/requirex/master/LICENSE)

Copyright (c) 2018- RequireX authors, see doc/AUTHORS
