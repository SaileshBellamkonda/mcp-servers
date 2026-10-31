interface MockLike {
  mock: { calls: readonly (readonly unknown[])[] };
}

/** Argument `arg` of the `call`th call of `mock`; fails the test with a clear message when the mock was not called that often. */
export function callArg<T>(mock: MockLike | undefined, call = 0, arg = 0): T {
  const calls = mock?.mock.calls ?? [];
  const args = calls[call];
  if (args === undefined) throw new Error(`expected call #${String(call + 1)} but the mock was called ${String(calls.length)} time(s)`);
  return args[arg] as T;
}
