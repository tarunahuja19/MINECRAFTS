#!/usr/bin/env bash
# ==============================================================================
# ensure_postgres.sh - make PostgreSQL reachable, or start it.
#
# Sourced by start_all.sh. Reads PGHOST/PGPORT from the environment (start_all
# loads backend/.env before calling this). Exits 0 when Postgres answers on
# $PGHOST:$PGPORT, non-zero when every start strategy has been tried and failed.
#
# Only ever starts a *local* server: if PGHOST is a remote box, a down database
# is not ours to fix and we just report it.
# ==============================================================================

ensure_postgres() {
  local host="${PGHOST:-localhost}" port="${PGPORT:-5432}"
  local isready; isready="$(command -v pg_isready || true)"

  _pg_up() {
    if [ -n "$isready" ]; then
      "$isready" -h "$host" -p "$port" -q
    else
      # No pg_isready on PATH - fall back to a bare TCP probe.
      (exec 3<>"/dev/tcp/$host/$port") 2>/dev/null
    fi
  }

  if _pg_up; then
    ok "PostgreSQL already up on $host:$port"
    return 0
  fi

  case "$host" in
    localhost|127.0.0.1|::1|"") ;;
    *) die "PostgreSQL is down at $host:$port and it is not local - start it there" ;;
  esac

  warn "PostgreSQL not answering on $host:$port - attempting to start it"

  # Strategy 1: Homebrew services (no sudo, the common dev setup).
  if command -v brew >/dev/null; then
    local svc
    svc="$(brew services list 2>/dev/null | awk '/^postgresql/ {print $1; exit}')"
    if [ -n "$svc" ]; then
      say "  starting $svc via brew services"
      brew services start "$svc" >/dev/null 2>&1 || true
      _pg_wait "$host" "$port" && { ok "PostgreSQL started ($svc)"; return 0; }
    fi
  fi

  # Strategy 2: an EDB / Postgres.app style LaunchDaemon.
  local plist
  for plist in /Library/LaunchDaemons/postgresql-*.plist /Library/LaunchDaemons/com.edb.launchd.postgresql-*.plist; do
    [ -f "$plist" ] || continue
    say "  loading $(basename "$plist") (may prompt for your password)"
    sudo launchctl load -w "$plist" >/dev/null 2>&1 || sudo launchctl bootstrap system "$plist" >/dev/null 2>&1 || true
    _pg_wait "$host" "$port" && { ok "PostgreSQL started ($(basename "$plist"))"; return 0; }
  done

  # Strategy 3: pg_ctl against a discoverable data directory.
  local pgctl; pgctl="$(command -v pg_ctl || true)"
  if [ -n "$pgctl" ]; then
    local datadir=""
    for d in \
      "${PGDATA:-}" \
      "/opt/homebrew/var/postgresql@17" "/opt/homebrew/var/postgresql@16" "/opt/homebrew/var/postgres" \
      "/usr/local/var/postgres" \
      "/Library/PostgreSQL/18/data" "/Library/PostgreSQL/17/data"; do
      [ -n "$d" ] && [ -f "$d/PG_VERSION" ] && { datadir="$d"; break; }
    done
    if [ -n "$datadir" ]; then
      say "  starting pg_ctl on $datadir"
      if [ -w "$datadir" ]; then
        "$pgctl" -D "$datadir" -l "$ROOT_DIR/.postgres.log" -w start >/dev/null 2>&1 || true
      else
        sudo -u "$(stat -f '%Su' "$datadir")" "$pgctl" -D "$datadir" -l /tmp/postgres.log -w start >/dev/null 2>&1 || true
      fi
      _pg_wait "$host" "$port" && { ok "PostgreSQL started (pg_ctl $datadir)"; return 0; }
    fi
  fi

  die "could not start PostgreSQL automatically - start it yourself (e.g. 'brew services start postgresql@17') and re-run"
}

_pg_wait() {
  local host="$1" port="$2" i
  for i in $(seq 1 40); do
    if [ -n "$(command -v pg_isready || true)" ]; then
      pg_isready -h "$host" -p "$port" -q && return 0
    else
      (exec 3<>"/dev/tcp/$host/$port") 2>/dev/null && return 0
    fi
    sleep 0.5
  done
  return 1
}
