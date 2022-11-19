import type { PreState, VersionType, NewChangeset } from "@changesets/types";

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

export type CommandOptions = CliOptions & {
  cwd: string;
};

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

export type RelevantChangesets = {
  major: NewChangeset[];
  minor: NewChangeset[];
  patch: NewChangeset[];
};
