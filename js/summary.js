function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

export function roundMedals(value) {
  return Math.round(finite(value));
}

export function calculateMedalSummary({
  startingMedals = 0,
  currentMedals = 0,
  cashInvestmentYen = 0,
  lendYenUnit = 0,
  lendMedalsPerUnit = 0,
} = {}) {
  const starting = roundMedals(Math.max(0, finite(startingMedals)));
  const current = roundMedals(Math.max(0, finite(currentMedals)));
  const cash = Math.max(0, finite(cashInvestmentYen));
  const yenUnit = Math.max(0, finite(lendYenUnit));
  const medalsPerUnit = Math.max(0, finite(lendMedalsPerUnit));
  const investmentMedals = yenUnit > 0 ? roundMedals((cash / yenUnit) * medalsPerUnit) : 0;
  return {
    startingMedals: starting,
    currentMedals: current,
    cashInvestmentYen: cash,
    investmentMedals,
    differenceMedals: current - starting - investmentMedals,
  };
}

export function formatSignedMedals(value) {
  const rounded = roundMedals(value);
  const sign = rounded > 0 ? "+" : "";
  return `${sign}${rounded.toLocaleString("ja-JP")}枚`;
}

export function resolveCurrentMedals(metrics, eventSummary, startingMedals = 0) {
  if (metrics?.current_medals !== null && metrics?.current_medals !== undefined) {
    return roundMedals(metrics.current_medals);
  }
  return roundMedals(eventSummary?.currentPayoutMedals ?? startingMedals);
}
