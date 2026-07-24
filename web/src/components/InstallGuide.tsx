"use client";

export function InstallGuide() {
  return (
    <div className="space-y-3 text-sm text-ink-700">
      <p>
        Add Alte&apos; to your iPhone Home Screen so it opens like an app and keeps a
        local copy for airplane mode.
      </p>
      <ol className="list-decimal space-y-2 pl-5">
        <li>Open this site in Safari (not Chrome or in-app browsers).</li>
        <li>Tap the Share button.</li>
        <li>Scroll and tap <span className="font-bold">Add to Home Screen</span>.</li>
        <li>Open Budget and Accounts once while online to save your offline snapshot.</li>
      </ol>
      <p className="text-xs text-ink-600">
        Offline mode shows your last synced balances and recent transactions, and can
        queue new transactions until you’re back online. Bank sync, invites, and edits
        that need the server still require a connection.
      </p>
    </div>
  );
}
