// All private-media writers must hold the SQLite write fence before probing.
// A record quota is not physical capacity: keep room for a full local backup
// archive as well as a fixed working buffer on the existing data volume.
const BUFFER_BYTES = 256 * 1024 * 1024;
const MEDIA_BYTES = { creative: 8 * 1024 * 1024, signature: 512000 };

function storageHasRoom(dfOutput, duOutput, incomingBytes) {
  const lines = String(dfOutput).trim().split(/\r?\n/);
  const fields = lines[lines.length - 1].trim().split(/\s+/);
  const dataToken = String(duOutput).trim().split(/\s+/)[0];
  if (!/^\d+$/.test(fields[3] || "") || !/^\d+$/.test(dataToken || "")) return false;
  const available = Number(fields[3]) * 1024;
  const dataSize = Number(dataToken) * 1024;
  return (
    Number.isSafeInteger(available) &&
    Number.isSafeInteger(dataSize) &&
    Number.isSafeInteger(incomingBytes) &&
    available >= 0 &&
    dataSize >= 0 &&
    incomingBytes >= 0 &&
    available > dataSize + incomingBytes * 2 + BUFFER_BYTES
  );
}

function ensureStorageRoom(incomingBytes) {
  try {
    const path = $app.dataDir();
    if (
      storageHasRoom(
        toString($os.cmd("df", "-Pk", path).output()),
        toString($os.cmd("du", "-sk", path).output()),
        incomingBytes,
      )
    )
      return;
  } catch (_e) {
    // Unknown capacity must not consume the recovery reserve.
  }
  throw new Error("MEDIA_STORAGE_LIMITED");
}

function withMediaWrite(dao, dealerId, incomingBytes, write) {
  dao.runInTransaction(function (tx) {
    // SQLite has one writer. This serializes posts, signatures and spin frames
    // across dealers, processes and restarts before checking physical space.
    const fence = tx
      .db()
      .newQuery("UPDATE dealers SET updated = updated WHERE id = {:dealer}")
      .bind({ dealer: dealerId })
      .execute();
    if (!fence || fence.rowsAffected() !== 1) throw new Error("media_dealer_missing");
    ensureStorageRoom(incomingBytes);
    write(tx);
  });
}

function respondIfLimited(c, error) {
  if (!error || error.message !== "MEDIA_STORAGE_LIMITED") return false;
  c.json(507, {
    error:
      "Archive storage is limited. Keep this work open and ask your administrator before saving again.",
    code: "MEDIA_STORAGE_LIMITED",
  });
  return true;
}

module.exports = {
  MEDIA_BYTES,
  storageHasRoom,
  ensureStorageRoom,
  withMediaWrite,
  respondIfLimited,
};
