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
