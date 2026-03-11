import tracer from '../../lib/tracer';

import Data from '../../data';

import type { app_version } from '../../../prisma/client';

type VersionsResult = {
  current: number | null;
  history: app_version[];
};

/**
 * Get version history.
 *
 * @returns Current version and full history.
 */
const getVersionsAction = async (): Promise<VersionsResult> =>
  tracer.trace('ACTION.VERSION.GET_VERSIONS', async () => {
    const history = await Data.version.findAll();
    const current = history.length > 0 ? history[0].version : null;

    return { current, history };
  });

export default getVersionsAction;
