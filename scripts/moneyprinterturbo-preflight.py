#!/usr/bin/env python3
"""Read-only MoneyPrinterTurbo health/auth preflight; never creates a video job."""
import argparse
import json
import os
import sys
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import Request, urlopen


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", required=True, help="Private HTTPS upstream base URL")
    args = parser.parse_args()
    url = args.base_url.rstrip("/")
    parsed = urlsplit(url)
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment:
        parser.error("base URL must be a private HTTPS URL without credentials or query")
    token = os.environ.get("MPT_API_KEY")
    if not token:
        parser.error("MPT_API_KEY must be set in the environment; do not paste secrets into arguments")
    # The upstream /api/v1 endpoint may return 404/405; that still demonstrates network reachability.
    req = Request(url + "/api/v1", headers={"Authorization": "Bearer " + token}, method="GET")
    try:
        with urlopen(req, timeout=10) as response:
            status = response.status
    except HTTPError as exc:
        status = exc.code
    except (URLError, TimeoutError) as exc:
        print(json.dumps({"reachable": False, "reason": type(exc).__name__}))
        return 1
    print(json.dumps({"reachable": True, "http_status": status, "note": "No video task was submitted; auth not established by this probe"}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
