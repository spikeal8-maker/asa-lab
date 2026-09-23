#!/usr/bin/env python3
"""OS-scheduler entry point. No execution outside the installation's window."""

import datetime as dt
import json
from pathlib import Path
import subprocess
import sys
import uuid

from deployment.contracts import DEFAULT_WINDOW, in_window

root = Path(__file__).resolve().parent.parent
settings_file = root / ".asa" / "installation.json"
if not settings_file.exists():
    sys.exit(0)
settings = json.loads(settings_file.read_text(encoding="utf-8"))
if not settings.get("automaticUpdates") or not in_window(settings.get("window", DEFAULT_WINDOW)):
    sys.exit(0)
logs = root / ".asa" / "logs"
logs.mkdir(parents=True, exist_ok=True, mode=0o700)
stamp = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ") + "-" + uuid.uuid4().hex[:8]
with (logs / (stamp + ".log")).open("x", encoding="utf-8") as output:
    result = subprocess.run([sys.executable, str(root / "tools" / "asa_manager.py"), "update", "--scheduled"],
                            cwd=root, stdout=output, stderr=subprocess.STDOUT)
sys.exit(result.returncode)
