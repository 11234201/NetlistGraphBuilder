import { getPinNetReferences } from "./model.js";

// Concatenation slots are display terminals, not new source pins or nets.
// Their ordinal follows Verilog's left-to-right concatenation order.
export function getPinConnectionEndpoints(pin) {
  const references = getPinNetReferences(pin);
  const pinName = pin.pinDisplayName || pin.pin;
  return references.map((reference, index) => ({
    ...reference,
    pin: pin.connection?.kind === "concat" ? `${pinName}{${references.length - 1 - index}}` : pinName,
    rawPin: pin.pin,
    connectionIndex: index
  }));
}
