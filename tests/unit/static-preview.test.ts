import { describe, expect, it } from "vitest";

import { buildStaticPreview } from "@/lib/preview/static-preview";

describe("static preview", () => {
  it("inlines project-local styles and scripts into an isolated document", () => {
    const preview = buildStaticPreview([
      {
        path: "index.html",
        content:
          '<html><head><link rel="stylesheet" href="styles.css"></head><body><script src="app.js"></script></body></html>',
      },
      { path: "styles.css", content: "body { color: tomato; }" },
      { path: "app.js", content: "document.body.dataset.ready = 'yes';" },
    ]);

    expect(preview?.entryPath).toBe("index.html");
    expect(preview?.srcDoc).toContain("Content-Security-Policy");
    expect(preview?.srcDoc).toContain("body { color: tomato; }");
    expect(preview?.srcDoc).toContain("document.body.dataset.ready");
    expect(preview?.srcDoc).not.toContain('src="app.js"');
  });

  it("returns null when the project has no HTML entry", () => {
    expect(
      buildStaticPreview([{ path: "src/app.ts", content: "export {};" }]),
    ).toBeNull();
  });

  it("resolves nested relative assets from the HTML directory", () => {
    const preview = buildStaticPreview([
      {
        path: "src/index.html",
        content: '<script src="assets/app.js"></script>',
      },
      { path: "src/assets/app.js", content: "window.previewReady = true;" },
    ]);

    expect(preview?.srcDoc).toContain("window.previewReady = true");
  });
});
