import { readFileSync } from 'fs';
import { join } from 'path';

import tracer from '../../lib/tracer';
import Data from '../../data';

import type { hologram_avatar } from '../../../prisma/client';

type MorphTargetEntry = {
  emotion: string;
  pose: { joints: Record<string, { rx: number; ry: number; rz: number }> };
  point_morphs: { joint_id: string; offset_delta: [number, number, number]; size_scale: number }[];
  fitness: number;
};

type SamplesFile = {
  version: string;
  performance: Record<string, { peakFitness: number; convergedGen: number; runtimeMs: number }>;
  morphTargets: Record<string, MorphTargetEntry[]>;
};

let cachedSamples: SamplesFile | null = null;

/**
 * Load GA-evolved morph target samples from hologram_samples.json.
 * Caches in memory after first load.
 */
const loadSamplesFromDisk = (): SamplesFile => {
  if (cachedSamples) return cachedSamples;

  const filePath = join(__dirname, '..', '..', '..', 'hologram_samples.json');
  const raw = readFileSync(filePath, 'utf-8');
  cachedSamples = JSON.parse(raw) as SamplesFile;
  return cachedSamples;
};

/**
 * Get all morph targets (top-1 per emotion) from GA samples.
 * Returns a Record<emotion, MorphTargetEntry[]> suitable for AvatarData.morphTargets.
 */
const getMorphTargets = (): Record<string, MorphTargetEntry[]> => {
  const samples = loadSamplesFromDisk();
  return samples.morphTargets;
};

/**
 * Save GA morph targets to an avatar's DB record.
 */
const saveMorphTargetsToAvatar = async (avatarId: string): Promise<hologram_avatar> =>
  tracer.trace('ACTION.HOLOGRAM.SAVE_MORPHS', async () => {
    const morphTargets = getMorphTargets();
    return Data.hologramAvatar.update(avatarId, { morph_targets: morphTargets });
  });

export { getMorphTargets, saveMorphTargetsToAvatar };
export default getMorphTargets;
