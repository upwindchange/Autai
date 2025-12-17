import log from "electron-log/main";

export class BrowserUseWorker {
	private logger = log.scope("BrowserUseWorker");

	constructor() {
		this.logger.info("BrowserUseWorker initialized");
	}
}
