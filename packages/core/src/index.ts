// @hisaab/core — pure money logic shared by the app and (via Deno) the Edge Functions.
//
// Nothing in this package may import React Native, Node built-ins, or perform I/O.
// Everything here is a pure function so it can be property-tested exhaustively and so the
// client's offline split preview matches the server's plpgsql implementation exactly.
//
// Split allocation, debt simplification and FX land in Phase 2 —
// see plan/phase-02-core-money.md. Money and formatting shipped early because Phase 1's
// balance chip needs en-IN grouping.

export * from './money.js';
export * from './format.js';
