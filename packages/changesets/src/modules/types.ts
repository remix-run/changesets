import type { PreState, VersionType, NewChangeset } from "@changesets/types";

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
