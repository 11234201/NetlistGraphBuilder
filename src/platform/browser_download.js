export function createBrowserDownload(environment = {}) {
  const BlobImpl = environment.BlobImpl || globalThis.Blob;
  const URLImpl = environment.URLImpl || globalThis.URL;
  const createElement = environment.createElement || ((name) => globalThis.document.createElement(name));
  if (!BlobImpl || !URLImpl?.createObjectURL || typeof createElement !== "function") {
    throw new Error("Browser download environment is unavailable");
  }
  const downloadText = (value, fileName, type = "text/plain") => {
    const blob = new BlobImpl([String(value)], { type });
    const url = URLImpl.createObjectURL(blob);
    try {
      const link = createElement("a");
      link.href = url;
      link.download = String(fileName);
      link.click();
    } finally {
      URLImpl.revokeObjectURL?.(url);
    }
  };
  return Object.freeze({
    text: downloadText,
    json(value, fileName) {
      downloadText(`${JSON.stringify(value, null, 2)}\n`, fileName, "application/json");
    }
  });
}

export function sanitizeDownloadFileName(value) {
  return String(value).replace(/[^A-Za-z0-9_.-]+/g, "_");
}
