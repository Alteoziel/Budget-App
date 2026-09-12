#!/usr/bin/env python3
"""Write a SideStore/AltStore Classic source JSON for an unsigned IPA."""

from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--ipa", required=True, type=Path)
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument("--download-url", required=True)
    parser.add_argument("--version", default="1.0.0")
    parser.add_argument("--build", default="1")
    parser.add_argument("--date", default="")
    args = parser.parse_args()

    ipa = args.ipa.resolve()
    if not ipa.is_file():
        raise SystemExit(f"IPA not found: {ipa}")

    released = args.date or datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    source = {
        "name": "Alte' Budgeting",
        "subtitle": "Sideload the iPhone shell with SideStore",
        "description": (
            "Unsigned IPA for SideStore (or AltStore Classic). The app is a thin "
            "WKWebView shell around the hosted PWA at "
            "https://budget-app-mauve-five.vercel.app."
        ),
        "website": "https://github.com/Alteoziel/Budget-App",
        "tintColor": "#3F7A5C",
        "iconURL": "https://budget-app-mauve-five.vercel.app/icons/icon-512.png",
        "featuredApps": ["app.alteoziel.budgeting"],
        "apps": [
            {
                "name": "Alte' Budgeting",
                "bundleIdentifier": "app.alteoziel.budgeting",
                "developerName": "Alteoziel",
                "subtitle": "YNAB-inspired personal budgeting",
                "localizedDescription": (
                    "Sideloadable iPhone wrapper for Alte' Budgeting. It loads the "
                    "live Vercel PWA so budgets, Plaid, and auth stay on the server. "
                    "Safari → Add to Home Screen is still the more reliable offline "
                    "and passkey path."
                ),
                "iconURL": "https://budget-app-mauve-five.vercel.app/icons/icon-512.png",
                "tintColor": "#3F7A5C",
                "category": "utilities",
                "versions": [
                    {
                        "version": args.version,
                        "buildVersion": str(args.build),
                        "date": released,
                        "localizedDescription": "Unsigned SideStore build from GitHub Actions.",
                        "downloadURL": args.download_url,
                        "size": ipa.stat().st_size,
                        "minOSVersion": "16.0",
                    }
                ],
                "appPermissions": {
                    "entitlements": [],
                    "privacy": {},
                },
            }
        ],
        "news": [],
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(source, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {args.out} ({ipa.stat().st_size} byte IPA)")


if __name__ == "__main__":
    main()
