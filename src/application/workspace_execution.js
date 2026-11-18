// Shared scheduling policy for Single and Compare. Callers supply scoped jobs
// and presentation callbacks; this boundary owns sync/async and stale commits.
export function createWorkspaceExecution({ jobs }) {
  return Object.freeze({
    execute({ provider, tasks, signal, preparePresentation, onStarted = () => {}, onCommit, onError, onSettled = () => {} }) {
      const executions = [];
      let active = true;
      const cancel = () => {
        if (!active) return;
        active = false;
        signal?.removeEventListener("abort", abort);
        for (const execution of executions) execution?.cancel?.();
      };
      const abort = () => {
        if (!active) return;
        cancel();
        onSettled([{ status: "cancelled" }]);
      };
      const fail = (error) => {
        if (!active) return;
        cancel();
        onError(error);
      };
      const commit = (results, presentation) => {
        if (!active) return;
        signal?.removeEventListener("abort", abort);
        if (results.every((result) => result.status === "committed")) onCommit(results, presentation);
        onSettled(results);
      };
      const finish = preparePresentation ? async (results) => {
        if (!active) return;
        if (!results.every((result) => result.status === "prepared")) { abort(); return; }
        const presentation = await preparePresentation(results);
        if (!active) return;
        if (!presentation || !results.every((result) => jobs.isCurrent(result.context))) { abort(); return; }
        // Install all prepared views before publishing any artifact or query.
        if (presentation.install && !presentation.install()) { abort(); return; }
        commit(results.map((result) => result.publish()), presentation);
      } : commit;
      if (signal?.aborted) { abort(); return; }
      signal?.addEventListener("abort", abort, { once: true });
      try {
        const asynchronous = provider.executionMode === "async";
        for (const task of tasks) {
          if (!active) break;
          const session = task.beginComputation();
          const request = { sessionId: session.sessionId, kind: task.kind, run: task.run, prepareOnly: Boolean(preparePresentation) };
          const execution = asynchronous ? jobs.start(request) : jobs.runSync(request);
          executions.push(execution);
          // A later task may fail during startup before Promise.all is attached.
          if (asynchronous) execution.promise.catch(() => {});
          if (!active) execution?.cancel?.();
        }
        if (!active) return;
        if (asynchronous) {
          const completion = Promise.all(executions.map((execution) => execution.promise));
          const handled = completion.then(finish).catch(fail);
          try { onStarted(executions); } catch (error) { fail(error); }
          return handled;
        }
        if (preparePresentation) return finish(executions).catch(fail);
        commit(executions);
      } catch (error) { fail(error); }
    }
  });
}
