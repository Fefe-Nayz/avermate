import { describe, expect, test } from "bun:test";
import {
  BillingTestModeError,
  TestModeBillingAdapter,
} from "./test-mode-adapter";

const secret = "test-mode-billing-fixture-secret-00000001";

describe("test-mode billing adapter", () => {
  test("never returns a provider or money-moving URL", async () => {
    const adapter = new TestModeBillingAdapter(secret);
    const checkout = await adapter.createCheckout({
      accountId: "account-a",
      offerReference: "offer-test",
      returnUrl: "https://avermate.fr/settings/managed",
      state: "state-1",
    });
    const portal = await adapter.createPortal({
      accountId: "account-a",
      returnUrl: "https://avermate.fr/settings/managed",
      state: "state-1",
    });
    expect(new URL(checkout.url).hostname).toBe("billing-test.invalid");
    expect(new URL(portal.url).hostname).toBe("billing-test.invalid");
  });

  test("verifies a bounded signed fixture and rejects tampering", async () => {
    const adapter = new TestModeBillingAdapter(secret);
    const raw = new TextEncoder().encode(
      JSON.stringify({
        id: "event-1",
        type: "subscription.updated",
        createdAt: "2026-08-22T12:00:00.000Z",
        data: { subscriptionReference: "test_subscription_1" },
      }),
    );
    const headers = new Headers({
      "x-avermate-test-signature": adapter.signFixture(raw),
    });
    await expect(adapter.verifyWebhook(raw, headers)).resolves.toMatchObject({
      externalId: "event-1",
      type: "subscription.updated",
    });
    raw[0] = 0;
    await expect(adapter.verifyWebhook(raw, headers)).rejects.toBeInstanceOf(
      BillingTestModeError,
    );
  });

  test("rejects oversized callback bodies before parsing", async () => {
    const adapter = new TestModeBillingAdapter(secret);
    const raw = new Uint8Array(256 * 1024 + 1);
    await expect(adapter.verifyWebhook(raw, new Headers())).rejects.toThrow(
      "TEST_BILLING_WEBHOOK_SIZE_INVALID",
    );
  });
});
