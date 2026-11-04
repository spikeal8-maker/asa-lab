"""Bounded, disk-free discovery of the published scratch deployment image.

Only metadata is read. No Docker CLI, cache, extraction or image pull is used.
The supported OCI filesystem is deliberately narrow: one plain release.json.
"""
from __future__ import annotations

import datetime as dt
import gzip
import hashlib
import io
import json
import re
import tarfile
import urllib.error
import urllib.parse
import urllib.request

from .contracts import Blocked, REPOSITORY, require, validate_release
from .releases import assert_ci, validate_deployment_digest

REGISTRY = "https://ghcr.io"
IMAGE = REPOSITORY + "/deployment"
JSON_LIMIT = 1024 * 1024
LAYER_LIMIT = 1024 * 1024
TAR_LIMIT = 2 * 1024 * 1024
RELEASE_LIMIT = 65535
MANIFEST_TYPES = ("application/vnd.oci.image.manifest.v1+json", "application/vnd.docker.distribution.manifest.v2+json")
INDEX_TYPES = ("application/vnd.oci.image.index.v1+json", "application/vnd.docker.distribution.manifest.list.v2+json")
LAYER_TYPES = ("application/vnd.oci.image.layer.v1.tar", "application/vnd.oci.image.layer.v1.tar+gzip",
               "application/vnd.docker.image.rootfs.diff.tar.gzip")


def _error(code="RELEASE_UNAVAILABLE"):
    return Blocked(code, "Не удалось проверить опубликованный выпуск.",
                   "Проверьте доступ к GHCR/GitHub; установка и Docker не изменены.")


class _Redirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, message, headers, newurl):
        source, target = urllib.parse.urlsplit(request.full_url), urllib.parse.urlsplit(newurl)
        # GHCR sends public blobs to its signed GitHub storage URL. Never
        # forward the registry bearer (or a GitHub token) to the blob host.
        permitted = (source.hostname == "ghcr.io" and "/blobs/sha256:" in source.path
                     and target.hostname == "pkg-containers.githubusercontent.com")
        require(permitted and target.scheme == "https" and target.port in (None, 443)
                and not target.username and not target.password, "RELEASE_REDIRECT",
                "Перенаправление registry не входит в разрешённый маршрут.")
        return urllib.request.Request(newurl, headers={"User-Agent": "ASA-CLI/1"})


class RegistryReader:
    def __init__(self):
        self.opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), _Redirect())
        self.token = None
        self.requests = 0

    def _read(self, url, maximum, *, auth=True):
        self.requests += 1
        require(self.requests <= 10, "RELEASE_BUDGET", "Превышен бюджет чтения registry.")
        headers = {"User-Agent": "ASA-CLI/1", "Accept": ", ".join((*MANIFEST_TYPES, *INDEX_TYPES))}
        if auth and self.token:
            headers["Authorization"] = "Bearer " + self.token
        try:
            with self.opener.open(urllib.request.Request(url, headers=headers), timeout=12) as response:
                length = response.headers.get("Content-Length")
                require(length is None or length.isdigit() and int(length) <= maximum,
                        "RELEASE_SIZE", "Ответ registry превышает допустимый размер.")
                body = response.read(maximum + 1)
                require(len(body) <= maximum, "RELEASE_SIZE", "Ответ registry превышает допустимый размер.")
                return body, response.headers.get("Docker-Content-Digest")
        except urllib.error.HTTPError as exc:
            if exc.code == 401 and auth and self.token is None:
                # Do not trust a server-provided auth realm or scope URL.
                token_url = REGISTRY + "/token?" + urllib.parse.urlencode({"service": "ghcr.io", "scope": "repository:" + IMAGE + ":pull"})
                body, _ = self._read(token_url, 65536, auth=False)
                token = _json(body).get("token")
                require(isinstance(token, str) and 0 < len(token) <= 16384 and "\n" not in token and "\r" not in token,
                        "RELEASE_AUTH", "Registry не выдал допустимое разрешение чтения.")
                self.token = token
                return self._read(url, maximum)
            raise _error() from exc
        except (OSError, ValueError) as exc:
            raise _error() from exc

    def manifest(self, reference):
        require(reference == "stable" or re.fullmatch(r"sha256:[a-f0-9]{64}", reference),
                "RELEASE_SELECTOR", "Допустим stable или точный deployment digest.")
        body, declared = self._read(REGISTRY + "/v2/" + IMAGE + "/manifests/" + reference, JSON_LIMIT)
        digest = "sha256:" + hashlib.sha256(body).hexdigest()
        require(declared is None or declared == digest, "RELEASE_DIGEST_MISMATCH", "Digest manifest не совпал.")
        require(reference == "stable" or reference == digest, "RELEASE_DIGEST_MISMATCH", "Выбранный manifest изменился.")
        return _json(body), digest

    def blob(self, descriptor, maximum):
        require(isinstance(descriptor, dict) and type(descriptor.get("size")) is int
                and 0 < descriptor["size"] <= maximum and not descriptor.get("urls"),
                "RELEASE_SIZE", "Некорректный размер или внешний адрес OCI blob.")
        digest = validate_deployment_digest(descriptor.get("digest"))
        body, _ = self._read(REGISTRY + "/v2/" + IMAGE + "/blobs/" + digest, maximum)
        require(len(body) == descriptor["size"] and "sha256:" + hashlib.sha256(body).hexdigest() == digest,
                "RELEASE_DIGEST_MISMATCH", "OCI blob не соответствует manifest.")
        return body


def _json(body):
    try:
        def unique(pairs):
            result = {}
            for key, value in pairs:
                require(key not in result, "RELEASE_JSON", "Повторяющийся ключ в метаданных выпуска.")
                result[key] = value
            return result
        value = json.loads(body, object_pairs_hook=unique)
        require(isinstance(value, dict), "RELEASE_JSON", "Метаданные выпуска должны быть JSON object.")
        return value
    except (ValueError, UnicodeError, RecursionError) as exc:
        raise _error("RELEASE_JSON") from exc


def release_from_layer(body, media_type):
    require(media_type in LAYER_TYPES, "RELEASE_LAYER", "Этот формат OCI layer пока не поддерживается.")
    try:
        if media_type.endswith("gzip"):
            with gzip.GzipFile(fileobj=io.BytesIO(body)) as stream:
                body = stream.read(TAR_LIMIT + 1)
        require(len(body) <= TAR_LIMIT, "RELEASE_SIZE", "Распакованный OCI layer слишком велик.")
        with tarfile.open(fileobj=io.BytesIO(body), mode="r:") as archive:
            member = archive.next()
            require(member is not None and member.name == "release.json" and member.isfile()
                    and not member.issym() and not member.islnk() and not member.pax_headers
                    and member.size <= RELEASE_LIMIT and member.mode & 0o7000 == 0,
                    "RELEASE_LAYER", "OCI layer должен содержать только обычный release.json.")
            stream = archive.extractfile(member)
            require(stream is not None, "RELEASE_LAYER", "release.json недоступен.")
            content = stream.read(RELEASE_LIMIT + 1)
            require(len(content) == member.size and archive.next() is None,
                    "RELEASE_LAYER", "Неожиданный состав OCI layer.")
        return validate_release(_json(content))
    except (OSError, EOFError, tarfile.TarError) as exc:
        raise _error("RELEASE_LAYER") from exc


def resolve_release(deployment_digest=None, *, reader=None, verify_ci=assert_ci):
    """Return immutable selection and CI evidence; never persist a check result."""
    reader = reader or RegistryReader()
    reference = validate_deployment_digest(deployment_digest) if deployment_digest else "stable"
    manifest, selected_digest = reader.manifest(reference)
    manifest_digest = selected_digest
    for depth in range(3):
        require(manifest.get("schemaVersion") == 2, "RELEASE_OCI", "Неподдерживаемая схема OCI.")
        if manifest.get("mediaType") not in INDEX_TYPES:
            break
        descriptors = manifest.get("manifests")
        require(isinstance(descriptors, list) and 0 < len(descriptors) <= 128 and all(isinstance(x, dict) for x in descriptors),
                "RELEASE_OCI", "Некорректный OCI index.")
        matches = [item for item in descriptors if item.get("platform", {}).get("os") == "linux"
                   and item.get("platform", {}).get("architecture") == "amd64"
                   and item.get("platform", {}).get("variant") in (None, "")]
        require(len(matches) == 1 and depth < 2 and matches[0].get("mediaType") in (*INDEX_TYPES, *MANIFEST_TYPES),
                "RELEASE_PLATFORM", "Не найден единственный поддерживаемый linux/amd64 manifest.")
        manifest, manifest_digest = reader.manifest(validate_deployment_digest(matches[0].get("digest")))
    require(manifest.get("mediaType") in MANIFEST_TYPES, "RELEASE_OCI", "Неподдерживаемый OCI manifest.")
    layers = manifest.get("layers")
    require(isinstance(layers, list) and len(layers) == 1 and isinstance(layers[0], dict),
            "RELEASE_LAYER", "Поддерживается только опубликованный scratch deployment image.")
    config = _json(reader.blob(manifest.get("config"), 65536))
    require(config.get("os") == "linux" and config.get("architecture") == "amd64",
            "RELEASE_PLATFORM", "Платформа deployment image не поддерживается.")
    release = release_from_layer(reader.blob(layers[0], LAYER_LIMIT), layers[0].get("mediaType"))
    verify_ci(release)
    return {"release": release, "deploymentDigest": selected_digest, "manifestDigest": manifest_digest,
            "checkedAt": dt.datetime.now(dt.timezone.utc).isoformat(), "ci": "VERIFIED"}
