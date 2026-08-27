# MODO Video V1.7 — Media Lab

A V1.7 adiciona controle da matéria-prima visual por cena sem alterar o cérebro estratégico da MODO.

## Escopo

- upload de PNG, JPEG, WebP ou MP4 por cena;
- imagens até 12 MB e MP4 até 24 MB;
- validação de assinatura do arquivo no backend;
- foco horizontal e vertical;
- zoom entre 1x e 2.5x;
- trim inicial para MP4 enviado pelo Media Lab, respeitando a duração mínima da cena;
- mídia enviada entra automaticamente na biblioteca de takes;
- restauração de take sem nova chamada a Pexels/OpenAI;
- alteração reabre somente a cena afetada e a aprovação final do vídeo;
- isolamento por organização, projeto e cena.

## Persistência dos ajustes

O arquivo continua armazenado uma única vez em `modo_video_scene_assets`. Crop, zoom e trim são parâmetros de composição persistidos no URL do asset da cena (`mlfx`, `mlfy`, `mlz`, `mltrim`, `mldur`). Isso preserva os ajustes em retry/rerender sem criar uma tabela de edição nem duplicar a mídia.

## Princípio de produto

O Media Lab controla a execução da cena. Roteiro, objetivo, memória, inteligência, Quality Gate e direção estratégica continuam pertencendo ao fluxo principal da MODO.
