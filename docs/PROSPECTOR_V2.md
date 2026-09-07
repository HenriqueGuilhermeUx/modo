# MODO Prospector V2

## Runtime variables

- `APIFY_TOKEN`: token da conta Apify usada pelo backend.
- `APIFY_PROSPECTOR_ACTOR_ID`: actor compatível com o adapter MODO. O actor recebe `segment`, `roles`, `location`, `companySize`, `offer`, `maxItems` e `searchQuery`.
- `APIFY_BASE_URL`: opcional; padrão `https://api.apify.com/v2`.
- `OPENAI_API_KEY`: já usada pelo motor MODO; habilita rascunhos personalizados de outbound.
- `OPENAI_TEXT_MODEL`: opcional; modelo de texto do motor.

## Endpoints

- `GET /api/v1/prospector/health`
- `POST /api/v1/prospector/campaigns`
- `GET /api/v1/prospector/campaigns`
- `POST /api/v1/prospector/campaigns/:id/discover`
- `GET /api/v1/prospector/campaigns/:id/leads`
- `PATCH /api/v1/prospector/leads/:id/status`
- `POST /api/v1/prospector/leads/:id/approach`

O discovery é multi-provider por design. Apify é o primeiro adapter; o domínio do Prospector não depende do formato interno do provider.