import { getReleaseLine } from "./index";
import parse from "@changesets/parse";

const REPO = "remix-run/remix-react";
const changes: ChangeData[] = [
  {
    commit: "a085003",
    user: "Andarist",
    pull: 1613,
    repo: REPO,
  },
  {
    commit: "b085003",
    user: "chaance",
    pull: null,
    repo: REPO,
  },
  {
    commit: "c085003",
    user: "chaance",
    pull: 1618,
    repo: REPO,
  },
];

jest.mock("./get-github-info", (): typeof import("./get-github-info") => {
  // this is duplicated because jest.mock reordering things
  let repo = "remix-run/remix-react";
  let changes = [
    {
      commit: "a085003",
      user: "Andarist",
      pull: 1613,
      repo,
    },
    {
      commit: "b085003",
      user: "chaance",
      pull: null,
      repo,
    },
    {
      commit: "c085003",
      user: "chaance",
      pull: 1618,
      repo,
    },
  ];
  return {
    async getInfo({ commit, repo }) {
      // let { changes } = getFakeChangeData();
      let data = changes.find((c) => c.commit === commit)!;
      expect(data).toBeDefined();
      expect(commit).toBe(data.commit);
      expect(repo).toBe(data.repo);
      return {
        pull: data.pull,
        user: data.user,
        links: {
          user: `[@${data.user}](https://github.com/${data.user})`,
          pull:
            data.pull != null
              ? `[#${data.pull}](https://github.com/${data.repo}/pull/${data.pull})`
              : null,
          commit: `[\`${data.commit}\`](https://github.com/${data.repo}/commit/${data.commit})`,
        },
      };
    },
    async getInfoFromPullRequest({ pull, repo }) {
      // let { changes } = getFakeChangeData();
      let data = changes.find((c) => c.pull === pull)!;
      expect(data).toBeDefined();
      expect(pull).toBe(data.pull);
      expect(repo).toBe(data.repo);
      return {
        commit: data.commit,
        user: data.user,
        links: {
          user: `[@${data.user}](https://github.com/${data.user})`,
          pull: `[#${data.pull}](https://github.com/${data.repo}/pull/${data.pull})`,
          commit: `[\`${data.commit}\`](https://github.com/${data.repo}/commit/${data.commit})`,
        },
      };
    },
  };
});

let changeData = changes[0];
let changeDataWithoutPullRequest = changes[1];

describe.each([changeData.commit, "wrongcommit", undefined])(
  "with commit from changeset of %s",
  (commitFromChangeset) => {
    describe.each(["pr", "pull request", "pull"])(
      "override pr with %s keyword",
      (keyword) => {
        test.each(["with #", "without #"] as const)("%s", async (kind) => {
          expect(
            await getReleaseLine(
              ...getChangeset(
                "something",
                `${keyword}: ${kind === "with #" ? "#" : ""}${changeData.pull}`,
                commitFromChangeset
              )
            )
          ).toEqual(
            `- something ([#1613](https://github.com/remix-run/remix-react/pull/1613))`
          );
        });
      }
    );
    it("overrides commit with commit keyword", async () => {
      expect(
        await getReleaseLine(
          ...getChangeset(
            "something",
            `commit: ${changeData.commit}`,
            commitFromChangeset
          )
        )
      ).toEqual(
        `- something ([#1613](https://github.com/remix-run/remix-react/pull/1613))`
      );
    });
  }
);

test("with multiple authors", async () => {
  expect(
    await getReleaseLine(
      ...getChangeset(
        "something",
        ["author: @Andarist", "author: @mitchellhamilton"].join("\n"),
        changeData.commit
      )
    )
  ).toMatchInlineSnapshot(
    '"- something ([#1613](https://github.com/remix-run/remix-react/pull/1613))"'
  );
});

test("change without a pull request", async () => {
  expect(
    await getReleaseLine(
      ...getChangeset(
        "something",
        "author: @chaance",
        changeDataWithoutPullRequest.commit
      )
    )
  ).toMatchInlineSnapshot(
    '"- something ([`b085003`](https://github.com/remix-run/remix-react/commit/b085003))"'
  );
});

test("with multiple changesets", async () => {
  let lines = await Promise.all([
    getReleaseLine(
      ...getChangeset("something", "author: @Andarist", changeData.commit)
    ),
    getReleaseLine(
      ...getChangeset(
        "something else",
        "author: @chaance",
        changeDataWithoutPullRequest.commit
      )
    ),
    getReleaseLine(
      ...getChangeset(
        "and one more thing",
        "author: @chaance",
        changes[2].commit
      )
    ),
  ]);

  expect(lines.join("\n")).toMatchInlineSnapshot(`
    "- something ([#1613](https://github.com/remix-run/remix-react/pull/1613))
    - something else ([\`b085003\`](https://github.com/remix-run/remix-react/commit/b085003))
    - and one more thing ([#1618](https://github.com/remix-run/remix-react/pull/1618))"
  `);
});

function getChangeset(
  message: string,
  content: string,
  commit: string | undefined
) {
  return [
    {
      ...parse(
        `---
    pkg: "minor"
    ---
    ${message}
    ${content}
    `
      ),
      id: "some-id",
      commit,
    },
    "minor",
    { repo: REPO },
  ] as const;
}

interface ChangeData {
  user: string;
  repo: string;
  commit: string;
  pull: number | null;
}
