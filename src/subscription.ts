import { requireMethod } from "./clients.js";

export interface SubscriptionStatus {
  active: boolean;
  owner?: string;
  planType?: unknown;
  prepaidUsdc?: string;
  validUntil?: string;
  jobCount?: number;
  message?: string;
}

export async function readSubscriptionStatus(
  solana: Record<string, unknown>
): Promise<SubscriptionStatus> {
  const readSubscription = requireMethod<[], Promise<Record<string, unknown> | null>>(solana, "readSubscription");

  try {
    const subscription = await readSubscription();

    if (!subscription) {
      return {
        active: false,
        message:
          "No active subscription found. Run `npm run provision -- subscribe` (or molpha-provision bootstrap) with OWNER_KEYPAIR before creating jobs."
      };
    }

    const validUntil = BigInt(String(subscription.validUntil ?? 0));
    const now = BigInt(Math.floor(Date.now() / 1000));
    const active = validUntil > now;

    return {
      active,
      owner: subscription.owner?.toString?.() ?? String(subscription.owner ?? ""),
      planType: subscription.planType,
      prepaidUsdc: String(subscription.prepaidUsdc ?? ""),
      validUntil: validUntil.toString(),
      jobCount: Number(subscription.jobCount ?? 0),
      ...(active ? {} : { message: "Subscription expired. Extend via the bootstrap CLI before creating jobs." })
    };
  } catch (error) {
    return {
      active: false,
      message: error instanceof Error ? error.message : String(error)
    };
  }
}

export async function assertActiveSubscription(solana: Record<string, unknown>): Promise<SubscriptionStatus> {
  const status = await readSubscriptionStatus(solana);

  if (!status.active) {
    throw new Error(status.message ?? "Subscription is inactive or missing");
  }

  return status;
}
