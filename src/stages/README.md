# `requirex/src/stages`

This directory contains the base implementations of all RequireX JavaScript loader stages,
each in its own file and usually executed in this order:

1. [`doResolve.ts`](doResolve.ts)
2. [`doFetch.ts`](doFetch.ts)
3. [`doAnalyze.ts`](doAnalyze.ts)
4. [`doTranslate.ts`](doTranslate.ts)
5. [`doInstantiate.ts`](doInstantiate.ts)
