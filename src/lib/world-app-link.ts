const WORLD_MINI_APP_URL = "https://world.org/mini-app";
const WORLD_APP_ID_PATTERN = /^app_[0-9a-f]{32}$/i;

/**
 * Universal link for handing a browser visitor into the registered FAVOUR
 * Mini App. World opens the app directly when installed and otherwise routes
 * the visitor to the relevant app store.
 */
export function worldAppUrl(
  path = "/",
  appId = process.env.NEXT_PUBLIC_WORLD_APP_ID,
): string | null {
  if (!appId || !WORLD_APP_ID_PATTERN.test(appId)) return null;

  const params = new URLSearchParams({
    app_id: appId,
    path,
  });

  return `${WORLD_MINI_APP_URL}?${params.toString()}`;
}
