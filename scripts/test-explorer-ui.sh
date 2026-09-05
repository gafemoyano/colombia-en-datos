#!/usr/bin/env bash
# Requires agent-browser and a running dev server with the canonical registry/store.
# Usage: bash scripts/test-explorer-ui.sh http://localhost:<port>
set -euo pipefail
base="${1:?Pass the dev server URL}"
browser() { agent-browser --session explorer-regression "$@"; }
trap 'browser close >/dev/null' EXIT

browser open "$base/explore?indicator=EMICRON_PI_109&freq=A&filter.CATEGORY=SERVICIO_01"
browser wait --fn '!!document.querySelector(".js-plotly-plot .main-svg")'
browser wait --fn 'document.querySelector("[aria-labelledby=filter-SEX-label]").parentElement.textContent.includes("Predeterminada")'
browser click '[aria-labelledby="filter-SEX-label"]'
browser find role option click --name Total --exact
browser wait --fn 'new URLSearchParams(location.search).get("filter.SEX") === "_T"'
browser wait --fn 'document.querySelector("[aria-labelledby=filter-SEX-label]").parentElement.textContent.includes("Filtrada")'
browser wait --fn '!new URLSearchParams(location.search).has("filter.HEAD_SEX") && !new URLSearchParams(location.search).has("by")'

# Reset the explicit choice without changing the effective Total or category.
browser click '[aria-labelledby="filter-SEX-label"]'
browser find role option click --name Predeterminado --exact
browser wait --fn '!new URLSearchParams(location.search).has("filter.SEX")'
browser wait --fn 'document.querySelector("[aria-labelledby=filter-SEX-label]").parentElement.textContent.includes("Predeterminada")'
browser wait --fn 'new URLSearchParams(location.search).get("filter.CATEGORY") === "SERVICIO_01"'

# The page-wide reset also removes explicit Total rather than persisting it.
browser click '[aria-labelledby="filter-SEX-label"]'
browser find role option click --name Total --exact
browser wait --fn 'new URLSearchParams(location.search).get("filter.SEX") === "_T"'
browser find role link click --name 'Limpiar visualización' --exact
browser wait --fn '!new URLSearchParams(location.search).has("filter.SEX") && !new URLSearchParams(location.search).has("filter.CATEGORY")'
browser wait --fn 'document.querySelector("[aria-labelledby=filter-CATEGORY-label]").parentElement.textContent.includes("Pendiente")'
echo 'PASS: effective Total → explicit SEX=_T; independent HEAD_SEX; default and page-wide resets'
