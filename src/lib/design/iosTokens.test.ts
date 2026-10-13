import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { generateSwiftTokens, parseDesignFrontMatter, parseTheme, swiftName, TokenError } from "./iosTokens";

const read = (path: string) => readFileSync(fileURLToPath(new URL(`../../../${path}`, import.meta.url)), "utf8");

const DESIGN = `---
name: Test
typography:
  body:
    fontFamily: "system-ui"
    fontSize: "12.5px"
    fontWeight: 600
    lineHeight: 1.3
  hero:
    fontSize: "40px"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "-0.02em"
  fluid:
    fontSize: "clamp(26px, 3.2vw, 38px)"
    fontWeight: 700
rounded:
  sm: "3px"
spacing:
  xs: "4px"
components:
  button:
    rounded: "{rounded.sm}"
---

# Body
`;

describe("iOS tokens", () => {
  it("the committed Tokens.swift matches the web tokens (run `npm run ios:tokens` if this fails)", () => {
    const expected = generateSwiftTokens(read("src/app/globals.css"), read("DESIGN.md"));
    expect(read("mobile/ios/DraftRoom/Design/Tokens.swift")).toBe(expected);
  });

  it("reads the @theme block, skipping comments", () => {
    const vars = parseTheme("a { --x: 1; }\n@theme {\n  /* --color-gone: #000; */\n  --color-bg: #1a1e25;\n}");
    expect([...vars]).toEqual([["color-bg", "#1a1e25"]]);
  });

  it("names tokens in camelCase", () => {
    expect(swiftName("row-line")).toBe("rowLine");
    expect(swiftName("panel2")).toBe("panel2");
    expect(swiftName("2xl")).toBe("_2xl");
  });

  it("writes sRGB colors and resolves aliases", () => {
    const swift = generateSwiftTokens("@theme {\n  --color-bg: #ff0080;\n  --color-page: var(--color-bg);\n}", DESIGN);
    expect(swift).toContain("static var bg: Color { Color(.sRGB, red: 1, green: 0, blue: 0.502, opacity: 1) }");
    expect(swift).toContain("static var page: Color { Color(.sRGB, red: 1, green: 0, blue: 0.502, opacity: 1) }");
  });

  it("rejects a dangling alias and a non-hex color", () => {
    expect(() => generateSwiftTokens("@theme { --color-a: var(--color-nope); }", DESIGN)).toThrow(TokenError);
    expect(() => generateSwiftTokens("@theme { --color-a: rgb(1 2 3); }", DESIGN)).toThrow(TokenError);
  });

  it("writes the type scale, radii and spacing, skipping fluid web-only sizes", () => {
    const swift = generateSwiftTokens("@theme {\n  --color-bg: #000;\n  --radius-card: 6px;\n}", DESIGN);
    expect(swift).toContain("static let body = TypeToken(size: 12.5, weight: .semibold, lineHeight: 1.3, tracking: 0)");
    expect(swift).toContain("static let hero = TypeToken(size: 40, weight: .bold, lineHeight: 1, tracking: -0.8)");
    expect(swift).not.toContain("fluid");
    expect(swift).toContain("static let card: CGFloat = 6");
    expect(swift).toContain("static let sm: CGFloat = 3");
    expect(swift).toContain("static let xs: CGFloat = 4");
  });

  it("reads only the maps it needs from the front matter", () => {
    const fm = parseDesignFrontMatter(DESIGN);
    expect(fm.spacing).toEqual({ xs: "4px" });
    expect(fm.typography.body).toMatchObject({ fontSize: "12.5px", fontWeight: 600 });
  });
});
