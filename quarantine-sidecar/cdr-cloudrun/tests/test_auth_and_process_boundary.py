"""Authentication lifetime and child-process environment safety regressions."""
from __future__ import annotations

import os
import sys
import tempfile
import unittest
from datetime import UTC, datetime, timedelta
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import app as app_module
from fastapi import HTTPException


class AuthBoundaryTest(unittest.TestCase):
    def test_non_ascii_signature_is_an_auth_refusal_not_a_server_error(self):
        with self.assertRaises(HTTPException) as caught:
            app_module.require_authentication("sha256:" + "a" * 64,
                datetime.now(UTC).isoformat(), "unit-request-000000001", "\u00ff" * 43)
        self.assertEqual(caught.exception.status_code, 401)

    def test_future_clock_skew_retains_nonce_until_signature_expires(self):
        timestamp = (datetime.now(UTC) + timedelta(seconds=299)).isoformat()
        request_id = "unit-request-clock-000001"
        digest = "sha256:" + "a" * 64
        test_key = "unit-only-" * 4
        signature = app_module.cdr_request_signature(test_key, timestamp, request_id, digest)
        with patch.object(app_module, "read_hmac_secret", return_value=test_key), \
             patch.object(app_module.replay_guard, "claim") as claim:
            self.assertEqual(app_module.require_authentication(digest, timestamp, request_id, signature), digest)
        self.assertEqual(claim.call_args.args[0], request_id)
        self.assertGreater(claim.call_args.args[1], 598)
        self.assertLessEqual(claim.call_args.args[1], 599)

    def test_nonce_does_not_expire_at_nominal_ttl_when_signature_is_still_valid(self):
        guard = app_module.RequestReplayGuard()
        with patch.object(app_module, "monotonic", return_value=0):
            guard.claim("unit-request-clock-000002", 599)
        with patch.object(app_module, "monotonic", return_value=301):
            with self.assertRaises(HTTPException) as caught:
                guard.claim("unit-request-clock-000002")
            self.assertEqual(caught.exception.status_code, 409)
        with patch.object(app_module, "monotonic", return_value=600):
            guard.claim("unit-request-clock-000002")

    def test_invalid_nonce_lifetimes_refuse(self):
        for value in (0, -1, float("nan"), float("inf"), 601):
            with self.subTest(value=value), self.assertRaises(HTTPException):
                app_module.RequestReplayGuard().claim("unit-request-invalid", value)


class ConverterProcessBoundaryTest(unittest.TestCase):
    def test_environment_is_allowlisted_not_copied(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {
            "PATH": "unit-process-path", "LANG": "C.UTF-8",
            "TAVONEL_CDR_HMAC": "unit-value-not-for-converter",
            "GOOGLE_APPLICATION_CREDENTIALS": "unit-path-not-for-converter",
            "SUPABASE_SERVICE_ROLE_KEY": "unit-value-not-for-converter",
            "UNRECOGNIZED_FUTURE_PROVIDER": "unit-value-not-for-converter",
        }, clear=True):
            result = app_module.office_process_environment(Path(directory))
        self.assertEqual(set(result), {"PATH", "LANG", "HOME", "TMP", "TEMP"})
        self.assertEqual(result["HOME"], directory)
        self.assertEqual(result["PATH"], "unit-process-path")

    def test_converter_receives_only_allowlisted_environment_and_file_uri(self):
        from subprocess import CompletedProcess
        with tempfile.TemporaryDirectory(prefix="cdr path ") as directory:
            work = Path(directory)
            source = work / "input.docx"
            source.write_bytes(b"unit fixture: converter is mocked")

            def convert(command, **kwargs):
                self.assertEqual(kwargs["env"], app_module.office_process_environment(work))
                self.assertEqual(kwargs["timeout"], 45)
                self.assertIn("-env:UserInstallation=" + (work / "lo-profile").as_uri(), command)
                (work / "converted" / "input.pdf").write_bytes(b"unit-output")
                return CompletedProcess(command, 0)

            with patch.object(app_module.subprocess, "run", side_effect=convert) as runner:
                result = app_module.convert_to_pdf(source,
                    "application/vnd.openxmlformats-officedocument.wordprocessingml.document", work)
            self.assertEqual(result, work / "converted" / "input.pdf")
            runner.assert_called_once()


if __name__ == "__main__":
    unittest.main()
