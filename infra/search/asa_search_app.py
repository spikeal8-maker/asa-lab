"""Internal WSGI boundary: search text and upstream URLs are never operational logs.

This SearXNG adapter is distributed under AGPL-3.0-or-later, like its upstream.
"""

import logging

logging.disable(logging.CRITICAL)

from searx.webapp import app as upstream_app  # noqa: E402


def app(environ, start_response):
    try:
        return upstream_app(environ, start_response)
    except Exception:
        start_response("503 Service Unavailable", [("Content-Type", "application/json")])
        return [b'{"error":"search_unavailable"}']
