import test from "node:test";
import assert from "node:assert/strict";
import { loadCatalog, profileAbilities } from "../lib/catalog.mjs";

test("portable profiles expose a growing catalog without changing installation", async () => {
  const catalog = await loadCatalog();
  assert.equal(catalog.sources.length, 14);
  const essentials = profileAbilities(catalog, "kujo.profile.essentials");
  const review = profileAbilities(catalog, "kujo.profile.review");
  const ship = profileAbilities(catalog, "kujo.profile.ship");
  const full = profileAbilities(catalog, "kujo.profile.full");
  assert.deepEqual([essentials.length, review.length, ship.length, full.length], [5, 9, 11, 14]);
  assert.equal(new Set(catalog.abilities.map((item) => item.definition.id)).size, catalog.abilities.length);
  for (const item of catalog.abilities) {
    assert.match(item.definition.id, /^[a-z0-9][a-z0-9.-]+$/);
    assert.ok(item.definition.effects.length);
    assert.equal(item.definition.input_schema.type, "object");
  }
});

test("ability overrides affect exposure, not the installed source catalog", async () => {
  const catalog = await loadCatalog();
  const active = profileAbilities(catalog, "kujo.profile.essentials", ["kujo.rag.knowledge.query"], ["kujo.patchbrief.changes.summarize"]);
  assert.ok(active.some((item) => item.definition.id === "kujo.rag.knowledge.query"));
  assert.ok(!active.some((item) => item.definition.id === "kujo.patchbrief.changes.summarize"));
  assert.equal(catalog.sources.length, 14);
});
