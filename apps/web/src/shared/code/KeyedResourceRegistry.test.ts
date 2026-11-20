import { describe, expect, it, vi } from "vitest";
import { KeyedResourceRegistry } from "./KeyedResourceRegistry";

describe("KeyedResourceRegistry", () => {
  it("creates one resource for a key and shares it across leases", () => {
    const registry = new KeyedResourceRegistry<object>();
    const dispose = vi.fn();
    const create = vi.fn(() => ({ value: {}, dispose }));

    const first = registry.acquire("changeset://org/repo/CS-1/src/a.ts", create);
    const second = registry.acquire("changeset://org/repo/CS-1/src/a.ts", create);

    expect(create).toHaveBeenCalledTimes(1);
    expect(first.value).toBe(second.value);
    expect(registry.getReferenceCount("changeset://org/repo/CS-1/src/a.ts")).toBe(2);
    expect(registry.size).toBe(1);
    expect(dispose).not.toHaveBeenCalled();
  });

  it("disposes only after the final lease is released", () => {
    const registry = new KeyedResourceRegistry<string>();
    const dispose = vi.fn();
    const first = registry.acquire("model-a", () => ({ value: "model", dispose }));
    const second = registry.acquire("model-a", () => ({ value: "unused", dispose }));

    first.release();
    expect(dispose).not.toHaveBeenCalled();
    expect(registry.getReferenceCount("model-a")).toBe(1);

    second.release();
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(registry.size).toBe(0);
  });

  it("makes release idempotent and allows reacquisition after disposal", () => {
    const registry = new KeyedResourceRegistry<number>();
    const dispose = vi.fn();
    let sequence = 0;
    const create = vi.fn(() => ({ value: ++sequence, dispose }));
    const lease = registry.acquire("model-a", create);

    lease.release();
    lease.release();
    expect(dispose).toHaveBeenCalledTimes(1);

    const replacement = registry.acquire("model-a", create);
    expect(create).toHaveBeenCalledTimes(2);
    expect(replacement.value).toBe(2);
    replacement.release();
    expect(dispose).toHaveBeenCalledTimes(2);
  });

  it("keeps independent keys isolated", () => {
    const registry = new KeyedResourceRegistry<string>();
    const disposeA = vi.fn();
    const disposeB = vi.fn();
    const a = registry.acquire("model-a", () => ({ value: "a", dispose: disposeA }));
    const b = registry.acquire("model-b", () => ({ value: "b", dispose: disposeB }));

    a.release();
    expect(disposeA).toHaveBeenCalledTimes(1);
    expect(disposeB).not.toHaveBeenCalled();
    expect(registry.getReferenceCount("model-b")).toBe(1);
    b.release();
  });

  it("disposes all owned resources and clears the registry", () => {
    const registry = new KeyedResourceRegistry<string>();
    const disposeA = vi.fn();
    const disposeB = vi.fn();
    registry.acquire("a", () => ({ value: "a", dispose: disposeA }));
    registry.acquire("b", () => ({ value: "b", dispose: disposeB }));

    registry.disposeAll();

    expect(disposeA).toHaveBeenCalledTimes(1);
    expect(disposeB).toHaveBeenCalledTimes(1);
    expect(registry.size).toBe(0);
  });

  it("invalidates outstanding leases when all resources are disposed", () => {
    const registry = new KeyedResourceRegistry<number>();
    const dispose = vi.fn();
    const oldLease = registry.acquire("model-a", () => ({ value: 1, dispose }));

    registry.disposeAll();
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(registry.size).toBe(0);

    const replacementDispose = vi.fn();
    const replacement = registry.acquire("model-a", () => ({ value: 2, dispose: replacementDispose }));
    oldLease.release();
    expect(registry.getReferenceCount("model-a")).toBe(1);
    expect(replacementDispose).not.toHaveBeenCalled();

    replacement.release();
    expect(replacementDispose).toHaveBeenCalledTimes(1);
  });

  it("attempts every disposal when one disposer throws", () => {
    const registry = new KeyedResourceRegistry<string>();
    const failure = new Error("dispose failed");
    const throwingDispose = vi.fn(() => { throw failure; });
    const laterDispose = vi.fn();
    registry.acquire("a", () => ({ value: "a", dispose: throwingDispose }));
    registry.acquire("b", () => ({ value: "b", dispose: laterDispose }));

    expect(() => registry.disposeAll()).toThrow(failure);
    expect(throwingDispose).toHaveBeenCalledTimes(1);
    expect(laterDispose).toHaveBeenCalledTimes(1);
    expect(registry.size).toBe(0);
  });

  it("rejects empty keys before creating resources", () => {
    const registry = new KeyedResourceRegistry<string>();
    const create = vi.fn(() => ({ value: "x", dispose: () => undefined }));

    expect(() => registry.acquire("", create)).toThrow("A resource registry key is required");
    expect(create).not.toHaveBeenCalled();
  });
});
