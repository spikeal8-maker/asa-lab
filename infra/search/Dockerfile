# syntax=docker/dockerfile:1
# Official multi-platform image, resolved from the registry on 2026-10-25.
FROM docker.io/searxng/searxng:2026.10.25-54ca1d9cf@sha256:23482d8ecf7ddf66029479468ea04c1bb11d2b65785a17a7e629e2ffd13296ca

ARG ASA_BUILD_REVISION=unknown
LABEL org.opencontainers.image.revision="${ASA_BUILD_REVISION}" \
      org.opencontainers.image.source="https://github.com/spikeal8-maker/asa-lab" \
      org.opencontainers.image.licenses="AGPL-3.0-or-later" \
      asa.search.upstream.revision="54ca1d9cfb08674f66261d7f351b063558dfcc62"
USER root
COPY --chown=977:977 infra/search/settings.json /usr/local/share/asa-search/settings.json
COPY --chown=977:977 infra/search/start.py /usr/local/share/asa-search/start.py
COPY --chown=977:977 infra/search/asa_search_app.py /usr/local/share/asa-search/asa_search_app.py
RUN printf '%s\n' "$ASA_BUILD_REVISION" > /usr/local/share/asa-search/asa-commit.txt \
    && chmod 0444 /usr/local/share/asa-search/asa-commit.txt
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONPATH=/usr/local/share/asa-search:/usr/local/searxng \
    SEARXNG_SETTINGS_PATH=/tmp/asa-search/settings.yml \
    GRANIAN_HOST=0.0.0.0 \
    GRANIAN_PORT=8080 \
    GRANIAN_WORKERS=1 \
    GRANIAN_BLOCKING_THREADS=4 \
    GRANIAN_LOG_LEVEL=error \
    GRANIAN_ACCESS_LOG=false
USER 977:977
ENTRYPOINT ["/usr/local/searxng/.venv/bin/python", "/usr/local/share/asa-search/start.py"]
