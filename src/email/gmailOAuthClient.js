/**
 * Backwards compatibility proxy for googleOAuthClient.js
 */
export {
  isGoogleConfigured as isGmailConfigured,
  isGoogleAuthenticated as isGmailAuthenticated,
  getGoogleAuthUrl,
  exchangeCodeForTokens,
  saveTokens,
  loadStoredTokens,
  createGmailDraft,
  getValidAccessToken,
  disconnectAccount,
  getOAuthStatus,
  GOOGLE_OAUTH_SCOPES
} from './googleOAuthClient.js';
