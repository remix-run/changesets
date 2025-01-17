import fs from "fs-extra";
import path from "path";
import parse from "@changesets/parse";
import type { NewChangeset } from "./types";
import * as git from "./git";

async function filterChangesetsSinceRef(
  changesets: Array<string>,
  changesetBase: string,
  sinceRef: string
) {
  const newChangesets = await git.getChangedChangesetFilesSinceRef({
    cwd: changesetBase,
    ref: sinceRef,
  });
  const newHashes = newChangesets.map((c) => c.split("/")[1]);

  return changesets.filter((dir) => newHashes.includes(dir));
}

export async function getChangesets(
  cwd: string,
  sinceRef?: string
): Promise<Array<NewChangeset>> {
  let changesetBase = path.join(cwd, ".changeset");
  let contents: string[];
  try {
    contents = await fs.readdir(changesetBase);
  } catch (err) {
    if ((err as any).code === "ENOENT") {
      throw new Error("There is no .changeset directory in this project");
    }
    throw err;
  }

  if (sinceRef !== undefined) {
    contents = await filterChangesetsSinceRef(
      contents,
      changesetBase,
      sinceRef
    );
  }

  let changesets = contents.filter(
    (file) =>
      !file.startsWith(".") && file.endsWith(".md") && file !== "README.md"
  );

  const changesetContents = changesets.map(async (file) => {
    const changeset = await fs.readFile(
      path.join(changesetBase, file),
      "utf-8"
    );

    return { ...parse(changeset), id: file.replace(".md", "") };
  });
  return await Promise.all(changesetContents);
}
