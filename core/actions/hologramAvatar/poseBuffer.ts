/**
 * Binary serialization for hologram pose data.
 * ~90% bandwidth savings vs JSON.
 *
 * Binary layout (261 bytes per frame):
 *   [0..239]   20 joints × 3 floats (rx, ry, rz) as Float32 = 240 bytes
 *   [240..255] 4 morph weights as Float32 = 16 bytes
 *   [256]      emotionIdx as Uint8 = 1 byte
 *   [257..260] timestamp as Uint32LE = 4 bytes
 */

import {
  POSE_BUFFER_JOINTS,
  POSE_BUFFER_MORPHS,
  POSE_BUFFER_BYTE_SIZE,
  POSE_JOINT_ORDER,
  type PoseBufferFrame,
} from '../../interfaces/hologram';

// ── Pack (encode) ───────────────────────────────────────

/**
 * Pack a pose frame into a compact Uint8Array for socket transmission.
 * Missing joints default to (0, 0, 0). Missing morphs default to 0.
 */
const packPoseBuffer = (frame: PoseBufferFrame): Uint8Array => {
  const buf = new ArrayBuffer(POSE_BUFFER_BYTE_SIZE);
  const view = new DataView(buf);
  let offset = 0;

  // Joint rotations: 20 joints × 3 floats
  for (let i = 0; i < POSE_BUFFER_JOINTS; i++) {
    const jointId = POSE_JOINT_ORDER[i];
    const joint = frame.jointRotations[jointId];
    view.setFloat32(offset, joint?.rx ?? 0, true);
    offset += 4;
    view.setFloat32(offset, joint?.ry ?? 0, true);
    offset += 4;
    view.setFloat32(offset, joint?.rz ?? 0, true);
    offset += 4;
  }

  // Morph weights: 4 floats
  for (let i = 0; i < POSE_BUFFER_MORPHS; i++) {
    view.setFloat32(offset, frame.morphWeights[i] ?? 0, true);
    offset += 4;
  }

  // Emotion index: 1 byte
  view.setUint8(offset, frame.emotionIdx & 0xff);
  offset += 1;

  // Timestamp: uint32 LE
  view.setUint32(offset, frame.timestamp >>> 0, true);

  return new Uint8Array(buf);
};

// ── Unpack (decode) ─────────────────────────────────────

/**
 * Unpack a binary pose buffer back into a structured PoseBufferFrame.
 * Returns null if buffer size doesn't match expected size.
 */
const unpackPoseBuffer = (data: Uint8Array | ArrayBuffer): PoseBufferFrame | null => {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (bytes.byteLength < POSE_BUFFER_BYTE_SIZE) return null;

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 0;

  // Joint rotations
  const jointRotations: Record<string, { rx: number; ry: number; rz: number }> = {};
  for (let i = 0; i < POSE_BUFFER_JOINTS; i++) {
    const rx = view.getFloat32(offset, true); offset += 4;
    const ry = view.getFloat32(offset, true); offset += 4;
    const rz = view.getFloat32(offset, true); offset += 4;
    // Only include non-zero joints to keep output sparse
    if (rx !== 0 || ry !== 0 || rz !== 0) {
      jointRotations[POSE_JOINT_ORDER[i]] = { rx, ry, rz };
    }
  }

  // Morph weights
  const morphWeights: [number, number, number, number] = [
    view.getFloat32(offset, true),
    view.getFloat32(offset + 4, true),
    view.getFloat32(offset + 8, true),
    view.getFloat32(offset + 12, true),
  ];
  offset += 16;

  // Emotion index
  const emotionIdx = view.getUint8(offset);
  offset += 1;

  // Timestamp
  const timestamp = view.getUint32(offset, true);

  return { jointRotations, morphWeights, emotionIdx, timestamp };
};

// ── Exports ─────────────────────────────────────────────

export { packPoseBuffer, unpackPoseBuffer, POSE_BUFFER_BYTE_SIZE };
export default { packPoseBuffer, unpackPoseBuffer };
