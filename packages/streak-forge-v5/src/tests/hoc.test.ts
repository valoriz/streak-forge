import { describe, test, expect } from "bun:test";
import { handler, widget, component, resetHandlerCache } from "../hoc.js";

// handler() is the one HOC with real runtime behavior (memoization) — see
// its own doc comment in hoc.ts. widget()/component() stay pure identity
// wrappers, covered briefly here just to pin that down.

describe("hoc.handler — memoized by (function reference, hash of call args)", () => {
  test("same input, called twice, only actually invokes the wrapped function once", async () => {
    let calls = 0;
    const getData = handler({})(async (id: string) => {
      calls++;
      return { id, calls };
    });

    const first = await getData("a");
    const second = await getData("a");

    expect(calls).toBe(1);
    expect(first).toEqual({ id: "a", calls: 1 });
    expect(second).toEqual(first);
  });

  test("different input re-invokes and caches separately", async () => {
    let calls = 0;
    const getData = handler({})(async (id: string) => {
      calls++;
      return { id, calls };
    });

    const a = await getData("a");
    const b = await getData("b");
    const aAgain = await getData("a");

    expect(calls).toBe(2);
    expect(a).toEqual({ id: "a", calls: 1 });
    expect(b).toEqual({ id: "b", calls: 2 });
    expect(aAgain).toEqual(a);
  });

  test("concurrent calls with the same input dedupe too, not just completed ones", async () => {
    let calls = 0;
    const getData = handler({})(async (id: string) => {
      calls++;
      await new Promise((resolve) => setTimeout(resolve, 5));
      return { id, calls };
    });

    const [a, b] = await Promise.all([getData("x"), getData("x")]);
    expect(calls).toBe(1);
    expect(a).toEqual(b);
  });

  test("two separately-wrapped handlers never share a cache, even with identical input and body", async () => {
    let callsA = 0;
    let callsB = 0;
    const handlerA = handler({})(async () => {
      callsA++;
      return "A";
    });
    const handlerB = handler({})(async () => {
      callsB++;
      return "B";
    });

    await handlerA();
    await handlerB();
    await handlerA();
    await handlerB();

    expect(callsA).toBe(1);
    expect(callsB).toBe(1);
  });

  test("a zero-arg handler still memoizes (empty args list hashes deterministically)", async () => {
    let calls = 0;
    const getCommon = handler({})(async () => {
      calls++;
      return { branding: "Streak.js" };
    });

    await getCommon();
    await getCommon();
    expect(calls).toBe(1);
  });
});

describe("hoc.widget / hoc.component — pure identity wrappers", () => {
  test("widget() returns the exact same function reference, unwrapped behavior", () => {
    const fn = (props: { x: number }) => props.x * 2;
    const wrapped = widget({})(fn);
    expect(wrapped).toBe(fn);
    expect(wrapped({ x: 21 })).toBe(42);
  });

  test("component() returns the exact same function reference, unwrapped behavior", () => {
    const fn = (props: { x: number }) => props.x + 1;
    const wrapped = component({})(fn);
    expect(wrapped).toBe(fn);
    expect(wrapped({ x: 1 })).toBe(2);
  });
});

describe("hoc.resetHandlerCache", () => {
  test("a reset makes the next call run the handler again; calls in between share one run", async () => {
    let runs = 0;
    const load = handler({})(async (slug: string) => {
      runs++;
      return slug;
    });
    await load("a");
    await load("a");
    expect(runs).toBe(1);
    resetHandlerCache();
    await load("a");
    await load("a");
    expect(runs).toBe(2);
  });
});
