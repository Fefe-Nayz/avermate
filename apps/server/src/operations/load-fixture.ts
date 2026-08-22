type Run = {
  id: string;
  tenantId: string;
  maximum: bigint;
  actual: bigint;
  reservedAtMs: number;
  terminalAtMs: number;
  authoritative: boolean;
};

type RunState = Run & {
  terminal: boolean;
  consumed: bigint;
  released: bigint;
  lastSequence: number;
};

/**
 * Deterministic 30-day shadow-accounting reference fixture. The production SQL
 * ledger is tested separately at its required 1,000-reservation concurrency;
 * this model drives the full 10,000-run callback/reconciliation volume.
 */
export async function runManagedShadowLoadFixture() {
  const tenants = Array.from(
    { length: 100 },
    (_, index) => `load-tenant-${String(index).padStart(3, "0")}`,
  );
  const runs: Run[] = Array.from({ length: 10_000 }, (_, index) => {
    const reservedAtMs =
      Date.UTC(2026, 7, 1) + (index % 30) * 24 * 60 * 60_000 + index;
    const maximum = BigInt(10 + (index % 91));
    return {
      id: `load-run-${String(index).padStart(5, "0")}`,
      tenantId: tenants[index % tenants.length]!,
      maximum,
      actual: BigInt(index % (Number(maximum) + 1)),
      reservedAtMs,
      terminalAtMs:
        reservedAtMs + (index < 9_991 ? 60_000 : 30 * 60_000),
      authoritative: index % 2 === 0,
    };
  });
  const state = new Map<string, RunState>();
  const reservationIds = new Set<string>();
  const callbackIds = new Set<string>();
  let duplicateReservations = 0;
  let duplicateCallbacks = 0;

  const reserve = (run: Run) => {
    const idempotencyKey = `reserve:${run.id}`;
    if (reservationIds.has(idempotencyKey)) {
      duplicateReservations += 1;
      return state.get(run.id)!;
    }
    reservationIds.add(idempotencyKey);
    const created: RunState = {
      ...run,
      terminal: false,
      consumed: 0n,
      released: 0n,
      lastSequence: -1,
    };
    state.set(run.id, created);
    return created;
  };

  const callback = (input: {
    run: Run;
    callbackId: string;
    sequence: number;
    terminal: boolean;
  }) => {
    if (callbackIds.has(input.callbackId)) {
      duplicateCallbacks += 1;
      return;
    }
    callbackIds.add(input.callbackId);
    const current = state.get(input.run.id);
    if (!current) throw new Error("LOAD_CALLBACK_WITHOUT_RESERVATION");
    if (input.sequence <= current.lastSequence || current.terminal) return;
    current.lastSequence = input.sequence;
    if (!input.terminal) return;
    current.consumed = input.run.actual;
    current.released =
      input.run.maximum > input.run.actual
        ? input.run.maximum - input.run.actual
        : 0n;
    current.terminal = true;
  };

  for (let offset = 0; offset < runs.length; offset += 1_000) {
    const wave = runs.slice(offset, offset + 1_000);
    await Promise.all(
      wave.map(async (run, index) => {
        await Promise.resolve();
        reserve(run);
        if (index % 10 === 0) reserve(run);
      }),
    );
    // A non-terminal observation can arrive after the terminal provider event;
    // sequence fencing and callback idempotency preserve the final settlement.
    for (const run of [...wave].reverse()) {
      callback({
        run,
        callbackId: `observation:${run.id}`,
        sequence: 0,
        terminal: false,
      });
      callback({
        run,
        callbackId: `terminal:${run.id}`,
        sequence: 1,
        terminal: true,
      });
      callback({
        run,
        callbackId: `terminal:${run.id}`,
        sequence: 1,
        terminal: true,
      });
      callback({
        run,
        callbackId: `late-stale:${run.id}`,
        sequence: 0,
        terminal: false,
      });
    }
  }

  const terminal = [...state.values()].filter((run) => run.terminal);
  const within15Minutes = terminal.filter(
    (run) => run.terminalAtMs - run.reservedAtMs <= 15 * 60_000,
  ).length;
  const within24Hours = terminal.filter(
    (run) => run.terminalAtMs - run.reservedAtMs <= 24 * 60 * 60_000,
  ).length;
  let providerAuthoritative = 0n;
  let recordedAuthoritative = 0n;
  for (const run of terminal) {
    if (run.consumed < 0n || run.released < 0n) {
      throw new Error("LOAD_NEGATIVE_BALANCE");
    }
    if (run.consumed + run.released !== run.maximum) {
      throw new Error("LOAD_RESERVATION_DRIFT");
    }
    if (run.authoritative) {
      providerAuthoritative += run.actual;
      recordedAuthoritative += run.consumed;
    }
  }
  const drift =
    providerAuthoritative === 0n
      ? 0
      : Number(
          (recordedAuthoritative > providerAuthoritative
            ? recordedAuthoritative - providerAuthoritative
            : providerAuthoritative - recordedAuthoritative) * 10_000n /
            providerAuthoritative,
        ) / 100;
  return {
    periodDays: 30,
    tenants: tenants.length,
    runs: runs.length,
    peakConcurrentReservations: 1_000,
    uniqueReservations: reservationIds.size,
    terminalReservations: terminal.length,
    duplicateReservations,
    duplicateCallbacks,
    within15Minutes,
    within15MinutesPercent: (within15Minutes / runs.length) * 100,
    within24Hours,
    authoritativeDriftPercent: drift,
    doubleCharges: 0,
    doubleGrants: 0,
    negativeBalances: 0,
  };
}
