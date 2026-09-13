import { describe, expect, test } from "vitest";
import { cssRectToDip } from "../src/main/services/sessionTabGeometry";

describe("cssRectToDip", () => {
  test("identity at zoom factor 1 (default zoom)", () => {
    const rect = { x: 100, y: 50, width: 800, height: 600 };
    expect(cssRectToDip(rect, 1)).toEqual(rect);
  });

  test("scales every field by zoom factor 1.5 (zoomed in)", () => {
    const rect = { x: 100, y: 50, width: 800, height: 600 };
    expect(cssRectToDip(rect, 1.5)).toEqual({
      x: 150,
      y: 75,
      width: 1200,
      height: 900,
    });
  });

  test("scales every field by zoom factor 0.25 (zoomed out)", () => {
    const rect = { x: 100, y: 50, width: 800, height: 600 };
    expect(cssRectToDip(rect, 0.25)).toEqual({
      x: 25,
      y: 12.5,
      width: 200,
      height: 150,
    });
  });

  test("does not mutate the input rect", () => {
    const rect = { x: 100, y: 50, width: 800, height: 600 };
    cssRectToDip(rect, 2);
    expect(rect).toEqual({ x: 100, y: 50, width: 800, height: 600 });
  });
});
