// Tiny word-level diff (LCS) for highlighting Original vs Edited.
type Op = { type: "same" | "add" | "del"; value: string };

function tokenize(s: string): string[] {
  return s.match(/(\s+|[^\s]+)/g) ?? [];
}

export function diffWords(a: string, b: string): Op[] {
  const A = tokenize(a);
  const B = tokenize(b);
  const n = A.length;
  const m = B.length;
  // LCS table — guard size
  if (n * m > 250000) {
    // Fallback: treat as full replace
    return [
      { type: "del", value: a },
      { type: "add", value: b },
    ];
  }
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      if (A[i] === B[j]) dp[i][j] = dp[i + 1][j + 1] + 1;
      else dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (A[i] === B[j]) {
      out.push({ type: "same", value: A[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push({ type: "del", value: A[i] });
      i++;
    } else {
      out.push({ type: "add", value: B[j] });
      j++;
    }
  }
  while (i < n) out.push({ type: "del", value: A[i++] });
  while (j < m) out.push({ type: "add", value: B[j++] });

  // Collapse consecutive ops of same type
  const merged: Op[] = [];
  for (const op of out) {
    const last = merged[merged.length - 1];
    if (last && last.type === op.type) last.value += op.value;
    else merged.push({ ...op });
  }
  return merged;
}
