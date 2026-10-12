#!/usr/bin/env python3
"""Opt-in isolated MoneyPrinterTurbo smoke test. No MODO production calls.

Default: verify fail-closed authentication only. Rendering requires explicit
--render and a reviewed JSON brief. Do not run with paid/unlicensed providers.
"""
import argparse
import json
import os
import secrets
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from urllib.parse import urlparse


def request(base, path, key, *, body=None):
    payload = None if body is None else json.dumps(body).encode("utf-8")
    headers = {"x-api-key": key, "Accept": "application/json"}
    if payload is not None:
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(base + path, data=payload, headers=headers,
                                 method="POST" if payload is not None else "GET")
    try:
        with urllib.request.urlopen(req, timeout=30) as response:
            return response.status, json.load(response)
    except urllib.error.HTTPError as error:
        return error.code, None


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", default="http://127.0.0.1:8080")
    parser.add_argument("--render", action="store_true")
    parser.add_argument("--brief", help="JSON request body (not the fixture wrapper)")
    parser.add_argument("--timeout-seconds", type=int, default=600)
    args = parser.parse_args()
    parsed = urlparse(args.base_url)
    if (parsed.scheme != "http" or parsed.hostname not in ("127.0.0.1", "localhost")
            or parsed.port != 8080 or parsed.path not in ("", "/")
            or parsed.username or parsed.password or parsed.query or parsed.fragment):
        parser.error("Smoke runner only permits loopback HTTP port 8080")
    base = args.base_url.rstrip("/")
    key = os.getenv("MPT_API_KEY", "")
    if len(key) < 24:
        parser.error("MPT_API_KEY must be configured (at least 24 characters)")
    path = "/api/v1/tasks?page=1&page_size=1"
    invalid_status, _ = request(base, path, "modo-invalid-" + secrets.token_hex(16))
    if invalid_status != 401:
        sys.exit(f"FAIL: invalid key was not rejected (HTTP {invalid_status})")
    valid_status, data = request(base, path, key)
    if valid_status != 200 or data is None or data.get("status") != 200 or not isinstance(data.get("data", {}).get("tasks"), list):
        sys.exit("FAIL: valid key was not accepted on tasks endpoint")
    print("PASS: invalid key rejected, valid key accepted")
    if not args.render:
        print("READ-ONLY: no video task submitted")
        return
    if not args.brief:
        parser.error("--render requires --brief")
    with open(args.brief, encoding="utf-8") as file:
        body = json.load(file)
    if not isinstance(body, dict) or not body.get("video_script"):
        parser.error("Brief must be a JSON object containing video_script")
    if body.get("video_count") != 1:
        parser.error("Smoke test only permits video_count=1")
    if body.get("video_source") != "local":
        parser.error("Smoke test requires video_source=local (licensed media)")
    status, result = request(base, "/api/v1/videos", key, body=body)
    if status != 200 or result is None or result.get("status") != 200:
        sys.exit(f"FAIL: video task submission HTTP {status}")
    task_id = result.get("data", {}).get("task_id", "")
    if not isinstance(task_id, str) or len(task_id) != 36:
        sys.exit("FAIL: upstream did not return a task ID")
    print(f"SUBMITTED task={task_id}")
    deadline = time.monotonic() + args.timeout_seconds
    while time.monotonic() < deadline:
        time.sleep(10)
        status, result = request(base, "/api/v1/tasks/" + urllib.parse.quote(task_id, safe=""), key)
        if status != 200 or result is None:
            sys.exit(f"FAIL: task polling HTTP {status}")
        task = result.get("data", {})
        if task.get("task_id") != task_id:
            sys.exit("FAIL: mismatched task ID")
        state = task.get("state")
        if state == -1:
            sys.exit("FAIL: upstream rendering task failed")
        if state == 1:
            videos = task.get("videos") or task.get("combined_videos") or []
            if not videos:
                sys.exit("FAIL: complete task returned no videos")
            print(f"PASS: task complete; upstream reports {len(videos)} video(s)")
            print("NOTE: video files are still on the isolated worker, not imported into MODO")
            return
        print(f"PROCESSING state={state} progress={task.get('progress', 0)}")
    sys.exit("FAIL: rendering timed out")


if __name__ == "__main__":
    main()
