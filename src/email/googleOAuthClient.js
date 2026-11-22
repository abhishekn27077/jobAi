import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { encryptTokenPayload, decryptTokenPayload, secureWipeFile } from './tokenEncryption.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TOKEN_DIR = path.resolve(__dirname, '../../data/.oauth_tokens');
const TOKEN_PATH = path.join(TOKEN_DIR, 'token.json');

// MINIMUM REQUIRED SCOPES: Readonly + Draft Compose + Calendar Events
// Redundant and over-privileged scopes have been removed.
export const GOOGLE_OAUTH_SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.compose',
  'https://www.googleapis.com/auth/calendar.events'
];

// In-memory active OAuth states and PKCE verifiers (TTL: 10 minutes)
const activeOAuthStates = new Map();

// Standard allowed local redirect URIs to prevent Open Redirect attacks
const DEFAULT_ALLOWED_REDIRECT_URIS = [
  'http://localhost:3000/oauth2callback',
  'http://127.0.0.1:3000/oauth2callback',
  'http://localhost:3000',
  'http://127.0.0.1:3000'
];

/**
 * Validates that a requested redirect URI is within the strict whitelist.
 */
export function validateRedirectUri(uri) {
  const custom = process.env.GMAIL_REDIRECT_URI || process.env.GOOGLE_REDIRECT_URI;
  const allowed = [...DEFAULT_ALLOWED_REDIRECT_URIS];
  if (custom) allowed.push(custom);

  if (!uri || !allowed.includes(uri)) {
    throw new Error(`Unauthorized OAuth redirect URI: "${uri}". Must match an allowed local callback.`);
  }
  return uri;
}

/**
 * Generates cryptographically secure OAuth state and PKCE S256 challenge.
 */
export function generateOAuthSecurityContext(redirectUri = 'http://localhost:3000/oauth2callback') {
  validateRedirectUri(redirectUri);

  // 1. 256-bit cryptographically random state parameter
  const state = crypto.randomBytes(32).toString('hex');

  // 2. PKCE code verifier (43-128 unreserved chars)
  const codeVerifier = crypto.randomBytes(32).toString('base64url');

  // 3. PKCE code challenge (S256 = Base64URL(SHA-256(verifier)))
  const codeChallenge = crypto.createHash('sha256')
    .update(codeVerifier)
    .digest('base64url');

  // Prune expired states (> 10 minutes)
  const now = Date.now();
  for (const [s, data] of activeOAuthStates.entries()) {
    if (now - data.createdAt > 600000) {
      activeOAuthStates.delete(s);
    }
  }

  // Store in cache
  activeOAuthStates.set(state, {
    codeVerifier,
    codeChallenge,
    redirectUri,
    createdAt: now
  });

  return { state, codeVerifier, codeChallenge, redirectUri };
}

/**
 * Validates and consumes an OAuth state parameter (one-time use).
 */
export function consumeOAuthState(state) {
  if (!state || typeof state !== 'string') {
    return { valid: false, error: 'State parameter is missing or malformed.' };
  }

  const record = activeOAuthStates.get(state);
  if (!record) {
    return { valid: false, error: 'Invalid or unrecognized OAuth state parameter.' };
  }

  activeOAuthStates.delete(state); // Enforce single-use

  if (Date.now() - record.createdAt > 600000) {
    return { valid: false, error: 'OAuth state has expired (10 minute limit).' };
  }

  return { valid: true, data: record };
}

export function isGoogleConfigured() {
  const clientId = process.env.GMAIL_CLIENT_ID || process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GMAIL_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET;
  return Boolean(clientId && clientSecret);
}

export function isGoogleAuthenticated() {
  return fs.existsSync(TOKEN_PATH);
}

/**
 * Builds Google OAuth 2.0 authorization URL with PKCE S256 and cryptographically random state.
 */
export function getGoogleAuthUrl(customRedirectUri = null, existingSecurityContext = null) {
  const clientId = process.env.GMAIL_CLIENT_ID || process.env.GOOGLE_CLIENT_ID;
  const redirectUri = validateRedirectUri(
    customRedirectUri || process.env.GMAIL_REDIRECT_URI || process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/oauth2callback'
  );

  if (!clientId) {
    throw new Error('Google Client ID is not configured. Set GMAIL_CLIENT_ID in your environment or .env file.');
  }

  const security = existingSecurityContext || generateOAuthSecurityContext(redirectUri);

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: GOOGLE_OAUTH_SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    state: security.state,
    code_challenge: security.codeChallenge,
    code_challenge_method: 'S256'
  });

  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  return authUrl;
}

/**
 * Exchanges authorization code for tokens, enforcing PKCE and state validation.
 */
export async function exchangeCodeForTokens(authCode, options = {}) {
  const clientId = process.env.GMAIL_CLIENT_ID || process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GMAIL_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error('Google OAuth credentials not configured.');
  }

  let redirectUri = options.redirectUri || options.customRedirectUri || process.env.GMAIL_REDIRECT_URI || process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/oauth2callback';
  let codeVerifier = options.codeVerifier || null;

  // If state was provided, validate it and extract associated PKCE verifier
  if (options.state) {
    const stateValidation = consumeOAuthState(options.state);
    if (!stateValidation.valid) {
      throw new Error(`OAuth State Verification Failed: ${stateValidation.error}`);
    }
    codeVerifier = stateValidation.data.codeVerifier;
    redirectUri = stateValidation.data.redirectUri;
  }

  validateRedirectUri(redirectUri);

  const bodyParams = {
    code: authCode,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code'
  };

  if (codeVerifier) {
    bodyParams.code_verifier = codeVerifier;
  }

  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(bodyParams).toString()
  });

  if (!resp.ok) {
    // Redact sensitive credentials from error message
    const status = resp.status;
    let safeErrMsg = `HTTP ${status}`;
    try {
      const errJson = await resp.json();
      safeErrMsg = errJson.error_description || errJson.error || safeErrMsg;
    } catch {
      safeErrMsg = (await resp.text()).slice(0, 100);
    }
    throw new Error(`Failed to exchange authorization code with Google: ${safeErrMsg}`);
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
    throw new Error(`Failed to refresh Google access token: HTTP ${resp.status}`);
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

/**
 * Saves tokens encrypted with AES-256-GCM.
 */
export function saveTokens(tokens) {
  if (!fs.existsSync(TOKEN_DIR)) {
    fs.mkdirSync(TOKEN_DIR, { recursive: true });
  }
  const encryptedPayload = encryptTokenPayload(tokens);
  fs.writeFileSync(TOKEN_PATH, JSON.stringify(encryptedPayload, null, 2), {
    encoding: 'utf-8',
    mode: 0o600
  });
}

/**
 * Loads stored tokens with automatic decryption and legacy migration.
 */
export function loadStoredTokens() {
  if (!fs.existsSync(TOKEN_PATH)) return null;
  try {
    const raw = fs.readFileSync(TOKEN_PATH, 'utf-8');
    const result = decryptTokenPayload(raw);
    if (!result) return null;

    // Automatic Migration: if plaintext token found, immediately encrypt it on disk
    if (result.needsMigration && result.tokens) {
      console.log('[OAuth Security] Migrated legacy plaintext token to encrypted storage.');
      saveTokens(result.tokens);
    }

    return result.tokens;
  } catch (err) {
    console.error('[OAuth Security] Failed reading stored tokens:', err.message);
    return null;
  }
}

/**
 * Disconnects Google account, revoking remote token and securely wiping local files.
 * Strictly requires explicit user confirmation.
 */
export async function disconnectAccount({ userConfirmed = false } = {}) {
  if (!userConfirmed) {
    throw new Error('User Confirmation Required: Disconnecting your Google OAuth account requires explicit confirmation (userConfirmed: true).');
  }

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

  const wiped = secureWipeFile(TOKEN_PATH);

  return {
    success: true,
    revoked,
    wiped,
    message: 'Google account disconnected and local OAuth tokens securely wiped.'
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
    throw new Error(`Failed to create Gmail draft: HTTP ${resp.status}`);
  }

  const result = await resp.json();
  return result;
}
