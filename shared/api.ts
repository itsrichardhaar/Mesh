// IPC contract surface exposed to the renderer via the preload bridge.
// Every method here corresponds to a registered `ipcMain.handle` in src/main.

export interface MeshApi {
  /** Round-trip ping for verifying the IPC bridge is working. */
  ping(): Promise<string>
}
