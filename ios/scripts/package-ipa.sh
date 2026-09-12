#!/usr/bin/env bash
# Build an unsigned device IPA on macOS. SideStore/AltStore re-sign it with
# the installer's Apple ID — no paid Developer account and no local Mac needed
# when this runs on GitHub-hosted macos runners.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PROJECT="${ROOT}/AlteBudgeting.xcodeproj"
SCHEME="AlteBudgeting"
DERIVED="${ROOT}/build/DerivedData"
OUT_DIR="${ROOT}/build"
BUILD_NUMBER="${CURRENT_PROJECT_VERSION:-1}"
VERSION="${MARKETING_VERSION:-1.0.0}"

mkdir -p "${OUT_DIR}"
rm -rf "${DERIVED}"

xcodebuild \
  -project "${PROJECT}" \
  -scheme "${SCHEME}" \
  -configuration Release \
  -sdk iphoneos \
  -destination "generic/platform=iOS" \
  -derivedDataPath "${DERIVED}" \
  CURRENT_PROJECT_VERSION="${BUILD_NUMBER}" \
  MARKETING_VERSION="${VERSION}" \
  CODE_SIGNING_ALLOWED=NO \
  CODE_SIGNING_REQUIRED=NO \
  CODE_SIGN_IDENTITY="" \
  DEVELOPMENT_TEAM="" \
  PROVISIONING_PROFILE_SPECIFIER="" \
  VALIDATE_PRODUCT=NO \
  clean build

APP="$(find "${DERIVED}/Build/Products/Release-iphoneos" -maxdepth 1 -name "*.app" | head -n 1)"
if [[ -z "${APP}" || ! -d "${APP}" ]]; then
  echo "No iphoneos .app found under ${DERIVED}" >&2
  exit 1
fi

STAGE="$(mktemp -d)"
mkdir -p "${STAGE}/Payload"
cp -R "${APP}" "${STAGE}/Payload/"
(
  cd "${STAGE}"
  zip -r -y "${OUT_DIR}/AlteBudgeting.ipa" Payload >/dev/null
)
rm -rf "${STAGE}"

echo "Wrote ${OUT_DIR}/AlteBudgeting.ipa"
ls -lh "${OUT_DIR}/AlteBudgeting.ipa"
