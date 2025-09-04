import { lstat } from 'node:fs/promises'
import { cwd } from 'node:process'
import { createLogger } from '@/lib/logger'

const logger = createLogger('NodeDemo')

lstat(cwd()).then(stats => {
  logger.info('fs.lstat result', { stats })
}).catch(err => {
  logger.error('fs.lstat failed', err)
})
