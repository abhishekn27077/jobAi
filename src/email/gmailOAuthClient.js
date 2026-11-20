import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TOKEN_DIR = path.resolve(__dirname, '../../data/.oauth_tokens');
const TOKEN_PATH = path.join(TOKEN_DIR, 'token.json');

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.compose'
];

export function isGmailConfigured() {
  const clientId = process.env.GMAIL_CLIENT_ID;
  const clientSecret = process.env.GMAIL_CLIENT_SECRET;
  return Boolean(clientId && clientSecret);
}

export function isGmailAuthenticated() {
  return fs.existsSync(TOKEN_PATH);
}

export function getGoogleAuthUrl() {
  const clientId = process.env.GMAIL_CLIENT_ID;
  const redirectUri = process.env.GMAIL_REDIRECT_URI || 'http://localhost:3000/oauth2callback';

  if (!clientId) {
    throw new Error('GMAIL_CLIENT_ID is not configured in environment or .env');
  }

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent'
  });

  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export async function exchangeCodeForTokens(authCode) {
  const clientId = process.env.GMAIL_CLIENT_ID;
  const clientSecret = process.env.GMAIL_CLIENT_SECRET;
  const redirectUri = process.env.GMAIL_REDIRECT_URI || 'http://localhost:3000/oauth2callback';

  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code: authCode,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code'
    }).toString()
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Failed to exchange auth code: ${resp.status} ${errText}`);
  }

  const tokens = await resp.json();
  saveTokens(tokens);
  return tokens;
}

export function saveTokens(tokens) {
  if (!fs.existsSync(TOKEN_DIR)) {
    fs.mkdirSync(TOKEN_DIR, { recursive: true });
  }
  fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2), 'utf-8');
  console.log('[Gmail OAuth] Tokens saved securely in data/.oauth_tokens/token.json');
}

export function loadStoredTokens() {
  if (!fs.existsSync(TOKEN_PATH)) return null;
  return JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf-8'));
}

export async function createGmailDraft({ to, subject, body }) {
  const tokens = loadStoredTokens();
  if (!tokens || !tokens.access_token) {
    throw new Error('Gmail is not authenticated yet. Run: node src/cli.js auth-gmail');
  }

  const utf8Subject = `=?utf-8?B?${Buffer.from(subject).toString('base64')}?=`;
  const messageParts = [
    `To: ${to}`,
    'Content-Type: text/plain; charset=utf-8',
    'MIME-Version: 1.0',
    `Subject: ${utf8Subject}`,
    '',
    body
  ];
  const message = messageParts.join('\r\n');
  const encodedMessage = Buffer.from(message)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  const resp = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/drafts', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${tokens.access_token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      message: { raw: encodedMessage }
    })
  });

  if (!resp.ok) {
    throw new Error(`Failed to create Gmail draft: ${resp.status} ${await resp.text()}`);
  }

  const result = await resp.json();
  console.log('[Gmail OAuth] Draft created successfully in Gmail inbox (Draft ID:', result.id, ')');
  return result;
}
