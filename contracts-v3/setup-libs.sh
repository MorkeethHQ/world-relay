#!/bin/sh
# Vendors pinned libs from local git checkouts (no network). OZ contracts + upgradeable both v5.1.0.
set -e; cd "$(dirname "$0")"; rm -rf lib; mkdir -p lib/openzeppelin-contracts lib/openzeppelin-contracts-upgradeable lib/forge-std
OZ=${OZ_REPO:-$HOME/CODE/world-relay/contracts/lib/openzeppelin-contracts}
OZU=${OZU_REPO:-$HOME/CODE/world-relay/contracts/lib/openzeppelin-contracts-upgradeable}
git -C "$OZ" archive v5.1.0 contracts | tar -x -C lib/openzeppelin-contracts
git -C "$OZU" archive v5.1.0 contracts | tar -x -C lib/openzeppelin-contracts-upgradeable
cp -R "${FORGE_STD:-$HOME/CODE/arcade/contracts/lib/forge-std}/src" lib/forge-std/src
