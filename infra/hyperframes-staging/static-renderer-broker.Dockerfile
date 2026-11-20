# CI-only per-run pinned broker identity; no secret is copied or mounted.
FROM modo-hf-static-receipt:ci
USER root
COPY attest-public.pem /opt/hf-broker-pinned.pem
RUN test -s /opt/hf-broker-pinned.pem && chmod 0444 /opt/hf-broker-pinned.pem
USER 10001:10001
