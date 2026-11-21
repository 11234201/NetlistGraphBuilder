import http from "node:http";

export function workbenchCall(socketPath, body) {
  return new Promise((resolve, reject) => {
    const request = http.request({socketPath, path: "/", method: "POST", timeout: 15000}, response => {
      const chunks = [];
      response.on("data", part => chunks.push(part));
      response.on("error", reject);
      response.on("end", () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
        } catch (error) {
          reject(error);
        }
      });
    });
    request.on("timeout", () => request.destroy(new Error("Control socket timed out")));
    request.on("error", reject);
    request.end(JSON.stringify(body));
  });
}
