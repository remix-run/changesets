export interface CliOptions {
  sinceMaster?: boolean;
  verbose?: boolean;
  output?: string;
  otp?: string;
  empty?: boolean;
  since?: string;
  ignore?: string | string[];
  snapshot?: string | boolean;
  snapshotPrereleaseTemplate?: string;
  tag?: string;
  gitTag?: boolean;
  open?: boolean;
}

export interface CommandOptions extends CliOptions {
  cwd: string;
}

export interface InternalRelease {
  name: string;
  type: VersionType;
  oldVersion: string;
  changesets: string[];
}

export interface PreInfo {
  state: PreState;
  preVersions: Map<string, number>;
}

export interface RelevantChangesets {
  major: NewChangeset[];
  minor: NewChangeset[];
  patch: NewChangeset[];
}

export type VersionType = "major" | "minor" | "patch" | "none";

// NB: Bolt check uses a different dependnecy set to every other package.
// You need think before you use this.
export type DependencyType =
  | "dependencies"
  | "devDependencies"
  | "peerDependencies"
  | "optionalDependencies";

export type AccessType = "public" | "restricted";

export interface Release {
  name: string;
  type: VersionType;
}

// This is a release that has been modified to include all relevant information
// about releasing - it is calculated and doesn't make sense as an artefact
export interface ComprehensiveRelease {
  name: string;
  type: VersionType;
  oldVersion: string;
  newVersion: string;
  changesets: string[];
}

export interface Changeset {
  summary: string;
  releases: Array<Release>;
}

export interface NewChangeset extends Changeset {
  id: string;
}

export interface ReleasePlan {
  changesets: NewChangeset[];
  releases: ComprehensiveRelease[];
  preState: PreState | undefined;
}

export interface PackageJSON {
  name: string;
  version: string;
  dependencies?: { [key: string]: string };
  peerDependencies?: { [key: string]: string };
  devDependencies?: { [key: string]: string };
  optionalDependencies?: { [key: string]: string };
  resolutions?: { [key: string]: string };
  private?: boolean;
  publishConfig?: {
    access?: AccessType;
    directory?: string;
    registry?: string;
  };
}

export type PackageGroup = ReadonlyArray<string>;
export type Fixed = ReadonlyArray<PackageGroup>;
export type Linked = ReadonlyArray<PackageGroup>;

export interface PrivatePackages {
  version: boolean;
  tag: boolean;
}

export interface Config {
  changelog: false | readonly [string, any];
  commit: false | readonly [string, any];
  fixed: Fixed;
  linked: Linked;
  access: AccessType;
  baseBranch: string;
  /** Features enabled for Private packages */
  privatePackages: PrivatePackages;
  /** The minimum bump type to trigger automatic update of internal dependencies that are part of the same release */
  updateInternalDependencies: "patch" | "minor";
  ignore: ReadonlyArray<string>;
  /** This is supposed to be used with pnpm's `link-workspace-packages: false` and Berry's `enableTransparentWorkspaces: false` */
  bumpVersionsWithWorkspaceProtocolOnly?: boolean;
  ___experimentalUnsafeOptions_WILL_CHANGE_IN_PATCH: Omit<
    Required<ExperimentalOptions>,
    "useCalculatedVersionForSnapshots"
  >;
  snapshot: {
    useCalculatedVersion: boolean;
    prereleaseTemplate: string | null;
  };
}

export interface WrittenConfig {
  changelog?: false | readonly [string, any] | string;
  commit?: boolean | readonly [string, any] | string;
  fixed?: Fixed;
  linked?: Linked;
  access?: AccessType;
  baseBranch?: string;
  /** Opt in to tracking non-npm / private packages */
  privatePackages?:
    | false
    | {
        version?: boolean;
        tag?: boolean;
      };
  /** The minimum bump type to trigger automatic update of internal dependencies that are part of the same release */
  updateInternalDependencies?: "patch" | "minor";
  ignore?: ReadonlyArray<string>;
  bumpVersionsWithWorkspaceProtocolOnly?: boolean;
  snapshot?: {
    useCalculatedVersion?: boolean;
    prereleaseTemplate?: string;
  };
  ___experimentalUnsafeOptions_WILL_CHANGE_IN_PATCH?: ExperimentalOptions;
}

export type ExperimentalOptions = {
  onlyUpdatePeerDependentsWhenOutOfRange?: boolean;
  updateInternalDependents?: "always" | "out-of-range";
  /** @deprecated Since snapshot feature is now stable, you should migrate to use "snapshot.useCalculatedVersion". */
  useCalculatedVersionForSnapshots?: boolean;
};

export type NewChangesetWithCommit = NewChangeset & { commit?: string };

export type ModCompWithPackage = ComprehensiveRelease & {
  packageJson: PackageJSON;
  dir: string;
};

export interface ChangelogFunctions {
  getReleaseLine(
    changeset: NewChangesetWithCommit,
    type: VersionType,
    changelogOpts: null | Record<string, any>
  ): Promise<string>;
  getDependencyReleaseLine(
    changesets: NewChangesetWithCommit[],
    dependenciesUpdated: ModCompWithPackage[],
    changelogOpts: any
  ): Promise<string>;
}

export type GetAddMessage = (
  changeset: Changeset,
  commitOptions: any
) => Promise<string>;

export type GetVersionMessage = (
  releasePlan: ReleasePlan,
  commitOptions: any
) => Promise<string>;

export type CommitFunctions = {
  getAddMessage?: GetAddMessage;
  getVersionMessage?: GetVersionMessage;
};

export type PreState = {
  mode: "pre" | "exit";
  tag: string;
  initialVersions: {
    [pkgName: string]: string;
  };
  changesets: string[];
};
