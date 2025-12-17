import log from "electron-log/renderer";

const logger = log.scope("IpcDemo");

window.ipcRenderer.on("main-process-message", (_event, ...args) => {
	logger.info("received main-process message", { args });
});
