import { formatEther, formatGwei } from 'viem';
export function gasLines(s) {
  if (s.estimatedGasCost === undefined)
    return 'Детали газа отсутствуют: результат сохранён до обновления.';
  return `Газ внутри симуляции: ${s.gasUsed}; с оценкой накладных расходов: ${s.estimatedGasUnits} единиц.\nBase fee: ${formatGwei(BigInt(s.baseFee))}; заданный tip: ${formatGwei(BigInt(s.priorityFee))} gwei; запас единиц: ${Number(s.gasMarginBps) / 100}%.\nОценка по комиссии блока: ${formatEther(BigInt(s.estimatedGasCost))} ETH; итог по этой оценке: ${formatEther(BigInt(s.estimatedNet))} WETH.\n${s.breakEvenGasPrice === null ? 'Обмены не дают прибыли до газа; положительной цены газа для окупаемости нет.' : `Цена газа для безубыточности: не выше ${formatGwei(BigInt(s.breakEvenGasPrice))} gwei суммарно (base fee + tip).`}`;
}
const labels = { candidate: 'кандидат', control: 'контроль', recheck: 'повторная проверка' };
export function resultClass(s) {
  const net = BigInt(s.net);
  return net <= 0n ? 'nonpositive' : net < BigInt(s.minProfit) ? 'below' : 'eligible';
}
export function resultLines(store, cfg, since, now) {
  const rows = store.db
    .prepare('SELECT valid,data FROM simulation_results WHERE ts>=? AND ts<? ORDER BY id')
    .all(since, now);
  const valid = rows.filter((r) => r.valid).map((r) => JSON.parse(r.data));
  const lines = [
    '\nФактические результаты симуляций (сохраняются после обновления):',
    `Текущий порог сигнала: ${formatEther(cfg.minProfit)} WETH.`,
  ];
  if (!valid.length) {
    lines.push(
      'За период ещё нет сохранённых действительных результатов. Старые симуляции восстановить из счётчиков нельзя.',
    );
  } else {
    const counts = { nonpositive: 0, below: 0, eligible: 0 };
    const sources = { candidate: 0, control: 0, recheck: 0 };
    for (const s of valid) {
      counts[resultClass(s)]++;
      sources[s.source]++;
    }
    lines.push(
      `Сохранено результатов: ${valid.length} (кандидаты ${sources.candidate}, контроль ${sources.control}, повторные ${sources.recheck}).`,
      `После консервативного бюджета газа: ≤0 — ${counts.nonpositive}; >0, но ниже порога — ${counts.below}; достигли порога — ${counts.eligible}.`,
      'Категории учитывают порог на момент симуляции. Повтор одного блока/маршрута/суммы/типа не дублируется.',
    );
    const detailed = valid.filter((s) => s.estimatedNet !== undefined);
    const estimatedPositive = detailed.filter((s) => BigInt(s.estimatedNet) > 0n);
    lines.push(
      `С деталями газа: ${detailed.length}/${valid.length}; положительных по оценке комиссии блока: ${estimatedPositive.length}.`,
      `Уточнений суммы: ${valid.filter((s) => s.refined).length}.`,
      'Оценка комиссии блока = (газ симуляции + 50 000) × (base fee + заданный tip). Бюджет дополнительно учитывает запас единиц и удвоенную base fee. Обе суммы расчётные; фактически уплаченного газа нет. Сигналы проверяются по бюджету.',
    );
    if (detailed.length) {
      const bestEstimate = detailed.reduce((a, b) =>
        BigInt(a.estimatedNet) >= BigInt(b.estimatedNet) ? a : b,
      );
      lines.push(
        `Лучший итог по оценке комиссии блока: ${bestEstimate.symbol}, блок ${bestEstimate.block}, вход ${formatEther(BigInt(bestEstimate.input))} WETH; итог ${formatEther(BigInt(bestEstimate.estimatedNet))} WETH; по бюджету ${formatEther(BigInt(bestEstimate.net))} WETH.\n${bestEstimate.buy} → ${bestEstimate.sell}`,
      );
    }
    const best = new Map();
    for (const s of valid) {
      const old = best.get(s.route);
      if (!old || BigInt(s.net) > BigInt(old.net)) best.set(s.route, s);
    }
    const top = [...best.values()]
      .sort((a, b) => (BigInt(a.net) > BigInt(b.net) ? -1 : BigInt(a.net) < BigInt(b.net) ? 1 : 0))
      .slice(0, 3);
    lines.push('\nЛучшие фактические итоги: до 3 разных маршрутов, включая убыточные.');
    for (const [i, s] of top.entries()) {
      lines.push(
        `${i + 1}. ${s.symbol} — ${labels[s.source]}, блок ${s.block}\nВход ${formatEther(BigInt(s.input))} WETH; выход ${formatEther(BigInt(s.output))} WETH.\nДо газа ${formatEther(BigInt(s.gross))} WETH; газ-бюджет ${formatEther(BigInt(s.gasBudget))} ETH; итог ${formatEther(BigInt(s.net))} WETH.\nПорог тогда: ${formatEther(BigInt(s.minProfit))} WETH.\n${s.buy} → ${s.sell}`,
      );
      lines.push(gasLines(s));
    }
  }
  const invalid = rows.length - valid.length;
  if (invalid) lines.push(`Исключено после обнаружения смены хеша: ${invalid} результатов.`);
  return lines;
}
