/**
 * The published API version, in one place.
 *
 * It was a literal inside the OpenAPI route, which was fine while the spec was the only thing
 * that quoted it. The documentation quotes it too now, and a version number written twice is a
 * version number that will disagree with itself -- the docs would keep saying 2026-09-02.1
 * after the contract moved, which is worse than not stating a version at all.
 *
 * Date-based rather than semantic: this contract is additive and dated, and a semantic number
 * would imply a breaking-change policy that has not been decided.
 */
export const API_VERSION = "2026-09-02.1";
