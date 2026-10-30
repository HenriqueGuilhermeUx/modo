# MODO / HyperFrames — piloto de exportação isolada

O MODO já usa Remotion e possui fluxos de vídeo em produção. **Não substituir** esse motor.
A função buildHyperframesPilot (apps/api/src/services/hyperframes-pilot.ts)
exporta um index.html com composição, clips cronometrados e texto escapado, usando
o contrato HTML publicado pelo HyperFrames.

## Status e teste

- Implementado: composição HTML segura e isolada, 9:16 / 1:1 / 16:9, duração de até 60 segundos.
- Não implementado: worker, filas, FFmpeg, MP4, upload, preview integrado e Publisher V2.
- Validar: npm run test --workspace=@modo/api
- Para prova de renderização, em AMBIENTE DESCARTÁVEL com Node 22+ e FFmpeg,
  escreva a string html retornada para index.html e execute os comandos oficiais
  do HyperFrames: npx hyperframes lint, npx hyperframes check,
  npx hyperframes render --output final.mp4
- Não instalar dependências no Render de produção nem mudar nenhuma rota pública.
- Revisar o HTML de saída no lint/check antes de habilitar um pipeline.
- Limitar consumo de CPU, memória, duração, mídia e concorrência por organização.
- Revisar termos de mídias/fontes e registrar autoria/licenças.

Fonte: https://github.com/heygen-com/hyperframes (Apache-2.0).

## Contrato inicial para Agentics

Ferramenta creative.storyboard_export escopo modo.video.preview.
Entrada: brandName, accentColor, format, scenes; saída: HTML para worker
isolado de pré-visualização. Sem autorização para publicar ou agendar.
A ferramenta NÃO será exposta no núcleo Agentics até passar em testes.


## Próxima etapa: exportação autenticada de projetos existentes

A PR adiciona a rota opt-in:
`GET /api/v1/video-projects/:id/hyperframes-preview`

- Exige o mesmo token Bearer e consulta da organização/marca que as rotas de vídeo.
- Só é registrada com `MODO_HYPERFRAMES_PREVIEW_ENABLED=true`.
- Retorna objeto `preview` com o `index.html`, metadados e
  `publishingAllowed=false`. Não executa render, não cobra e não altera estado.
- Os projetos já criados no Remotion permanecem com seu renderizador original.
- Projetos com mais de oito cenas ou cenas acima de 12 segundos recebem HTTP 422;
  não modificar a sequência nem descartar cenas silenciosamente.
- Testes: `hyperframes-project-preview.test.ts`, em conjunto com o teste
  anterior. Antes de habilitar em staging, confirmar autenticação/isolamento por
  tenant com chamadas HTTP reais.

Este recurso é um exportador de preview técnico, não um vídeo visível na interface.


## MP4 smoke with content-integrity gate

The isolated GitHub Actions job renders a five-second, 1080×1920, 30 fps
synthetic two-scene composition and verifies:
- HyperFrames lint/check;
- success of MP4 production in a disposable runner;
- ffprobe resolution, frame rate and duration bounds;
- decoded frames at 1s and 4s have different MD5 hashes.

The verified artifact is retained for one day. This does not test uploaded
customer assets, audio, billing, render concurrency, or the Publisher V2.


## Feature-flagged review screen, no publication
A test-only panel has been added to the MODO Video V1.8 screen behind
`VITE_HYPERFRAMES_PREVIEW_ENABLED=true`. It calls the authenticated,
tenant-scoped `/hyperframes-preview` endpoint only when a human requests
an HTML export. The backend additionally requires
`MODO_HYPERFRAMES_PREVIEW_ENABLED=true` at startup.

This panel does not run returned HTML in the browser, never calls the
publisher, creates no job and sends no media to a new provider. Unsupported
projects remain on Remotion. It is a manual technical-download experience,
not a usable new public video renderer.
