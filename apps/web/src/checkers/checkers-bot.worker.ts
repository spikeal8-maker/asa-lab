import {
  chooseCheckersBotMove,
  type CheckersBotId,
  type CheckersDocument,
} from '@asa-lab/checkers';

interface CheckersBotWorkerRequest {
  readonly document: CheckersDocument;
  readonly botId: CheckersBotId;
  readonly maxTimeMs: number;
}

addEventListener('message', (event: MessageEvent<CheckersBotWorkerRequest>) => {
  const { document, botId, maxTimeMs } = event.data;
  postMessage(chooseCheckersBotMove(document, botId, { maxTimeMs }));
});

export {};
