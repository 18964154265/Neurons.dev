export type StaticPreviewFile = {
  path: string;
  content: string;
};

function normalizeReference(reference: string) {
  return (
    reference.split(/[?#]/, 1)[0]?.replace(/^\.\//, "").replace(/^\//, "") ?? ""
  );
}

function resolveSiblingPath(entryPath: string, reference: string) {
  const normalized = normalizeReference(reference);
  if (!normalized || normalized.includes("..") || /^[a-z]+:/i.test(reference)) {
    return null;
  }
  const directorySegments = reference.startsWith("/")
    ? []
    : entryPath.split("/").slice(0, -1);
  return [...directorySegments, ...normalized.split("/")]
    .filter((segment) => segment && segment !== ".")
    .join("/");
}

export function buildStaticPreview(files: StaticPreviewFile[]) {
  const fileMap = new Map(files.map((file) => [file.path, file.content]));
  const entryPath =
    ["index.html", "public/index.html", "src/index.html"].find((path) =>
      fileMap.has(path),
    ) ?? files.find((file) => file.path.endsWith(".html"))?.path;
  if (!entryPath) return null;

  let html = fileMap.get(entryPath) ?? "";
  html = html.replace(
    /<link\b([^>]*?)href=["']([^"']+)["']([^>]*)>/gi,
    (tag, before: string, href: string, after: string) => {
      if (!/rel=["']stylesheet["']/i.test(`${before}${after}`)) return tag;
      const path = resolveSiblingPath(entryPath, href);
      const css = path ? fileMap.get(path) : null;
      return css === undefined || css === null
        ? tag
        : `<style data-preview-path="${path}">\n${css}\n</style>`;
    },
  );
  html = html.replace(
    /<script\b([^>]*?)src=["']([^"']+)["']([^>]*)><\/script>/gi,
    (tag, before: string, src: string, after: string) => {
      const path = resolveSiblingPath(entryPath, src);
      const script = path ? fileMap.get(path) : null;
      return script === undefined || script === null
        ? tag
        : `<script${before}${after} data-preview-path="${path}">\n${script.replaceAll(
            "</script",
            "<\\/script",
          )}\n</script>`;
    },
  );

  const securityHead = [
    "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; font-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'\">",
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
  ].join("");
  html = /<head[\s>]/i.test(html)
    ? html.replace(/<head([^>]*)>/i, `<head$1>${securityHead}`)
    : `<!doctype html><html><head>${securityHead}</head><body>${html}</body></html>`;

  return { entryPath, srcDoc: html };
}
