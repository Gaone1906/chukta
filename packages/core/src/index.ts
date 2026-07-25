// @hisaab/core — pure money logic shared by the app and (via Deno) the Edge Functions.
//
// Nothing in this package may import React Native, Node built-ins, or perform I/O.
// Everything here is a pure function so it can be property-tested exhaustively and so the
// client's offline split preview matches the server's plpgsql implementation exactly.
//
// NOTE: relative imports here are deliberately extensionless. Adding `.js` (the NodeNext
// style) satisfies tsc and Vitest but Metro cannot resolve it, and the app fails to bundle.

export * from './bigintMath';
export * from './money';
export * from './format';
export * from './allocate';
export * from './split';
export * from './fx';
export * from './settle';
