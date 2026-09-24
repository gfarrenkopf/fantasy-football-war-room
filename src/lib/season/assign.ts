/**
 * Maximum-weight assignment on a square matrix (the Hungarian algorithm, O(n³)). The lineup engine
 * uses it to put players in slots: a roster is a couple of dozen players, so it's instant, and
 * unlike filling slots greedily it stays exact whatever mix of flex slots a league starts.
 *
 * `weight[i][j]` is the value of giving row i column j; use -Infinity for "never". Returns, for each
 * row, the column it gets.
 */
export function maxWeightAssignment(weight: readonly (readonly number[])[]): number[] {
  const n = weight.length;
  if (n === 0) return [];
  // Minimize cost = -weight. "Never" becomes a cost too large to ever be worth taking.
  const finite = weight.flat().filter(Number.isFinite);
  const forbidden = (finite.length ? Math.max(...finite.map(Math.abs)) : 0) * (n + 1) + 1e9;
  const cost = (i: number, j: number) => (Number.isFinite(weight[i][j]) ? -weight[i][j] : forbidden);

  // Potentials and matching, 1-indexed with column 0 as the sentinel (the standard e-maxx form).
  const u = new Array<number>(n + 1).fill(0);
  const v = new Array<number>(n + 1).fill(0);
  const p = new Array<number>(n + 1).fill(0);
  const way = new Array<number>(n + 1).fill(0);
  for (let i = 1; i <= n; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = new Array<number>(n + 1).fill(Infinity);
    const used = new Array<boolean>(n + 1).fill(false);
    do {
      used[j0] = true;
      const i0 = p[j0];
      let delta = Infinity;
      let j1 = 0;
      for (let j = 1; j <= n; j++) {
        if (used[j]) continue;
        const cur = cost(i0 - 1, j - 1) - u[i0] - v[j];
        if (cur < minv[j]) {
          minv[j] = cur;
          way[j] = j0;
        }
        if (minv[j] < delta) {
          delta = minv[j];
          j1 = j;
        }
      }
      for (let j = 0; j <= n; j++) {
        if (used[j]) {
          u[p[j]] += delta;
          v[j] -= delta;
        } else minv[j] -= delta;
      }
      j0 = j1;
    } while (p[j0] !== 0);
    do {
      const j1 = way[j0];
      p[j0] = p[j1];
      j0 = j1;
    } while (j0);
  }
  const out = new Array<number>(n).fill(-1);
  for (let j = 1; j <= n; j++) if (p[j]) out[p[j] - 1] = j - 1;
  return out;
}
