#!/usr/bin/env python3
"""Unit tests for isolated MoneyPrinterTurbo smoke runner; no network calls."""
import importlib.util
import pathlib
import unittest
from unittest.mock import patch

MODULE = pathlib.Path(__file__).with_name("moneyprinterturbo-smoke-runner.py")
spec = importlib.util.spec_from_file_location("mpt_smoke_runner", MODULE)
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)


class SmokeRunnerTests(unittest.TestCase):
    def test_invalid_key_must_be_rejected(self):
        with patch.dict("os.environ", {"MPT_API_KEY": "x" * 32}), patch.object(
            runner, "request", return_value=(200, {"status": 200, "data": {"tasks": []}})
        ), patch("sys.argv", ["smoke"]):
            with self.assertRaises(SystemExit) as context:
                runner.main()
            self.assertIn("invalid key", str(context.exception))

    def test_readonly_mode_never_submits_video(self):
        with patch.dict("os.environ", {"MPT_API_KEY": "x" * 32}), patch.object(
            runner, "request", side_effect=[
                (401, None),
                (200, {"status": 200, "data": {"tasks": []}}),
            ]
        ) as request_mock, patch("sys.argv", ["smoke"]):
            runner.main()
            self.assertEqual(request_mock.call_count, 2)
            self.assertFalse(any(call.kwargs.get("body") for call in request_mock.call_args_list))

    def test_external_hosts_are_rejected(self):
        with patch("sys.argv", ["smoke", "--base-url", "https://example.com"]):
            with self.assertRaises(SystemExit) as context:
                runner.main()
            self.assertEqual(context.exception.code, 2)


if __name__ == "__main__":
    unittest.main()
