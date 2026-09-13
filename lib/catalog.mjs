import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { catalogDir } from "./paths.mjs";

async function json(name) { return JSON.parse(await readFile(join(catalogDir, name), "utf8")); }
export async function loadCatalog() { return { abilities: await json("abilities.json"), profiles: await json("profiles.json"), sources: (await json("sources.json")).sources }; }

export function profileAbilities(catalog, profileId, enabled = [], disabled = []) {
  const byId = new Map(catalog.profiles.map((profile) => [profile.id, profile]));
  if (!byId.has(profileId)) throw new Error(`unknown profile '${profileId}'`);
  const ids = new Set();
  const visit = (id, stack = new Set()) => {
    if (stack.has(id)) throw new Error(`profile inheritance cycle at '${id}'`);
    const profile = byId.get(id);
    if (!profile) throw new Error(`missing profile '${id}'`);
    const next = new Set(stack); next.add(id);
    for (const parent of profile.extends || []) visit(parent, next);
    for (const ability of profile.ability_ids) ids.add(ability);
  };
  visit(profileId);
  for (const id of enabled) ids.add(id);
  for (const id of disabled) ids.delete(id);
  return catalog.abilities.filter((ability) => ids.has(ability.definition.id));
}

export const skillForSource = {
  scout: "kujo-scout-workflows", scent: "kujo-scent-workflows", patchbrief: "kujo-patchbrief-workflows",
  changebucket: "kujo-changebucket-workflows", shipcheck: "kujo-shipcheck-workflows", dispatch: "kujo-dispatch-workflows",
  runledger: "kujo-runledger-workflows", watchdog: "kujo-watchdog-workflows", rag: "kujo-rag-workflows",
  fence: "kujo-fence-workflows", spec: "kujo-spec-workflows", eval: "kujo-eval-workflows",
};
