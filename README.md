<div align="center">
<img width="576" height="432" src="https://unpkg.com/requirex@0.1.1/doc/rex.svg">

[![npm version](https://img.shields.io/npm/v/requirex.svg)](https://www.npmjs.com/package/requirex)

[![Travis status](https://travis-ci.org/requirex/requirex.svg?branch=master)](http://travis-ci.org/requirex/requirex)
[![AppVeyor status](https://ci.appveyor.com/api/projects/status/rwywobi1pvq95pwu/branch/master?svg=true)](https://ci.appveyor.com/project/jjrv/requirex/branch/master)

[![dependency status](https://david-dm.org/requirex/requirex.svg)](https://david-dm.org/requirex/requirex)
[![install size](https://img.shields.io/bundlephobia/min/requirex.svg)](https://bundlephobia.com/result?p=requirex)
[![license](https://img.shields.io/npm/l/requirex.svg)](https://raw.githubusercontent.com/requirex/requirex/master/LICENSE)

<h1>requirex</h1>
</div>

**REQUIREX IS NOT READY. NOT EVERYTHING BELOW IS TRUE.**

`requirex` is not only a zero-configuration module loader for browsers and Node.js.
It's also **a revolution**:

- **Modern**. Supports ES6, React, PostCSS and TypeScript (made with it, even) out of the box.
  - All npm packages and the latest development toolchain at your disposal.
- **Faster**. Get started with a project immediately. Nothing to install or configure.
  - No need to install npm packages, just use them.
  - Instantly bundle transpiled code and all your dependencies for distribution.
- **Simpler**. Makes webpack, Babel and even Node.js optional.
- **Safer**. Runs locally in the browser, not in the cloud (unless you put it there).
  - Does not run malicious (or any other) shell scripts.
  - Does not leak your code to 3rd parties.
  - Lock down dependency versions, bundle code to avoid CDN-related vulnerabilities.
- **Lighter**. It's less than 50kb. About 99.99998% smaller than [create-react-app](https://github.com/facebook/create-react-app#readme) and an empty project.
- **The best way to work with JavaScript, period.**

## Getting started

Save this in an `index.html` file somewhere:

```html
<!doctype html>
<html><head>
  <title>Hello requirex</title>
  <meta http-equiv="Content-Type" content="text/html; charset=utf-8">

  <!-- Use requirex. -->
  <script src="https://cdn.jsdelivr.net/npm/requirex"></script>
  <script type="x-req-application/javascript">
    // Your code goes below.
    import * as React from 'react';
    import * as ReactDOM from 'react-dom';

    const element = <h1 style={{ color: 'red' }}>Hello, World!</h1>;

    ReactDOM.render(element, document.body);
  </script>
</head><body>

</body></html>
```

Did you publish it online? If yes, open it and see it already work. It automatically fetched react and transpiled the JSX syntax.
Loaded slowly? Well, quite a bit just happened there. But try reloading: it's instant.
That's also the speed users get after you [bundle](#bundling-for-production) it.

Saved it on your own device? [Download this as serve.bat](https://raw.githubusercontent.com/requirex/requirex/master/example/browser/serve.bat) in the same directory and run it. Just double click it on Windows or make it executable and run it like this on Linux, OS X or Android under [Termux](https://termux.com/) (yes, the same script works on **all** common operating systems):

```bash
chmod a+x serve.bat
./serve.bat
```

It runs a web server on your own device, publishing the project for local use at the address [http://127.0.0.1:8080/](http://127.0.0.1:8080/). Click that link to see it.

You need a server because browser security rules don't allow html files from the local file system to access remote addresses, such as the CDN hosting `react` and `react-dom`.
The browser security sandbox is a big benefit when dealing with unknown or misspelled npm packages.

If that example contained too many moving parts, don't worry because there's a [tutorial](#tutorial).

You don't need Node.js. It's OK to use it, but it's *optional*.

More information in the:

# User Guide

- [Benefits](#benefits)
- [Features](#features)
- [Tutorial](#tutorial)
- [Bundling for production](#bundling-for-production)
- [API](#api)
- [Plugins](#plugins)
- [License](#license)

## Benefits

These are too numerous to list, so let's go with some main ones for developers with different amounts of experience. See more under [Features](#features).

`requirex` is simple in the *painless* sense, but extremely *advanced*. It's for *everyone*.

- Beginners
  - Get started with the fun part of development immediately.
  - Avoid several days and endless frustration setting things up.
  - Create more professional results with less bloat or configuration mistakes.

- Intermediate
  - Painlessly use proper tools even in small projects.
  - Avoid getting hosed by backdoors in hijacked npm packages.

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

### CJS

### CSS

### Document

### JS

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
