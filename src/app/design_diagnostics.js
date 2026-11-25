export function logDesignDiagnostics(log, design, fileName, fileCount, compareSide, append) {
  let diagnosticCount = 0;
  const diagnosticExamples = [];
  function collect(items, sourceFile) {
    for (const entry of items || []) {
      diagnosticCount++;
      if (diagnosticExamples.length < 8) {
        diagnosticExamples.push({ code: entry.code, moduleName: entry.moduleName, severity: entry.severity,
          line: entry.line, column: entry.column, fileName: entry.fileName || entry.sourceFile || sourceFile });
      }
    }
  }
  collect(design.diagnostics, fileName);
  for (const module of design.modules) collect(module.diagnostics, module.sourceFile || fileName);
  log(diagnosticCount ? "warning" : "info", "parse", "Parsed " + design.modules.length + " module(s)", {
    operation: append ? "import.merge-netlist" : "import.netlist",
    code: diagnosticCount ? "netlist.parsed-with-warnings" : "netlist.parsed",
    fileName, fileCount, compareSide, append, diagnosticCount, diagnosticExamples
  });
}
