# MODO — Fluxo de geração de conteúdo no n8n

Este fluxo recebe pedidos da API MODO, gera conteúdo estruturado com a OpenAI e devolve o resultado ao callback protegido da API.

Arquivo para importação:

```text
n8n/workflows/modo-content-generation.json
```

## 1. Crie as credenciais no n8n

### MODO Content Secret

Crie uma credencial do tipo **Header Auth**:

```text
Name: x-modo-content-secret
Value: o mesmo segredo configurado em N8N_CONTENT_SECRET no Render
```

Nome sugerido para a credencial:

```text
MODO Content Secret
```

A mesma credencial é usada no webhook de entrada e no callback para a API MODO.

### OpenAI API Key

Crie outra credencial do tipo **Header Auth**:

```text
Name: Authorization
Value: Bearer SUA_OPENAI_API_KEY
```

Nome sugerido:

```text
OpenAI API Key
```

Nunca coloque a chave OpenAI no frontend, no GitHub ou no payload do webhook.

## 2. Importe o workflow

1. No n8n, abra **Workflows**.
2. Escolha **Import from File**.
3. Importe `modo-content-generation.json`.
4. No node **MODO Content Webhook**, selecione a credencial `MODO Content Secret`.
5. No node **OpenAI Structured Content**, selecione `OpenAI API Key`.
6. No node **Return Result to MODO**, selecione novamente `MODO Content Secret`.
7. Salve e publique/ative o workflow.

## 3. Copie a Production URL

No node **MODO Content Webhook**, copie a **Production URL**. Ela será semelhante a:

```text
https://seu-n8n.com/webhook/modo-content-generation
```

Use a URL de produção, não a URL de teste.

## 4. Configure o Render

No serviço `modo-api`, configure:

```env
PUBLIC_API_URL=https://modo-api-3m10.onrender.com
CONTENT_PROVIDER=n8n
N8N_CONTENT_WEBHOOK_URL=https://SEU-N8N/webhook/modo-content-generation
N8N_CONTENT_SECRET=O_MESMO_SEGREDO_DA_CREDENCIAL_N8N
```

Depois faça **Manual Deploy → Deploy latest commit**.

O health esperado passa a incluir:

```json
{
  "version": "0.7.0",
  "contentProvider": "n8n"
}
```

## 5. Fluxo de dados

```text
Cliente cria pedido
→ API valida assinatura, marca e créditos
→ PostgreSQL registra o pedido
→ API envia pedido ao n8n
→ n8n chama OpenAI Responses API com Structured Outputs
→ n8n envia resultado ao callback da API
→ API valida o segredo e o schema
→ conteúdo fica pronto para revisão
→ cliente aprova ou solicita revisão
```

## 6. Contrato do callback

Sucesso:

```json
{
  "status": "completed",
  "providerRunId": "resp_...",
  "output": {
    "hook": "...",
    "title": "...",
    "caption": "...",
    "cta": "...",
    "hashtags": ["#exemplo"],
    "visualDirection": "...",
    "slides": [],
    "script": [],
    "storyFrames": [],
    "adaptationNotes": []
  }
}
```

Falha:

```json
{
  "status": "failed",
  "providerRunId": "resp_...",
  "error": "Descrição do problema"
}
```

O callback deve enviar o header:

```text
x-modo-content-secret: valor de N8N_CONTENT_SECRET
```

## 7. Teste operacional

1. Crie ou use uma conta MODO com créditos.
2. Cadastre uma marca.
3. Abra `/app/content`.
4. Crie um post estático.
5. Confirme no n8n uma execução do workflow.
6. Confirme no portal a mudança:

```text
Na fila → Em produção → Pronto para revisar
```

7. Abra os detalhes do conteúdo.
8. Aprove a entrega ou solicite uma revisão.
9. Confirme que uma revisão não consome novos créditos e respeita o limite do plano.

## 8. Segurança e operação

- O webhook de entrada usa autenticação por header.
- O callback usa comparação segura do segredo.
- A chave OpenAI fica somente na credencial do n8n.
- A chamada à OpenAI usa `store: false`.
- O resultado é validado por Structured Outputs no n8n e novamente por Zod na API.
- Falhas de disparo podem ser reenviadas pelo cliente sem novo consumo de créditos.
- Execuções bem-sucedidas do n8n podem ficar sem dados salvos; falhas devem ser preservadas para diagnóstico.
