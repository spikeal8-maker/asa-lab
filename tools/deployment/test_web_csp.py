"""Real Caddy response checks for the production web header boundary.

Run with CADDY_BIN pointing to the pinned 2.10.2 binary (no Docker needed).
Fixtures replace only the loopback listener, static root and upstream addresses;
the production matchers, handlers and security policies remain unchanged.
"""
import http.server
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request


SOURCE = Path(__file__).resolve().parents[2] / 'docker/web/Caddyfile'
CADDY = os.environ.get('CADDY_BIN') or shutil.which('caddy')


def free_port():
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        return sock.getsockname()[1]


class Upstream(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.send_header('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'")
        self.end_headers()
        self.wfile.write(b'upstream')

    def log_message(self, *args):
        pass


@unittest.skipUnless(CADDY, 'CADDY_BIN is required for actual production-router evidence')
class WebCspResponses(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        version = subprocess.check_output([CADDY, 'version'], text=True)
        if not version.startswith('v2.10.2 '):
            raise RuntimeError('Use the production-pinned Caddy v2.10.2')
        cls.temp = tempfile.TemporaryDirectory(prefix='asa-web-csp-')
        root = Path(cls.temp.name)
        (root / 'index.html').write_text('<!doctype html><title>ASA fixture</title>', encoding='utf-8')
        (root / 'public-page.html').write_text('<!doctype html><title>Public fixture</title>', encoding='utf-8')
        cls.upstream = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Upstream)
        cls.upstream_thread = threading.Thread(target=cls.upstream.serve_forever, daemon=True)
        cls.upstream_thread.start()
        cls.port = free_port()
        config = SOURCE.read_text(encoding='utf-8').replace('\n:8080 {', f'\nhttp://127.0.0.1:{cls.port} {{', 1)
        config = config.replace('root * /srv', f'root * "{root.as_posix()}"')
        for host in ['api:4611', 'scratch:8080']:
            config = config.replace(host, f'127.0.0.1:{cls.upstream.server_port}')
        config_path = root / 'Caddyfile'
        config_path.write_text(config, encoding='utf-8')
        env = {**os.environ, 'ASA_BUILD_REVISION': 'synthetic-csp-fixture',
               'ASA_INGRESS_TRUSTED_PROXY_CIDRS': '127.0.0.1/32 ::1/128'}
        adapted = subprocess.run([CADDY, 'adapt', '--config', str(config_path), '--adapter', 'caddyfile'],
                                 capture_output=True, text=True, env=env)
        if adapted.returncode:
            raise RuntimeError('Fixture adaptation failed: ' + adapted.stderr)
        json.loads(adapted.stdout)
        cls.logs = (root / 'caddy.log').open('wb')
        cls.process = subprocess.Popen([CADDY, 'run', '--config', str(config_path), '--adapter', 'caddyfile'],
                                       stdout=cls.logs, stderr=cls.logs, env=env)
        deadline = time.monotonic() + 10
        while True:
            try:
                cls.response('/')
                break
            except OSError:
                if cls.process.poll() is not None or time.monotonic() >= deadline:
                    cls.tearDownClass()
                    raise RuntimeError('Fixture Caddy did not start') from None
                time.sleep(0.05)

    @classmethod
    def tearDownClass(cls):
        if hasattr(cls, 'process') and cls.process.poll() is None:
            cls.process.terminate()
            cls.process.wait(timeout=10)
        cls.upstream.shutdown()
        cls.upstream.server_close()
        cls.upstream_thread.join()
        cls.logs.close()
        cls.temp.cleanup()

    @classmethod
    def response(cls, path):
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        try:
            return opener.open(f'http://127.0.0.1:{cls.port}{path}', timeout=2)
        except urllib.error.HTTPError as error:
            return error

    def test_html_entry_spa_and_public_pages_have_enforced_boundary(self):
        for path in ['/', '/index.html', '/projects/synthetic', '/public-page.html']:
            with self.response(path) as response:
                self.assertEqual(response.status, 200)
                policy = response.headers['Content-Security-Policy']
                for directive in ["base-uri 'self'", "object-src 'none'", "frame-ancestors 'none'", "form-action 'self'"]:
                    self.assertIn(directive, policy)
                # Script restrictions are deliberately not enforced before browser qualification.
                self.assertNotIn('script-src', policy)

    def test_script_worker_wasm_candidates_are_report_only(self):
        with self.response('/') as response:
            policy = response.headers['Content-Security-Policy-Report-Only']
            self.assertIn("script-src 'self' 'wasm-unsafe-eval' https://st.max.ru", policy)
            self.assertIn("worker-src 'self' blob:", policy)
            self.assertNotIn('report-uri http', policy)
            self.assertNotIn('upgrade-insecure-requests', policy)

    def test_api_and_health_retain_upstream_policy(self):
        for path in ['/api/probe', '/health/probe']:
            with self.response(path) as response:
                self.assertEqual(response.headers['Content-Security-Policy'], "default-src 'none'; frame-ancestors 'none'")
                self.assertIsNone(response.headers.get('Content-Security-Policy-Report-Only'))

    def test_embedded_editor_retains_its_same_origin_frame_boundary(self):
        with self.response('/internal/blocks/probe') as response:
            self.assertEqual(response.headers['Content-Security-Policy'], "frame-ancestors 'self'")
            self.assertIsNone(response.headers.get('Content-Security-Policy-Report-Only'))


if __name__ == '__main__':
    unittest.main()
