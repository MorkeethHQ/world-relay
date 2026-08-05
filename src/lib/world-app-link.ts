const WORLD_MINI_APP_URL = "https://world.org/mini-app";

/**
 * Universal link for handing a browser visitor into the registered FAVOUR
 * Mini App. World opens the app directly when installed and otherwise routes
 * the visitor to the relevant app store.
 */
export function worldAppUrl(
  path = "/",
  appId = process.env.NEXT_PUBLIC_WORLD_APP_ID,
): string | null {
  if (!appId?.startsWith("app_")) return null;

  const params = new URLSearchParams({
    app_id: appId,
    path,
  });

  return `${WORLD_MINI_APP_URL}?${params.toString()}`;
}
