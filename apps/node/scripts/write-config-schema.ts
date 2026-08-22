import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import { nodeConfigSchema } from "../src/config";

const target = resolve(
  import.meta.dir,
  "../../../infra/node/config.schema.json",
);
const schema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://avermate.fr/schemas/avermate-node-config-v1.json",
  title: "Avermate Node configuration",
  description:
    "Public, non-secret configuration. Cross-field and host security checks are also enforced by the daemon's Zod schema.",
  ...z.toJSONSchema(nodeConfigSchema, { target: "draft-2020-12" }),
};

await mkdir(resolve(target, ".."), { recursive: true });
await writeFile(target, `${JSON.stringify(schema, null, 2)}\n`, "utf8");
console.log(target);
