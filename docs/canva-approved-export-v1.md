# Canva pós-aprovação v1

## Regra de governança

A integração Canva não participa da geração nem da revisão. O fluxo obrigatório é:

1. a MODO gera estratégia, copy e imagem contextual;
2. o cliente revisa e pode solicitar alterações;
3. o cliente aprova explicitamente o conteúdo;
4. somente após a aprovação aparece a ação **Criar versão no Canva**;
5. o Canva recebe a imagem aprovada e cria um design editável na conta conectada;
6. nenhuma publicação ou ativação de campanha acontece automaticamente.

## Escopo técnico

A v1 usa somente endpoints estáveis do Canva Connect API:

- OAuth 2.0 Authorization Code com PKCE;
- upload binário de imagem como ativo do usuário;
- criação de design customizado com o ativo aprovado;
- leitura do design para renovar links temporários;
- revogação de conexão.

Tokens de acesso, refresh tokens e verificadores PKCE são criptografados com AES-256-GCM. As conexões e designs são isolados por organização. Refresh tokens rotativos são substituídos a cada renovação.

## Idempotência

Existe no máximo um design Canva por organização e pedido de conteúdo. Repetir a ação devolve o design já criado, evitando duplicações e novos uploads.

## Ativo enviado

A imagem é lida diretamente do armazenamento PostgreSQL da organização e do pedido aprovado. A API não aceita uma URL arbitrária fornecida pelo navegador, reduzindo o risco de importar conteúdo externo indevido.

## Limite conhecido da v1

O endpoint estável de criação de design insere a imagem aprovada como um elemento editável. Ele não cria, de forma estável e pública, caixas de texto independentes para título e CTA. A copy aprovada continua disponível no Studio e no Histórico da MODO para copiar e adaptar.

Brand Templates e Autofill podem ser adicionados em uma fase posterior, quando os recursos necessários estiverem disponíveis para integrações públicas e os templates de cada marca estiverem preparados.

## Variáveis de ambiente

```text
CANVA_CLIENT_ID
CANVA_CLIENT_SECRET
CANVA_REDIRECT_URI=https://modo-api-3m10.onrender.com/api/v1/canva/callback
CANVA_TOKEN_ENCRYPTION_SECRET
CANVA_SCOPES=asset:read asset:write design:content:write design:meta:read
```

Nunca colocar segredos no frontend ou no repositório.

## Configuração no Canva Developer Portal

1. Criar uma integração pública.
2. Habilitar apenas os escopos listados acima.
3. Registrar a URL de callback exatamente igual à variável `CANVA_REDIRECT_URI`.
4. Durante desenvolvimento, autorizar apenas usuários de teste permitidos.
5. Antes de liberar a todos os clientes, submeter a integração à revisão do Canva.
