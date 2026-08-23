/**
 * The id the skip link points at and the route announcer focuses.
 *
 * Shared rather than written twice: a skip link whose target id has drifted is
 * a skip link that silently does nothing, and nothing about the page looks
 * wrong when it happens.
 */
export const MAIN_CONTENT_ID = 'main-content'
