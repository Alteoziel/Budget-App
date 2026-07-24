import https from "node:https";

export type TellerAccount = {
  id: string;
  enrollment_id: string;
  name: string;
  type: string;
  subtype?: string;
  currency?: string;
  institution?: { name?: string };
  last_four?: string;
};

export type TellerTransaction = {
  id: string;
  account_id: string;
  date: string;
  amount: string;
  description: string;
  status: string;
  type?: string;
};

function tellerTls(): { cert: string; key: string } {
  const cert = process.env.TELLER_CERTIFICATE?.replace(/\\n/g, "\n");
  const key = process.env.TELLER_PRIVATE_KEY?.replace(/\\n/g, "\n");
  if (!cert || !key) {
    throw new Error(
      "Teller mTLS cert/key missing. Set TELLER_CERTIFICATE and TELLER_PRIVATE_KEY in Doppler.",
    );
  }
  return { cert, key };
}

export function tellerConfigured(): boolean {
  return Boolean(
    process.env.TELLER_CERTIFICATE &&
      process.env.TELLER_PRIVATE_KEY &&
      (process.env.NEXT_PUBLIC_TELLER_APPLICATION_ID ||
        process.env.TELLER_APPLICATION_ID),
  );
}

export async function tellerFetch<T>(
  path: string,
  accessToken: string,
  init?: { method?: string; body?: string },
): Promise<T> {
  const { cert, key } = tellerTls();
  const auth = Buffer.from(`${accessToken}:`).toString("base64");
  const url = new URL(path.startsWith("http") ? path : `https://api.teller.io${path}`);

  const body = await new Promise<string>((resolve, reject) => {
    const req = https.request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || 443,
        path: `${url.pathname}${url.search}`,
        method: init?.method || "GET",
        cert,
        key,
        headers: {
          Authorization: `Basic ${auth}`,
          Accept: "application/json",
          ...(init?.body
            ? {
                "Content-Type": "application/json",
                "Content-Length": Buffer.byteLength(init.body),
              }
            : {}),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          if ((res.statusCode ?? 500) >= 400) {
            reject(
              new Error(`Teller API ${res.statusCode}: ${text.slice(0, 300)}`),
            );
            return;
          }
          resolve(text);
        });
      },
    );
    req.on("error", reject);
    if (init?.body) req.write(init.body);
    req.end();
  });

  return JSON.parse(body) as T;
}

export function listTellerAccounts(accessToken: string) {
  return tellerFetch<TellerAccount[]>("/accounts", accessToken);
}

export function listTellerTransactions(
  accessToken: string,
  accountId: string,
  opts?: { startDate?: string; endDate?: string },
) {
  const params = new URLSearchParams();
  if (opts?.startDate) params.set("start_date", opts.startDate);
  if (opts?.endDate) params.set("end_date", opts.endDate);
  const qs = params.toString();
  return tellerFetch<TellerTransaction[]>(
    `/accounts/${accountId}/transactions${qs ? `?${qs}` : ""}`,
    accessToken,
  );
}

/** Teller amounts are dollar strings; convert to signed cents (outflows negative). */
export function tellerAmountToCents(amount: string): number {
  const n = Number(amount);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}

export function mapTellerAccountType(
  type: string,
  subtype?: string,
): "checking" | "savings" | "credit" | "cash" | "other" {
  const t = `${type} ${subtype ?? ""}`.toLowerCase();
  if (t.includes("credit")) return "credit";
  if (t.includes("saving")) return "savings";
  if (t.includes("depository") || t.includes("checking")) return "checking";
  if (t.includes("cash")) return "cash";
  return "other";
}
