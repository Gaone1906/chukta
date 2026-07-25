-- Allocator parity with packages/core/src/fixtures.ts.
--
-- These cases are copied from ALLOCATION_FIXTURES and must stay in lockstep. If a case here
-- fails after a change to either implementation, the two have diverged and the client's
-- offline split preview will disagree with what the server stores.

begin;
select plan(14);

-- ---------------------------------------------------------------- fixtures

select is(
  app.allocate_minor(10000, array[1,1,1]::numeric[], array['a','b','c']),
  array[3334,3333,3333]::bigint[],
  'equal three ways, one paisa left over'
);

select is(
  app.allocate_minor(10001, array[1,1,1]::numeric[], array['c','a','b']),
  array[3333,3334,3334]::bigint[],
  'keys out of order - tiebreak still picks a and b'
);

select is(
  app.allocate_minor(30000, array[2,1]::numeric[], array['a','b']),
  array[20000,10000]::bigint[],
  'clean two-to-one split'
);

select is(
  app.allocate_minor(100, array[1,1,1,1,1,1,1]::numeric[], array['a','b','c','d','e','f','g']),
  array[15,15,14,14,14,14,14]::bigint[],
  'weights that do not divide evenly'
);

select is(
  app.allocate_minor(100, array[1,0,1]::numeric[], array['a','b','c']),
  array[50,0,50]::bigint[],
  'zero-weight participant gets nothing'
);

select is(
  app.allocate_minor(-10000, array[1,1,1]::numeric[], array['a','b','c']),
  array[-3333,-3333,-3334]::bigint[],
  'negative total (a refund) still sums exactly'
);

select is(
  app.allocate_minor(99999, array[1]::numeric[], array['solo']),
  array[99999]::bigint[],
  'single participant takes everything'
);

select is(
  app.allocate_minor(1000, array[333333,333333,333334]::numeric[], array['a','b','c']),
  array[333,333,334]::bigint[],
  'remainder decided by weight before key'
);

select is(
  app.allocate_minor(10001, array[33330000,33330000,33340000]::numeric[], array['a','b','c']),
  array[3333,3333,3335]::bigint[],
  'percentage-style weights scaled to six decimal places'
);

select is(
  app.allocate_minor(9007199254740993, array[1,1]::numeric[], array['a','b']),
  array[4503599627370497,4503599627370496]::bigint[],
  'amount beyond Number.MAX_SAFE_INTEGER survives the round trip'
);

-- ---------------------------------------------------------------- invariants

select is(
  (select sum(x) from unnest(app.allocate_minor(123457, array[7,11,13,17]::numeric[], array['a','b','c','d'])) x),
  123457::numeric,
  'allocation sums to exactly the total for awkward weights'
);

select throws_ok(
  $$ select app.allocate_minor(100, array[]::numeric[], array[]::text[]) $$,
  'allocate_minor: no participants',
  'rejects an empty participant list'
);

select throws_ok(
  $$ select app.allocate_minor(100, array[0,0]::numeric[], array['a','b']) $$,
  'allocate_minor: weights sum to zero',
  'rejects weights that sum to zero'
);

select throws_ok(
  $$ select app.allocate_minor(100, array[1]::numeric[], array['a','b']) $$,
  'allocate_minor: 1 weights but 2 keys',
  'rejects mismatched weights and keys'
);

select * from finish();
rollback;
