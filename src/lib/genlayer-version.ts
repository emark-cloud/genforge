/**
 * Pinned py-genlayer release.
 *
 * Used by the system prompt and any UI surface that references the
 * `# { "Depends": "py-genlayer:..." }` header line. Update here when py-genlayer
 * pins a new release on Studio + Bradbury (per GUIDELINES.md §4.2 the hash is
 * the same on both networks).
 */
export const GENLAYER_DEPENDS_HASH =
  "1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6";

export const GENLAYER_HEADER = `# v0.1.0
# { "Depends": "py-genlayer:${GENLAYER_DEPENDS_HASH}" }`;
