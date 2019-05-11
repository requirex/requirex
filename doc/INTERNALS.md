# RequireX internals

## Philosophy

The JavaScript ecosystem is infested with bloat. Run-time bloat from
carelessly added dependencies make web pages and apps load and run slower.
Complicated toolchains and development dependencies make JavaScript as a
language less approachable and painful especially to new programmers and those
with a background in other languages.

JavaScript is a thing of beauty. It's Scheme with a C-like syntax. It's
extremely powerful, with built-in support for GPU shaders, cameras,
touchscreens and gyroscopes, C++ bindings and much more. It's dynamic but JIT
compiled and optimized to the hilt by all the biggest tech companies working
together, sparing no expense to make even badly written code run fast (if not
too bloated). Probably most people you know have a device that easily runs it.

In the 80s you used to turn on a home computer and start writing what
could be called programming instructions, even to load a game from disk or
more concretely to copy its source code printed in a magazine. In the early
2000s computer users no longer had to ever see any program code, but they could
open up a text editor, write JavaScript in the most modern style of the day,
and have it run with what they already had installed.

How things have changed. Today even a seasoned programmer can read a dozen
articles and still have little clue how to get started with writing a new
modern JavaScript web app, especially while following good style and
conventions.

`requirex` combines the best aspects of today's JavaScript with the minimal
(read: non-existent) toolchain requirements it used to have. With zero bloat.
Everything you need, you already have installed. `requirex` is one small script
infused with magic, that you mention in your code to have it run completely
in your browser, not the cloud.

All necessary online resources for more advanced tooling and libraries are
loaded transparently from static files. Several CDNs are falling over each
other competing to host them for free, we couldn't stop them even if we wanted
to. Of course, the end result is easy to run offline, share or host yourself.

## Design

The API is based on promises so a polyfill might be required for older
browsers. A polyfill for WhatWG style fetch for browsers and Node.js is
provided and exported for use by others. Otherwise the project does not rely
on features unsupported by older browsers such as IE9.

A general principle is that generally useful internal APIs should be published
to avoid duplication in case the loaded code also needs the same functionality
for other purposes.

## The import process

The loader is based on plugins for different "file formats" which can also
change the input file or its format information. Format changes send the input
to another plugin. The initial format is determined by the file extension.

For example the generic JavaScript (JS) plugin detects the type of module
loader the code expects and sets its format to CommonJS, TypeScript etc.
accordingly. Another plugin specific to that format then continues the import
process.

The TypeScript plugin transpiles code to JavaScript, which gets sent back to
the generic JS plugin to detect which plugin is appropriate for the transpiled
result. The TypeScript compiler can be configured to produce AMD, CommonJS or
`System.register` modules, all of which are supported.

Importing a new file works in stages:

1. `resolve` converts relative URLs to absolute and simulates the Node.js module
   resolution algorithm. It also finds, parses and caches `package.json` files.
2. `fetch` retrieves the file over HTTP(S), from the local file system or its
   internal cache which it also manages.
3. `discover` parses the file to detect its format and list its dependencies.
    - If format information changes, discover runs again using another plugin.
    - All dependencies are resolved, fetched and their dependencies discovered
      recursively, before continuing to the next stage.
4. `transpile` changes the file to make it more suitable for passing through
   `eval()`. It can change the format information, which sends the file back
   to the discovery stage using a different plugin. Often several plugins will
   need to transpile the same file.
5. `instantiate` calls or parses the file to produce an object with its exported
   variables. All imported dependencies are instantiated recursively first, to
   get any imported variables from their exports.

Discover and transpile are separate stages, because the TypeScript transpiler
runs synchronously and expects all dependencies to be available. They need to
be discovered and asynchronously fetched first.

The exact roles of different stages are not set in stone. For example the
generic JS plugin also removes hashbang headers and eliminates dead code
conditioned on `process.env.NODE_ENV` already during discovery instead of
transpiling, for two reasons:

- JavaScript parsing is expensive and necessary for both format detection in
  discovery, and dead code removal. We can do both at once.
- Changing format information sends the file to another plugin, which may not
  like the parts that were supposed to be removed.

Similarly the AMD and `System.register` plugins run `eval()` already during
discovery. A single file may define multiple such modules and their
dependencies, which would otherwise need more complicated parsing to discover.
The format assumes that top level code has no side effects other than defining
modules and no synchronous imports, making it safe to run at any point.

## Bundling

During bundling, code is transformed in exactly the same way as during import.
Transpile functions in plugins wrap code in a function for passing to `eval()`
and the same function source code gets emitted into bundles, together with
metadata about their URL, format and dependencies. Bundles are then loadable
using `<script>` tags, without requiring `eval()`.
