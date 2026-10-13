"""Thin operator entry point shared by source and published-release startup."""
from deployment.collector import main

if __name__ == "__main__":
    raise SystemExit(main())
