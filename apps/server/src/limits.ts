// In-memory sliding-window limits (one server instance is enough for the hackathon; a restart
// resets them, which only makes the faucet a little more generous once).

/** At most `max` hits per `windowMs` per key. */
export class RateLimit {
  private hits = new Map<string, number[]>();
  constructor(
    private readonly windowMs: number,
    private readonly max: number,
    private readonly now: () => number = Date.now,
  ) {}

  /** Would a hit be allowed now? `retryMs` = how long until it would be. */
  check(key: string): { ok: boolean; retryMs: number } {
    const t = this.now();
    const list = (this.hits.get(key) ?? []).filter((x) => t - x < this.windowMs);
    if (list.length) this.hits.set(key, list);
    else this.hits.delete(key);
    if (list.length < this.max) return { ok: true, retryMs: 0 };
    return { ok: false, retryMs: this.windowMs - (t - list[0]!) };
  }

  hit(key: string): void {
    const list = this.hits.get(key) ?? [];
    list.push(this.now());
    this.hits.set(key, list);
  }

  /** check + hit in one go. */
  take(key: string): { ok: boolean; retryMs: number } {
    const r = this.check(key);
    if (r.ok) this.hit(key);
    return r;
  }

  get size(): number {
    return this.hits.size;
  }
}

/** A spending budget over a sliding window (e.g. lamports per hour). */
export class Budget {
  private spent: { at: number; amount: number }[] = [];
  constructor(
    private readonly windowMs: number,
    private readonly max: number,
    private readonly now: () => number = Date.now,
  ) {}

  used(): number {
    const t = this.now();
    this.spent = this.spent.filter((x) => t - x.at < this.windowMs);
    return this.spent.reduce((n, x) => n + x.amount, 0);
  }

  allows(amount: number): boolean {
    return this.used() + amount <= this.max;
  }

  spend(amount: number): void {
    this.spent.push({ at: this.now(), amount });
  }
}
