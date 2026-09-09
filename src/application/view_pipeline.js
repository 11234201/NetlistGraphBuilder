export function runViewPipeline(stages, request) {
  const queryResult = stages.query(request);
  return chain(queryResult, (queried) => chain(stages.project(queried, request), (diagram) =>
    chain(stages.measure(diagram, request), (measuredGraph) =>
      chain(stages.layout(measuredGraph, request), (autoGraph) =>
        chain(stages.applyOverrides(autoGraph, request), (adjustedGraph) =>
          chain(stages.createScene(adjustedGraph, request), (scene) => ({
            queryResult: queried,
            diagram,
            measuredGraph,
            autoGraph,
            graph: adjustedGraph,
            scene
          }))
        )
      )
    )
  ));
}

export function createIdentityStage() {
  return (value) => value;
}

function chain(value, next) {
  return isPromise(value) ? value.then(next) : next(value);
}

function isPromise(value) {
  return Boolean(value && typeof value.then === "function");
}
