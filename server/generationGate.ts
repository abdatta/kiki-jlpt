// Serializes LLM text-generation work: one generation job holds the slot at a
// time and later starts wait in FIFO order. Audio has its own scheduler; this
// gate only covers run-generation, workflow-generation, and library-complement.
const waiters: Array<() => void> = [];
let busy = false;

export function isGenerationSlotBusy(): boolean {
  return busy;
}

async function acquireGenerationSlot(): Promise<void> {
  if (!busy) {
    busy = true;
    return;
  }
  await new Promise<void>((resolve) => waiters.push(resolve));
}

function releaseGenerationSlot(): void {
  const next = waiters.shift();
  if (next) next();
  else busy = false;
}

export async function withGenerationSlot<T>(operation: () => Promise<T>): Promise<T> {
  await acquireGenerationSlot();
  try {
    return await operation();
  } finally {
    releaseGenerationSlot();
  }
}

export function resetGenerationGateForTests(): void {
  busy = false;
  waiters.length = 0;
}
