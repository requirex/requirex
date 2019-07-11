<div align="center">
<img width="576" height="432" src="https://unpkg.com/requirex@0.1.1/doc/rex.svg">

[![npm version](https://img.shields.io/npm/v/requirex.svg)](https://www.npmjs.com/package/requirex)

[![Travis status](https://travis-ci.org/requirex/requirex.svg?branch=master)](http://travis-ci.org/requirex/requirex)
[![AppVeyor status](https://ci.appveyor.com/api/projects/status/rwywobi1pvq95pwu/branch/master?svg=true)](https://ci.appveyor.com/project/jjrv/requirex/branch/master)

[![dependency status](https://david-dm.org/requirex/requirex.svg)](https://david-dm.org/requirex/requirex)
[![install size](https://img.shields.io/bundlephobia/min/requirex.svg)](https://bundlephobia.com/result?p=requirex)
[![license](https://img.shields.io/npm/l/requirex.svg)](https://raw.githubusercontent.com/requirex/requirex/master/LICENSE)

<h1>RequireX</h1>
</div>

## Web dev, without the crud

**REQUIREX IS NOT READY. NOT EVERYTHING BELOW IS TRUE.**


```html
<!-- RequireX from CDN -->
<script src="https://cdn.jsdelivr.net/npm/requirex"></script>

<!-- Your fancy modern web code -->
<script type="x-req-application/javascript">
  // or set src="./App.tsx"

  import * as React from 'react';
  import * as ReactDOM from 'react-dom';

  ReactDOM.render(
    <h1 style={{ color: 'red' }}>Hello, World!</h1>, 
    document.body
  );
</script>

<body></body>
```

`requirex` is a revolutionary zero-configuration module loader for browsers and Node.js:

- **Simpler**. Forget Webpack, Babel, Brunch, Rollup, SystemJS, Parcel, Browserify...
- **Modern**. Supports ES6, TypeScript, React, PostCSS, LESS, and NPM out of the box.
  - All npm packages and the latest development toolchain at your disposal.
- **Faster**. Get started with a project immediately. Nothing to install or configure.
  - No need to install npm packages, just use them.
  - Instantly bundle transpiled code and all your dependencies for distribution.
- **Safer**. Runs in the browser, not in the cloud (unless you put it there).
  - Does not run malicious (or any other) shell scripts.
  - Does not leak your code to 3rd parties.
  - Lock down dependency versions, bundle code to avoid CDN-related vulnerabilities.
- **Lighter**. Less than 50kb. About 99.99998% smaller than [create-react-app](https://github.com/facebook/create-react-app#readme) and an empty project.


# RequireX in the wild

# User Guide

- [Benefits](#benefits)
- [Features](#features)
- [Tutorial](#tutorial)
- [Bundling for production](#bundling-for-production)
- [API](#api)
- [Plugins](#plugins)
- [License](#license)

## Benefits


`RequireX` is simple in the *painless* sense, but extremely *advanced*. It's for *everyone*.

- Beginners
  - Get started with the fun part of development immediately.
  - Avoid several days and endless frustration setting things up.
  - Create more professional results with less bloat or configuration mistakes.

- Intermediate
  - Painlessly use proper tools even in small projects.
  - Avoid backdoors in hijacked npm packages.
  - Reclaim gigabytes worth of `node_modules` directories

- Highly experienced
  - Set up quick demos with no boilerplate.
  - Many saved hours amortized over different demos and test cases.
  - Full control of the source code and dependency versions without duplicated toolchain installations between projects.

It's time to stop some bad habits giving the entire JavaScript community a bad name.

- No more running shell scripts from random sources 4 steps down the dependency chain.
- No more packages with hundreds of dependencies and as many megabytes of installed size.
- Let's use types. `requirex` comes with TypeScript. It doesn't cost anything or bloat anything. Just use it.

## Features

All features work automatically and transparently out of the box, without any configuration.

- Free forever.
  - This is not [SaaS](https://www.gnu.org/philosophy/who-does-that-server-really-serve.html). This is just software.
  - Clone this repo or [download the production bundle](https://cdn.jsdelivr.net/npm/requirex/dist/umd/) ([alternative link](https://unpkg.com/requirex/dist/umd/)) and it's yours to keep.
  - Dependencies are downloaded from [jsDelivr](https://www.jsdelivr.com/). They're also available on [UNPKG](https://unpkg.com/) and (less conveniently) on [npm](https://www.npmjs.com/). If those disappear, others will come.
- Import npm packages with zero effort.
  - Node.js module resolution based algorithm runs in the browser (or Node.js if you use that).
  - Packages installed in your own project are used from there. Anything missing is downloaded from a CDN.
  - The `browser` field in `package.json` is respected for browser support.
  - (TODO) Automatic package version lock avoids surprises from 3rd party code changes.
  - If you run Node.js, missing packages are downloaded straight to memory and executed much faster, without installing.
- Import CommonJS, AMD, ES6, TypeScript, JSON, plain text, CSS and Less.
- Transpile ES6 and TypeScript code to ES5.
  - Suddenly most code on npm runs on ancient Node.js versions down to 0.x.
  - If code from npm runs on a browser, it probably runs on all browsers, even mobile.
- Transpile CSS using PostCSS or Less.
  - Autoprefixer, minification and syntax improvements make CSS much nicer.
- Cache downloaded code and transpiled results for faster development.
  - This is similar to running a `watch` task in a traditional toolchain.
- Develop inside the safety of your own computer and your own browser's sandbox.
  - Avoid traditional npm package installation, which runs potentially dangerous shell scripts.
  - Do not let development tools and 3rd party packages access your file system, Bitcoin wallet etc.
  - Do not upload your source code to cloud providers or random companies hosting cloud-based development tools.
- Use many conventions popularized by webpack.
  - Use `@import` in CSS, reference npm packages with a `~` (tilde) prefix.
  - Conditionally compile code using tests like `if (process.env.NODE_ENV !== 'production' && typeof console !== 'undefined')`.
- Bundle code for production.
  - (TODO) Add a temporary link somewhere in your app. Clicking it allows saving a production-ready bundle to your device.
  - All transpiling, bundling and minification runs locally in your browser, keeping your code safe.
  - Bundled code loads and runs fast. It's fast enough for production use unless you're making the front page of a (soon to be) publicly traded company. In that case it's still good enough for most of your company internal apps.
- Make contributors' lives easier.
  - If you use requirex, others don't need to install anything to contribute.
  - Fork a repo, point GitHub Pages to the correct branch and just run the project including dev toolchain from there.

## Tutorial

### Browsers

First include `requirex` on the page:

```HTML
<script src="https://cdn.jsdelivr.net/npm/requirex"></script>
```

Then use it to load your own code with a `script` element using a special `type` attribute:

```HTML
<script type="x-req-application/javascript" src="App.ts"></script>
```

Or more explicitly using vanilla JavaScript:

```HTML
<script>

System.import('./App.ts');

</script>
```

You can also write ES6 or TypeScript directly inside the `script` element:

```HTML
<script type="x-req-application/javascript">

import * as React from 'react';
import * as ReactDOM from 'react-dom';

const element = <h1>Hello, World!</h1>;

ReactDOM.render(element, document.body);

</script>
```

### Node.js

First install:

```bash
npm install --save requirex
```

Then use it:

```JavaScript
require('requirex');

System.import('./App.ts');
```

You can also call from the command line:

`npx requirex ./App.ts`

If installed globally using `npm install --global requirex` or used in the
`scripts` section in `package.json`, `requirex` can effectively replace `npx`:

`requirex ./App.ts`

It will download any dependencies directly to memory as needed
(in contrast to `npx` which first installs packages in the file system and then removes them).

## Bundling for production

## API

### `System`

The most important class exposed by `requirex` is `Loader`.
An instance of it is available as a global variable called `System` which comes pre-configured with all included loader plugins.

`System.import`

`System.config`

`System.getConfig`

`System.resolve`

`System.resolveSync`

`System.build`

### `fetch`

A partial implementation of the WHATWG Fetch standard for both browsers and Node.js,
used internally by the loader. Replaceable with another compatible function by setting
`features.fetch`.

### `URL`

A polyfill for the Node.js [`URL API`](https://nodejs.org/api/url.html) is included,
with only the basic functionality needed internally by the loader and its most important plugins.

`URL.parse`

`URL.resolve`

`URL.relative`

### `features`

`features.isES6`

`features.isNode`

`features.isWin`

## Plugins

### AMD

### Cache

- Stores less than half a megabyte sized downloaded files and transpilation results in `window.localStorage`.
- Adds browser cache busting for downloads located under `window.origin` but not under a `node_modules` directory.
- Compares downloaded files with the previous version to avoid re-transpiling unchanged files.

### CJS

- Handles importing the CommonJS format and synchronous `require()` calls.
- Relies on the `JS` plugin and main loader to detect and fetch dependencies before running.

### CSS

- Transpiles CSS files using PostCSS and injects them on the page using `style` elements.
- Handles necessary URL transformations and webpack-style `@import` with a `~` prefix forcing Node.js module resolution.

### Document

Waits until the DOM is ready and then executes all script elements with an `x-req` prefix in their `type`,
in order of appearance on the page.

Usage in HTML:

```html
<script src="index.ts" type="x-req-application/x-typescript"></script>

<script type="x-req-application/javascript">
// Your code here.
</script>
```

### JS

- Detects the module format used in a `.js` file and delegates it to the correct plugin.
- Lists CommonJS-style dependencies to ensure the loader fetches them first, allowing synchronous `require()` calls.
- Forces transpilation to ES5 if ES6 code unsupported by the current JavaScript engine is detected.
- Handles conditional compilation by detecting `if` statements conditioned on `process.env.NODE_ENV` and passing the condition to `eval`.
  - If no error was encountered, removes the test and any related statements that became dead code.

### JSON

Reads and parses a JSON file using the JavaScript engine's internal `JSON.parse` function.
It's usually quite strict and for example does not support comments or single quote delimited strings.

Usage in ES6 or TypeScript:

```TypeScript
import * as json from './package.json';
```

Usage in CommonJS:

```JavaScript
const json = require('./package.json');
```

### NodeBuiltin

### NodeResolve

### Register

### TS

### TXT

Reads a plain text file, turning it into a module exporting the file contents as a variable.
Also useful for importing WebGL shader code.

Usage in ES6 or TypeScript:

```TypeScript
import * as txt from './readme.txt';
```

Usage in CommonJS:

```JavaScript
const txt = require('./readme.txt');
```

# License

[The MIT License](https://raw.githubusercontent.com/requirex/requirex/master/LICENSE)

Copyright (c) 2018- RequireX authors, see [doc/AUTHORS](doc/AUTHORS)
