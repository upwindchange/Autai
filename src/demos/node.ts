import { lstat } from 'node:fs/promises'
import { cwd } from 'node:process'
import log from 'electron-log/renderer'

const logger = log.scope('NodeDemo')

lstat(cwd()).then(stats => {
  logger.info('fs.lstat result', { stats })
}).catch(err => {
  logger.error('fs.lstat failed', err)
})
