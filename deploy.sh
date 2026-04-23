#!/usr/bin/env bash
# deploy.sh — push this folder to GitHub (frankfu0714/stock-tracker) and deploy to Vercel.
# Run from anywhere:   bash ~/Desktop/stock-tracker/deploy.sh
#
# What it does:
#   1. git init + commit this folder
#   2. Create the GitHub repo (uses gh CLI; installs it via Homebrew if missing)
#   3. Push to GitHub
#   4. Deploy to Vercel (installs Vercel CLI if missing)
#
# You'll be asked to log in to GitHub and Vercel once (browser pop-ups).

set -euo pipefail

REPO_NAME="stock-tracker"
GH_USER="frankfu0714"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$HERE"

say()  { printf "\n\033[1;34m==> %s\033[0m\n" "$*"; }
ok()   { printf "\033[1;32m✓\033[0m %s\n" "$*"; }
warn() { printf "\033[1;33m!\033[0m %s\n" "$*"; }
die()  { printf "\033[1;31m✗ %s\033[0m\n" "$*" >&2; exit 1; }

command_exists() { command -v "$1" >/dev/null 2>&1; }

# ---------- 0. Sanity: we're in the right folder ----------
[[ -f index.html && -f server.js && -d api ]] || die "Run this from the stock-tracker folder."

# ---------- 1. git identity ----------
if ! git config --global user.email >/dev/null 2>&1; then
  warn "Git identity not set. Setting it now."
  read -rp "  Your email for git commits: " git_email
  read -rp "  Your name for git commits: " git_name
  git config --global user.email "$git_email"
  git config --global user.name "$git_name"
fi

# ---------- 2. git init + commit ----------
if [[ ! -d .git ]]; then
  say "Initializing git repo"
  git init -q
  git branch -m main 2>/dev/null || true
fi
git add -A
if git diff --cached --quiet; then
  ok "Nothing new to commit"
else
  git commit -q -m "Stock Tracker — initial commit"
  ok "Committed"
fi

# ---------- 3. gh CLI ----------
if ! command_exists gh; then
  say "GitHub CLI (gh) not found — installing via Homebrew"
  if ! command_exists brew; then
    die "Homebrew is not installed. Install it from https://brew.sh then re-run this script.
Or create the repo manually at https://github.com/new named 'stock-tracker' and run:
  git remote add origin https://github.com/${GH_USER}/${REPO_NAME}.git
  git push -u origin main"
  fi
  brew install gh
fi

# ---------- 4. GitHub auth ----------
if ! gh auth status >/dev/null 2>&1; then
  say "Logging in to GitHub (a browser window will open)"
  gh auth login --web --git-protocol https --hostname github.com
fi
ok "GitHub authenticated"

# ---------- 5. create/push repo ----------
if gh repo view "${GH_USER}/${REPO_NAME}" >/dev/null 2>&1; then
  warn "Repo ${GH_USER}/${REPO_NAME} already exists — pushing to it"
  if ! git remote | grep -q '^origin$'; then
    git remote add origin "https://github.com/${GH_USER}/${REPO_NAME}.git"
  fi
  git push -u origin main
else
  say "Creating ${GH_USER}/${REPO_NAME} on GitHub"
  gh repo create "${GH_USER}/${REPO_NAME}" --public --source=. --remote=origin --push \
    --description "Personal portfolio tracker — TW (上市/上櫃/興櫃) and US stocks"
fi
ok "Pushed to https://github.com/${GH_USER}/${REPO_NAME}"

# ---------- 6. Vercel CLI ----------
if ! command_exists vercel; then
  say "Installing Vercel CLI"
  npm install -g vercel
fi

# ---------- 7. Vercel deploy ----------
say "Deploying to Vercel (may ask you to log in once)"
# First run — link the project; second run promotes to production.
vercel link --yes --project "${REPO_NAME}" || true
vercel deploy --prod --yes
ok "Deployed. Your live URL is shown above ↑"

cat <<EOF

================================================================
 All done.

 GitHub repo:  https://github.com/${GH_USER}/${REPO_NAME}
 Vercel URL:   see the URL printed by 'vercel deploy' above

 In the app, tap ⚙ and paste that Vercel URL into
 "Price API base URL". Then ↻ to refresh.
================================================================
EOF
