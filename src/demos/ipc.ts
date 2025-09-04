
import { createLogger } from '@/lib/logger'

const logger = createLogger('IpcDemo')

window.ipcRenderer.on('main-process-message', (_event, ...args) => {
  logger.info('received main-process message', { args })
})
