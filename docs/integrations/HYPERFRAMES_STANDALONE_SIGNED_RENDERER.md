# MODO — renderizador estático independente com envelope Ed25519

**Situação:** experimento **exclusivamente sintético**, PR #164 DRAFT, sem merge/deploy ou ativação em produção.

## Objetivo da separação

O ensaio anterior comprovou que Chrome CDP + FFmpeg consegue produzir um MP4 real no Docker offline, inclusive com cenas de um `VideoProject` MODO validadas pelo exportador read-only. Este incremento remove o código do backend e as bibliotecas PostgreSQL **da imagem do navegador**.

- `infra/hyperframes-staging/static-renderer.Dockerfile`: imagem de renderer independente; inclui somente Node 22, `puppeteer-core` fixado, Chrome Headless Shell **152.0.7977.30** e FFmpeg. Não copia `apps/api`, contratos, variáveis da API, migrações ou código do banco. A imagem antiga do worker é preservada separadamente.
- `infra/hyperframes-staging/static-renderer-sign-synthetic.mjs`: executado **fora** do navegador em runner descartável, compila/reutiliza `buildStaticStoryboardPlan` (que chama o validador MODO), gera um pedido para cenas fictícias **31+64+55 quadros**, e assina bytes exatos do payload com chave privada Ed25519 **gerada só em memória**. Somente a chave **pública**, pedido assinado e casos negativos são gravados em diretório temporário. O arquivo de chave privada nunca é criado.
- `infra/hyperframes-staging/static-renderer-standalone.cjs`: recebe apenas `/input/order.json` + `/input/public-key.pem`, montados read-only. Verifica assinatura Ed25519 sobre os bytes exatos da mensagem, audiência, versão, id sintético, emissão/expiração curta, sequência de frames inteira, formato, textos, limites de tamanho e ausência de segredos antes de abrir o navegador. Gera HTML do zero com escape de caracteres, sem executar HTML ou JS fornecido na ordem; escopo: **estáticos com cortes secos, sem voz, assets ou movimento**.
- `.github/workflows/hyperframes-standalone-signed-renderer-ci.yml`: cria imagem independente e rede Docker `--internal`, testa rejeição de assinatura modificada e prazo vencido, depois renderiza vídeo sintético válido. Exige **150 quadros, 1080×1920, H264 30fps, 5 segundos**, com FFprobe; remove PNG e MP4 temporários sem fazer upload.

## Contrato experimental

Arquivo `order.json` contém `payloadB64` (JSON UTF-8 codificado em Base64URL) e `signatureB64` (assinatura Ed25519 detached, Base64URL). Um exemplo do payload **não assinado**, apenas ilustrativo:

```json
{
  "version": 1,
  "audience": "modo-static-renderer-synthetic-ci-v1",
  "issuedAtMs": 0,
  "expiresAtMs": 0,
  "jobId": "synthetic-uuid",
  "brandName": "Marca Sintética",
  "accentColor": "#2ED19A",
  "width": 1080,
  "height": 1920,
  "fps": 30,
  "totalFrames": 150,
  "scenes": [
    {"startFrame": 0, "endFrame": 31, "headline": "Primeira cena sintética", "caption": "Quadros 0 a 30"},
    {"startFrame": 31, "endFrame": 95, "headline": "Segunda cena sintética", "caption": "Quadros 31 a 94"},
    {"startFrame": 95, "endFrame": 150, "headline": "Terceira cena sintética", "caption": "Quadros 95 a 149"}
  ]
}
```

Os tempos zero são **placeholders de documentação**, não pedidos válidos. Na CI, emissão real e expiração são verificadas no relógio da execução; não existe chave privada persistente. Não montar um diretório que contenha credenciais dentro do navegador; disponibilizar somente os dois arquivos necessários.

## Limitações e bloqueadores de produção

1. **Autenticidade não é autorização de tenant.** O envelope sintético não possui escopo real de organização, nem canal operacional autenticado, controle de replay, rotação/revogação de chaves, auditoria imutável ou autorização de serviço. Tudo isso deve existir antes de transportar pedidos de clientes.
2. O browser mantém `--no-sandbox` **internamente**; o Docker externo deve ter usuário não-root, rootfs read-only, sem capabilities, `no-new-privileges`, limites de CPU/RAM/PID, e rede `--internal` privada. Um ambiente comercial exigirá revisão de isolamento por tenant, redes e defesa em profundidade. Rede interna sem gateway não impede contato entre pares deliberadamente na mesma rede.
3. O renderer **não processa mídia/HTML do cliente**; somente strings de texto escapadas na própria imagem. Não temos comparação visual quadro a quadro com o Remotion de produção, equivalência tipográfica/fontes nem suporte a motion/áudio.
4. O MP4 sintético **não** é gravado no PostgreSQL, nem publicado. A integração com o one-shot worker exige mecanismo de handoff efêmero e resposta assinada, segregação de permissões e testes de reconciliação antes de entrar na fila/ledger.
5. O **CLI HyperFrames 0.8.207** continua com teste separado e reprovado no Docker restrito (`Network.enable timed out`). A prova FFmpeg não deve ocultar essa falha.

**Release gate:** permanecer em PR DRAFT, sem merge/deploy nem conteúdo de clientes; primeiro comprovar o CI dedicado, auditar imagem mínima, endurecer canal assinado e confrontar frames/textos com Remotion em laboratório separado.
