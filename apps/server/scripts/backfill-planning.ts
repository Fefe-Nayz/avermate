import { backfillLegacyPlannerItems } from "../src/db/planning-backfill";

const result = await backfillLegacyPlannerItems();
console.log(JSON.stringify(result, null, 2));
