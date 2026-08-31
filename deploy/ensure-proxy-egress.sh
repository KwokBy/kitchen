#!/usr/bin/env bash
set -euo pipefail

network_name="compose_default"
network_id="$(docker network inspect "$network_name" --format '{{.Id}}')"
subnet="$(docker network inspect "$network_name" --format '{{(index .IPAM.Config 0).Subnet}}')"
bridge="br-${network_id:0:12}"
comment="xiguifei-proxy-egress"

ensure_rule() {
  local table="$1"
  shift
  if ! iptables -t "$table" -C "$@" 2>/dev/null; then
    iptables -t "$table" -I "$@"
  fi
}

ensure_rule nat POSTROUTING -s "$subnet" ! -o "$bridge" -m comment --comment "$comment" -j MASQUERADE
ensure_rule filter FORWARD -i "$bridge" ! -o "$bridge" -m comment --comment "$comment" -j ACCEPT
ensure_rule filter FORWARD -o "$bridge" -m conntrack --ctstate RELATED,ESTABLISHED -m comment --comment "$comment" -j ACCEPT
