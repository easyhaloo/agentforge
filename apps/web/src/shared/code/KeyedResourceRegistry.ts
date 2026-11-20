export type DisposableResource<T> = {
  value: T;
  dispose: () => void;
};

export type ResourceLease<T> = {
  value: T;
  release: () => void;
};

type RegistryEntry<T> = {
  value: T;
  dispose: () => void;
  references: number;
};

/**
 * Owns keyed resources while one or more consumers hold leases.
 *
 * A resource is created once per key, shared by subsequent acquisitions, and
 * disposed exactly once after the final lease is released. This keeps Monaco
 * model ownership independent from React component mount order.
 */
export class KeyedResourceRegistry<T> {
  private readonly entries = new Map<string, RegistryEntry<T>>();

  acquire(key: string, create: () => DisposableResource<T>): ResourceLease<T> {
    if (!key) throw new Error("A resource registry key is required");

    let entry = this.entries.get(key);
    if (!entry) {
      const resource = create();
      entry = { value: resource.value, dispose: resource.dispose, references: 0 };
      this.entries.set(key, entry);
    }

    entry.references += 1;
    let released = false;

    return {
      value: entry.value,
      release: () => {
        if (released) return;
        released = true;

        const current = this.entries.get(key);
        if (current !== entry) return;
        current.references -= 1;
        if (current.references > 0) return;

        // Remove before disposal so a throwing disposer cannot strand the key.
        this.entries.delete(key);
        current.dispose();
      },
    };
  }

  get size(): number {
    return this.entries.size;
  }

  getReferenceCount(key: string): number {
    return this.entries.get(key)?.references ?? 0;
  }

  disposeAll(): void {
    const entries = [...this.entries.values()];
    this.entries.clear();

    // Attempt every disposal even if one resource has a faulty disposer.
    let firstError: unknown;
    let didThrow = false;
    for (const entry of entries) {
      try {
        entry.dispose();
      } catch (error) {
        if (!didThrow) firstError = error;
        didThrow = true;
      }
    }
    if (didThrow) throw firstError;
  }
}
