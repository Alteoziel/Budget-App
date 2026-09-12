"use client";

const SIDESTORE_SOURCE =
  "https://github.com/Alteoziel/Budget-App/releases/download/ios-sideload/sidestore.json";
const SIDESTORE_RELEASE =
  "https://github.com/Alteoziel/Budget-App/releases/tag/ios-sideload";

export function InstallGuide() {
  return (
    <div className="space-y-5 text-sm text-ink-700">
      <div className="space-y-3">
        <p className="font-bold text-ink-900">Home Screen (recommended)</p>
        <p>
          Add Alte&apos; from Safari so it opens like an app, keeps a local copy for
          airplane mode, and does not expire every 7 days.
        </p>
        <ol className="list-decimal space-y-2 pl-5">
          <li>Open this site in Safari (not Chrome or in-app browsers).</li>
          <li>Tap the Share button.</li>
          <li>
            Scroll and tap <span className="font-bold">Add to Home Screen</span>.
          </li>
          <li>Open Budget and Accounts once while online to save your offline snapshot.</li>
        </ol>
      </div>

      <div className="space-y-3">
        <p className="font-bold text-ink-900">SideStore (no modern Mac)</p>
        <p>
          GitHub Actions builds the iPhone <span className="font-bold">.ipa</span>{" "}
          on a cloud Mac. SideStore + WireGuard re-signs it with your Apple ID —
          a 2011-era Mac cannot compile for iPhone 14/15.
        </p>
        <ol className="list-decimal space-y-2 pl-5">
          <li>
            Download{" "}
            <a
              href={SIDESTORE_RELEASE}
              className="font-bold text-moss-500 underline underline-offset-2"
              target="_blank"
              rel="noopener noreferrer"
            >
              AlteBudgeting.ipa
            </a>{" "}
            and Share it to SideStore, or add this source in SideStore:
          </li>
        </ol>
        <p className="break-all rounded-xl bg-ink-900/5 px-3 py-2 font-mono text-xs text-ink-800">
          {SIDESTORE_SOURCE}
        </p>
        <p className="text-xs text-ink-600">
          Free Apple IDs still have a 3-app limit and a 7-day refresh over the
          WireGuard tunnel. Email/password sign-in is the reliable path in the
          wrapper; passkeys work more consistently from the Safari install above.
        </p>
      </div>

      <p className="text-xs text-ink-600">
        Offline mode shows your last synced balances and recent transactions, and can
        queue new transactions until you’re back online. Bank sync, invites, and edits
        that need the server still require a connection.
      </p>
    </div>
  );
}
