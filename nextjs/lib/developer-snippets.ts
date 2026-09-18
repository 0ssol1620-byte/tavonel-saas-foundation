/**
 * The first API call, as `/developers` prints it. The landing page shows the same two lines, from
 * this one string, so the two cannot drift.
 */
export const FIRST_CALL = `curl -H "Authorization: Bearer $TAVONEL_API_KEY" \\
  https://tavonel.com/api/v1/documents`;
