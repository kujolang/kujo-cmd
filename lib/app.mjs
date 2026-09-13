import { access } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { loadCatalog, profileAbilities } from "./catalog.mjs";
import { readJson } from "./io.mjs";
import { handlers } from "./executor.mjs";
import { homePaths, projectPaths, runtimeModule } from "./paths.mjs";

export async function loadProjectConfig(project = process.cwd()) {
  const paths = projectPaths(project); const config = await readJson(paths.config, null);
  if (!config || config.schema !== "kujo.cmd.config/v1") throw new Error(`Kujo CMD is not configured for ${paths.root}; run 'kujo-cmd setup'`);
  return { config: { ...config, receiptsPath: homePaths().receipts }, paths };
}

export async function createApp(project = process.cwd()) {
  await access(runtimeModule);
  const { LocalAbilityRuntime, FileAbilityState } = await import(pathToFileURL(runtimeModule));
  const catalog = await loadCatalog(); const { config, paths } = await loadProjectConfig(project);
  const selected = profileAbilities(catalog, config.profile, config.enabled, config.disabled);
  let adapterHandlers = {};
  const abilities = selected.map((item) => ({ ...item, handler: (input, context) => adapterHandlers[item.adapter](input, context), handlerId: `${item.definition.id}.canonical-cli` }));
  const home = homePaths();
  const runtime = new LocalAbilityRuntime({ abilities, profiles: catalog.profiles, profileId: config.profile, state: new FileAbilityState({ statePath: home.state, receiptsPath: home.receipts }) });
  adapterHandlers = handlers({ config: { ...config, receiptsPath: home.receipts }, project: paths.root, runtime });
  return { catalog, config, paths, runtime };
}
