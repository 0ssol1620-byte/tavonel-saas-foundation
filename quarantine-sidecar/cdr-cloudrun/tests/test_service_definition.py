from __future__ import annotations

import re
import unittest
from pathlib import Path

SERVICE_PATH = Path(__file__).resolve().parents[1] / "service.yaml"
README_PATH = Path(__file__).resolve().parents[1] / "README.md"
WRANGLER_PATH = Path(__file__).resolve().parents[2] / "foundation-cdr-worker" / "wrangler.jsonc"
# Raised from 1 for general availability (2026-11-10). One hostile document per instance stays exact.
MAX_SCALE = 3
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
        self.assertIn(f'autoscaling.knative.dev/maxScale: "{MAX_SCALE}"', self.source)
        self.assertEqual(re.findall(r"containerConcurrency: ([0-9]+)", self.source), ["1"])
        self.assertIn('autoscaling.knative.dev/minScale: "0"', self.source)
        self.assertIn("run.googleapis.com/vpc-access-egress: all-traffic", self.source)

    def test_cdr_instances_match_the_queue_consumers_that_call_them(self) -> None:
        # Each consumer invocation holds one CDR request at a time and each instance takes one, so
        # more consumers than instances queue requests inside Cloud Run past the 120 s timeout, and
        # more instances than consumers is capacity nothing can reach.
        wrangler = WRANGLER_PATH.read_text(encoding="utf-8")
        self.assertEqual(re.findall(r'"max_concurrency": ([0-9]+)', wrangler), [str(MAX_SCALE)])
        self.assertEqual(re.findall(r'"max_batch_size": ([0-9]+)', wrangler), ["1"])

    def test_more_than_one_instance_states_its_replay_residual(self) -> None:
        readme = README_PATH.read_text(encoding="utf-8")
        self.assertIn("not shared between instances", readme)
        self.assertIn(f"max instances `{MAX_SCALE}`", readme)

    def test_no_secret_value_is_committed(self) -> None:
        self.assertIn("secretKeyRef", self.source)
        self.assertNotRegex(self.source, r'name: TAVONEL_CDR_HMAC\s*\n\s*value:')

    def test_the_production_revision_runs_the_literal_limits(self) -> None:
        # The measurement overrides (app.py, D1 stage 1) belong on a zero-traffic revision deployed
        # for measurement, never in the definition production is applied from.
        for name in ("TAVONEL_CDR_MAX_INPUT_BYTES", "TAVONEL_CDR_MAX_PAGES",
                     "TAVONEL_CDR_MAX_OUTPUT_BYTES", "TAVONEL_CDR_RASTER_RANGE_PAGES"):
            self.assertNotIn(name, self.source)


if __name__ == "__main__":
    unittest.main()
