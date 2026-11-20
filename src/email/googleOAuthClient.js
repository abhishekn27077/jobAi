import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TOKEN_DIR = path.resolve(__dirname, '../../data/.oauth_tokens');
const TOKEN_PATH = path.join(TOKEN_DIR, 'token.json');

// MINIMUM REQUIRED SCOPES: Readonly + Draft Compose + Calendar Events/Read
export const GOOGLE_OAUTH_SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.compose',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.readonly'
];

export function isGoogleConfigured() {
  const clientId = process.env.GMAIL_CLIENT_ID || process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GMAIL_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET;
  return Boolean(clientId && clientSecret);
}

export function isGoogleAuthenticated() {
  return fs.existsSync(TOKEN_PATH);
}

export function getGoogleAuthUrl(customRedirectUri = null) {
  const clientId = process.env.GMAIL_CLIENT_ID || process.env.GOOGLE_CLIENT_ID;
  const redirectUri = customRedirectUri || process.env.GMAIL_REDIRECT_URI || process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/oauth2callback';

  if (!clientId) {
    throw new Error('Google Client ID is not configured. Set GMAIL_CLIENT_ID in your environment or .env file.');
  }

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: GOOGLE_OAUTH_SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent'
  });

  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export async function exchangeCodeForTokens(authCode, customRedirectUri = null) {
  const clientId = process.env.GMAIL_CLIENT_ID || process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GMAIL_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = customRedirectUri || process.env.GMAIL_REDIRECT_URI || process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/oauth2callback';

  if (!clientId || !clientSecret) {
    throw new Error('Google OAuth credentials not configured.');
  }

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
    throw new Error(`Failed to exchange authorization code: ${resp.status} ${errText}`);
  }

  const tokens = await resp.json();
  const enhancedTokens = {
    ...tokens,
    saved_at: Date.now(),
    expires_at: Date.now() + ((tokens.expires_in || 3600) * 1000)
  };
  saveTokens(enhancedTokens);
  return enhancedTokens;
}

export async function refreshAccessToken(refreshToken) {
  const clientId = process.env.GMAIL_CLIENT_ID || process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GMAIL_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error('Google OAuth credentials not configured for token refresh.');
  }

  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token'
    }).toString()
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Failed to refresh Google access token: ${resp.status} ${errText}`);
  }

  const newTokens = await resp.json();
  const current = loadStoredTokens() || {};
  const updated = {
    ...current,
    ...newTokens,
    refresh_token: newTokens.refresh_token || current.refresh_token,
    saved_at: Date.now(),
    expires_at: Date.now() + ((newTokens.expires_in || 3600) * 1000)
  };

  saveTokens(updated);
  return updated;
}

export async function getValidAccessToken() {
  const tokens = loadStoredTokens();
  if (!tokens || !tokens.access_token) {
    return null;
  }

  // Check if token has expired or will expire in next 60 seconds
  const now = Date.now();
  const expiresAt = tokens.expires_at || (tokens.saved_at ? tokens.saved_at + 3600000 : 0);

  if (expiresAt && now >= (expiresAt - 60000)) {
    if (tokens.refresh_token) {
      try {
        const refreshed = await refreshAccessToken(tokens.refresh_token);
        return refreshed.access_token;
      } catch (err) {
        console.warn(`[OAuth Warning] Token refresh failed: ${err.message}`);
        return null;
      }
    }
  }

  return tokens.access_token;
}

export function saveTokens(tokens) {
  if (!fs.existsSync(TOKEN_DIR)) {
    fs.mkdirSync(TOKEN_DIR, { recursive: true });
  }
  fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2), 'utf-8');
}

export function loadStoredTokens() {
  if (!fs.existsSync(TOKEN_PATH)) return null;
  try {
    return JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf-8'));
  } catch {
    return null;
  }
}

export async function disconnectAccount() {
  const tokens = loadStoredTokens();
  let revoked = false;

  if (tokens && tokens.access_token) {
    try {
      await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(tokens.access_token)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
      });
      revoked = true;
    } catch (err) {
      console.warn(`[OAuth Notice] Remote revocation notice: ${err.message}`);
    }
  }

  if (fs.existsSync(TOKEN_PATH)) {
    fs.unlinkSync(TOKEN_PATH);
  }

  return {
    success: true,
    revoked,
    message: 'Google account disconnected and local OAuth tokens removed.'
  };
}

export function getOAuthStatus() {
  const configured = isGoogleConfigured();
  const authenticated = isGoogleAuthenticated();
  const tokens = loadStoredTokens();

  return {
    configured,
    authenticated,
    scopes: GOOGLE_OAUTH_SCOPES,
    expiresAt: tokens?.expires_at ? new Date(tokens.expires_at).toISOString() : null,
    hasRefreshToken: Boolean(tokens?.refresh_token)
  };
}

export async function createGmailDraft({ to, subject, body }) {
  const accessToken = await getValidAccessToken();
  if (!accessToken) {
    throw new Error('Gmail is not authenticated or token expired. Please connect your Google account in Settings.');
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
      'Authorization': `Bearer ${accessToken}`,
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
  return result;
}
