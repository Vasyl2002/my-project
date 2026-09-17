import { formatEther } from 'viem';
const eth = (value) => formatEther(BigInt(value));
const key = (s) => `${s.hash}:${s.route}:${s.input}`;

export function describeRecheck(s) {
  const delta = s.block - s.origin.block;
  const net = BigInt(s.net),
    threshold = BigInt(s.minProfit);
  const status =
    net <= 0n
      ? 'неположительный итог'
      : net < threshold
        ? 'прибыль положительная, но ниже порога'
        : 'порог достигнут';
  return `Повтор: блок ${s.block}, через ${delta} блок(а).\nВыход ${eth(s.output)} WETH; бюджет газа ${eth(s.gasBudget)} ETH; итог ${eth(s.net)} WETH — ${status}.\nПорог при повторе: ${eth(s.minProfit)} WETH; изменение итога: ${eth(net - BigInt(s.origin.net))} WETH.${s.estimatedNet === undefined ? '' : `\nИтог по оценке комиссии блока: ${eth(s.estimatedNet)} WETH.`}`;
}

// Exact origin identity prevents mixing equal routes observed at different amounts/blocks.
export function recheckReport(store, since, now) {
  const rows = store.db
    .prepare(
      "SELECT ts,data FROM simulation_results WHERE valid=1 AND source='recheck' AND ts<? ORDER BY ts,id",
    )
    .all(now)
    .map((r) => ({ ts: r.ts, s: JSON.parse(r.data) }));
  const linked = rows.filter((r) => r.s.origin);
  const byOrigin = new Map(linked.map((r) => [key(r.s.origin), r.s]));
  const issues = store.db
    .prepare(
      "SELECT kind,data FROM events WHERE kind IN ('recheck_expired','recheck_error') AND ts<? ORDER BY id",
    )
    .all(now);
  const byIssue = new Map(
    issues
      .map((r) => ({ kind: r.kind, ...JSON.parse(r.data) }))
      .filter((r) => r.origin)
      .map((r) => [key(r.origin), r]),
  );
  const pending = new Set(store.get('pending', []).map(key));
  const forSignal = (s) => {
    const result = byOrigin.get(key(s));
    if (result) return describeRecheck(result);
    const issue = byIssue.get(key(s));
    if (issue)
      return issue.kind === 'recheck_error'
        ? `Повтор на блоке ${issue.block}: ошибка симуляции; итог неизвестен.`
        : `Без повторной симуляции, блок ${issue.block}: ${issue.reason === 'too_old' ? 'прошло больше 5 блоков' : 'пул недоступен'}.`;
    return pending.has(key(s))
      ? 'Повторная проверка ожидается.'
      : 'Точная связь с повторной проверкой не сохранена; результат неизвестен.';
  };
  const recent = linked.filter((r) => r.ts >= since);
  const legacy = rows.filter((r) => r.ts >= since && !r.s.origin).length;
  const lines = [];
  if (recent.length || legacy) {
    lines.push('\nРезультаты повторных проверок за период:');
    for (const { s } of recent.slice(-10)) {
      lines.push(
        `${s.symbol}; вход ${eth(s.input)} WETH. Сигнал: блок ${s.origin.block}, итог ${eth(s.origin.net)} WETH.\n${s.buy} → ${s.sell}\n${describeRecheck(s)}`,
      );
    }
    if (recent.length > 10) lines.push(`Показаны последние 10 из ${recent.length} проверок.`);
    if (legacy) lines.push(`Без точной связи с исходным сигналом (до обновления): ${legacy}.`);
    lines.push(
      'Проверка показывает состояние только в указанных блоках. Момент исчезновения возможности между ними неизвестен; сохранение порога не означает возможность реального исполнения.',
    );
  }
  return { forSignal, lines };
}
