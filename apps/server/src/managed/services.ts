import { db } from "../db";
import { env } from "../lib/env";
import { EntitlementService } from "../entitlements/service";
import { UsageLedger } from "../usage/ledger";
import { PricingService } from "../usage/pricing";

let entitlementInstance: EntitlementService | undefined;
let usageInstance: UsageLedger | undefined;
let pricingInstance: PricingService | undefined;

export function managedEntitlements() {
  entitlementInstance ??= new EntitlementService(db.$client, {
    mode: env.MANAGED_ACCOUNTING_MODE,
    selfHost: env.AVERMATE_DEPLOYMENT_MODE === "full-self-host",
  });
  return entitlementInstance;
}

export function managedUsage() {
  usageInstance ??= new UsageLedger(db.$client, managedEntitlements());
  return usageInstance;
}

export function managedPricing() {
  pricingInstance ??= new PricingService(db.$client);
  return pricingInstance;
}
