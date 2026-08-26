# MODO Video V1

## Produto

O MODO Video não é um segundo gerador de conteúdo. Ele recebe um `short_video_script` já produzido pela MODO e transforma a decisão estratégica existente em um vídeo vertical pronto para revisão.

Fluxo:

```text
Memory / Director
  -> short_video_script
  -> storyboard
  -> MODO Video Composer
  -> MP4 9:16
  -> revisão / aprovação
  -> Publisher
```

## Escopo V1

- entrada: `ContentRequest` do tipo `short_video_script`;
- duração: 15, 30 ou 45 segundos;
- proporção: 9:16;
- resolução: 720x1280;
- frame rate: 30 fps;
- codec: H.264 em MP4;
- renderer: Remotion;
- cenas: gancho + cenas do roteiro + CTA;
- texto de legenda: `voiceover` já escrito no roteiro;
- imagem: usa visual da cena quando disponível e cai para o criativo principal/gradiente;
- sem GPU;
- render assíncrono e serializado para preservar recursos do serviço da API;
- saída persistida no PostgreSQL para não depender do filesystem efêmero do Render;
- URL pública imutável com suporte a HTTP Range para preview e consumo por providers.

## O que deliberadamente não entrou

A V1 não inclui clonagem de voz, avatar, talking head ou geração pixel-a-pixel de vídeo. Esses recursos entram depois como providers opcionais e não alteram o cérebro da MODO.

Próximas camadas previstas:

1. TTS/voz opcional por interface de provider, com Chatterbox PT-BR como candidato;
2. lip-sync/avatar opcional com MuseTalk;
3. B-roll generativo opcional por provider/API;
4. transcrição/word timing com faster-whisper quando houver áudio externo;
5. worker dedicado e object storage quando volume real justificar separar render da API.

## Persistência e custo

`modo_video_renders` guarda metadados do projeto, storyboard e o MP4 em `BYTEA`. Isso é uma escolha de bootstrap: evita perda do arquivo em restart e permite validar demanda sem adicionar imediatamente outro serviço de storage.

Antes de escalar, medir:

- renders por organização/dia;
- tempo de render P50/P95;
- tamanho médio do MP4;
- crescimento mensal de armazenamento;
- CPU/memória durante Chromium/FFmpeg;
- falhas e retries.

Quando volume justificar, migrar `output_data` para object storage mantendo a mesma `outputUrl`/abstração pública.

## Concorrência

O renderer usa fila serial por processo (`concurrency: 1`). O objetivo é previsibilidade no plano atual do Render, não throughput máximo. Um worker/queue dedicado é a evolução correta quando houver demanda.

## Licença do renderer

Remotion fica isolado atrás do `VideoService`. A licença comercial do Remotion deve continuar sendo revisada conforme o tamanho da organização e mudanças de versão. A separação do renderer permite substituir Remotion/FFmpeg sem alterar contratos, conteúdo, Director, aprovação ou Publisher.

## Segurança e governança

- todos os projetos privados exigem sessão e isolamento por `organizationId`;
- a URL pública usa token UUID não enumerável e só existe quando o render está `ready`;
- conteúdo da estratégia não é exposto na URL pública: apenas o MP4 final;
- clonagem de voz e avatar, quando entrarem, exigirão consentimento explícito e trilha de auditoria;
- a MODO continua mantendo aprovação humana antes da publicação.
