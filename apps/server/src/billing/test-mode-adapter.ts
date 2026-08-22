import { createHmac, timingSafeEqual } from "node:crypto";
import type { BillingAdapter } from "@avermate/agent-contracts";
import { z } from "zod";

const testEventSchema = z.strictObject({
  id: z.string().trim().min(1).max(256),
  type: z.string().trim().min(1).max(128),
  createdAt: z.string().datetime(),
  data: z.unknown(),
});

const MAX_TEST_WEBHOOK_BYTES = 256 * 1024;

export class BillingTestModeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BillingTestModeError";
  }
}

/**
 * Deterministic provider-contract fixture. It can exercise signed callbacks and
 * return-state handling, but every navigation target uses the reserved
 * `.invalid` domain and therefore cannot move money or reach a provider.
 */
export class TestModeBillingAdapter implements BillingAdapter {
  constructor(private readonly webhookSecret: string) {
    if (webhookSecret.length < 32) {
      throw new BillingTestModeError("TEST_BILLING_SECRET_TOO_SHORT");
    }
  }

  async createCheckout(input: {
    accountId: string;
    offerReference: string;
    returnUrl: string;
    state: string;
  }) {
    const reference = `test_checkout_${digest(
      this.webhookSecret,
      `${input.accountId}\0${input.offerReference}\0${input.state}`,
    ).slice(0, 24)}`;
    return {
      reference,
      url: `https://billing-test.invalid/checkout/${reference}`,
    };
  }

  async createPortal(input: {
    accountId: string;
    returnUrl: string;
    state: string;
  }) {
    const reference = `test_portal_${digest(
      this.webhookSecret,
      `${input.accountId}\0${input.state}`,
    ).slice(0, 24)}`;
    return {
      reference,
      url: `https://billing-test.invalid/portal/${reference}`,
    };
  }

  async verifyWebhook(raw: Uint8Array, headers: Headers) {
    if (raw.byteLength === 0 || raw.byteLength > MAX_TEST_WEBHOOK_BYTES) {
      throw new BillingTestModeError("TEST_BILLING_WEBHOOK_SIZE_INVALID");
    }
    const supplied = headers.get("x-avermate-test-signature") ?? "";
    const expected = digest(this.webhookSecret, raw);
    const suppliedBytes = Buffer.from(supplied, "hex");
    const expectedBytes = Buffer.from(expected, "hex");
    if (
      suppliedBytes.length !== expectedBytes.length ||
      !timingSafeEqual(suppliedBytes, expectedBytes)
    ) {
      throw new BillingTestModeError("TEST_BILLING_SIGNATURE_INVALID");
    }
    const parsed = testEventSchema.parse(
      JSON.parse(new TextDecoder().decode(raw)),
    );
    return {
      externalId: parsed.id,
      type: parsed.type,
      payload: parsed,
    };
  }

  async getSubscription(reference: string) {
    if (!reference.startsWith("test_subscription_")) {
      throw new BillingTestModeError("TEST_BILLING_SUBSCRIPTION_UNKNOWN");
    }
    return { reference, status: "test-only" };
  }

  signFixture(raw: Uint8Array | string) {
    return digest(this.webhookSecret, raw);
  }
}

function digest(secret: string, value: Uint8Array | string) {
  return createHmac("sha256", secret).update(value).digest("hex");
}
