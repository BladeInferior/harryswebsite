// Re-exports the one shared Firebase app instance (see ../../firebase-config.js)
// instead of calling initializeApp() again here — every page now also loads
// admin-auth.js site-wide, and a second initializeApp() call with the same
// config throws ("Firebase App named '[DEFAULT]' already exists").
export * from '../../firebase-config.js';
