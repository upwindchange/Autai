import { describe, expect, test } from "vitest";
import {
  buildLandingRecoveryPrompt,
  buildSearchQuery,
  filterBlockedHosts,
  probeWallMarkers,
} from "../src/main/agents/workers/entertainmentWorker/pipeline2ChapteredInternet/internetFetch/pure";

describe("buildSearchQuery", () => {
  test("joins title + author with a single space", () => {
    expect(buildSearchQuery({ title: "诡秘之主", author: "爱潜水的乌贼" })).toBe(
      "诡秘之主 爱潜水的乌贼",
    );
  });

  test("trims whitespace from both parts", () => {
    expect(
      buildSearchQuery({
        title: "  Lord of the Mysteries  ",
        author: " Cuttlefish ",
      }),
    ).toBe("Lord of the Mysteries Cuttlefish");
  });

  test("authorless title → title alone", () => {
    expect(buildSearchQuery({ title: "诡秘之主" })).toBe("诡秘之主");
    expect(buildSearchQuery({ title: "诡秘之主", author: "" })).toBe("诡秘之主");
  });

  test("empty title → empty string (caller errors out)", () => {
    expect(buildSearchQuery({ title: "" })).toBe("");
    expect(buildSearchQuery({ title: "", author: "" })).toBe("");
  });
});

describe("probeWallMarkers", () => {
  test("positive: 开通会员", () => {
    expect(probeWallMarkers("立即开通会员 畅读全书")).toBe("开通会员");
  });

  test("positive: VIP章节", () => {
    expect(probeWallMarkers("第123章 此章为VIP章节，请订阅")).toBe("VIP章节");
  });

  test("positive: 登录后阅读", () => {
    const marker = probeWallMarkers("请登录后阅读完整内容");
    expect(marker).not.toBeNull();
  });

  test("positive: verify you are human (case-insensitive)", () => {
    // case-insensitive match — the matched phrase reflects the input's case
    expect(
      probeWallMarkers("Please VERIFY YOU ARE HUMAN to continue"),
    ).not.toBeNull();
  });

  test("negative: bare VIP in prose", () => {
    expect(probeWallMarkers("He walked into the VIP lounge scene")).toBeNull();
  });

  test("negative: prose containing bare 订阅 without a compound marker", () => {
    expect(
      probeWallMarkers("她订阅了三份报纸，小说情节围绕报纸连载展开"),
    ).toBeNull();
  });

  test("negative: empty string", () => {
    expect(probeWallMarkers("")).toBeNull();
  });

  test("negative: plain URL", () => {
    expect(probeWallMarkers("https://www.example.com/book/12345")).toBeNull();
  });
});

describe("filterBlockedHosts", () => {
  test("removes blocked hostname, keeps others", () => {
    expect(
      filterBlockedHosts(
        ["https://dead.example.com/book/1", "https://alive.example.com/book/1"],
        { "dead.example.com": "wall:paywall" },
      ),
    ).toEqual(["https://alive.example.com/book/1"]);
  });

  test("dedupes same origin+pathname+search", () => {
    expect(
      filterBlockedHosts(
        [
          "https://a.example.com/book/1?x=1",
          "https://a.example.com/book/1?x=1",
          "https://a.example.com/book/1?x=2",
        ],
        {},
      ),
    ).toEqual([
      "https://a.example.com/book/1?x=1",
      "https://a.example.com/book/1?x=2",
    ]);
  });

  test("invalid URL entries are skipped, not thrown", () => {
    expect(
      filterBlockedHosts(["not a url", "https://ok.example.com/b", "::bad::"], {}),
    ).toEqual(["https://ok.example.com/b"]);
  });

  test("empty input → empty output", () => {
    expect(filterBlockedHosts([], { "x.com": "wall:login" })).toEqual([]);
  });
});

describe("buildLandingRecoveryPrompt", () => {
  const prompt = buildLandingRecoveryPrompt({
    target: 42,
    lastTitle: "第41章 夜幕",
    lastUrl: "https://example.com/book/41",
    attempt: 2,
  });

  test("contains the target chapter number", () => {
    expect(prompt).toContain("chapter 42");
  });

  test("contains the last title", () => {
    expect(prompt).toContain("第41章 夜幕");
  });

  test("contains the last URL", () => {
    expect(prompt).toContain("https://example.com/book/41");
  });

  test("contains the IMMEDIATELY FOLLOWING and ORDER rules", () => {
    expect(prompt).toContain("IMMEDIATELY FOLLOWING");
    expect(prompt).toContain("ORDER");
  });

  test("null lastTitle falls back to the unnamed-page wording", () => {
    const p = buildLandingRecoveryPrompt({
      target: 3,
      lastTitle: null,
      lastUrl: "https://example.com/x",
      attempt: 1,
    });
    expect(p).toContain("an unnamed page");
    expect(p).toContain("chapter 3");
  });
});
