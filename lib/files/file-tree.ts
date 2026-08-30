export type FileTreeRow<TFile extends { path: string }> =
  | {
      key: string;
      kind: "folder";
      name: string;
      path: string;
      depth: number;
      ancestorPaths: string[];
    }
  | {
      key: string;
      kind: "file";
      name: string;
      depth: number;
      ancestorPaths: string[];
      file: TFile;
    };

export function folderPathsForFile(path: string) {
  const parts = path.split("/").slice(0, -1);
  return parts.map((_, index) => parts.slice(0, index + 1).join("/"));
}

export function buildFileTreeRows<TFile extends { path: string }>(
  files: TFile[],
): FileTreeRow<TFile>[] {
  type FolderNode = {
    folders: Map<string, FolderNode>;
    files: Array<{ name: string; file: TFile }>;
  };
  const root: FolderNode = { folders: new Map(), files: [] };
  for (const file of files) {
    const parts = file.path.split("/");
    const fileName = parts.pop() ?? file.path;
    let node = root;
    for (const folderName of parts) {
      let folder = node.folders.get(folderName);
      if (!folder) {
        folder = { folders: new Map(), files: [] };
        node.folders.set(folderName, folder);
      }
      node = folder;
    }
    node.files.push({ name: fileName, file });
  }

  const rows: FileTreeRow<TFile>[] = [];
  function visit(
    node: FolderNode,
    depth: number,
    parentPath: string,
    ancestorPaths: string[],
  ) {
    for (const [name, folder] of [...node.folders].sort(([left], [right]) =>
      left.localeCompare(right),
    )) {
      const path = parentPath ? `${parentPath}/${name}` : name;
      rows.push({
        key: `folder:${path}`,
        kind: "folder",
        name,
        path,
        depth,
        ancestorPaths,
      });
      visit(folder, depth + 1, path, [...ancestorPaths, path]);
    }
    for (const entry of [...node.files].sort((left, right) =>
      left.name.localeCompare(right.name),
    )) {
      rows.push({
        key: `file:${entry.file.path}`,
        kind: "file",
        name: entry.name,
        depth,
        ancestorPaths,
        file: entry.file,
      });
    }
  }
  visit(root, 0, "", []);
  return rows;
}

export function filterCollapsedFileTreeRows<TFile extends { path: string }>(
  rows: FileTreeRow<TFile>[],
  collapsedFolders: ReadonlySet<string>,
) {
  return rows.filter(
    (row) => !row.ancestorPaths.some((path) => collapsedFolders.has(path)),
  );
}
