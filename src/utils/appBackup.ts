import { loadFromDB, openDB, saveToDB } from "../hooks/utils/useIndexedDB";

const BACKUP_FORMAT = "crafty-plus-app-backup";
const BACKUP_VERSION = 1;
const LAST_DEVICE_KEY = "lastBluetoothDevice";

interface AppBackup {
  format: typeof BACKUP_FORMAT;
  version: typeof BACKUP_VERSION;
  createdAt: string;
  indexedDb: Record<string, unknown>;
  localStorage: Record<string, string>;
}

export const createAppBackup = async (): Promise<string> => {
  const database = await openDB();
  const transaction = database.transaction(["keyValueStore"], "readonly");
  const store = transaction.objectStore("keyValueStore");
  const [keys, values] = await Promise.all([
    requestValue(store.getAllKeys()),
    requestValue(store.getAll()),
  ]);
  const indexedDb = Object.fromEntries(
    keys.flatMap((key, index) =>
      typeof key === "string" ? [[key, values[index]]] : []
    )
  );
  const localStorageValues = Object.fromEntries(
    Object.keys(localStorage)
      .filter((key) => key !== LAST_DEVICE_KEY)
      .flatMap((key) => {
        const value = localStorage.getItem(key);
        return value === null ? [] : [[key, value]];
      })
  );
  return JSON.stringify(
    {
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      createdAt: new Date().toISOString(),
      indexedDb,
      localStorage: localStorageValues,
    } satisfies AppBackup,
    null,
    2
  );
};

export const restoreAppBackup = async (json: string) => {
  const backup = JSON.parse(json) as Partial<AppBackup>;
  if (
    backup.format !== BACKUP_FORMAT ||
    backup.version !== BACKUP_VERSION ||
    !backup.indexedDb ||
    typeof backup.indexedDb !== "object" ||
    !backup.localStorage ||
    typeof backup.localStorage !== "object"
  ) {
    throw new Error("Ce fichier n’est pas une sauvegarde CRAFTY+ compatible.");
  }

  const entries = Object.entries(backup.indexedDb);
  for (const [key, incoming] of entries) {
    const existing = await loadFromDB<unknown>(key);
    await saveToDB(key, mergeValues(existing, incoming));
  }

  for (const [key, value] of Object.entries(backup.localStorage)) {
    if (key === LAST_DEVICE_KEY || typeof value !== "string") continue;
    localStorage.setItem(key, value);
  }
  return {
    indexedDbEntries: entries.length,
    batteryAlertsEnabled: backup.localStorage.notifyCraftyBatteryLow === "true",
  };
};

const mergeValues = (existing: unknown, incoming: unknown): unknown => {
  if (Array.isArray(existing) && Array.isArray(incoming)) {
    const hasId = [...existing, ...incoming].every(
      (item) => item && typeof item === "object" && "id" in item
    );
    const merged = hasId
      ? [
          ...new Map(
            [...existing, ...incoming].map((item) => [
              (item as { id: string }).id,
              item,
            ])
          ).values(),
        ]
      : [
          ...new Map(
            [...existing, ...incoming].map((item) => [
              JSON.stringify(item),
              item,
            ])
          ).values(),
        ];
    return merged.sort((a, b) => {
      const aTime =
        a && typeof a === "object" && "startedAt" in a
          ? Number(a.startedAt)
          : 0;
      const bTime =
        b && typeof b === "object" && "startedAt" in b
          ? Number(b.startedAt)
          : 0;
      return aTime - bTime;
    });
  }
  if (
    existing &&
    incoming &&
    typeof existing === "object" &&
    !Array.isArray(existing) &&
    typeof incoming === "object" &&
    !Array.isArray(incoming)
  ) {
    return { ...existing, ...incoming };
  }
  return incoming;
};

const requestValue = <T>(request: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
