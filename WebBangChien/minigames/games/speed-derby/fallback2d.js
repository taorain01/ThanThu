export function startSpeedDerbyFallback2D(context, names) {
  const legacy = context?.legacy || window.__minigamesLegacyApi;
  if (!legacy?.startFallback2DGame) {
    throw new Error("Speed Derby fallback 2D chưa sẵn sàng.");
  }

  return legacy.startFallback2DGame(names);
}
