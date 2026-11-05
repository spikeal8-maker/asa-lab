"""Real OCI byte parsing and bounded HTTP doubles; no Docker or cache writes."""
import gzip
import hashlib
import io
import json
from pathlib import Path
import sys
import tarfile
import unittest
from unittest.mock import patch
import urllib.request

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from deployment import release_readonly as read
from deployment.contracts import Blocked

REVISION = "a" * 40
RELEASE = {"format": "asa-deployment-v2", "repository": "spikeal8-maker/asa-lab", "revision": REVISION,
           "schema": 304, "platform": "linux/amd64", "publicationRunId": 1,
           "images": {name: "ghcr.io/spikeal8-maker/asa-lab/" + name + "@sha256:" + "b" * 64
                      for name in ("api", "web", "scratch", "minio", "search")}}


def layer(entries=None):
    output = io.BytesIO()
    with tarfile.open(fileobj=output, mode="w", format=tarfile.USTAR_FORMAT) as archive:
        for name, content, kind in entries or [("release.json", json.dumps(RELEASE).encode(), tarfile.REGTYPE)]:
            info = tarfile.TarInfo(name)
            info.type = kind
            info.size = len(content) if kind == tarfile.REGTYPE else 0
            if kind in (tarfile.SYMTYPE, tarfile.LNKTYPE):
                info.linkname = "elsewhere"
            archive.addfile(info, io.BytesIO(content) if info.size else None)
    return gzip.compress(output.getvalue())


class RegistryFixture:
    def __init__(self, index=True):
        self.blobs, self.manifests, self.calls = {}, {}, []
        def descriptor(body, media):
            digest = "sha256:" + hashlib.sha256(body).hexdigest()
            self.blobs[digest] = body
            return {"digest": digest, "size": len(body), "mediaType": media}
        manifest = {"schemaVersion": 2, "mediaType": read.MANIFEST_TYPES[0],
                    "config": descriptor(b'{"os":"linux","architecture":"amd64"}', "application/vnd.oci.image.config.v1+json"),
                    "layers": [descriptor(layer(), read.LAYER_TYPES[1])]}
        self.leaf = "sha256:" + hashlib.sha256(json.dumps(manifest).encode()).hexdigest()
        self.manifests[self.leaf] = (manifest, self.leaf)
        root = {"schemaVersion": 2, "mediaType": read.INDEX_TYPES[0], "manifests": [
            {"mediaType": read.MANIFEST_TYPES[0], "digest": self.leaf, "size": 1000,
             "platform": {"os": "linux", "architecture": "amd64"}},
            {"mediaType": read.MANIFEST_TYPES[0], "digest": "sha256:" + "f" * 64, "size": 1000,
             "platform": {"os": "unknown", "architecture": "unknown"}}]} if index else manifest
        self.pin = "sha256:" + hashlib.sha256(json.dumps(root).encode()).hexdigest()
        self.manifests[self.pin] = (root, self.pin)
        self.manifests["stable"] = self.manifests[self.pin]

    def manifest(self, reference):
        self.calls.append(reference)
        return self.manifests[reference]

    def blob(self, descriptor, maximum):
        self.calls.append(descriptor["digest"])
        body = self.blobs[descriptor["digest"]]
        assert len(body) <= maximum
        return body


class ReadOnlyReleaseTests(unittest.TestCase):
    def test_index_pins_both_selection_and_platform_manifest_and_verifies_ci(self):
        reader = RegistryFixture()
        with patch.object(read, "assert_ci") as ignored:
            ci = []
            result = read.resolve_release(reader=reader, verify_ci=ci.append)
        self.assertEqual(ci, [RELEASE])
        self.assertEqual(result["deploymentDigest"], reader.pin)
        self.assertEqual(result["manifestDigest"], reader.leaf)
        self.assertEqual(result["release"], RELEASE)
        self.assertEqual(reader.calls[:2], ["stable", reader.leaf])
        ignored.assert_not_called()

    def test_prior_pin_survives_stable_movement(self):
        reader = RegistryFixture()
        selected = read.resolve_release(reader=reader, verify_ci=lambda value: None)
        reader.manifests["stable"] = ({"schemaVersion": 999}, "sha256:" + "9" * 64)
        pinned = read.resolve_release(selected["deploymentDigest"], reader=reader, verify_ci=lambda value: None)
        self.assertEqual(pinned["release"], selected["release"])
        self.assertEqual(pinned["deploymentDigest"], selected["deploymentDigest"])

    def test_tar_links_paths_extra_files_and_oversize_rejected(self):
        cases = [layer([("../release.json", b"{}", tarfile.REGTYPE)]),
                 layer([("/release.json", b"{}", tarfile.REGTYPE)]),
                 layer([("release.json", b"", tarfile.SYMTYPE)]),
                 layer([("release.json", b"", tarfile.LNKTYPE)]),
                 layer([("release.json", b"x" * 65536, tarfile.REGTYPE)]),
                 layer([("release.json", json.dumps(RELEASE).encode(), tarfile.REGTYPE), ("extra", b"x", tarfile.REGTYPE)]),
                 gzip.compress(b"x" * (read.TAR_LIMIT + 1))]
        for body in cases:
            with self.subTest(size=len(body)), self.assertRaises(Blocked):
                read.release_from_layer(body, read.LAYER_TYPES[1])

    def test_unknown_or_ambiguous_platform_is_blocked(self):
        for mode in ("multiple", "missing"):
            reader = RegistryFixture()
            manifest = reader.manifests["stable"][0]
            manifest["manifests"] = manifest["manifests"][:1] * 2 if mode == "multiple" else []
            with self.assertRaises(Blocked):
                read.resolve_release(reader=reader, verify_ci=lambda value: None)

    def test_registry_checks_real_digest_size_and_no_external_urls(self):
        reader = read.RegistryReader()
        body = b"actual bytes"
        digest = "sha256:" + hashlib.sha256(body).hexdigest()
        descriptor = {"digest": digest, "size": len(body)}
        with patch.object(reader, "_read", return_value=(body, None)):
            self.assertEqual(reader.blob(descriptor, 100), body)
            for invalid in ({**descriptor, "size": 1}, {**descriptor, "digest": "sha256:" + "0" * 64},
                            {**descriptor, "urls": ["https://attacker.invalid/payload"]}):
                with self.assertRaises(Blocked):
                    reader.blob(invalid, 100)

    def test_redirect_strips_token_and_rejects_unknown_origins(self):
        handler = read._Redirect()
        request = urllib.request.Request("https://ghcr.io/v2/x/blobs/sha256:" + "a" * 64,
                                         headers={"Authorization": "Bearer SECRET", "Other": "PRIVATE"})
        allowed = handler.redirect_request(request, None, 307, "redirect", {}, "https://pkg-containers.githubusercontent.com/blob?sig=value")
        self.assertIsNone(allowed.get_header("Authorization"))
        self.assertIsNone(allowed.get_header("Other"))
        for url in ("https://attacker.invalid/blob", "http://pkg-containers.githubusercontent.com/blob",
                    "https://user:pass@pkg-containers.githubusercontent.com/blob", "https://pkg-containers.githubusercontent.com:444/blob"):
            with self.assertRaises(Blocked):
                handler.redirect_request(request, None, 307, "redirect", {}, url)

    def test_http_body_limit_is_enforced_before_json_and_errors_are_sanitized(self):
        class Response(io.BytesIO):
            headers = {"Content-Length": "65537"}
        reader = read.RegistryReader()
        with patch.object(reader.opener, "open", return_value=Response(b"secret")), self.assertRaises(Blocked) as failure:
            reader._read("https://ghcr.io/token", 65536, auth=False)
        self.assertNotIn("secret", str(failure.exception))

    def test_failed_ci_is_not_an_available_release(self):
        def fail(value):
            raise Blocked("CI_BLOCKED", "blocked", "wait")
        with self.assertRaisesRegex(Blocked, "blocked"):
            read.resolve_release(reader=RegistryFixture(index=False), verify_ci=fail)


if __name__ == "__main__":
    unittest.main()
