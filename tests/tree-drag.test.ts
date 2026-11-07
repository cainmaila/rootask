import { describe, expect, it } from "vitest";
import { EDGE, MAX_SPEED, positionFor, scrollSpeed } from "../web/src/useTreeDrag";

describe("手把拖曳（#54）", () => {
  it("指標在列的上半放前面、下半放後面", () => {
    const r = { top: 100, height: 40 };
    expect(positionFor(r, 101)).toBe("before");
    expect(positionFor(r, 119)).toBe("before");
    expect(positionFor(r, 120)).toBe("after");
    expect(positionFor(r, 139)).toBe("after");
  });

  it("接近上下緣才自動捲動，越靠邊越快，不超過上限", () => {
    const h = 800;
    expect(scrollSpeed(400, h)).toBe(0);
    expect(scrollSpeed(EDGE, h)).toBe(0);
    expect(scrollSpeed(EDGE / 2, h)).toBeLessThan(0);
    expect(scrollSpeed(0, h)).toBe(-MAX_SPEED);
    expect(scrollSpeed(-50, h)).toBe(-MAX_SPEED);
    expect(scrollSpeed(h - EDGE / 2, h)).toBeGreaterThan(0);
    expect(scrollSpeed(h, h)).toBe(MAX_SPEED);
    expect(Math.abs(scrollSpeed(EDGE / 2, h))).toBeLessThan(MAX_SPEED);
  });
});
