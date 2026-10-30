# MODO HyperFrames — auditoria de divergência visual versus Remotion

**Somente laboratório:** PR #164 DRAFT, sem merge, sem publicação, entradas exclusivamente fictícias. O Remotion comercial permanece inalterado e é a referência existente.

## Diferenças verificadas no código-fonte

| Propriedade | Remotion atual | HyperFrames independente |
|---|---|---|
| Dimensões | 720 × 1280 a 30 fps | 1080 × 1920 a 30 fps |
| Áudio | Trilha sonora gerada na composição | MP4 sintético possui somente vídeo |
| Cenários nativos | Gradientes, sobreposições e marcação de cenas por perfil | Fundo escuro plano e tipografia simplificada |
| Texto | Cartão posicionado com animação e tamanhos variáveis | Layout vertical centralizado e estático |
| Tempo | Sequências Remotion, transição e saída | Limites integrais 31/64/55 quadros, cortes estáticos |
| Mídia | Pode incluir imagem, vídeo e áudio | Recusa URLs externas e recursos não suportados |
| Publicação | Renderer comercial preservado | Nunca publica |

**Não há equivalência visual ou sonora comprovada.** As fontes comparadas são apps/api/src/video-remotion-entry.ts e infra/hyperframes-staging/static-renderer-standalone.cjs, sem mudar o Remotion.

## Medição sintética no GitHub Actions

O script static-remotion-visual-divergence-audit.mjs aceita o storyboard fictício já assinado com Ed25519 e o MP4 H.264 real do workflow, sob gate explícito de CI:

1. Confere assinatura, identidade, linha do tempo e um único stream de vídeo via FFprobe.
2. Compila a **entrada Remotion original** com @remotion/bundler e cenas ficcionais com o mesmo texto e timing, sem mídia remota.
3. Renderiza PNGs via @remotion/renderer.renderStill nos quadros interiores 8, 43 e 104.
4. Extrai esses mesmos quadros do MP4 HyperFrames com FFmpeg e normaliza para 720 × 1280 para comparação.
5. Calcula SSIM por quadro usando FFmpeg e emite hashes SHA-256 das imagens, média e o veredito NOT_VISUALLY_EQUIVALENT, com equivalenceApproved:false e releaseAllowed:false.

Os PNGs e relatórios temporários são destruídos no bloco finally. O MP4 original continua descartável e o workflow o elimina na limpeza. Nenhuma imagem comparada é publicada.

**Primeira auditoria quantitativa, não homologação pixel a pixel do vídeo completo.** Se o Remotion não renderizar no ambiente do CI, o erro será visível; não há substituição por screenshots fictícios.

## Próximos passos

Definir subset explícito de estilos e features, métricas de aprovação por quadro e equivalência de áudio, sem remover as salvaguardas de sandbox. Antes de liberar HTML, URL ou vídeo de cliente, fazer revisão de isolamento e segurança do browser.
