import { createLibertyLibraryService } from "../domains/netlist/liberty_import.js";
import { createCellConfigUseCases } from "../domains/netlist/cell_config_use_cases.js";
import { runCooperativeTask } from "../application/cooperative_task.js";
import { saveStoredCellConfig } from "../persistence/cell_config_storage.js";
import { createLibertyController } from "../ui/liberty_controller.js";
import { createLibraryWorkspaceRefresh } from "./library_workspace_refresh.js";
import { createRemoteCellConfigImport } from "./remote_cell_config.js";

export function createWorkbenchLibraries({elements, readContext, cancelJobs, renderSingle, renderCompare,
  readCellConfig, writeCellConfig, logProcess, setStatus}) {
  const cellConfigUseCases = createCellConfigUseCases({save:saveStoredCellConfig});
  const libertyService = createLibertyLibraryService({execute:runCooperativeTask});
  const refresh = createLibraryWorkspaceRefresh({readContext,cancelJobs,renderSingle,renderCompare});
  const libertyController = createLibertyController({
    elements:{summary:elements.libertySummary,diagnostics:elements.libertyDiagnostics,
      cancelButton:elements.cancelLibertyButton,clearButton:elements.clearLibertyButton},
    read:libertyService.read, importText:libertyService.importText, clear:libertyService.clear,
    cancel:libertyService.cancel, refresh, setStatus, logProcess
  });
  const loadCellConfig = createRemoteCellConfigImport({useCases:cellConfigUseCases,read:readCellConfig,write:writeCellConfig,refresh});
  return {cellConfigUseCases,libertyService,libertyController,loadCellConfig};
}
