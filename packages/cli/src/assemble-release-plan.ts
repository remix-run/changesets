import * as semver from "semver";
import type {
  Config,
  DependencyType,
  Linked,
  NewChangeset,
  PackageGroup,
  PackageJSON,
  PreState,
  ReleasePlan,
  VersionType,
} from "@changesets/types";
import { incrementVersion } from "./increment-version";
import { InternalError } from "@changesets/errors";
import type { Packages, Package } from "@manypkg/get-packages";
import { getDependentsGraph } from "./get-dependents-graph";
import type { InternalRelease, PreInfo } from "./types";

function getPreVersion(version: string) {
  let parsed = semver.parse(version)!;
  let preVersion =
    parsed.prerelease[1] === undefined ? -1 : parsed.prerelease[1];
  if (typeof preVersion !== "number") {
    throw new InternalError("preVersion is not a number");
  }
  preVersion++;
  return preVersion;
}

function getSnapshotSuffix(
  template: Config["snapshot"]["prereleaseTemplate"],
  snapshotParameters: SnapshotReleaseParameters
): string {
  let snapshotRefDate = new Date();

  const placeholderValues = {
    commit: snapshotParameters.commit,
    tag: snapshotParameters.tag,
    timestamp: snapshotRefDate.getTime().toString(),
    datetime: snapshotRefDate
      .toISOString()
      .replace(/\.\d{3}Z$/, "")
      .replace(/[^\d]/g, ""),
  };

  // We need a special handling because we need to handle a case where `--snapshot` is used without any template,
  // and the resulting version needs to be composed without a tag.
  if (!template) {
    return [placeholderValues.tag, placeholderValues.datetime]
      .filter(Boolean)
      .join("-");
  }

  const placeholders = Object.keys(placeholderValues) as Array<
    keyof typeof placeholderValues
  >;

  if (!template.includes(`{tag}`) && placeholderValues.tag !== undefined) {
    throw new Error(
      `Failed to compose snapshot version: "{tag}" placeholder is missing, but the snapshot parameter is defined (value: '${placeholderValues.tag}')`
    );
  }

  return placeholders.reduce((prev, key) => {
    return prev.replace(new RegExp(`\\{${key}\\}`, "g"), () => {
      const value = placeholderValues[key];
      if (value === undefined) {
        throw new Error(
          `Failed to compose snapshot version: "{${key}}" placeholder is used without having a value defined!`
        );
      }

      return value;
    });
  }, template);
}

function getSnapshotVersion(
  release: InternalRelease,
  preInfo: PreInfo | undefined,
  useCalculatedVersion: boolean,
  snapshotSuffix: string
): string {
  if (release.type === "none") {
    return release.oldVersion;
  }

  /**
   * Using version as 0.0.0 so that it does not hinder with other version release
   * For example;
   * if user has a regular pre-release at 1.0.0-beta.0 and then you had a snapshot pre-release at 1.0.0-canary-git-hash
   * and a consumer is using the range ^1.0.0-beta, most people would expect that range to resolve to 1.0.0-beta.0
   * but it'll actually resolve to 1.0.0-canary-hash. Using 0.0.0 solves this problem because it won't conflict with other versions.
   *
   * You can set `snapshot.useCalculatedVersion` flag to true to use calculated versions if you don't care about the above problem.
   */
  const baseVersion = useCalculatedVersion
    ? incrementVersion(release, preInfo)
    : `0.0.0`;

  return `${baseVersion}-${snapshotSuffix}`;
}

function getNewVersion(
  release: InternalRelease,
  preInfo: PreInfo | undefined
): string {
  if (release.type === "none") {
    return release.oldVersion;
  }

  return incrementVersion(release, preInfo);
}

type OptionalProp<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;

export function assembleReleasePlan(
  changesets: NewChangeset[],
  packages: Packages,
  config: OptionalProp<Config, "snapshot">,
  // intentionally not using an optional parameter here so the result of `readPreState` has to be passed in here
  preState: PreState | undefined,
  // snapshot: undefined            ->  not using snaphot
  // snapshot: { tag: undefined }   ->  --snapshot (empty tag)
  // snapshot: { tag: "canary" }    ->  --snapshot canary
  snapshot?: SnapshotReleaseParameters | string | boolean
): ReleasePlan {
  // TODO: remove `refined*` in the next major version of this package
  // just use `config` and `snapshot` parameters directly, typed as: `config: Config, snapshot?: SnapshotReleaseParameters`
  const refinedConfig: Config = config.snapshot
    ? (config as Config)
    : {
        ...config,
        snapshot: {
          prereleaseTemplate: null,
          useCalculatedVersion: (
            config.___experimentalUnsafeOptions_WILL_CHANGE_IN_PATCH as any
          ).useCalculatedVersionForSnapshots,
        },
      };
  const refinedSnapshot: SnapshotReleaseParameters | undefined =
    typeof snapshot === "string"
      ? { tag: snapshot }
      : typeof snapshot === "boolean"
      ? { tag: undefined }
      : snapshot;

  let packagesByName = new Map(
    packages.packages.map((x) => [x.packageJson.name, x])
  );

  const relevantChangesets = getRelevantChangesets(
    changesets,
    refinedConfig.ignore,
    preState
  );

  const preInfo = getPreInfo(
    changesets,
    packagesByName,
    refinedConfig,
    preState
  );

  // releases is, at this point a list of all packages we are going to releases,
  // flattened down to one release per package, having a reference back to their
  // changesets, and with a calculated new versions
  let releases = flattenReleases(
    relevantChangesets,
    packagesByName,
    refinedConfig.ignore
  );

  let dependencyGraph = getDependentsGraph(packages, {
    bumpVersionsWithWorkspaceProtocolOnly:
      refinedConfig.bumpVersionsWithWorkspaceProtocolOnly,
  });

  let releasesValidated = false;
  while (releasesValidated === false) {
    // The map passed in to determineDependents will be mutated
    let dependentAdded = determineDependents({
      releases,
      packagesByName,
      dependencyGraph,
      preInfo,
      config: refinedConfig,
    });

    // `releases` might get mutated here
    let fixedConstraintUpdated = matchFixedConstraint(
      releases,
      packagesByName,
      refinedConfig
    );
    let linksUpdated = applyLinks(
      releases,
      packagesByName,
      refinedConfig.linked
    );

    releasesValidated =
      !linksUpdated && !dependentAdded && !fixedConstraintUpdated;
  }

  if (preInfo?.state.mode === "exit") {
    for (let pkg of packages.packages) {
      // If a package had a prerelease, but didn't trigger a version bump in the regular release,
      // we want to give it a patch release.
      // Detailed explanation at https://github.com/changesets/changesets/pull/382#discussion_r434434182
      if (preInfo.preVersions.get(pkg.packageJson.name) !== 0) {
        const existingRelease = releases.get(pkg.packageJson.name);
        if (!existingRelease) {
          releases.set(pkg.packageJson.name, {
            name: pkg.packageJson.name,
            type: "patch",
            oldVersion: pkg.packageJson.version,
            changesets: [],
          });
        } else if (
          existingRelease.type === "none" &&
          !refinedConfig.ignore.includes(pkg.packageJson.name)
        ) {
          existingRelease.type = "patch";
        }
      }
    }
  }

  // Caching the snapshot version here and use this if it is snapshot release
  const snapshotSuffix =
    refinedSnapshot &&
    getSnapshotSuffix(
      refinedConfig.snapshot.prereleaseTemplate,
      refinedSnapshot
    );

  return {
    changesets: relevantChangesets,
    releases: [...releases.values()].map((incompleteRelease) => {
      return {
        ...incompleteRelease,
        newVersion: snapshotSuffix
          ? getSnapshotVersion(
              incompleteRelease,
              preInfo,
              refinedConfig.snapshot.useCalculatedVersion,
              snapshotSuffix
            )
          : getNewVersion(incompleteRelease, preInfo),
      };
    }),
    preState: preInfo?.state,
  };
}

function getRelevantChangesets(
  changesets: NewChangeset[],
  ignored: Readonly<string[]>,
  preState: PreState | undefined
): NewChangeset[] {
  for (const changeset of changesets) {
    // Using the following 2 arrays to decide whether a changeset
    // contains both ignored and not ignored packages
    const ignoredPackages = [];
    const notIgnoredPackages = [];
    for (const release of changeset.releases) {
      if (
        ignored.find(
          (ignoredPackageName) => ignoredPackageName === release.name
        )
      ) {
        ignoredPackages.push(release.name);
      } else {
        notIgnoredPackages.push(release.name);
      }
    }

    if (ignoredPackages.length > 0 && notIgnoredPackages.length > 0) {
      throw new Error(
        `Found mixed changeset ${changeset.id}\n` +
          `Found ignored packages: ${ignoredPackages.join(" ")}\n` +
          `Found not ignored packages: ${notIgnoredPackages.join(" ")}\n` +
          "Mixed changesets that contain both ignored and not ignored packages are not allowed"
      );
    }
  }

  if (preState && preState.mode !== "exit") {
    let usedChangesetIds = new Set(preState.changesets);
    return changesets.filter(
      (changeset) => !usedChangesetIds.has(changeset.id)
    );
  }

  return changesets;
}

function getHighestPreVersion(
  packageGroup: PackageGroup,
  packagesByName: Map<string, Package>
): number {
  let highestPreVersion = 0;
  for (let pkg of packageGroup) {
    highestPreVersion = Math.max(
      getPreVersion(packagesByName.get(pkg)!.packageJson.version),
      highestPreVersion
    );
  }
  return highestPreVersion;
}

function getPreInfo(
  changesets: NewChangeset[],
  packagesByName: Map<string, Package>,
  config: Config,
  preState: PreState | undefined
): PreInfo | undefined {
  if (preState === undefined) {
    return;
  }

  let updatedPreState = {
    ...preState,
    changesets: changesets.map((changeset) => changeset.id),
    initialVersions: {
      ...preState.initialVersions,
    },
  };

  for (const [, pkg] of packagesByName) {
    if (updatedPreState.initialVersions[pkg.packageJson.name] === undefined) {
      updatedPreState.initialVersions[pkg.packageJson.name] =
        pkg.packageJson.version;
    }
  }
  // Populate preVersion
  // preVersion is the map between package name and its next pre version number.
  let preVersions = new Map<string, number>();
  for (const [, pkg] of packagesByName) {
    preVersions.set(
      pkg.packageJson.name,
      getPreVersion(pkg.packageJson.version)
    );
  }
  for (let fixedGroup of config.fixed) {
    let highestPreVersion = getHighestPreVersion(fixedGroup, packagesByName);
    for (let fixedPackage of fixedGroup) {
      preVersions.set(fixedPackage, highestPreVersion);
    }
  }
  for (let linkedGroup of config.linked) {
    let highestPreVersion = getHighestPreVersion(linkedGroup, packagesByName);
    for (let linkedPackage of linkedGroup) {
      preVersions.set(linkedPackage, highestPreVersion);
    }
  }

  return {
    state: updatedPreState,
    preVersions,
  };
}

/////////////////////////////////////////////////////////////////////

export function getHighestReleaseType(
  releases: InternalRelease[]
): VersionType {
  if (releases.length === 0) {
    throw new Error(
      `Large internal Changesets error when calculating highest release type in the set of releases. Please contact the maintainers`
    );
  }

  let highestReleaseType: VersionType = "none";

  for (let release of releases) {
    switch (release.type) {
      case "major":
        return "major";
      case "minor":
        highestReleaseType = "minor";
        break;
      case "patch":
        if (highestReleaseType === "none") {
          highestReleaseType = "patch";
        }
        break;
    }
  }

  return highestReleaseType;
}

export function getCurrentHighestVersion(
  packageGroup: PackageGroup,
  packagesByName: Map<string, Package>
): string {
  let highestVersion: string | undefined;

  for (let pkgName of packageGroup) {
    let pkg = packagesByName.get(pkgName);

    if (!pkg) {
      console.error(
        `FATAL ERROR IN CHANGESETS! We were unable to version for package group: ${pkgName} in package group: ${packageGroup.toString()}`
      );
      throw new Error(`fatal: could not resolve linked packages`);
    }

    if (
      highestVersion === undefined ||
      semver.gt(pkg.packageJson.version, highestVersion)
    ) {
      highestVersion = pkg.packageJson.version;
    }
  }

  return highestVersion!;
}

/////////////////////////////////////////////////////////////////////

function matchFixedConstraint(
  releases: Map<string, InternalRelease>,
  packagesByName: Map<string, Package>,
  config: Config
): boolean {
  let updated = false;

  for (let fixedPackages of config.fixed) {
    let releasingFixedPackages = [...releases.values()].filter(
      (release) =>
        fixedPackages.includes(release.name) && release.type !== "none"
    );

    if (releasingFixedPackages.length === 0) continue;

    let highestReleaseType = getHighestReleaseType(releasingFixedPackages);
    let highestVersion = getCurrentHighestVersion(
      fixedPackages,
      packagesByName
    );

    // Finally, we update the packages so all of them are on the highest version
    for (let pkgName of fixedPackages) {
      if (config.ignore.includes(pkgName)) {
        continue;
      }
      let release = releases.get(pkgName);

      if (!release) {
        updated = true;
        releases.set(pkgName, {
          name: pkgName,
          type: highestReleaseType,
          oldVersion: highestVersion,
          changesets: [],
        });
        continue;
      }

      if (release.type !== highestReleaseType) {
        updated = true;
        release.type = highestReleaseType;
      }
      if (release.oldVersion !== highestVersion) {
        updated = true;
        release.oldVersion = highestVersion;
      }
    }
  }

  return updated;
}

/////////////////////////////////////////////////////////////////////

function flattenReleases(
  changesets: NewChangeset[],
  packagesByName: Map<string, Package>,
  ignoredPackages: Readonly<string[]>
): Map<string, InternalRelease> {
  let releases: Map<string, InternalRelease> = new Map();

  changesets.forEach((changeset) => {
    changeset.releases
      // Filter out ignored packages because they should not trigger a release
      // If their dependencies need updates, they will be added to releases by `determineDependents()` with release type `none`
      .filter(({ name }) => !ignoredPackages.includes(name))
      .forEach(({ name, type }) => {
        let release = releases.get(name);
        let pkg = packagesByName.get(name);
        if (!pkg) {
          throw new Error(
            `"${changeset.id}" changeset mentions a release for a package "${name}" but such a package could not be found.`
          );
        }
        if (!release) {
          release = {
            name,
            type,
            oldVersion: pkg.packageJson.version,
            changesets: [changeset.id],
          };
        } else {
          if (
            type === "major" ||
            ((release.type === "patch" || release.type === "none") &&
              (type === "minor" || type === "patch"))
          ) {
            release.type = type;
          }
          // Check whether the bumpType will change
          // If the bumpType has changed recalc newVersion
          // push new changeset to releases
          release.changesets.push(changeset.id);
        }

        releases.set(name, release);
      });
  });

  return releases;
}

/////////////////////////////////////////////////////////////////////

/**
 * WARNING: Important note for understanding how this package works:
 *
 * We are doing some kind of wacky things with manipulating the objects within
 * the releases array, despite the fact that this was passed to us as an
 * argument. We are aware that this is generally bad practice, but have decided
 * to to this here as we control the entire flow of releases.
 *
 * We could solve this by inlining this function, or by returning a deep-cloned
 * then modified array, but we decided both of those are worse than this
 * solution.
 */
function determineDependents({
  releases,
  packagesByName,
  dependencyGraph,
  preInfo,
  config,
}: {
  releases: Map<string, InternalRelease>;
  packagesByName: Map<string, Package>;
  dependencyGraph: Map<string, string[]>;
  preInfo: PreInfo | undefined;
  config: Config;
}): boolean {
  let updated = false;
  // NOTE this is intended to be called recursively
  let pkgsToSearch = [...releases.values()];

  while (pkgsToSearch.length > 0) {
    // nextRelease is our dependency, think of it as "avatar"
    const nextRelease = pkgsToSearch.shift();
    if (!nextRelease) continue;
    // pkgDependents will be a list of packages that depend on nextRelease ie. ['avatar-group', 'comment']
    const pkgDependents = dependencyGraph.get(nextRelease.name);
    if (!pkgDependents) {
      throw new Error(
        `Error in determining dependents - could not find package in repository: ${nextRelease.name}`
      );
    }

    for (let dependent of pkgDependents) {
      let type: VersionType | undefined;

      const dependentPackage = packagesByName.get(dependent);
      if (!dependentPackage) throw new Error("Dependency map is incorrect");

      if (config.ignore.includes(dependent)) {
        type = "none";
      } else {
        const dependencyVersionRanges = getDependencyVersionRanges(
          dependentPackage.packageJson,
          nextRelease
        );

        for (const { depType, versionRange } of dependencyVersionRanges) {
          if (nextRelease.type === "none") {
            continue;
          } else if (
            shouldBumpMajor({
              dependent,
              depType,
              versionRange,
              releases,
              nextRelease,
              preInfo,
              onlyUpdatePeerDependentsWhenOutOfRange:
                config.___experimentalUnsafeOptions_WILL_CHANGE_IN_PATCH
                  .onlyUpdatePeerDependentsWhenOutOfRange,
            })
          ) {
            type = "major";
          } else if (
            (!releases.has(dependent) ||
              releases.get(dependent)!.type === "none") &&
            (config.___experimentalUnsafeOptions_WILL_CHANGE_IN_PATCH
              .updateInternalDependents === "always" ||
              !semver.satisfies(
                incrementVersion(nextRelease, preInfo),
                versionRange
              ))
          ) {
            switch (depType) {
              case "dependencies":
              case "optionalDependencies":
              case "peerDependencies":
                if (type !== "major" && type !== "minor") {
                  type = "patch";
                }
                break;
              case "devDependencies": {
                // We don't need a version bump if the package is only in the devDependencies of the dependent package
                if (type !== "major" && type !== "minor" && type !== "patch") {
                  type = "none";
                }
              }
            }
          }
        }
      }
      if (releases.has(dependent) && releases.get(dependent)!.type === type) {
        type = undefined;
      }

      if (!type) {
        continue;
      }

      let name = dependent;
      let pkgJSON = dependentPackage.packageJson;

      // At this point, we know if we are making a change
      updated = true;

      const existing = releases.get(name);
      // For things that are being given a major bump, we check if we have already
      // added them here. If we have, we update the existing item instead of pushing it on to search.
      // It is safe to not add it to pkgsToSearch because it should have already been searched at the
      // largest possible bump type.

      if (existing && type === "major" && existing.type !== "major") {
        existing.type = "major";

        pkgsToSearch.push(existing);
      } else {
        let newDependent: InternalRelease = {
          name,
          type,
          oldVersion: pkgJSON.version,
          changesets: [],
        };

        pkgsToSearch.push(newDependent);
        releases.set(name, newDependent);
      }
    }

    //   .map((dependent) => {})
    //   .filter((dependentItem) => {})
    //   .forEach(({ name, type, pkgJSON }) => {});
  }

  return updated;
}

/**
 * Returns an array that can contain more than one elements in case a dependency
 * appears in multiple dependency lists. For example, a package that is both a
 * `peerDepenency` and a `devDependency`.
 */
function getDependencyVersionRanges(
  dependentPkgJSON: PackageJSON,
  dependencyRelease: InternalRelease
): {
  depType: DependencyType;
  versionRange: string;
}[] {
  const DEPENDENCY_TYPES = [
    "dependencies",
    "devDependencies",
    "peerDependencies",
    "optionalDependencies",
  ] as const;
  const dependencyVersionRanges: {
    depType: DependencyType;
    versionRange: string;
  }[] = [];
  for (const type of DEPENDENCY_TYPES) {
    const versionRange = dependentPkgJSON[type]?.[dependencyRelease.name];
    if (!versionRange) continue;

    if (versionRange.startsWith("workspace:")) {
      dependencyVersionRanges.push({
        depType: type,
        versionRange:
          // intentionally keep other workspace ranges untouched
          // this has to be fixed but this should only be done when adding appropriate tests
          versionRange === "workspace:*"
            ? // workspace:* actually means the current exact version, and not a wildcard similar to a reguler * range
              dependencyRelease.oldVersion
            : versionRange.replace(/^workspace:/, ""),
      });
    } else {
      dependencyVersionRanges.push({
        depType: type,
        versionRange,
      });
    }
  }
  return dependencyVersionRanges;
}

function shouldBumpMajor({
  dependent,
  depType,
  versionRange,
  releases,
  nextRelease,
  preInfo,
  onlyUpdatePeerDependentsWhenOutOfRange,
}: {
  dependent: string;
  depType: DependencyType;
  versionRange: string;
  releases: Map<string, InternalRelease>;
  nextRelease: InternalRelease;
  preInfo: PreInfo | undefined;
  onlyUpdatePeerDependentsWhenOutOfRange: boolean;
}) {
  // we check if it is a peerDependency because if it is, our dependent bump type might need to be major.
  return (
    depType === "peerDependencies" &&
    nextRelease.type !== "none" &&
    nextRelease.type !== "patch" &&
    // 1. If onlyUpdatePeerDependentsWhenOutOfRange set to true, bump major if the version is leaving the range.
    // 2. If onlyUpdatePeerDependentsWhenOutOfRange set to false, bump major regardless whether or not the version is leaving the range.
    (!onlyUpdatePeerDependentsWhenOutOfRange ||
      !semver.satisfies(
        incrementVersion(nextRelease, preInfo),
        versionRange
      )) &&
    // bump major only if the dependent doesn't already has a major release.
    (!releases.has(dependent) ||
      (releases.has(dependent) && releases.get(dependent)!.type !== "major"))
  );
}

function applyLinks(
  releases: Map<string, InternalRelease>,
  packagesByName: Map<string, Package>,
  linked: Linked
): boolean {
  let updated = false;

  // We do this for each set of linked packages
  for (let linkedPackages of linked) {
    // First we filter down to all the relevant releases for one set of linked packages
    let releasingLinkedPackages = [...releases.values()].filter(
      (release) =>
        linkedPackages.includes(release.name) && release.type !== "none"
    );

    // If we proceed any further we do extra work with calculating highestVersion for things that might
    // not need one, as they only have workspace based packages
    if (releasingLinkedPackages.length === 0) continue;

    let highestReleaseType = getHighestReleaseType(releasingLinkedPackages);
    let highestVersion = getCurrentHighestVersion(
      linkedPackages,
      packagesByName
    );

    // Finally, we update the packages so all of them are on the highest version
    for (let linkedPackage of releasingLinkedPackages) {
      if (linkedPackage.type !== highestReleaseType) {
        updated = true;
        linkedPackage.type = highestReleaseType;
      }
      if (linkedPackage.oldVersion !== highestVersion) {
        updated = true;
        linkedPackage.oldVersion = highestVersion;
      }
    }
  }

  return updated;
}

interface SnapshotReleaseParameters {
  tag?: string | undefined;
  commit?: string | undefined;
}
