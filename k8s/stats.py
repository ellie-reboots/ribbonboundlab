"""Read-only public stats for ribbonboundlab.com/api/stats.

Runs fixed PromQL queries against the in-cluster Prometheus and returns only
aggregate counts and percentages. Nothing from the request is ever passed to
Prometheus, and results are cached so visitors can't add load to the cluster.
"""
import json
import os
import time
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PROMETHEUS = os.environ.get("PROMETHEUS_URL", "http://prometheus-operated.monitoring.svc:9090")
CACHE_SECONDS = int(os.environ.get("CACHE_SECONDS", "30"))

QUERIES = {
    "nodes_ready": 'sum(kube_node_status_condition{condition="Ready",status="true"})',
    "nodes_total": "count(kube_node_info)",
    "pods_running": 'sum(kube_pod_status_phase{phase="Running"})',
    "cpu_percent": '100 * (1 - avg(rate(node_cpu_seconds_total{mode="idle"}[5m])))',
    "memory_percent": "100 * (1 - sum(node_memory_MemAvailable_bytes) / sum(node_memory_MemTotal_bytes))",
}

_cache = {"at": 0.0, "body": b""}


def query(promql):
    url = PROMETHEUS + "/api/v1/query?" + urllib.parse.urlencode({"query": promql})
    with urllib.request.urlopen(url, timeout=5) as resp:
        result = json.load(resp)["data"]["result"]
    return float(result[0]["value"][1]) if result else None


def collect():
    stats = {}
    for key, promql in QUERIES.items():
        try:
            value = query(promql)
        except Exception:
            value = None
        if value is not None:
            value = round(value, 1) if key.endswith("_percent") else int(value)
        stats[key] = value
    stats["updated"] = int(time.time())
    return json.dumps(stats).encode()


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path.split("?")[0] != "/api/stats":
            self.send_error(404)
            return
        if time.time() - _cache["at"] > CACHE_SECONDS:
            _cache["body"] = collect()
            _cache["at"] = time.time()
        body = _cache["body"]
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", f"public, max-age={CACHE_SECONDS}")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass  # keep visitor requests out of the logs


if __name__ == "__main__":
    ThreadingHTTPServer(("0.0.0.0", 8080), Handler).serve_forever()
