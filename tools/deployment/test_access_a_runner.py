"""Protect the real Access A browser gate from unsupported floating Ubuntu runners."""
from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[2]
WORKFLOW = ROOT / ".github" / "workflows" / "spec-validation.yml"


class AccessARunnerContract(unittest.TestCase):
    def test_real_browser_keeps_supported_ubuntu_and_true_browsers(self):
        source = WORKFLOW.read_text(encoding="utf8")
        match = re.search(
            r"(?ms)^  access-a-browser:\n(.*?)(?=^  [a-z0-9_-]+:|\Z)",
            source
        )
        self.assertIsNotNone(match, "Access A job was removed")
        job = match.group(1)
        self.assertIn("runs-on: ubuntu-24.04", job)
        self.assertNotIn("runs-on: ubuntu-latest", job)
        self.assertIn("pnpm exec playwright install --with-deps chromium", job)
        self.assertIn("pnpm e2e:access-a", job)
        self.assertIn("pnpm e2e:settings-ui", job)
        self.assertNotIn("PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD", job)


if __name__ == "__main__":
    unittest.main()
