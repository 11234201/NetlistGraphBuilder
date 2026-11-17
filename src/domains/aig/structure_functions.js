// Truth-table bit i is the output for assignment i; variable zero is the LSB.
const muxFunctions = new Map();
for (let select = 0; select < 3; select++) {
  for (const data0 of [0, 1, 2].filter((index) => index !== select)) {
    const data1 = 3 - select - data0;
    for (let neg0 = 0; neg0 < 2; neg0++) for (let neg1 = 0; neg1 < 2; neg1++) for (let output = 0; output < 2; output++) {
      let truth = 0;
      for (let row = 0; row < 8; row++) truth |= ((((row >> select) & 1) ? ((row >> data1) & 1) ^ neg1 : ((row >> data0) & 1) ^ neg0) ^ output) << row;
      const value = { kind: "mux", roles: { s: select, d0: data0, d1: data1 }, inversions: { s: false, d0: Boolean(neg0), d1: Boolean(neg1) }, outputInverted: Boolean(output) };
      const key = `${neg0 + neg1}${output}${select}${data0}${data1}${neg0}${neg1}`;
      if (!muxFunctions.has(truth) || key < muxFunctions.get(truth).key) muxFunctions.set(truth, { key, value });
    }
  }
}

export function classifyStructureFunction(truth, size) {
  if (size === 2 && (truth === 6 || truth === 9)) {
    return { kind: truth === 6 ? "xor" : "xnor", roles: { a: 0, b: 1 }, inversions: { a: false, b: false }, outputInverted: false };
  }
  return size === 3 ? muxFunctions.get(truth)?.value || null : null;
}

export function evaluateCut(index, rootId, leaves, members) {
  const rows = 1 << leaves.length, mask = (1 << rows) - 1;
  const values = new Map(leaves.map((id, bit) => {
    let truth = 0;
    for (let row = 0; row < rows; row++) truth |= ((row >> bit) & 1) << row;
    return [id, truth];
  }));
  for (const id of members) {
    let truth = mask;
    for (const edge of index.incoming.get(id)) truth &= (values.get(edge.source) ?? 0) ^ (edge.inverted ? mask : 0);
    values.set(id, truth);
  }
  return values.get(rootId) ?? 0;
}

export function minimizeStructureFunction(truth, leaves) {
  const support = leaves.map((_, bit) => bit).filter((bit) => {
    for (let row = 0; row < (1 << leaves.length); row++) if (((truth >> row) & 1) !== ((truth >> (row ^ (1 << bit))) & 1)) return true;
    return false;
  });
  let reduced = 0;
  for (let row = 0; row < (1 << support.length); row++) {
    const original = support.reduce((bits, bit, slot) => bits | (((row >> slot) & 1) << bit), 0);
    reduced |= ((truth >> original) & 1) << row;
  }
  return { truth: reduced, inputs: support.map((bit) => leaves[bit]) };
}
