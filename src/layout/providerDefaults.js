// Shared product defaults; failure fallback is deliberately independent.
export const DEFAULT_LAYOUT_PROVIDER_ID = "native-layered";
export const FALLBACK_LAYOUT_PROVIDER_ID = "simple-layered";

export function getNextLayoutProviderId(providerId) {
  if (providerId === DEFAULT_LAYOUT_PROVIDER_ID) return "elk-layered";
  if (providerId === "elk-layered") return FALLBACK_LAYOUT_PROVIDER_ID;
  return null;
}
