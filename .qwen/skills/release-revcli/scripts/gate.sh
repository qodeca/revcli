#!/usr/bin/env bash
# PreToolUse gate for the release-revcli skill.
#
# Denies the two actions that must never happen without a human's explicit say-so:
#   - approving the `production` environment deployment (the human gate itself)
#   - unpublishing from the registry
#
# Exit 2 denies the tool call; stderr is fed back to the model as the reason. Any other exit
# allows it. Deliberately simple: it matches on the raw tool input rather than parsing JSON,
# so it cannot fail open on a malformed payload.
#
# REVCLI_GATE_APPROVED=1 allows the action — set it only when the user has explicitly
# authorised it.

if [ "${REVCLI_GATE_APPROVED:-}" = "1" ]; then
  exit 0
fi

input=$(cat)

if printf '%s' "$input" | grep -qE 'pending_deployments|unpublish'; then
  cat >&2 <<'EOF'
Blocked by the release-revcli skill: this is an irreversible, human-only action.

Clearing the `production` approval gate and unpublishing a version must never happen on an
agent's own initiative.

Instead: give the user the run link and ask them to approve the deployment. If they have
already explicitly asked you to perform it, re-run with REVCLI_GATE_APPROVED=1.
EOF
  exit 2
fi

exit 0
