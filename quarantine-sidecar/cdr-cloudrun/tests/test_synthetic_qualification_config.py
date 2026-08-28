from __future__ import annotations

import base64
import unittest
from pathlib import Path


CONFIG_PATH = Path(__file__).resolve().parents[1] / "cloudbuild.synthetic-cdr-qualification.yaml"


class SyntheticQualificationConfigTest(unittest.TestCase):
    def test_config_keeps_hmac_provider_internal_and_checks_only_proof_metadata(self) -> None:
        source = CONFIG_PATH.read_text(encoding="utf-8")

        self.assertIn("secretEnv:", source)
        self.assertIn("TAVONEL_CDR_HMAC", source)
        self.assertIn("secrets/tavonel-cdr-hmac/versions/1", source)
        self.assertNotIn("gcloud secrets versions access", source)
        self.assertNotIn("--set-secrets", source)
        self.assertIn("rm -f", source)
        self.assertIn("unset TAVONEL_CDR_HMAC", source)
        self.assertIn("TAVONEL_CDR_SYNTHETIC_QUALIFICATION_OK", source)
        self.assertIn("x-tavonel-cdr-output-sha256", source)
        self.assertNotIn("cat \"${response_path}\"", source)

    def test_embedded_fixture_is_a_small_pdf(self) -> None:
        source = CONFIG_PATH.read_text(encoding="utf-8")
        marker = "readonly fixture_b64='"
        encoded = source.split(marker, 1)[1].split("'", 1)[0]
        fixture = base64.b64decode(encoded)

        self.assertTrue(fixture.startswith(b"%PDF-"))
        self.assertLess(len(fixture), 5 * 1024 * 1024)


if __name__ == "__main__":
    unittest.main()
