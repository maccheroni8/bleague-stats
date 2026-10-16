import type { MediaBinding, MediaRequest } from './mediaCatalog.ts';

/** 対象の照合だけを共有する。検証・表示許可・書き出し許可を与える関数ではない。 */
export function exactMediaBindings(bindings: readonly MediaBinding[], request: MediaRequest, teamId: string | null): MediaBinding[] {
  return bindings.filter(b => b.subject.kind === request.kind && b.season === request.season &&
    b.subject.teamId === teamId && (request.kind !== 'player' || b.subject.playerId === request.playerId));
}
