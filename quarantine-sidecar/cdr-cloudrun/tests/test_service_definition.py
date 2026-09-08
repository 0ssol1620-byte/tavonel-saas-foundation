from __future__ import annotations

import re
import unittest
from pathlib import Path

SERVICE_PATH = Path(__file__).resolve().parents[1] / "service.yaml"
README_PATH = Path(__file__).resolve().parents[1] / "README.md"
PINNED_SIDECAR = "clamav/clamav:1.5.4@sha256:f0954d679017eb6d48221e2b2be3ac5457bf278a844f39b672376f55a085f591"


class ServiceDefinitionTest(unittest.TestCase):
    """Guards the security-relevant lines of the deploy definition against a quiet loosening."""

    def setUp(self) -> None:
        self.source = SERVICE_PATH.read_text(encoding="utf-8")

    def test_scanner_sidecar_is_pinned_by_tag_and_digest(self) -> None:
        self.assertIn(PINNED_SIDECAR, self.source)
        readme = README_PATH.read_text(encoding="utf-8")
        tag, digest = PINNED_SIDECAR.split("@")
        # The README records the tag, the digest and the licence of whatever is deployed.
        self.assertTrue(tag in readme and digest in readme, "README must record the pinned sidecar")
        self.assertIn("GPL-2.0-only", readme)

    def test_the_scan_is_required_and_points_at_the_sidecar(self) -> None:
        self.assertRegex(self.source, r'name: MALWARE_SCAN_REQUIRED\s*\n\s*value: "1"')
        self.assertRegex(self.source, r'name: CLAMD_HOST\s*\n\s*value: "127\.0\.0\.1"')
        self.assertRegex(self.source, r'name: CLAMD_PORT\s*\n\s*value: "3310"')

    def test_the_read_budget_stays_below_the_request_timeout(self) -> None:
        read_budget = float(re.search(r'name: CLAMD_READ_TIMEOUT_SECONDS\s*\n\s*value: "([0-9.]+)"', self.source).group(1))
        request_timeout = float(re.search(r"timeoutSeconds: ([0-9.]+)", self.source).group(1))
        self.assertLess(read_budget, request_timeout, "a hung scanner must be SCAN_TIMEOUT, not a Cloud Run timeout")

    def test_the_container_cannot_serve_before_the_scanner_is_up(self) -> None:
        self.assertIn('run.googleapis.com/container-dependencies: \'{"cdr":["clamd"]}\'', self.source)

    def test_ingress_scaling_and_concurrency_stay_closed(self) -> None:
        self.assertIn("run.googleapis.com/ingress: internal", self.source)
        self.assertIn('autoscaling.knative.dev/maxScale: "1"', self.source)
        self.assertIn("containerConcurrency: 1", self.source)
        self.assertIn("run.googleapis.com/vpc-access-egress: all-traffic", self.source)

    def test_no_secret_value_is_committed(self) -> None:
        self.assertIn("secretKeyRef", self.source)
        self.assertNotRegex(self.source, r'name: TAVONEL_CDR_HMAC\s*\n\s*value:')


if __name__ == "__main__":
    unittest.main()
