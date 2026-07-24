import {
  Configuration,
  CountryCode,
  PlaidApi,
  PlaidEnvironments,
  Products,
} from "plaid";

export type PlaidEnvName = "sandbox" | "development" | "production";

export function plaidEnvName(): PlaidEnvName {
  const raw = (process.env.PLAID_ENV || "sandbox").toLowerCase();
  if (raw === "development" || raw === "production" || raw === "sandbox") {
    return raw;
  }
  return "sandbox";
}

export function plaidConfigured(): boolean {
  return Boolean(process.env.PLAID_CLIENT_ID && process.env.PLAID_SECRET);
}

export function getPlaidClient(): PlaidApi {
  const clientId = process.env.PLAID_CLIENT_ID;
  const secret = process.env.PLAID_SECRET;
  if (!clientId || !secret) {
    throw new Error(
      "Missing PLAID_CLIENT_ID or PLAID_SECRET. Add them in Doppler from your Plaid dashboard.",
    );
  }

  const env = plaidEnvName();
  const configuration = new Configuration({
    basePath: PlaidEnvironments[env],
    baseOptions: {
      headers: {
        "PLAID-CLIENT-ID": clientId,
        "PLAID-SECRET": secret,
      },
    },
  });
  return new PlaidApi(configuration);
}

export const PLAID_PRODUCTS = [Products.Transactions];
export const PLAID_COUNTRY_CODES = [CountryCode.Us];

/** Plaid: positive = money out; our ledger: negative = outflow. */
export function plaidAmountToCents(amount: number): number {
  if (!Number.isFinite(amount)) return 0;
  const cents = -Math.round(amount * 100);
  return cents === 0 ? 0 : cents;
}

export function mapPlaidAccountType(
  type?: string | null,
  subtype?: string | null,
): "checking" | "savings" | "credit" | "cash" | "other" {
  const t = `${type ?? ""} ${subtype ?? ""}`.toLowerCase();
  if (t.includes("credit")) return "credit";
  if (t.includes("saving")) return "savings";
  if (t.includes("checking") || t.includes("depository")) return "checking";
  if (t.includes("cash")) return "cash";
  return "other";
}

/** Extract a user-facing message from Plaid SDK / Axios errors. */
export function plaidErrorMessage(error: unknown, fallback = "Plaid request failed"): string {
  if (error && typeof error === "object" && "response" in error) {
    const data = (
      error as {
        response?: {
          data?: {
            error_message?: string;
            error_code?: string;
            display_message?: string | null;
          };
        };
      }
    ).response?.data;
    if (data?.display_message) return data.display_message;
    if (data?.error_message) {
      return data.error_code ? `${data.error_code}: ${data.error_message}` : data.error_message;
    }
  }
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}
