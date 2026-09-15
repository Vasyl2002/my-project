import { formatEther } from 'viem';
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
      `После газа: ≤0 — ${counts.nonpositive}; >0, но ниже порога — ${counts.below}; достигли порога — ${counts.eligible}.`,
      'Категории учитывают порог на момент симуляции. Повтор одного блока/маршрута/суммы/типа не дублируется.',
    );
    const best = new Map();
    for (const s of valid) {
      const old = best.get(s.route);
      if (!old || BigInt(s.net) > BigInt(old.net)) best.set(s.route, s);
    }
    const top = [...best.values()]
      .sort((a, b) => (BigInt(a.net) > BigInt(b.net) ? -1 : BigInt(a.net) < BigInt(b.net) ? 1 : 0))
      .slice(0, 3);
    lines.push('\nЛучшие фактические итоги: до 3 разных маршрутов, включая убыточные.');
    for (const [i, s] of top.entries())
      lines.push(
        `${i + 1}. ${s.symbol} — ${labels[s.source]}, блок ${s.block}\nВход ${formatEther(BigInt(s.input))} WETH; выход ${formatEther(BigInt(s.output))} WETH.\nДо газа ${formatEther(BigInt(s.gross))} WETH; газ-бюджет ${formatEther(BigInt(s.gasBudget))} ETH; итог ${formatEther(BigInt(s.net))} WETH.\nПорог тогда: ${formatEther(BigInt(s.minProfit))} WETH.\n${s.buy} → ${s.sell}`,
      );
  }
  const invalid = rows.length - valid.length;
  if (invalid) lines.push(`Исключено после обнаружения смены хеша: ${invalid} результатов.`);
  return lines;
}
