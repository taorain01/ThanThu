export function startSpeedDerbyGame(context, names) {
  const legacy = context?.legacy || window.__minigamesLegacyApi;
  if (!legacy?.launchSpeedDerbyGame) {
    throw new Error("Speed Derby legacy engine chưa sẵn sàng.");
  }

  return legacy.launchSpeedDerbyGame(names);
}

export function cleanupSpeedDerbyGame(context) {
  const legacy = context?.legacy || window.__minigamesLegacyApi;
  legacy?.cleanupWebGLScene?.();
}
