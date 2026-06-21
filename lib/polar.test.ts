import { describe, it, expect } from "vitest";
import { polarSpeed, angleDiff, optimumUpwind, clamp } from "./polar";

describe("polarSpeed", () => {
  it("returns ~9.1 kn at 90 degrees", () => {
    expect(polarSpeed(90)).toBeCloseTo(9.1, 5);
  });

  it("returns ~0.3 kn at 0 degrees (head to wind)", () => {
    expect(polarSpeed(0)).toBeCloseTo(0.3, 5);
  });

  it("interpolates linearly between table points", () => {
    // halfway between 90 (9.1) and 110 (9.2) -> 100 deg
    expect(polarSpeed(100)).toBeCloseTo(9.15, 5);
  });

  it("folds angles above 180 back into the symmetric range", () => {
    expect(polarSpeed(270)).toBeCloseTo(polarSpeed(90), 5);
  });

  it("wraps negative angles", () => {
    expect(polarSpeed(-90)).toBeCloseTo(polarSpeed(90), 5);
  });
});

describe("angleDiff", () => {
  it("computes the signed shortest difference across the wrap", () => {
    expect(angleDiff(350, 10)).toBe(-20);
  });

  it("is the negative in the other direction", () => {
    expect(angleDiff(10, 350)).toBe(20);
  });

  it("returns 0 for equal angles", () => {
    expect(angleDiff(42, 42)).toBe(0);
  });
});

describe("optimumUpwind", () => {
  it("finds a beating angle between 38 and 46 degrees", () => {
    const { twa } = optimumUpwind();
    expect(twa).toBeGreaterThanOrEqual(38);
    expect(twa).toBeLessThanOrEqual(46);
  });

  it("reports a positive VMG", () => {
    expect(optimumUpwind().vmg).toBeGreaterThan(0);
  });
});

describe("clamp", () => {
  it("clamps below and above the range", () => {
    expect(clamp(-1, 0, 1)).toBe(0);
    expect(clamp(2, 0, 1)).toBe(1);
    expect(clamp(0.5, 0, 1)).toBe(0.5);
  });
});
