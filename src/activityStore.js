const databaseName = "fit-track";
const databaseVersion = 1;
const importsStore = "imports";
const deletedStore = "deleted";

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, databaseVersion);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(importsStore)) database.createObjectStore(importsStore, { keyPath: "file" });
      if (!database.objectStoreNames.contains(deletedStore)) database.createObjectStore(deletedStore, { keyPath: "file" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Browser storage could not be opened."));
  });
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Browser storage could not be updated."));
  });
}

async function readStore(storeName) {
  const database = await openDatabase();
  try {
    return await requestResult(database.transaction(storeName, "readonly").objectStore(storeName).getAll());
  } finally {
    database.close();
  }
}

export async function mergeActivityData(baseline) {
  const [imports, deletions] = await Promise.all([readStore(importsStore), readStore(deletedStore)]);
  const deletedFiles = new Set(deletions.map((item) => item.file));
  const importedByFile = new Map(imports.map((session) => [session.file, session]));
  const baselineSessions = baseline.sessions.filter((session) => !deletedFiles.has(session.file) && !importedByFile.has(session.file));
  return {
    ...baseline,
    sessions: [...baselineSessions, ...imports].sort((a, b) => new Date(a.startTime) - new Date(b.startTime)),
  };
}

export async function saveImportedActivity(session) {
  const database = await openDatabase();
  try {
    const transaction = database.transaction([importsStore, deletedStore], "readwrite");
    transaction.objectStore(importsStore).put(session);
    transaction.objectStore(deletedStore).delete(session.file);
    await new Promise((resolve, reject) => {
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error || new Error("The activity could not be saved."));
      transaction.onabort = () => reject(transaction.error || new Error("The activity could not be saved."));
    });
  } finally {
    database.close();
  }
}

export async function deleteStoredActivities(files, baseline) {
  const baselineFiles = new Set(baseline.sessions.map((session) => session.file));
  const database = await openDatabase();
  try {
    const transaction = database.transaction([importsStore, deletedStore], "readwrite");
    const imports = transaction.objectStore(importsStore);
    const deletions = transaction.objectStore(deletedStore);
    files.forEach((file) => {
      imports.delete(file);
      if (baselineFiles.has(file)) deletions.put({ file });
      else deletions.delete(file);
    });
    await new Promise((resolve, reject) => {
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error || new Error("The selected activities could not be deleted."));
      transaction.onabort = () => reject(transaction.error || new Error("The selected activities could not be deleted."));
    });
  } finally {
    database.close();
  }
}
