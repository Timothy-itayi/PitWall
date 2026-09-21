const { BlobServiceClient } = require("@azure/storage-blob");
const { DefaultAzureCredential } = require("@azure/identity");

const DASHBOARD_BLOB = "dashboard.json";

let containerPromise;

function getBlobServiceClient() {
  const connectionString = process.env.CACHE_CONNECTION_STRING;
  if (connectionString) {
    return BlobServiceClient.fromConnectionString(connectionString);
  }

  const accountUrl = process.env.CACHE_ACCOUNT_URL;
  if (!accountUrl) {
    throw new Error("Set CACHE_CONNECTION_STRING or CACHE_ACCOUNT_URL");
  }

  return new BlobServiceClient(accountUrl, new DefaultAzureCredential());
}

function getContainerClient() {
  if (!containerPromise) {
    containerPromise = (async () => {
      const service = getBlobServiceClient();
      const name = process.env.CACHE_CONTAINER || "pitwall-cache";
      const container = service.getContainerClient(name);
      await container.createIfNotExists();
      return container;
    })();
  }
  return containerPromise;
}

function isMissingBlob(err) {
  return err && (err.statusCode === 404 || err.code === "BlobNotFound" || err.code === "ContainerNotFound");
}

async function readJsonBlob(blobName) {
  const container = await getContainerClient();
  const blob = container.getBlockBlobClient(blobName);
  try {
    const buffer = await blob.downloadToBuffer();
    return JSON.parse(buffer.toString("utf8"));
  } catch (err) {
    if (isMissingBlob(err)) return null;
    throw err;
  }
}

async function writeJsonBlob(blobName, value) {
  const container = await getContainerClient();
  const blob = container.getBlockBlobClient(blobName);
  const json = JSON.stringify(value);
  await blob.uploadData(Buffer.from(json, "utf8"), {
    blobHTTPHeaders: { blobContentType: "application/json" },
  });
}

function raceBlobName(sessionKey) {
  return `races/${sessionKey}.json`;
}

function readDashboard() {
  return readJsonBlob(DASHBOARD_BLOB);
}

function writeDashboard(snapshot) {
  return writeJsonBlob(DASHBOARD_BLOB, snapshot);
}

function readRace(sessionKey) {
  return readJsonBlob(raceBlobName(sessionKey));
}

function writeRace(sessionKey, detail) {
  return writeJsonBlob(raceBlobName(sessionKey), detail);
}

module.exports = {
  readDashboard,
  writeDashboard,
  readRace,
  writeRace,
};
