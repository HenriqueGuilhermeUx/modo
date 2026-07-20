# MODO LinkedIn

## Operating modes

### Manual mode

Available without LinkedIn credentials:

- specialized LinkedIn content creation;
- approval in MODO Create;
- copy final post;
- generate and download PDF document;
- manual publication history.

### Connected mode

Enabled after creating and configuring an official LinkedIn application:

- OAuth connection;
- encrypted token storage;
- profile or organization author;
- publish text posts;
- publish PDF documents;
- schedule publication;
- publication status and failure history.

## LinkedIn Developer configuration

1. Create an application in LinkedIn Developers.
2. Associate the application with the MODO company page when requested.
3. Enable the product required for member sign-in and the product **Share on LinkedIn**.
4. Configure this exact redirect URL:

```text
https://modo-api-3m10.onrender.com/api/v1/linkedin/callback
```

5. For organization pages, request Community Management API access and the permissions required for organization publishing.

## Render environment

```env
PUBLIC_WEB_URL=https://modo1.netlify.app
LINKEDIN_CLIENT_ID=YOUR_CLIENT_ID
LINKEDIN_CLIENT_SECRET=YOUR_CLIENT_SECRET
LINKEDIN_REDIRECT_URI=https://modo-api-3m10.onrender.com/api/v1/linkedin/callback
LINKEDIN_SCOPES=r_liteprofile w_member_social
LINKEDIN_TOKEN_ENCRYPTION_SECRET=A_RANDOM_SECRET_WITH_AT_LEAST_32_CHARACTERS
LINKEDIN_API_VERSION=202606
```

Do not put these credentials in Netlify, GitHub or frontend code.

For organization publishing, add the approved organization scope to `LINKEDIN_SCOPES` after LinkedIn grants access. The user must also be authorized to publish for the selected organization.

## Routes

```text
GET  /api/v1/linkedin/status
POST /api/v1/linkedin/connect
GET  /api/v1/linkedin/callback
POST /api/v1/linkedin/disconnect
GET  /api/v1/linkedin/publications
POST /api/v1/linkedin/publications
GET  /api/v1/linkedin/content/:id/document
```

## Security

- OAuth state is single-use and expires.
- Access tokens are encrypted with AES-256-GCM before persistence.
- Tokens never reach the browser after exchange.
- Publication requires an authenticated MODO session.
- Only approved LinkedIn content can be sent to publication.
- Document uploads use the official Documents API flow.

## Restrictions

MODO must not automate connection requests, profile visits, mass direct messages, likes, comments, scraping or simulated browser activity. Publishing and analytics must use official APIs and approved permissions.

## Organization URN

The initial interface accepts the organization URN manually:

```text
urn:li:organization:123456
```

A future approved organization lookup can replace manual input without changing the publication model.
