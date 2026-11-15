// Keep missing APIs and synchronous browser failures on the same async boundary
// as a rejected clipboard permission request.
export async function copyBrowserText(text, clipboard) {
  if (typeof clipboard?.writeText !== "function") throw new Error("Clipboard unavailable");
  await clipboard.writeText(String(text));
}
