// PocketBase 0.22's $http.send follows redirects. Managed destinations use
// curl without --location instead. Credential headers travel only through stdin;
// request bytes use a private temporary file to avoid older curl config limits.
// Never include request options or upstream response bodies in error/log output.
function invalid() {
  throw new Error("CONNECTION_TRANSPORT_FAILED");
}
function quoted(value) {
  return (
    '"' +
    String(value)
      .replace(/\\/g, "\\\\")
      .replace(/"/g, '\\"')
      .replace(/\r/g, "\\r")
      .replace(/\n/g, "\\n")
      .replace(/\t/g, "\\t") +
    '"'
  );
}
function bytes(value) {
  // Curl config is UTF-8; Goja has no TextEncoder. Percent encoding supplies
  // the correct bytes without putting any credentials into process arguments.
  const encoded = encodeURIComponent(value),
    result = [];
  for (let i = 0; i < encoded.length; i++) {
    if (encoded[i] === "%") {
      result.push(parseInt(encoded.slice(i + 1, i + 3), 16));
      i += 2;
    } else result.push(encoded.charCodeAt(i));
  }
  return result;
}
function send(options) {
  if (
    !options ||
    typeof options.url !== "string" ||
    options.url.length > 2048 ||
    /[\r\n]/.test(options.url)
  )
    invalid();
  const test =
    !String($os.getenv("FLY_APP_NAME") || "") &&
    String($os.getenv("SAFE_HTTP_ALLOW_LOOPBACK_TEST") || "") === "true";
  const loopback = test && /^http:\/\/127\.0\.0\.1:\d{2,5}\/[^?#]*$/.test(options.url);
  if (!loopback && !/^https:\/\/[a-zA-Z0-9.-]+\/(?:[^?#]*)$/.test(options.url))
    invalid();
  if (["GET", "POST", "DELETE"].indexOf(options.method || "GET") < 0) invalid();
  const timeout = Math.min(45, Math.max(1, Number(options.timeout) || 15));
  const body = options.body === undefined ? "" : String(options.body);
  if (body.length > 12 * 1024 * 1024) invalid();
  const config = [
    "url = " + quoted(options.url),
    "request = " + quoted(options.method || "GET"),
  ];
  Object.keys(options.headers || {}).forEach(function (name) {
    const value = String(options.headers[name]);
    if (
      !/^[A-Za-z0-9-]{1,80}$/.test(name) ||
      /[\r\n]/.test(value) ||
      value.length > 8192
    )
      invalid();
    config.push("header = " + quoted(name + ": " + value));
  });
  const args = [
    "--disable",
    "--silent",
    "--show-error",
    "--globoff",
    "--proto",
    loopback ? "=http" : "=https",
    "--max-time",
    String(timeout),
    "--connect-timeout",
    String(Math.min(timeout, 10)),
    "--write-out",
    "\n%{http_code}",
    "--config",
    "-",
  ];
  let command,
    started = false,
    waited = false,
    bodyDirectory = "",
    bodyPath = "";
  try {
    if (options.body !== undefined) {
      const bodyBytes = bytes(body);
      if (bodyBytes.length > 12 * 1024 * 1024) invalid();
      // PB 0.22 has no createTemp/openFile. mkdir creates an exclusive private
      // directory; a collision fails before writeFile can follow any symlink.
      const candidate =
        $os.tempDir() +
        "/dealer-social-http-body-" +
        $security.randomStringWithAlphabet(32, "abcdefghijklmnopqrstuvwxyz0123456789");
      $os.mkdir(candidate, 448);
      bodyDirectory = candidate;
      bodyPath = bodyDirectory + "/body";
      $os.writeFile(bodyPath, bodyBytes, 384);
      // A single multi-megabyte data= line exceeds curl 7.81's 100 KiB cap.
      // --data-binary reads exact UTF-8 bytes, without newline transformations.
      config.push("data-binary = " + quoted("@" + bodyPath));
    }
    command = $os.cmd.apply($os, ["curl"].concat(args));
    const input = command.stdinPipe(),
      output = command.stdoutPipe();
    command.start();
    started = true;
    input.write(bytes(config.join("\n") + "\n"));
    input.close();
    const raw = toString(output, 2 * 1024 * 1024 + 1);
    if (raw.length > 2 * 1024 * 1024) {
      try {
        command.process.kill();
      } catch (_e) {}
      invalid();
    }
    command.wait();
    waited = true;
    const match = raw.match(/\n(\d{3})$/);
    if (!match) invalid();
    const responseBody = raw.slice(0, -4),
      statusCode = Number(match[1]);
    if (statusCode < 100 || statusCode > 599 || (statusCode >= 300 && statusCode < 400))
      invalid();
    let json = null;
    try {
      json = JSON.parse(responseBody);
    } catch (_e) {}
    return { statusCode: statusCode, json: json, raw: responseBody };
  } catch (_e) {
    if (command && command.process) {
      try {
        command.process.kill();
      } catch (_ignored) {}
    }
    if (command && started && !waited) {
      try {
        command.wait();
      } catch (_ignored) {}
    }
    invalid();
  } finally {
    if (bodyPath) {
      try {
        $os.remove(bodyPath);
      } catch (_e) {}
    }
    if (bodyDirectory) {
      try {
        $os.remove(bodyDirectory);
      } catch (_e) {}
    }
  }
}
module.exports = { send: send };
