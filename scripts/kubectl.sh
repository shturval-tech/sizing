#!/usr/bin/env bash
# Калькулятор сайзинга Штурвал: сбор прикладных нагрузок из работающего кластера.
# Нужны kubectl и jq. Скрипт только читает кластер и пишет workloads.json.
#
#   ./kubectl.sh           нагрузки без системных namespace платформы
#   ./kubectl.sh --all     все namespace
#
# Контейнеры скрипт не суммирует: правило max(обычные, init) применяет калькулятор.
set -euo pipefail

# Системные namespace платформы пропускаем, иначе платформа посчитается дважды.
EXCLUDE='^(kube-.*|shturval-.*|cert-manager|velero|kyverno|rawfile-provisioner|snapshotter|trivy-system|capi-.*|cap.*-system)$'
[ "${1:-}" = "--all" ] && EXCLUDE='^$'
OUT="${OUT:-workloads.json}"

read -r -d '' FILTER <<'JQ' || true
def cpu: if . == null or . == "" then 0
  elif type == "number" then . * 1000
  elif endswith("m") then (.[:-1] | tonumber)
  else (tonumber * 1000) end;
def mem: if . == null or . == "" then 0
  elif type == "number" then .
  else (capture("^(?<n>[0-9.]+(e[0-9]+)?)(?<u>[A-Za-z]*)$")) as $m
    | ($m.n | tonumber) * ({"":1,"Ki":1024,"Mi":1048576,"Gi":1073741824,"Ti":1099511627776,
                            "k":1000,"K":1000,"M":1000000,"G":1000000000,"T":1000000000000}[$m.u] // 1) end;
def podspec: (.spec.template // .spec.jobTemplate.spec.template).spec;
def ctr: { name: .name, cpuMillis: (.resources.requests.cpu | cpu), memoryBytes: (.resources.requests.memory | mem) };
def storage: [ (.spec.volumeClaimTemplates // [])[] | (.spec.resources.requests.storage | mem) ] | add // 0;

[ (.items // [.])[]
  | select(.kind == "Deployment" or .kind == "StatefulSet" or .kind == "DaemonSet" or .kind == "Job" or .kind == "CronJob")
  | select((.metadata.namespace // $ns) | test($ex) | not)
  | podspec as $p
  | { namespace: (.metadata.namespace // $ns),
      kind: .kind,
      name: .metadata.name,
      replicas: (if .kind == "DaemonSet" or .kind == "Job" or .kind == "CronJob" then null else (.spec.replicas // 1) end),
      parallelism: (.spec.parallelism // .spec.jobTemplate.spec.parallelism // 1),
      storageBytes: storage,
      containers: [ ($p.containers // [])[] | ctr ],
      initContainers: [ ($p.initContainers // [])[] | ctr ] }
  | with_entries(select(.value != null)) ]
| group_by(.namespace)
| map({ namespace: .[0].namespace, workloads: map(del(.namespace)) })
JQ

kubectl get deploy,sts,ds,job,cronjob -A -o json | jq --arg ex "$EXCLUDE" --arg ns "default" "$FILTER" > "$OUT"

echo "Готово: $OUT"
