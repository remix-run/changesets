import { assembleReleasePlan } from "./assemble-release-plan";
import { getChangesets } from "./get-changesets";
import { read } from "./config";
import type { Config, ReleasePlan } from "@changesets/types";
import { getPackages } from "@manypkg/get-packages";
import { readPreState } from "./pre";

export async function getReleasePlan(
  cwd: string,
  sinceRef?: string,
  passedConfig?: Config
): Promise<ReleasePlan> {
  const packages = await getPackages(cwd);
  const preState = await readPreState(cwd);
  const readConfig = await read(cwd, packages);
  const config = passedConfig ? { ...readConfig, ...passedConfig } : readConfig;
  const changesets = await getChangesets(cwd, sinceRef);

  return assembleReleasePlan(changesets, packages, config, preState);
}
