#!/usr/bin/env python3
"""Fail-closed read-only MoneyPrinterTurbo API authentication probe."""
import argparse
import json
import os
import secrets
import sys
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import Request, urlopen


def probe(url, key):
    request = Request(url + "/api/v1/tasks", headers={"x-api-key": key}, method="GET")
    try:
        with urlopen(request, timeout=10) as response:
            return response.status
    except HTTPError as exc:
        return exc.code


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", required=True, help="Private HTTPS upstream base URL")
    args = parser.parse_args()
    url = args.base_url.rstrip("/")
    parsed = urlsplit(url)
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment or parsed.path not in ("", "/"):
        parser.error("base URL must be HTTPS without credentials, path or query")
    key = os.environ.get("MPT_API_KEY")
    if not key:
        parser.error("Set MPT_API_KEY in the environment, not in CLI arguments")
    try:
        # A valid-key 200 alone is unsafe: upstream allows anonymous access when api_key is unset.
        rejected = probe(url, "invalid-" + secrets.token_hex(24))
        accepted = probe(url, key)
    except (URLError, TimeoutError) as exc:
        print(json.dumps({"ok": False, "reason": type(exc).__name__}))
        return 1
    ok = rejected == 401 and accepted == 200
    print(json.dumps({"ok": ok, "invalid_key_status": rejected, "valid_key_status": accepted, "no_video_submitted": True}))
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
