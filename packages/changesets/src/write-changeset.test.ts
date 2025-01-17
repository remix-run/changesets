import fs from "fs-extra";
import path from "path";
import parse from "@changesets/parse";
import { writeChangeset } from "./write-changeset";

import humanId from "human-id";
import { testdir } from "@changesets/test-utils";

jest.mock("human-id");

describe("simple project", () => {
  it("should write a changeset", async () => {
    const cwd = await testdir({
      "package.json": JSON.stringify({
        private: true,
        workspaces: ["packages/*"],
      }),
      "packages/pkg-a/package.json": JSON.stringify({
        name: "pkg-a",
        version: "1.0.0",
      }),
    });

    const changesetID = "ascii";
    // @ts-ignore
    humanId.mockReturnValueOnce(changesetID);

    await writeChangeset(
      {
        summary: "This is a summary",
        releases: [{ name: "pkg-a", type: "minor" }],
      },
      cwd
    );

    const mdPath = path.join(cwd, ".changeset", `${changesetID}.md`);
    const mdContent = await fs.readFile(mdPath, "utf-8");

    expect(parse(mdContent)).toEqual({
      summary: "This is a summary",
      releases: [{ name: "pkg-a", type: "minor" }],
    });
  });
  it("should write an empty changeset", async () => {
    const cwd = await testdir({
      "package.json": JSON.stringify({
        private: true,
        workspaces: ["packages/*"],
      }),
      "packages/pkg-a/package.json": JSON.stringify({
        name: "pkg-a",
        version: "1.0.0",
      }),
    });

    const changesetID = "ascii";
    // @ts-ignore
    humanId.mockReturnValueOnce(changesetID);

    await writeChangeset(
      {
        summary: "",
        releases: [],
      },
      cwd
    );

    const mdPath = path.join(cwd, ".changeset", `${changesetID}.md`);
    const mdContent = await fs.readFile(mdPath, "utf-8");

    expect(parse(mdContent)).toEqual({
      summary: "",
      releases: [],
    });
  });
});
