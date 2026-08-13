import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { DocMarkdown, safeUrlTransform } from "./DocMarkdown";

afterEach(cleanup);

describe("DocMarkdown", () => {
  it("renders embedded HTML and script as TEXT, never as markup", () => {
    const { container } = render(
      <DocMarkdown>{'Before\n\n<script>alert(1)</script>\n\n<img src=x onerror="alert(1)">\n\nAfter'}</DocMarkdown>,
    );

    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText(/<script>alert\(1\)<\/script>/)).toBeInTheDocument();
  });

  it("emits no href whose scheme is not http or https", () => {
    const { container } = render(
      <DocMarkdown>
        {[
          "[js](javascript:alert(1))",
          "[mail](mailto:someone@example.com)",
          "[irc](ircs://example.com/chan)",
          "[xmpp](xmpp:a@b.c)",
          "[http](http://example.com/a)",
          "[https](https://example.com/b)",
          "[relative](./sibling.md)",
          "[anchor](#section)",
        ].join("\n\n")}
      </DocMarkdown>,
    );

    const hrefs = [...container.querySelectorAll("a")].map((a) => a.getAttribute("href") ?? "");
    for (const href of hrefs) {
      expect(href).not.toMatch(/^javascript:/i);
      expect(href).not.toMatch(/^mailto:/i);
      expect(href).not.toMatch(/^ircs?:/i);
      expect(href).not.toMatch(/^xmpp:/i);
    }
    expect(hrefs).toContain("http://example.com/a");
    expect(hrefs).toContain("https://example.com/b");
    expect(hrefs).toContain("./sibling.md");
    expect(hrefs).toContain("#section");
  });
});

describe("safeUrlTransform", () => {
  const cases: Array<[string, string]> = [
    ["https://example.com", "https://example.com"],
    ["http://example.com", "http://example.com"],
    ["HTTPS://example.com", "HTTPS://example.com"],
    ["./relative.md", "./relative.md"],
    ["/absolute/path.md", "/absolute/path.md"],
    ["#anchor", "#anchor"],
    ["?q=1:2", "?q=1:2"],
    ["javascript:alert(1)", ""],
    ["JaVaScRiPt:alert(1)", ""],
    ["mailto:a@b.c", ""],
    ["ircs://example.com", ""],
    ["xmpp:a@b.c", ""],
    ["data:text/html;base64,PHNjcmlwdD4=", ""],
    ["file:///etc/passwd", ""],
  ];
  for (const [input, expected] of cases) {
    it(`maps ${JSON.stringify(input)} to ${JSON.stringify(expected)}`, () => {
      expect(safeUrlTransform(input)).toBe(expected);
    });
  }
});
