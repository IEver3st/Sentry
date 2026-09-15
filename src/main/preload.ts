import { contextBridge, ipcRenderer } from "electron";
import type {
  Request,
  SentryBridge,
  State,
  ResponseMap,
} from "../shared/contracts";
const bridge: SentryBridge = {
  async request<T extends Request>(
    request: T,
  ): Promise<ResponseMap[T["type"]]> {
    const result = (await ipcRenderer.invoke("sentry:request", request)) as {
      ok: boolean;
      value: ResponseMap[T["type"]];
      error?: string;
    };
    if (!result.ok)
      throw new Error(result.error ?? "Sentry could not complete the request.");
    return result.value;
  },
  subscribe(callback) {
    const listener = (_event: unknown, state: State) => callback(state);
    ipcRenderer.on("sentry:state", listener);
    return () => ipcRenderer.removeListener("sentry:state", listener);
  },
};
contextBridge.exposeInMainWorld("sentry", bridge);
