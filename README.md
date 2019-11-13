<div align="center">
<img width="576" height="432" src="https://unpkg.com/requirex@0.1.1/doc/rex.svg">

[![npm version](https://img.shields.io/npm/v/requirex.svg)](https://www.npmjs.com/package/requirex)
[![Travis status](https://travis-ci.org/requirex/requirex.svg?branch=master)](http://travis-ci.org/requirex/requirex)
[![AppVeyor status](https://ci.appveyor.com/api/projects/status/rwywobi1pvq95pwu/branch/master?svg=true)](https://ci.appveyor.com/project/jjrv/requirex/branch/master)
[![dependency status](https://david-dm.org/requirex/requirex.svg)](https://david-dm.org/requirex/requirex)

<h1>RequireX</h1>
</div>

`requirex` is a small [![install size](https://img.shields.io/bundlephobia/min/requirex.svg)](https://bundlephobia.com/result?p=requirex), free [![license](https://img.shields.io/npm/l/requirex.svg)](https://raw.githubusercontent.com/requirex/requirex/master/LICENSE), tightly coded and opinionated toolchain replacing `npm` and `webpack`. It runs entirely on your own machine in the browser, or in Node.js. It saves lots of both time and disk space.

It removes unnecessary complexity from modern JavaScript development, making it easy to start new projects and test ideas. There's no need to install or configure anything to start coding. You can even use npm packages without having Node.js.

For the quickest start, see the optional [instant online project creator](#)<sup>TODO</sup> (you can continue development locally and offline).

## Basic idea

If you write:

```TypeScript
import React from 'react';
```

`requirex` guesses it's ES6 or TypeScript and wants the latest `react` from npm. So it fetches React (unless already installed locally using `npm`) from [UNPKG](https://unpkg.com/) or [jsDelivr](https://www.jsdelivr.com/) and transpiles your code using the TypeScript compiler (also works for ES6, much like Babel).

If the compiler is not installed locally, it fetches that too. Any npm package can be imported in the same way and generally obvious, manual tooling steps in JavaScript development have been automated away to save your time and effort.

There's lots of automatic :sparkles: magic :sparkles: inside to make it run smooth and fast: caching, bundling, module resolution, transpiling, AMD / CommonJS support, source maps, isomorphic fetch... So read on:

## Table of contents

- [Skip Webpack](#skip-webpack)
- [Getting started](#getting-started)
  - [Online quickstart](#online-quickstart)
  - [Locally in the browser](#locally-in-the-browser)
  - [Locally in Node.js](#locally-in-nodejs)
- [Practical issues](#practical-issues)
- [License](#license)

## Skip Webpack

`requirex` is a radical change to JavaScript development philosophy. Compare:

<table><tr><td><code>requirex</code><ul>
<li><b>You write code.</b></li>
<li><b>Code runs.</b></li>
<li>Dependencies are downloaded as needed.</li>
<li>Configuration is generated.</li>
<li>You <b>may</b> edit configuration or run a bundler.</li>
</ul></td><td><code>webpack</code><ul>
<li>You <b>must</b> start with configuration.</li>
<li>Dependencies are installed.</li>
<li><b>You write code.</b></li>
<li>You <b>must</b> run a bundler or watch task.</li>
<li><b>Code runs.</b></li>
</ul></td></tr></table>

Automating the common development steps gets you started faster. If the project grows more complex, you can switch to Webpack later without wasting any effort spent because `requirex` can automatically generate compatible configuration files for `npm` or <sup>TODO</sup>Webpack.

`requirex` allows you to learn, test and validate ideas faster.

## Getting started

### Online quickstart

[Open the project creator](#)<sup>TODO</sup>, follow instructions and publish an app or download a self-hosted project (even without Node.js) as a .zip or tarball.

### Locally in the browser

If you already have a web server, a single `index.html` file inside it ([download example](https://raw.githubusercontent.com/requirex/requirex/master/example/browser/index.html)) is enough to run some code.

Otherwise, you can [download `serve.bat`](https://raw.githubusercontent.com/requirex/requirex/master/example/browser/serve.bat) (a simple web server for Linux, Windows and OS X), run it and put an `index.html` file in the same directory, then open [http://localhost:8080/](http://localhost:8080/) to see the result.

In `index.html` ([download full example](https://raw.githubusercontent.com/requirex/requirex/master/example/browser/index.html)), first include `requirex` on the page:

```HTML
<script src="https://cdn.jsdelivr.net/npm/requirex"></script>
```

Then use it to load your own code with a `script` element using a special `type` attribute:

```HTML
<script type="x-req-application/javascript" src="app.js"></script>
```

Or more explicitly using vanilla JavaScript:

```HTML
<script>

System.import('./app.js');

</script>
```

You can also write ES6 or TypeScript directly inside the `script` element:

```HTML
<script type="x-req-application/javascript">

import React from 'react';
import ReactDOM from 'react-dom';

const element = <h1>Hello, World!</h1>;

ReactDOM.render(element, document.body);

</script>
```

You can use the [project creator](#)<sup>TODO</sup> and download a self-hosted project with a web server included and ready to go (even without Node.js).

### Locally in Node.js

You can install `requirex` like so:

```bash
npm install --save requirex
```

Then use it from the command line:

```bash
npx requirex app.js
```

or without `npx`:

```bash
node -e "require('requirex').System.import('./app.js')"
```

or from JavaScript code:

```TypeScript
var System = require('requirex').System;

System.import('./app.js');
```

on in `package.json` scripts:

```bash
"scripts": {
  "start": "requirex app.js"
}
```

Now `app.js` can contain ES6 or TypeScript code and successfully import packages even if they haven't been installed, like this:

```
import pad from 'left-pad';

console.log(pad('foo', 42));
```

Here's a one-liner to test it immediately:

```bash
npx requirex -e "console.log(require('left-pad')('foo', 42));"
```

or without `npx`:

```bash
node -e "require('requirex').System.import('left-pad').then(function(pad) { console.log(pad('foo', 42)); })"
```

## Practical issues

Changing package versions can cause problems later, so `requirex` can read, generate and update `package.json` and `package-lock.json` files. That keeps the project always compatible with other development tools. If you want to keep using `npm` then `requirex` will use any installed packages, but you can also try out new packages without having to install them. Generating new npm configuration ensures used packages will have correct version numbers and unused packages are dropped.

Loading dependencies and transpiling code every time is slow, so `requirex` will store results
in `window.caches`, `window.localStorage` or the local filesystem, whichever it can access.

Other users still need to download everything the first time, so `requirex` can bundle and minify all dependencies into a single file making it load faster.

# License

[The MIT License](https://raw.githubusercontent.com/requirex/requirex/master/LICENSE)

Copyright (c) 2018- RequireX authors, see [doc/AUTHORS](doc/AUTHORS)
