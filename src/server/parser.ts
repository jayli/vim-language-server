import { join } from 'path';
import childProcess from 'child_process';
import { Subject, timer, from } from 'rxjs';
import { switchMap, map, filter } from 'rxjs/operators';
import { TextDocument } from 'vscode-languageserver';
import { waitMap } from 'rxjs-operators/lib/waitMap';

import { handleDiagnostic } from '../handles/diagnostic';
import { workspace } from './workspaces';
import { handleParse } from '../common/util';
import { IParserHandles} from '../common/types';
import logger from '../common/logger';

const log = logger('parser')

const parserHandles: IParserHandles = {}

const indexs: Record<string, boolean> = {}

const origin$: Subject<TextDocument> = new Subject<TextDocument>()

const scanProcess = childProcess.fork(
  join(__dirname, 'scan.js'),
  ['--node-ipc']
)

scanProcess.on('message', (mess) => {
  const { data, log } = mess
  if (data) {
    if (!workspace.isExistsBuffer(data.uri)) {
      workspace.updateBuffer(data.uri, data.node)
    }
  }
  if (log) {
    log.info(`child_log: ${mess.log}`)
  }
})

scanProcess.on('error', (err: Error) => {
  log.error(`${err.stack || err.message || err}`)
})

export function next(
  textDoc: TextDocument,
) {
  if (!parserHandles[textDoc.uri]) {
    const { uri } = textDoc
    parserHandles[uri] = origin$.pipe(
      filter((textDoc: TextDocument) => uri === textDoc.uri),
      switchMap((textDoc: TextDocument) => {
        return timer(100).pipe(
          map(() => textDoc)
        )
      }),
      waitMap((textDoc: TextDocument) => {
        return from(handleParse(textDoc))
      }, true)
    ).subscribe(
      (res) => {
        // handle diagnostic
        handleDiagnostic(textDoc, res[1])
        // handle node
        workspace.updateBuffer(uri, res[0])
        // scan project
        if (!indexs[uri]) {
          indexs[uri] = true
          scanProcess.send({
            uri
          })
        }
      },
      (err: Error) => {
        log.error(`${err.stack || err.message || err}`)
      }
    )
  }
  origin$.next(textDoc)
}

export function unsubscribe(textDoc: TextDocument) {
  if (parserHandles[textDoc.uri] !== undefined) {
    parserHandles[textDoc.uri]!.unsubscribe()
  }
  parserHandles[textDoc.uri] = undefined
}
