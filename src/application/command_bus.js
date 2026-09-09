export function createCommandBus(handlers = {}) {
  const handlerByType = new Map(Object.entries(handlers));
  return Object.freeze({
    dispatch(command) {
      if (!command?.type) throw new Error("Command type is required");
      const handler = handlerByType.get(command.type);
      if (!handler) throw new Error(`Unknown command: ${command.type}`);
      return handler(command);
    },
    types() {
      return [...handlerByType.keys()];
    }
  });
}
