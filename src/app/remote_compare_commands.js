export function createCompareCommands({read,modules,controls,enter,apply,exit,clearTiming,setSide,setDepth,changeOutput,summary}) {
  return function runCompareCommand({name,args,opts}) {
    const fail = (code,message) => { throw Object.assign(new Error(message),{code}); };
    const status = read, active = read().active;
    const elements = controls();
    if (name === "compare status") return status();
    if (name === "compare enter") {
      if (!active && (modules().length) < 2) fail("COMPARE_UNAVAILABLE","Compare requires two modules");
      if (!active) enter();
      return status();
    }
    if (!active) fail("DOMAIN_MISMATCH","Enter Compare first");
    const side = args[0] === "A" ? "left" : "right";
    if (name === "compare module") {
      if (!modules().includes(args[1])) fail("MODULE_NOT_FOUND","Unknown module");
      (side === "left" ? elements.leftModuleSelect : elements.rightModuleSelect).value = args[1];
    } else if (name === "compare apply") {
      if (elements.leftModuleSelect.value === elements.rightModuleSelect.value) fail("INVALID_PAIR","Choose two different modules");
      apply();
    } else if (name === "compare exit") exit();
    else if (name === "compare clear-timing") clearTiming(side);
    else if (name === "compare side") setSide(side);
    else if (name === "compare outputs") return [...elements.compareOutputSelect.options].filter(o => o.value).map(o => ({id:o.value,name:o.textContent}));
    else if (name === "compare summary") return { ...status(), analysis:summary() };
    else if (name === "compare cone") {
      const output = opts.whole ? "" : args[0];
      if (![...elements.compareOutputSelect.options].some(option => option.value === output)) fail("OUTPUT_NOT_FOUND","Choose a shared module output");
      if (opts.depth) {
        const depth = Number(opts.depth);
        if (!Number.isInteger(depth) || depth < 1 || depth > 99) fail("INVALID_ARGUMENT","Invalid cone depth");
        setDepth(depth);
        elements.coneDepthInput.value = String(depth);
      }
      elements.compareOutputSelect.value = output;
      changeOutput({target:elements.compareOutputSelect});
    } else return undefined;
    return status();
  };
}
