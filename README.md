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

`requirex` is a zero-configuration module loader for browsers and Node.js.
It allows modern JavaScript and TypeScript development without requiring other tooling, even Node.js.

**REQUIREX IS NOT READY. NOT EVERYTHING BELOW IS TRUE.**

You can write in ES6 or TypeScript, import npm packages and run the code in browsers without installing anything.
Code is transpiled, minified and bundled for publication directly in the browser.

`requirex` supports importing CommonJS, AMD, ES6, TypeScript, JSON, plain text and CSS.

All npm packages are available. `requirex` uses Node.js module resolution and looks for
`node_modules` directories in your project. Any missing packages it downloads automatically
from CDNs. Packages are configured according to their own `package.json` files, also respecting
`browser` specific configurations.

On top of everything `requirex` is small, below 30kb minified. It has no dependencies.
TypeScript and PostCSS compilers are downloaded from a CDN if needed.
For production use, code gets precompiled to skip the download and build steps for end users.

## Usage

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

# License

[The MIT License](https://raw.githubusercontent.com/requirex/requirex/master/LICENSE)

Copyright (c) 2018- RequireX authors, see [doc/AUTHORS](doc/AUTHORS)
