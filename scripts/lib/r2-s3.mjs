import { createHash, createHmac } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, stat } from "node:fs/promises";
import { dirname } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const EMPTY_SHA256 = createHash("sha256").update("").digest("hex");

function requireValue(value, name) {
  const normalized = String(value || "").trim();
  if (!normalized) throw new Error(`Missing required environment variable: ${name}`);
  return normalized;
}

function awsEncode(value) {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function encodeObjectPath(bucket, key) {
  const safeKey = String(key || "").replace(/^\/+/, "");
  if (!safeKey) return `/${awsEncode(bucket)}`;
  if (safeKey.split("/").includes("..")) {
    throw new Error("R2 object keys cannot contain '..' segments.");
  }
  return `/${awsEncode(bucket)}/${safeKey.split("/").map(awsEncode).join("/")}`;
}

function canonicalizeQuery(query) {
  return [...query.entries()]
    .map(([key, value]) => [awsEncode(key), awsEncode(value)])
    .sort(([leftKey, leftValue], [rightKey, rightValue]) => {
      if (leftKey !== rightKey) return leftKey < rightKey ? -1 : 1;
      if (leftValue === rightValue) return 0;
      return leftValue < rightValue ? -1 : 1;
    })
    .map(([key, value]) => `${key}=${value}`)
    .join("&");
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function hmac(key, value) {
  return createHmac("sha256", key).update(value).digest();
}

async function hashFile(filePath) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}

function decodeXml(value) {
  return value
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&");
}

function xmlValue(xml, tag) {
  const match = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
  return match ? decodeXml(match[1]) : "";
}

export function createR2ClientFromEnv(environment = process.env) {
  const endpoint = new URL(requireValue(environment.R2_ENDPOINT, "R2_ENDPOINT"));
  if (endpoint.username || endpoint.password) {
    throw new Error("R2_ENDPOINT must not contain credentials.");
  }
  if (endpoint.protocol !== "https:" && endpoint.hostname !== "127.0.0.1") {
    throw new Error("R2_ENDPOINT must use HTTPS.");
  }
  if (endpoint.pathname !== "/" || endpoint.search || endpoint.hash) {
    throw new Error(
      "R2_ENDPOINT must be an origin without a path, query, or fragment.",
    );
  }

  const config = {
    endpoint,
    bucket: requireValue(environment.R2_BUCKET, "R2_BUCKET"),
    accessKeyId: requireValue(environment.R2_ACCESS_KEY_ID, "R2_ACCESS_KEY_ID"),
    secretAccessKey: requireValue(
      environment.R2_SECRET_ACCESS_KEY,
      "R2_SECRET_ACCESS_KEY",
    ),
    sessionToken: String(environment.R2_SESSION_TOKEN || "").trim(),
  };

  async function request({
    method,
    key,
    query = new URLSearchParams(),
    payloadHash = EMPTY_SHA256,
    headers = {},
    body,
    timeoutMs = 15 * 60 * 1000,
  }) {
    const now = new Date();
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
    const dateStamp = amzDate.slice(0, 8);
    const canonicalUri = encodeObjectPath(config.bucket, key);
    const canonicalQuery = canonicalizeQuery(query);
    const canonicalHeaders = {
      host: config.endpoint.host,
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amzDate,
      ...Object.fromEntries(
        Object.entries(headers).map(([header, value]) => [
          header.toLowerCase(),
          String(value).trim().replace(/\s+/g, " "),
        ]),
      ),
    };
    if (config.sessionToken) {
      canonicalHeaders["x-amz-security-token"] = config.sessionToken;
    }

    const headerNames = Object.keys(canonicalHeaders).sort();
    const signedHeaders = headerNames.join(";");
    const headerBlock = headerNames
      .map((header) => `${header}:${canonicalHeaders[header]}\n`)
      .join("");
    const canonicalRequest = [
      method,
      canonicalUri,
      canonicalQuery,
      headerBlock,
      signedHeaders,
      payloadHash,
    ].join("\n");
    const scope = `${dateStamp}/auto/s3/aws4_request`;
    const stringToSign = [
      "AWS4-HMAC-SHA256",
      amzDate,
      scope,
      sha256(canonicalRequest),
    ].join("\n");
    const dateKey = hmac(`AWS4${config.secretAccessKey}`, dateStamp);
    const regionKey = hmac(dateKey, "auto");
    const serviceKey = hmac(regionKey, "s3");
    const signingKey = hmac(serviceKey, "aws4_request");
    const signature = createHmac("sha256", signingKey)
      .update(stringToSign)
      .digest("hex");

    const url = new URL(canonicalUri, config.endpoint);
    url.search = canonicalQuery;
    const outboundHeaders = { ...canonicalHeaders };
    delete outboundHeaders.host;
    const response = await fetch(url, {
      method,
      headers: {
        ...outboundHeaders,
        authorization:
          `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${scope}, ` +
          `SignedHeaders=${signedHeaders}, Signature=${signature}`,
      },
      body,
      duplex: body ? "half" : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!response.ok) {
      const responseText = (await response.text()).slice(0, 500).replace(/\s+/g, " ");
      throw new Error(
        `R2 ${method} failed with HTTP ${response.status}: ${responseText}`,
      );
    }
    return response;
  }

  return {
    async putFile(key, filePath, metadata = {}) {
      const fileStats = await stat(filePath);
      const digest = await hashFile(filePath);
      await request({
        method: "PUT",
        key,
        payloadHash: digest,
        headers: {
          "content-length": fileStats.size,
          "content-type": "application/zip",
          ...Object.fromEntries(
            Object.entries(metadata).map(([name, value]) => [
              `x-amz-meta-${name.toLowerCase()}`,
              value,
            ]),
          ),
        },
        body: createReadStream(filePath),
      });
      return { sha256: digest, size: fileStats.size };
    },

    async putJson(key, value) {
      const body = Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
      await request({
        method: "PUT",
        key,
        payloadHash: sha256(body),
        headers: {
          "content-length": body.length,
          "content-type": "application/json",
        },
        body,
      });
    },

    async getJson(key) {
      const response = await request({ method: "GET", key });
      return response.json();
    },

    async getToFile(key, outputPath) {
      const response = await request({ method: "GET", key });
      if (!response.body) throw new Error("R2 returned an empty response body.");
      await mkdir(dirname(outputPath), { recursive: true });
      await pipeline(Readable.fromWeb(response.body), createWriteStream(outputPath));
      return {
        sha256: await hashFile(outputPath),
        size: (await stat(outputPath)).size,
      };
    },

    async list(prefix) {
      const objects = [];
      let continuationToken = "";
      do {
        const query = new URLSearchParams({ "list-type": "2", prefix });
        if (continuationToken) query.set("continuation-token", continuationToken);
        const response = await request({ method: "GET", key: "", query });
        const xml = await response.text();
        for (const match of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
          objects.push({
            key: xmlValue(match[1], "Key"),
            lastModified: xmlValue(match[1], "LastModified"),
            size: Number(xmlValue(match[1], "Size")),
          });
        }
        continuationToken =
          xmlValue(xml, "IsTruncated") === "true"
            ? xmlValue(xml, "NextContinuationToken")
            : "";
      } while (continuationToken);
      return objects;
    },

    async delete(key) {
      await request({ method: "DELETE", key });
    },
  };
}

export { hashFile };
