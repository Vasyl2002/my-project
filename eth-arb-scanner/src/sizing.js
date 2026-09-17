// One local refinement, using only results from the current canonical snapshot.
// Bounds come from configured sizes; this is not a claim of a global optimum.
export function refinementJob(outcomes, routes, sizes, attempted) {
  const bounds = [...new Set(sizes)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  if (bounds.length < 2) return null;
  const candidates = outcomes
    .map((x) => x.result)
    .filter((s) => BigInt(s.output) > BigInt(s.input) && routes.some((r) => r.key === s.route))
    .sort((a, b) => {
      const x = BigInt(a.estimatedNet ?? a.net),
        y = BigInt(b.estimatedNet ?? b.net);
      return x > y ? -1 : x < y ? 1 : 0;
    });
  for (const best of candidates) {
    const center = BigInt(best.input);
    const points = [
      ...new Set([
        ...bounds,
        ...outcomes.filter((x) => x.result.route === best.route).map((x) => BigInt(x.result.input)),
      ]),
    ].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    const index = points.indexOf(center);
    const neighbors = [points[index + 1], points[index - 1]].filter((x) => x !== undefined);
    for (const neighbor of neighbors) {
      const amount = (center + neighbor) / 2n;
      if (amount < bounds[0] || amount > bounds.at(-1) || attempted.has(best.route + ':' + amount))
        continue;
      return { r: routes.find((r) => r.key === best.route), amount, refined: true };
    }
  }
  return null;
}
