# MoneyPrinterTurbo worker — deployment decision

Status: **not deployed**. The existing MODO API and website must not be changed by this experiment.

## Hosting gate

The currently available Render create-web-service operation creates a **public** HTTP
service and cannot configure a private service, ingress authentication proxy, disk,
or network isolation. Do **not** create a public MoneyPrinterTurbo API just to
get an MP4. Upstream `x-api-key` is necessary but not a substitute for network
isolation, per-tenant access controls, or artifact isolation.

Deploy only when an operator can provide:
- A private Docker host/network (or private Render service provisioned using
  an interface that supports private services), with no public ingress.
- A pinned reviewed MoneyPrinterTurbo revision, licensed local footage,
  and 6 GB+ RAM as a provisional sizing target (benchmark before production).
- A nonempty strong `[app].api_key`, stored in a secret manager, never in git.
- Egress and cost controls: no paid provider keys in the first test.
- A private connection from an operator to the worker (VPN or SSH tunnel);
  do not proxy through the production MODO API.
- Media retention policy, malware/format checks, and tenant-scoped storage
  before any future customer integration.

## Operator run (isolated host only)

1. Clone a pinned, reviewed MoneyPrinterTurbo upstream revision on the private
   host. Copy `config.example.toml` to `config.toml`; configure the nonempty key.
2. Place licensed source clips under `resource/`, prepare `storage/`, and
   review the local-media schema. Verify that the smoke JSON body includes
   valid `video_materials` for the pinned revision.
3. From the upstream checkout run:
   `docker compose -f /path/to/modo/docs/research/moneyprinterturbo-isolated.compose.yml --project-directory . up --build api`
4. Confirm Docker publishes port 8080 only on `127.0.0.1`.
5. Set `MPT_API_KEY` in the shell and run:
   `python /path/to/modo/scripts/moneyprinterturbo-smoke-runner.py`
6. Only after auth PASS and explicit approval of footage/voice costs, use
   `--render --brief /path/to/validated-body.json` to render a single video.
7. Inspect the resulting MP4 **on the private host**. Do not mark MODO's
   Creative Engine job `ready` until a separate tenant-scoped asset ingestion
   path is built and tested.

This is an operational checklist, **not** evidence of an executed Docker build,
a deployed worker, or a completed MP4.
