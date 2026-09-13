import { access } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { loadCatalog, profileAbilities } from "./catalog.mjs";
import { readJson } from "./io.mjs";
import { handlers } from "./executor.mjs";
import { homePaths, projectPaths, runtimeModule } from "./paths.mjs";
import { loadInstallation } from "./installation.mjs";

function projectConfigError(message) {
  return Object.assign(new Error(message), { code: "kujo_project_config_invalid" });
}

export async function loadProjectConfig(project = process.cwd(), catalog = null) {
  const paths = projectPaths(project); const projectConfig = await readJson(paths.config, null);
  if (!projectConfig || projectConfig.schema !== "kujo.cmd.config/v1") throw projectConfigError(`Kujo CMD is not configured for ${paths.root}; run 'kujo-cmd setup'`);
  const loadedCatalog = catalog || await loadCatalog();
  const installation = await loadInstallation(loadedCatalog);
  const allowed = new Set(["schema", "version", "profile", "enabled", "disabled", "installation_version", "installed_at", "updated_at"]);
  for (const key of Object.keys(projectConfig)) if (!allowed.has(key)) throw projectConfigError(`untrusted Kujo CMD project configuration field: ${key}`);
  if (projectConfig.version !== installation.version || projectConfig.installation_version !== installation.version) throw projectConfigError("Kujo CMD project and trusted installation versions do not match; run 'kujo-cmd update'");
  if (!Array.isArray(projectConfig.enabled) || !Array.isArray(projectConfig.disabled)) throw projectConfigError("Kujo CMD project Ability overrides are invalid");
  if (!loadedCatalog.profiles.some((profile) => profile.id === projectConfig.profile)) throw projectConfigError("Kujo CMD project profile is unknown");
  if (![...projectConfig.enabled, ...projectConfig.disabled].every((id) => typeof id === "string" && loadedCatalog.abilities.some((ability) => ability.definition.id === id))) throw projectConfigError("Kujo CMD project Ability overrides contain unknown identifiers");
  return { config: { ...projectConfig, ...installation, receiptsPath: homePaths().receipts }, projectConfig, installation, paths };
}

export async function createApp(project = process.cwd()) {
  await access(runtimeModule);
  const { LocalAbilityRuntime, FileAbilityState } = await import(pathToFileURL(runtimeModule));
  const catalog = await loadCatalog(); const { config, paths } = await loadProjectConfig(project, catalog);
  const selected = profileAbilities(catalog, config.profile, config.enabled, config.disabled);
  let adapterHandlers = {};
  const abilities = selected.map((item) => ({ ...item, handler: (input, context) => adapterHandlers[item.adapter](input, context), handlerId: `${item.definition.id}.canonical-cli` }));
  const home = homePaths();
  const runtime = new LocalAbilityRuntime({ abilities, profiles: catalog.profiles, profileId: config.profile, state: new FileAbilityState({ statePath: home.state, receiptsPath: home.receipts }) });
  adapterHandlers = handlers({ config: { ...config, receiptsPath: home.receipts }, project: paths.root, runtime });
  return { catalog, config, paths, runtime };
}
