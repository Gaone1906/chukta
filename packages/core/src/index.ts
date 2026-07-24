// @hisaab/core — pure money logic shared by the app and (via Deno) the Edge Functions.
//
// Nothing in this package may import React Native, Node built-ins, or perform I/O.
// Everything here is a pure function so it can be property-tested exhaustively and so the
// client's offline split preview matches the server's plpgsql implementation exactly.
//
// Implemented in Phase 2 — see plan/phase-02-core-money.md.

export const CORE_PLACEHOLDER = true;
