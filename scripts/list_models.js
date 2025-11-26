const https = require("https");
const fs = require("fs");

const checkEndpoint = (version) => {
  return new Promise((resolve) => {
    const url = `https://dealer-social-post-ai-production.fly.dev/api/proxy/${version}/models?key=ignored`;
    https
      .get(url, (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          resolve({ version, status: res.statusCode, data });
        });
      })
      .on("error", (e) => {
        resolve({ version, error: e.message });
      });
  });
};

async function run() {
  const v1beta = await checkEndpoint("v1beta");
  const v1alpha = await checkEndpoint("v1alpha");

  const output = JSON.stringify({ v1beta, v1alpha }, null, 2);
  fs.writeFileSync("models_list.txt", output);
}

run();
